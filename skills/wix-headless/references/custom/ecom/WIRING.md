---
name: custom-ecom-wiring
description: "Integration-mode wiring subagent for the ecom capability. Wires add-to-cart + checkout into a brought-in static site — @wix/ecom currentCart + a redirect to Wix-hosted checkout, client-side via @wix/sdk from CDN. No SSR cart-persistence (deferred); cart lives in the visitor session + a checkout redirect."
---

# Ecom wiring (integration mode)

You wire the **ecom capability** (add-to-cart + checkout) into a brought-in static site (`frontend = "custom"`). Pairs with the **stores** guide (which renders products). Client-side vanilla JS, `@wix/sdk` from CDN, no build. Read `INSTRUCTIONS.md` § "The technical spine" + § "Wiring discipline" first.

> **Scope.** Beta does **add-to-cart + redirect-to-Wix-hosted-checkout** via the visitor session. A persistent on-page cart UI across reloads needs the server runtime (`@wix/astro`) — **deferred**. Checkout itself happens on Wix's hosted page, so payment/fulfillment need no client work.

## Inputs

- **`appId`** — `OAuthStrategy` `clientId`.
- Binding-map / design controls: the "Add to cart" / "Buy" buttons (with the product/variant id available, e.g. from the stores wiring's `data-product-id`).

## Add to cart + checkout

```html
<script type="module">
  import { createClient, OAuthStrategy } from "https://esm.sh/@wix/sdk@1";
  import { currentCart } from "https://esm.sh/@wix/ecom@1";
  import { redirects } from "https://esm.sh/@wix/redirects@1";

  const wix = createClient({ modules: { currentCart, redirects }, auth: OAuthStrategy({ clientId: "REPLACE_WITH_APP_ID" }) });

  // Add to cart — buttons carry data-product-id (set by the stores wiring)
  document.querySelectorAll("[data-add-to-cart]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await wix.currentCart.addToCurrentCart({
          lineItems: [{
            catalogReference: {
              appId: "215238eb-22a5-4c36-9e7b-e7c08025e04e", // Wix Stores catalog appId (constant)
              catalogItemId: btn.dataset.productId,
            },
            quantity: 1,
          }],
        });
        document.querySelector("[data-cart-badge]")?.replaceChildren(document.createTextNode("•"));
      } catch (err) { console.error("[wix-ecom] add-to-cart failed:", err); }
      finally { btn.disabled = false; }
    });
  });

  // Checkout — create a checkout from the current cart, then redirect to Wix-hosted checkout
  document.querySelector("[data-checkout]")?.addEventListener("click", async () => {
    try {
      const { checkoutId } = await wix.currentCart.createCheckoutFromCurrentCart({ channelType: "WEB" });
      const { redirectSession } = await wix.redirects.createRedirectSession({
        ecomCheckout: { checkoutId },
        callbacks: { postFlowUrl: location.href },
      });
      if (redirectSession?.fullUrl) location.assign(redirectSession.fullUrl);
    } catch (err) { console.error("[wix-ecom] checkout failed:", err); }
  });
</script>
```

- **`currentCart`** APIs only — never the `cart` namespace that needs a cart ID.
- The Wix Stores catalog `appId` (`215238eb-…`) is a platform constant (the catalog provider), distinct from the site's OAuth `appId`/`clientId`.
- Cart badge is a minimal indicator; a full cart-contents page is out of Beta scope (no SSR persistence).

## React-SPA design with a server runtime (`@wix/astro`)

When the brought-in design is a **React SPA** (its own cart/checkout state in JS, e.g. a Claude-Design app that renders into `#root` via CDN React) rather than static card markup, two things change:

- **Keep checkout client-side — server-side `checkout.createCheckout` 403s.** It needs eCom *admin* scope the headless OAuth app doesn't hold, and the cart is **visitor-owned**. So even with a server runtime available, do the checkout with the **visitor identity** (`currentCart.addToCurrentCart` -> `currentCart.createCheckoutFromCurrentCart` -> `redirects.createRedirectSession` -> hosted checkout), exactly as above. Don't reach for a server route here (unlike Bookings, whose `confirmBooking` *is* app-scoped and must be server-elevated — the two verticals differ).
- **The SPA can't `import` the SDK** (its code runs via in-browser Babel, no module system). Put the eCom logic in a **bundled Astro `<script>` island** (a real `<script>`, NOT `is:inline`, so Astro bundles it with `@wix/sdk`/`@wix/ecom`/`@wix/redirects` and `WIX_CLIENT_ID` from `astro:env/client`) that exposes a `window.<fn>`; the SPA's checkout button calls it. **Map the design's own product ids to real `catalogItemId`s** — seed the catalog from the design's product data and persist a `designId -> productId` map (e.g. `src/lib/catalog-map.json`) the island reads. Clear the current cart before adding, so repeat checkouts don't accumulate.

### Sharp edges — bridging the SPA's cart to Wix line items

The SPA owns its own cart state, so the bridge from *its* cart rows to Wix line items is where parity silently breaks. Each row below has shipped a checkout whose order summary disagreed with the on-page cart — with **no error**:

| WRONG | CORRECT |
|---|---|
| Use the SPA's cart **row key** as the catalog id (`catalogMap[row.id]` where `row.id` is the drawer key) | A cart **row key** often encodes a client-only option to keep rows distinct (`productId + "::" + grind`). It is **not** a catalog id. Look up with the **real product id**; keep the row key only for qty/remove. Carry both on the row (e.g. `{ id: key, productId }`) and check out with `productId`. |
| `items.map(toLineItem).filter(Boolean)` — drop rows whose id isn't in the catalog map | A dropped row = a checkout missing items the user added, silently. After mapping, assert every row resolved (`lineItems.length === cartRows.length`); surface a mismatch — never swallow it with `.filter(Boolean)`. |
| Emit one line item per cart row | Multiple rows can resolve to the **same** `catalogItemId` (e.g. two grinds of one coffee). **Sum quantities per `catalogItemId`** into one line so the summary is predictable instead of relying on implicit cart merge. |
| Treat a client-only option (grind, size, gift-wrap) as if it reaches the order | It does **not** unless modeled as a real Stores **variant** (carry the `variantId` in `catalogReference`) or **modifier** (carry `options`/`customTextFields`). A bare design label is cosmetic and is lost at checkout. Decide up front: model it as a variant/modifier, or tell the user it won't appear on the order. |

**Loading state must survive bfcache.** A checkout button that sets a "starting…" flag then `location.assign(redirectSession.fullUrl)` leaves the page; pressing **Back** restores it from bfcache with the flag still set → button stuck on "Starting checkout…". Reset on `pageshow`:

```js
window.addEventListener("pageshow", () => setCheckingOut(false));
```

> Same trap on **any** control that redirects to a Wix-hosted page — bookings payment, member login. Apply the same `pageshow` reset wherever a button redirects off-page.

## Discipline & return

Additive; inline the site `appId`; guard calls. **Verify cart↔checkout parity** before returning: add several items (including any with a client-only option) and confirm the Wix order summary's line count + quantities match the on-page cart — this is the check that catches the silent-drop and row-key-vs-id bugs above. Return per `shared/RETURN_CONTRACT.md`: files edited, controls wired (add-to-cart count, checkout button), and note that persistent cart UI is deferred.
