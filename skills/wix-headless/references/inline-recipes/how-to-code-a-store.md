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

## The shapes you read (field cheat-sheet)

The exact field paths the storefront reads, and the **plausible-wrong sibling** each is mistaken for — the sections below reference these instead of re-describing them. All `amount`s are **strings**. These are **read** shapes; the cart-add body (under *Adding to cart*) is a separate **write** shape, and the `_id` rule applies to read **entities**, not to method-return wrappers (note `checkoutId`).

```jsonc
// productsV3.queryProducts() / .searchProducts()  →  result.items[]
product = {
  _id,                                            // links · cart catalogItemId · variant filter   (NOT .id → empty → HTTP 500)
  slug, name, visible,                            // only visible:true is returned to a visitor token
  actualPriceRange:    { minValue: { amount } },  // PRICE   (NOT price.actualPrice.amount — that's the seed/WRITE shape → $NaN)
  compareAtPriceRange: { minValue: { amount } },  // strike-through price
  inventory: { availabilityStatus },              // product-level stock, "IN_STOCK"
  media: { main: { image } },                     // image is a wix:image:// id → resolve it (see Rendering images)
  plainDescription,                               // plain string; description.nodes is the rich-text form
}

// readOnlyVariantsV3.queryVariants().eq('productData.productId', product._id).find()  →  result.items[]
// variants are a SEPARATE resource — queryProducts / getProduct return variantsInfo: null
variant = {
  variantId,                                      // → cart options.variantId   (use variant.variantId ?? variant._id)
  optionChoices: [{ optionChoiceNames: { optionName, choiceName } }],  // match the buyer's Size/Color selection
  inventoryStatus: { inStock },                   // variant-level stock (boolean)
}

// currentCart.getCurrentCart()  →  { lineItems: [...] }
lineItem = { quantity, price: { amount }, image }  // price is HERE (NOT actualPriceRange); image is wix:image:// too → resolve

// currentCart.createCheckoutFromCurrentCart({ channelType })  →  { checkoutId }   // a STRING — NOT { checkout }, NOT _id
// redirects.createRedirectSession({ ecomCheckout: { checkoutId }, callbacks })  →  { redirectSession: { fullUrl } }
```

---

## The storefront features (build the ones the site needs)

Each section below is a **self-contained storefront feature** — implement only the ones the site uses; they don't have to be built in order, and some sites need just a few of them. The only ordering is *within* a feature (e.g. resolve the variant before adding it to the cart).

### Listing products (and the `_id` rule)

Query products with `productsV3.queryProducts()` / `.searchProducts()`.
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products.md?apiView=SDK>

**⚠️ `queryProducts()` takes NO arguments — it returns a builder, not a Promise.** Chain `.eq(...)`/`.limit(...)`/`.find()` on it (e.g. `await productsV3.queryProducts().limit(50).find()`). Passing a query object (`queryProducts({...})`) does **not** type-check and returns a `Promise` that has no `.limit`/`.eq`/`.find` to chain — if the SDK reference page shows a `(query, options)→Promise` signature, trust the installed no-arg builder over that example. (`searchProducts` is the one that *does* take a query — see category filtering below.)

**⚠️ CRITICAL: the entity id is `_id`, NOT `id`.** The SDK normalizes every entity's id to **`_id`**. `product.id` is `undefined` in SDK code. This is the cart-killer: feeding `product.id` into the cart's `catalogItemId` sends an empty string and the add returns **HTTP 500** (`"catalogItemId" has size 0`). Use `product._id` everywhere — in links, as the cart `catalogItemId`, and as the variant-query filter value. (If a field name surprises you, you are probably reading the REST doc view — re-open it with `?apiView=SDK`.)

**Scope of the `_id` rule — entity reads only.** `_id` is the id of a read **entity** (product, variant, cart line item). It is **not** a universal "every id field is `_id`" rule: method results name their own fields (e.g. `createCheckoutFromCurrentCart` returns `checkoutId`, *not* `_id` — see Checkout). Don't assume a method's return wrapper exposes `_id`.

**Visibility:** only `visible: true` products are returned to a visitor token, so a missing product usually means it wasn't seeded visible — not a query bug.

**Price** comes from `actualPriceRange.minValue.amount` (see the cheat-sheet) — **not** `price.actualPrice.amount` (the seed/write shape), which reads `undefined` → `$NaN`.

### Category navigation — list categories live

**Build the category nav/rail from a live `categories` query (`@wix/categories`), never from a seeded category list** — a category the owner adds later then self-registers in the nav with no code change. Query at render time and read each `{ _id, name, slug }`; render the bar only when it returns **more than one** category, and treat it as **non-fatal** (wrap in try/catch, render without the bar if it fails).

```js
import { categories } from '@wix/categories';
const res = await categories.queryCategories({
  treeReference: { appNamespace: '@wix/stores' },
}).exists('name', true).find();   // read the returned array per the SDK doc; ids are `_id`; link each to /category/<slug>
```

**⚠️ The query MUST carry a filter condition — chain `.exists('name', true)` (as above), do NOT call a bare `.find()`.** A `.find()` with no chained filter serializes an empty `"filter": {}`, which `categories/v1/categories/query` rejects with `400 INVALID_FILTER` ("Filter expression cannot contain an empty condition"). **This is fatal on the visitor/manual-client (non-Astro) path** — the call throws and the nav never renders; managed-Astro's server-side transport happens to tolerate the empty filter, so a bare `.find()` *looks* fine there but breaks the moment the same code runs client-side. `.exists('name', true)` is a tautology (every category has a `name`), so it matches **all** categories and is accepted on **both** paths — use this one shape everywhere. **Do NOT filter on `visible`** (`.eq('visible', true)`): unlike `name`, `visible` is **not declared filterable** on `queryCategories`, so it triggers a silently-swallowed `400` and the nav renders blank; if you ever need to hide a category, filter the returned array **client-side**. (`getCategoryBySlug(slug, { appNamespace: '@wix/stores' })` on the category page is unaffected — it takes no query filter.) This is a **distinct API from bookings' `categoriesV2`** — don't copy that module's query shape here; read the exact result-array key + field names from the `@wix/categories` SDK doc: <https://dev.wix.com/docs/sdk/business-solutions/categories/introduction.md?apiView=SDK>.

### Filtering products by category

**Filter server-side by the live `categoryId` — keyed on the stable category id, so products the owner adds to a category later appear with no code change or re-publish.** This is the **prescribed** approach; do **not** freeze a seed-time `category→productIds` map into the code and filter client-side against it (a product added to that category in the backoffice would never appear on its category page — the exact "owner edit is lost" failure this recipe exists to prevent).

**⚠️ CRITICAL: category filtering MUST use `searchProducts`, NOT `queryProducts`.** `directCategoriesInfo.categories` is **not declared as filterable in `queryProducts`** — passing it there returns HTTP `400 "... is not declared as filterable"`, which the SDK **swallows silently**, leaving an empty category page that looks like "no products". This is the #1 way this breaks. Use Search Products:

```js
const { items } = await productsV3.searchProducts({
  filter: { 'directCategoriesInfo.categories': { $matchItems: [{ id: categoryId }] } },
});
```

- **`categoryId`** is the stable id from the live `categories.queryCategories()` result above (a category's `_id`) — read it from the render context, never a hardcoded seed-time id list.
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

```js
const checkout = await currentCart.createCheckoutFromCurrentCart({ channelType: currentCart.ChannelType.WEB });
const session = await redirects.createRedirectSession({
  ecomCheckout: { checkoutId: checkout.checkoutId },   // checkout.checkoutId — NOT checkout._id
  callbacks: { postFlowUrl: `${origin}/`, thankYouPageUrl: `${origin}/` },
});
window.location.href = session.redirectSession.fullUrl; // the hosted-checkout URL
```

**⚠️ Return shapes are in the cheat-sheet** — `createCheckoutFromCurrentCart` gives **`checkout.checkoutId`** (a string), not `checkout._id`. Reading `checkout._id` (over-applying the `_id` rule) throws *"Cannot read properties of undefined (reading '_id')"* — the silent checkout crash.

**⚠️ CRITICAL: `origin` for `postFlowUrl`/`thankYouPageUrl` MUST be the `https://` published host — derive it from `window.location.origin`, NEVER `new URL(request.url).origin`.** The Headless redirect allowlist registers the site's **`https://`** host and treats **`http://<same host>` as a different, unlisted origin**. When the buyer returns from the hosted checkout (e.g. clicks "Continue Browsing"), the redirect goes through the allowlist — and an `http://` `postFlowUrl` **403s** with *"… isn't listed as an allowed redirect domain."* If you build the redirect session in a **server route** (`src/pages/api/*`), `new URL(request.url).origin` resolves to **`http://`** behind Wix's TLS-terminating proxy → guaranteed 403 on return. So **pass `window.location.origin` from the client** into the route (don't read the origin off the request), or force the scheme to `https`. Doc: <https://dev.wix.com/docs/go-headless/getting-started/setup/manage-urls/add-allowed-redirect-domains>.

### Showing stock state

Read the **V3** inventory fields: product-level in-stock is `product.inventory.availabilityStatus` (`"IN_STOCK"`); variant-level is `variant.inventoryStatus.inStock`. Reading the V1 inventory field on V3 data returns `undefined` → everything renders out-of-stock (the all-OOS bug). These come from `productsV3` / `readOnlyVariantsV3`, not the V1 module.

### Rendering product images

Product media may come back as a **`wix:image://v1/<hash>/<file>#originWidth=…` identifier, not a ready URL** — this is what the SDK returns for images stored in Wix Media (e.g. once brand imagery is attached). Putting that string straight into `<img src>` shows nothing. `media.main` may carry **either** an already-absolute `.url` (e.g. an Unsplash placeholder seeded when imagery is off) **or** an `.image` that is a `wix:image://` id needing resolution — handle both with **one** helper and reuse it on every page that renders an image:

```js
import { media } from '@wix/sdk';
function imgSrc(mediaMain, w = 600, h = 600) {
  const v = mediaMain?.image ?? mediaMain?.url ?? mediaMain;   // the value can be a string or {url}
  if (!v) return '';
  if (typeof v === 'string' && v.startsWith('wix:image://')) return media.getScaledToFillImageUrl(v, w, h);
  return typeof v === 'string' ? v : (v.url ?? '');            // already an absolute https URL
}
```

**⚠️ Do NOT write `m.url ?? m.image` (or `image?.url ?? image`).** That returns the bare **`wix:image://` string** whenever `.url` is absent — which is exactly the Wix-Media case — and the browser fails it with **`ERR_UNKNOWN_URL_SCHEME`** (blank image). The `wix:image://` branch must go through `media.getScaledToFillImageUrl`; never return it raw. Define the helper **once** and call it from every render path (home, listing, product, cart) — resolving on some pages but not others is the common partial failure.

**Never hand-build a `static.wixstatic.com/.../v1/fit/...` URL** either — the format is easy to get wrong and the image then **403s**. Only `wix:image://` values need resolving; an already-absolute `https://` URL goes straight into `<img src>`. Doc: <https://dev.wix.com/docs/sdk/core-modules/sdk/media>

**This applies to cart line-item images too, not just product reads.** A cart `lineItem.image` is the same `wix:image://` identifier — run it through the same `imgSrc()` helper before `<img src>`. (If you build the cart over an API route, resolve there and return a ready URL so the component never sees a `wix:image://`.)

### Rendering product descriptions

Don't print the raw node object. A product description is rich text (`description.nodes`). Render the rich-text nodes, or use `plainDescription` for a plain string. Printing the raw node object dumps literal `<p>…</p>` into the page.

### SEO on item pages (Astro, Wix-managed)

A **product detail** page is a Wix **item page**: its `<title>`/description/OG/canonical come from what the owner sets in the dashboard. On the Astro (Wix-managed) frontend, wire it per the canonical guide — **[Add SEO Support to Item Pages](https://dev.wix.com/docs/go-headless/wix-managed-headless/seo/add-seo-support-to-item-pages.md)** — which covers the three steps: export `wixMetadata` (registers the route → sitemap + dashboard SEO editor), call `loadSEOTagsServiceConfig(...)`, and render `<SEO.Tags>` (from `@wix/seo`; deps + `@wix/essentials ≥ 1.0.10` are in the guide's "Before you begin").

For a product page use:
- **`wixMetadata`** from `WIX_APPS.checkoutAndOrders.productPageMetadata` — referenced **directly** in the export (module scope). ⚠️ It's `WIX_APPS.checkoutAndOrders`, **not** `WIX_APPS.stores` (`stores.id` is the catalog id for `catalogReference`, a different value). The `identifiers` key is your route param; the token is `…productPageMetadata.identifiers.handle`.
- **`itemType`**: `seoTags.ItemType.STORES_PRODUCT`.

**If you build a dedicated category route** (e.g. `/category/[slug]` or `/search/[collection]`), wire it the same way with `WIX_APPS.checkoutAndOrders.categoryPageMetadata` + `seoTags.ItemType.STORES_CATEGORY`. (A category rendered only as a query-string *filter* on the products listing is a main page — it gets its SEO from automatic injection, no `wixMetadata` needed.)

Optional: render a `Product` schema.org JSON-LD `<script>` from the fetched product for rich results (see the guide's structured-data step).

---

## Conclusion
A correct Catalog V3 storefront frontend:
- imports **`productsV3` / `readOnlyVariantsV3` / `categories` / `currentCart` / `redirects`** — never the V1 `products`/`collections` modules;
- uses **`product._id`** (never `product.id`) as the cart's `catalogItemId`;
- resolves the **mandatory `variantId`** via `readOnlyVariantsV3` and passes it as `options.variantId` (not `options.options`);
- builds its category nav from a **live `categories.queryCategories()`** and filters category pages server-side with **`searchProducts` + `$matchItems: [{ id: categoryId }]`** keyed on the live `categoryId` — never a frozen seed-time `productIds` map, never `queryProducts` for category filtering, never `$hasSome`, never V1 `collectionIds`;
- reads inventory from the **V3** shape and renders rich-text descriptions, not raw nodes.
