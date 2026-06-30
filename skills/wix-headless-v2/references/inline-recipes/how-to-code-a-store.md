---
name: "How to Code a Store"
description: The frontend read/cart contract for a Catalog V3 storefront — which SDK modules to import, how to resolve the mandatory variantId, the exact add-to-cart shape, how to filter by category, and how to read inventory. Specifies the *how* (modules + exact calls + the failure modes the docs omit); which products/categories to render come from the catalog the storefront reads.
---
**RECIPE**: How to Code a Wix Online Store Frontend (Catalog V3 + eCommerce cart)

A concise contract for writing the **frontend code** of a storefront against a Catalog V3 store: listing products, filtering by category, adding to cart, and checking out. **This recipe is the *how* (which modules, which calls, which fields), not the *what*** — which products to show, how the page looks, and the framework are decided by the request you're fulfilling.

> **This recipe is for CODING the storefront, not for seeding it.** It assumes a Catalog V3 store already exists (products, variants, categories, inventory). It says nothing about creating products — only how to read and purchase them from frontend code.

> **⚠️ Reading rule — always append `.md?apiView=SDK` to every doc link below.** The Wix docs render two views of the same page. The **bare / REST view shows `id`**; the **`?apiView=SDK` view shows `_id`** — and the SDK is what your frontend calls. Reading the REST view by mistake is the single most common source of the cart-killing `product.id` bug (see the `_id` rule under *Listing products*). Fetch the `.md?apiView=SDK` form directly; don't re-discover these with search.

---

## The modules and the client (read this first)

**Stores app id** (a constant you will need for the cart's `catalogReference`):
`215238eb-22a5-4c36-9e7b-e7c08025e04e`

**⚠️ CRITICAL: use the V3 SDK modules, never the V1 ones.** The store is seeded with Catalog **V3** data. The legacy V1 `products` / `collections` modules read a different shape against the same data and fail in ways the SDK swallows silently (empty category pages, unresolved variants, `400`s on server-side filters). Import only:

| Need | Package | Module |
|---|---|---|
| Products (list, get, search, filter) | `@wix/stores` | `productsV3` |
| Variants (to resolve `variantId`) | `@wix/stores` | `readOnlyVariantsV3` |
| Categories | `@wix/stores` | `categories` |
| Cart (add / get / checkout) | `@wix/ecom` | `currentCart` |
| Redirect to hosted checkout | `@wix/redirects` | `redirects` |

**Never** import the V1 `products` or `collections` modules from `@wix/stores`.

**Auth / client — framework split:**
- **Astro (Wix-managed):** authentication is ambient. Call `currentCart` / `productsV3` / `readOnlyVariantsV3` directly from server components and backend routes (`src/pages/api/*.ts`) — **no `createClient`, no `OAuthStrategy`, no `clientId`.**
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client and reuse it:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { productsV3, readOnlyVariantsV3 } from '@wix/stores';
  import { currentCart } from '@wix/ecom';
  import { redirects } from '@wix/redirects';

  const client = createClient({
    modules: { productsV3, readOnlyVariantsV3, currentCart, redirects },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  ```
  The `clientId` is public, not a secret.

---

## The storefront features (build the ones the site needs)

Each section below is a **self-contained storefront feature** — implement only the ones the site uses; they don't have to be built in order, and some sites need just a few of them. The only ordering is *within* a feature (e.g. resolve the variant before adding it to the cart).

### Listing products (and the `_id` rule)

Query products with `productsV3.queryProducts()` / `.searchProducts()`.
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products.md?apiView=SDK>

**⚠️ CRITICAL: the entity id is `_id`, NOT `id`.** The SDK normalizes every entity's id to **`_id`**. `product.id` is `undefined` in SDK code. This is the cart-killer: feeding `product.id` into the cart's `catalogItemId` sends an empty string and the add returns **HTTP 500** (`"catalogItemId" has size 0`). Use `product._id` everywhere — in links, as the cart `catalogItemId`, and as the variant-query filter value. (If a field name surprises you, you are probably reading the REST doc view — re-open it with `?apiView=SDK`.)

**Visibility:** only `visible: true` products are returned to a visitor token, so a missing product usually means it wasn't seeded visible — not a query bug.

### Filtering products by category

**✅ DEFAULT — filter client-side by `_id`.** Keep the category→`productIds` map you already have for the storefront, fetch the full product list once with `productsV3.queryProducts()`, and filter it **client-side**: `products.filter(p => categoryProductIds.includes(p._id))`. The SDK `_id` matches the seeded product ids. This is the **only approach proven to work reliably** — it sidesteps every server-filter pitfall below. Prefer it.

**Server-side filtering (only if you truly can't filter client-side):**

**⚠️ CRITICAL: category filtering MUST use `searchProducts`, NOT `queryProducts`.** `directCategoriesInfo.categories` is **not declared as filterable in `queryProducts`** — passing it there returns HTTP `400 "... is not declared as filterable"`, which the SDK **swallows silently**, leaving an empty category page that looks like "no products". This is the #1 way this breaks. Use Search Products:

```js
const { items } = await productsV3.searchProducts({
  filter: { 'directCategoriesInfo.categories': { $matchItems: [{ id: categoryId }] } },
});
```

- **Method:** `searchProducts`, never `queryProducts` (the field is only filterable in search).
- **Operator:** `$matchItems`, never `$hasSome` (the natural-looking guess returns nothing).
- **Inner key:** `id` (the category GUID), inside `$matchItems: [{ id: … }]`.
- **Never** the V1 `collectionIds` / `collections.id` paths — they return empty against V3 data.

Docs: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/supported-filters-and-sorting.md?apiView=SDK>

### Adding to cart — the V3 cart contract

Adding to cart is two parts of **one feature**: resolve the variant first, then add it. The variant resolution is not a standalone concern — it exists only to feed the add call.

**1 · Resolve the `variantId` (mandatory).** Variants are a **separate read-only resource** — `queryProducts` / `getProduct` do **not** return variant data (this is documented; `variantsInfo` comes back `null`). Resolve the variant yourself:

```js
const { items } = await readOnlyVariantsV3
  .queryVariants()
  .eq('productData.productId', product._id)   // NOTE: productData.productId is the filter field
  .find();
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/read-only-variants-v3/query-variants.md?apiView=SDK>

Each `variant` carries `variant.optionChoices[].optionChoiceNames` — `{ optionName, choiceName }`. Match the buyer's selected options (Size = "Small", Color = "Red", …) against those names to pick the variant. For a **single-variant** product, use the only item. Fall back to `items[0]` if matching yields nothing. The id to send to the cart is **`variant.variantId ?? variant._id`**.

**2 · Add it.** Doc: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart/add-to-current-cart.md?apiView=SDK> · catalogReference contract: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/e-commerce-integration.md?apiView=SDK>

```js
await currentCart.addToCurrentCart({
  lineItems: [{
    quantity,
    catalogReference: {
      catalogItemId: product._id,                 // the product's _id (the `_id` rule above)
      appId: '215238eb-22a5-4c36-9e7b-e7c08025e04e',
      options: { variantId },                     // the resolved variantId from part 1
    },
  }],
});
```

**⚠️ CRITICAL: `options.variantId` is MANDATORY for any product that has variants.** Adding by `catalogItemId` alone returns **HTTP 200 but adds nothing** — the silent empty cart. The cart method's required-params list omits `variantId`, so this fails quietly and looks like success. Always resolve and include it (part 1 above).

**⚠️ CRITICAL: `options.options` is for MODIFIERS, not variant selection.** Product option selections (Size/Color) are resolved to a **variant** and referenced by `variantId`. `options.options` is only for free-text / TEXT_CHOICES add-on **modifiers**. Do **not** encode Size/Color as `options.options` — that is the coffee-grind bug (`200` + empty cart).

### Checkout

Create a checkout from the current cart, then redirect the buyer to the hosted checkout.
Docs: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart/create-checkout-from-current-cart.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart/get-current-cart.md?apiView=SDK>

Use `currentCart.createCheckoutFromCurrentCart(...)` to get a `checkoutId`, then `redirects.createRedirectSession(...)` with that checkout to obtain the hosted-checkout URL and send the buyer there.

### Showing stock state

Read the **V3** inventory fields: product-level in-stock is `product.inventory.availabilityStatus` (`"IN_STOCK"`); variant-level is `variant.inventoryStatus.inStock`. Reading the V1 inventory field on V3 data returns `undefined` → everything renders out-of-stock (the all-OOS bug). These come from `productsV3` / `readOnlyVariantsV3`, not the V1 module.

### Rendering product images

Product media may come back as a **`wix:image://v1/<hash>/<file>#originWidth=…` identifier, not a ready URL** — this is what the SDK returns for images stored in Wix Media (e.g. once brand imagery is attached). Putting that string straight into `<img src>` shows nothing. Resolve it with the SDK media module:

```js
import { media } from '@wix/sdk';
const src = media.getScaledToFillImageUrl(product.media.main.image, 600, 600); // or media.getImageUrl(...).url for the original
```

**Never hand-build a `static.wixstatic.com/.../v1/fit/...` URL** — the format is easy to get wrong and the image then **403s**. Only `wix:image://` values need resolving; an already-absolute `https://` URL (e.g. an Unsplash placeholder seeded when imagery is off) goes straight into `<img src>`. Doc: <https://dev.wix.com/docs/sdk/core-modules/sdk/media>

### Rendering product descriptions

Don't print the raw node object. A product description is rich text (`description.nodes`). Render the rich-text nodes, or use `plainDescription` for a plain string. Printing the raw node object dumps literal `<p>…</p>` into the page.

---

## Conclusion
A correct Catalog V3 storefront frontend:
- imports **`productsV3` / `readOnlyVariantsV3` / `categories` / `currentCart` / `redirects`** — never the V1 `products`/`collections` modules;
- uses **`product._id`** (never `product.id`) as the cart's `catalogItemId`;
- resolves the **mandatory `variantId`** via `readOnlyVariantsV3` and passes it as `options.variantId` (not `options.options`);
- filters categories **client-side by `_id`** (default), or server-side with **`searchProducts` + `$matchItems`** — never `queryProducts` for category filtering, never `$hasSome`, never V1 `collectionIds`;
- reads inventory from the **V3** shape and renders rich-text descriptions, not raw nodes.
