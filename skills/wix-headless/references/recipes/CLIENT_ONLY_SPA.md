# Recipe: Client-only SPA storefront

For Path B existing projects that run **entirely in the browser** — Vite/Webpack/Parcel single-page apps, hand-coded React-via-CDN pages, Next.js in client-mode, anything without Node SSR. The Wix SDK runs under **visitor OAuth scope**, which strips fields admin scope returns. The Path A Astro templates assume SSR + admin scope (via `@wix/essentials.elevate()`) and silently don't translate to the browser. This file is the explicit recipe for the browser case.

> When does this apply? You're in Path B, your build output is a directory of static files (no Node runtime at request time), and your existing project doesn't use Astro's SSR adapter. If you're not sure, run `grep -r "output:\\s*\"server\"" .` against the project: empty result → you're client-only → use this file.

## Visitor vs admin scope cheat sheet

| Endpoint | Visitor (browser) | Admin (SSR / elevated) |
|---|---|---|
| `productsV3.queryProducts().find()` | `variantsInfo` is stripped — **no SKU, no variantId, no price** | Full data |
| `productsV3.searchProducts(...).find()` | Same — variants stripped | Full data |
| `productsV3.getProductBySlug(slug)` | Returns variants | Same |
| `productsV3.getProduct(id)` | Returns variants | Same |
| `readOnlyVariantsV3.queryVariants().find()` | Returns variants + embedded `productData` (productId, name, slug) | Same |
| `currentCart.addToCurrentCart(...)` | Works | Works |
| `currentCart.createCheckoutFromCurrentCart(...)` | Works | Works |
| `redirects.createRedirectSession(...)` | Works | Works |
| `categories.queryCategoriesForApp(...).find()` | Works (always chain `.eq("visible", true)` — empty filter rejected as `INVALID_FILTER`) | Same |

**Rule of thumb.** For product **listings** in the browser, do NOT use `productsV3.queryProducts` — it returns products with no SKU and no variantId, so you can't add anything to a cart. Use `readOnlyVariantsV3.queryVariants` instead. The variant response embeds `productData`, so a single call gives you everything a listing needs.

For product **detail pages** in the browser, `productsV3.getProductBySlug(slug)` works — the per-entity endpoints return full variants under visitor scope.

## Setup

```ts
// src/wix.ts
import { createClient, OAuthStrategy } from "@wix/sdk";
import { productsV3, readOnlyVariantsV3 } from "@wix/stores";
import { currentCart } from "@wix/ecom";
import { redirects } from "@wix/redirects";

const WIX_CLIENT_ID = "<appId from wix.config.json>"; // see SETUP.md § E4
export const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

export const wix = createClient({
  modules: { productsV3, readOnlyVariantsV3, currentCart, redirects },
  auth: OAuthStrategy({ clientId: WIX_CLIENT_ID }),
});
```

Dependencies:

```bash
npm i @wix/sdk @wix/stores @wix/ecom @wix/redirects --legacy-peer-deps
```

## Recipe 1 — Product listing (single call)

```ts
import { wix } from "./wix";

type Listing = {
  id: string;          // catalogItemId for cart
  variantId: string;
  name: string;
  slug: string;
  price: number;       // cents
  sku: string;
};

export async function loadListings(): Promise<Listing[]> {
  // Note: SDK find() returns the entity list under the entity key.
  // For queryVariants that's `variants`, NOT `items`. Some SDK builds also
  // surface it as `items` — read both for safety.
  const res: any = await wix.readOnlyVariantsV3.queryVariants().find();
  const list: any[] = res.items ?? res.variants ?? [];
  const out: Listing[] = [];
  for (const v of list) {
    const pd = v.productData ?? {};
    if (!pd.productId) continue;
    const amount: string = v.price?.actualPrice?.amount ?? "0";
    out.push({
      id: pd.productId,
      variantId: v.id,
      name: pd.name ?? v.sku ?? "",
      slug: pd.slug ?? "",
      sku: v.sku ?? "",
      price: Math.round(parseFloat(amount) * 100),
    });
  }
  return out;
}
```

Why not `productsV3.queryProducts`: at visitor scope it returns products with no `variantsInfo`. Your add-to-cart would then have no `variantId` to pass — and every single-variant product silently fails to add.

## Recipe 2 — Add to current cart

```ts
import { wix, STORES_APP_ID } from "./wix";

export async function addToCart(items: { productId: string; variantId: string; quantity: number }[]) {
  await wix.currentCart.addToCurrentCart({
    lineItems: items.map((it) => ({
      catalogReference: {
        catalogItemId: it.productId,
        appId: STORES_APP_ID,        // the Stores install id, not the back-in-stock id
        options: { variantId: it.variantId },
      },
      quantity: it.quantity,
    })),
  });
}
```

`STORES_APP_ID` is `215238eb-22a5-4c36-9e7b-e7c08025e04e` (Wix Stores). Do NOT use `1380b703-…` here — that's the Back-in-Stock app id, which `bulkAddItemsToCategory` happens to use for the items-side, but the cart's `catalogReference.appId` is always the Stores install id.

## Recipe 3 — Checkout redirect

The Wix Headless checkout flow is: build a cart server-side, create a Wix checkout, get a redirect URL, send the browser there. The visitor returns via your `thankYouPageUrl` callback.

```ts
import { wix } from "./wix";

export async function checkoutCurrentCart(opts?: { thankYouPath?: string }) {
  // 1) cart → checkout
  const { checkoutId } = await wix.currentCart.createCheckoutFromCurrentCart({
    channelType: "WEB" as any, // SDK literal type narrows tighter than runtime
  });
  if (!checkoutId) throw new Error("createCheckoutFromCurrentCart returned no checkoutId");

  // 2) checkout → redirect session
  const { redirectSession } = await wix.redirects.createRedirectSession({
    ecomCheckout: { checkoutId },
    callbacks: {
      postFlowUrl: window.location.href,
      thankYouPageUrl: window.location.origin + (opts?.thankYouPath ?? "/?thank-you=1"),
    },
  });

  // 3) hand off the browser
  const url = redirectSession?.fullUrl;
  if (!url) throw new Error("createRedirectSession returned no fullUrl");
  window.location.href = url;
}
```

After the visitor checks out, Wix redirects them to `thankYouPageUrl`. Handle the return:

```ts
import { useEffect } from "react";

export function useThankYouHandler(onSuccess: () => void) {
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("thank-you") === "1") {
      onSuccess();
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
}
```

## Recipe 4 — Product detail (slug-routed page)

`productsV3.getProductBySlug` works at visitor scope — variants come back in full.

```ts
import { wix } from "./wix";

export async function loadProductBySlug(slug: string) {
  const res: any = await wix.productsV3.getProductBySlug(slug);
  const p = res.product ?? res;
  const variant = p.variantsInfo?.variants?.[0];
  return {
    id: p.id,
    name: p.name,
    description: p.plainDescription,
    media: p.media?.itemsInfo?.items ?? [],
    variantId: variant?.id,
    sku: variant?.sku,
    price: Math.round(parseFloat(variant?.price?.actualPrice?.amount ?? "0") * 100),
  };
}
```

## Verification checklist

After wiring, before `wix release`:

- [ ] Product list renders > 0 cards. If the list is empty but you know products exist, you're almost certainly hitting the `productsV3.queryProducts` visitor-scope trap — switch to `readOnlyVariantsV3.queryVariants`.
- [ ] Add to cart returns 200 (check Network tab). 400 on `/ecom/v1/.../add-to-current-cart` usually means missing `appId` or `variantId` in `catalogReference`.
- [ ] Checkout button reaches a `https://www.wix.com/.../checkout?...` redirect URL. If `createRedirectSession` returns no `fullUrl`, the cart is empty — `addToCurrentCart` silently no-op'd.
- [ ] Return from Wix checkout hits your `thankYouPageUrl` with the expected query param.

## Things this recipe does NOT cover

- **Inventory management.** `inventoryItemsV3.*` is admin scope; visitors can't change inventory.
- **Member-area / login flows.** Use `members` + `OAuthStrategy` with a `tokens` callback that persists to `localStorage`. Out of scope here.
- **Real product images.** This recipe is data-layer-only — UI is your project's responsibility. For Wix-hosted media, see `templates/stores/ProductCard.astro` and adapt the `resolveWixImageUrl` helper.
- **Discount ribbons / offers.** See `templates/ecom/discounts.ts` — note it uses `auth.elevate()` which DOES NOT work at visitor scope. For visitor-side discount surfacing you need to call the discount-rules read endpoint with explicit visitor auth, which is a separate recipe.

## Related

- `<SKILL_ROOT>/references/SETUP.md` § Step E4 — when this recipe applies.
- `<SKILL_ROOT>/references/stores/INSTRUCTIONS.md` — admin-scope reference (Path A subagent guidance; do not copy verbatim into a browser project).
- `<SKILL_ROOT>/templates/stores/products/[slug].astro` — Astro SSR equivalent of Recipe 4. Top comment explains the SSR requirement; this file is its browser counterpart.
