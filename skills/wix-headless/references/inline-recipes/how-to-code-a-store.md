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
| Categories | `@wix/categories` | `categories` |
| Cart (add / get / checkout) | `@wix/ecom` | `currentCartV2` |
| Redirect to hosted checkout | `@wix/redirects` | `redirects` |

> Migrating from Cart V1 / Checkout V1? The code below is V2-only — see the [migration guide](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/migration-guide) for the before/after.

**Never** import the V1 `products` or `collections` modules from `@wix/stores`.

**Auth / client — framework split:**
- **Astro (Wix-managed):** authentication is ambient. Call `currentCartV2` / `productsV3` / `readOnlyVariantsV3` directly from server components and backend routes (`src/pages/api/*.ts`) — **no `createClient`, no `OAuthStrategy`, no `clientId`.**
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client and reuse it:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { productsV3, readOnlyVariantsV3 } from '@wix/stores';
  import { currentCartV2 } from '@wix/ecom';
  import { redirects } from '@wix/redirects';

  const client = createClient({
    modules: { productsV3, readOnlyVariantsV3, currentCartV2, redirects },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  ```
  The `clientId` is public, not a secret.

---

## The shapes you read (field cheat-sheet)

The exact field paths the storefront reads, and the **plausible-wrong sibling** each is mistaken for — the sections below reference these instead of re-describing them. All `amount`s are **strings**. These are **read** shapes; the cart-add body (under *Adding to cart*) is a separate **write** shape, and the `_id` rule applies to read **entities**, not to request params (note the redirect session's `checkoutId`, which is just the cart's `_id`).

```jsonc
// CURRENCY populates formattedAmount; MEDIA_ITEMS_INFO populates media.itemsInfo (the gallery); the detail read adds PLAIN_DESCRIPTION + VARIANT_OPTION_CHOICE_NAMES.
// `fields` is searchProducts' SECOND argument (its options object) — put it inside the search object and it is silently ignored → no CURRENCY → unformatted prices.
const LIST_FIELDS   = ['CURRENCY', 'MEDIA_ITEMS_INFO'];
const DETAIL_FIELDS = [...LIST_FIELDS, 'PLAIN_DESCRIPTION', 'VARIANT_OPTION_CHOICE_NAMES'];
// productsV3.queryProducts({ fields: LIST_FIELDS }).…find()       →  result.items[]
// productsV3.searchProducts({ filter }, { fields: LIST_FIELDS })  →  result.products[]
// productsV3.getProductBySlug(slug, { fields: DETAIL_FIELDS })    →  result.product
product = {
  _id,                                            // links · cart catalogItemId · variant filter   (NOT .id → empty → HTTP 500)
  slug, name, visible,                            // only visible:true is returned to a visitor token
  currency,                                       // present when CURRENCY is requested
  actualPriceRange:    { minValue: { amount, formattedAmount } },  // PRICE   (NOT price.actualPrice.amount — a product carries ranges only → $NaN; that path exists on a VARIANT)
  compareAtPriceRange: { minValue: { amount, formattedAmount } },  // strike-through price
  inventory: { availabilityStatus, preorderStatus },  // stock: IN_STOCK | OUT_OF_STOCK | PARTIALLY_OUT_OF_STOCK; preorderStatus 'ENABLED' on an OOS product → "Pre-order"
  media: { main: { image } },                     // image is a wix:image:// id → resolve it (see Rendering images)
  plainDescription,                               // an HTML string — render as HTML; description.nodes is the rich-text form
}

// list/search reads carry NO variant data; the DETAIL read does — getProduct / getProductBySlug return variantsInfo.variants[] when VARIANT_OPTION_CHOICE_NAMES is requested.
// readOnlyVariantsV3.queryVariants().eq('productData.productId', product._id).find()  →  result.items[]   // for variant-centric queries across products
variant = {
  variantId,                                      // → cart options.variantId   (use variant.variantId ?? variant._id)
  optionChoices: [{ optionChoiceNames: { optionName, choiceName } }],  // match the buyer's Size/Color selection
  price: { actualPrice: { amount, formattedAmount } },  // VARIANT-level price (formattedAmount with CURRENCY); the product level carries ranges instead
  inventoryStatus: { inStock },                   // variant-level stock (boolean)
}

// currentCartV2.getCurrentCart()  →  { cart: { _id, lineItems: [...] } }   // NOTE: returns { cart } — destructure it
lineItem = { _id, status, name: { original }, quantityInfo: { confirmedQuantity }, pricing: { unitPrice: { amount } }, source: { catalogReference: { catalogItemId } } }
// _id → the lineItemId for update/remove (NOT the product id); status → 'IN_STOCK', or a reason to block checkout
// price → pricing.unitPrice (ConvertedMoney, NO formatted string in V2 — format it yourself; .amount is site currency, .convertedAmount the buyer's display currency); qty → quantityInfo.confirmedQuantity
// image → NOT on the line — join it from the catalog by source.catalogReference.catalogItemId (see Rendering images)

// the cart's _id is the checkout id → pass to the redirect session:
// redirects.createRedirectSession({ ecomCheckout: { checkoutId: cart._id }, callbacks })  →  { redirectSession: { fullUrl } }
```

---

## The storefront features (build the ones the site needs)

Each section below is a **self-contained storefront feature** — implement only the ones the site uses; they don't have to be built in order, and some sites need just a few of them. The only ordering is *within* a feature (e.g. resolve the variant before adding it to the cart).

### Listing products (and the `_id` rule)

Query products with `productsV3.queryProducts()` / `.searchProducts()`. **Every product listing and
category search must request `CURRENCY` and `MEDIA_ITEMS_INFO`; the detail read adds `PLAIN_DESCRIPTION` and `VARIANT_OPTION_CHOICE_NAMES`**. Without `CURRENCY`, `formattedAmount` is omitted
and a product card renders an unsymbolled number such as `34.99` instead of a localized price. Without `MEDIA_ITEMS_INFO`, `media.itemsInfo` is absent and a gallery has a single image. Without `PLAIN_DESCRIPTION`, `product.plainDescription` is absent on the detail page.
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products.md?apiView=SDK>

**⚠️ `queryProducts()` returns a builder, not a Promise.** Pass requested fields when needed, then chain `.eq(...)`/`.limit(...)`/`.find()` — for example:

```js
const LIST_FIELDS = ['CURRENCY', 'MEDIA_ITEMS_INFO'];
const { items } = await productsV3
  .queryProducts({ fields: LIST_FIELDS })
  .limit(50)
  .find();
```

Do not pass a search/filter object to `queryProducts`; use `searchProducts` for that (see category filtering below). Reuse the same `LIST_FIELDS` / `DETAIL_FIELDS` constants for every product read so home, shop, category, and detail pages cannot drift.

**⚠️ CRITICAL: the entity id is `_id`, NOT `id`.** The SDK normalizes every entity's id to **`_id`**. `product.id` is `undefined` in SDK code. This is the cart-killer: feeding `product.id` into the cart's `catalogItemId` sends an empty string and the add returns **HTTP 500** (`"catalogItemId" has size 0`). Use `product._id` everywhere — in links, as the cart `catalogItemId`, and as the variant-query filter value. (If a field name surprises you, you are probably reading the REST doc view — re-open it with `?apiView=SDK`.)

**Scope of the `_id` rule — entity reads only.** `_id` is the id of a read **entity** (product, variant, cart line item). It is **not** a universal "every id field is `_id`" rule: request params name their own fields (e.g. the redirect session takes `ecomCheckout.checkoutId`, *not* `_id` — see the *Checkout* section below — even though the value you pass is the cart's `_id`). Don't assume every id-shaped field is spelled `_id`.

**Visibility:** only `visible: true` products are returned to a visitor token, so a missing product usually means it wasn't seeded visible — not a query bug.

**Price:** after requesting `CURRENCY`, render `actualPriceRange.minValue.formattedAmount` (and the matching `compareAtPriceRange` value) directly. Fall back to raw `.amount` only if the formatted value is unexpectedly absent. At **product** level never use `price.actualPrice.amount` — a product exposes ranges only, so it reads `undefined` → `$NaN`; a **variant** does carry `price.actualPrice` (with `formattedAmount` when `CURRENCY` is requested).

### Category navigation — list categories live

**Build the category nav/rail from a live `categories` query (`@wix/categories`), never from a seeded category list** — a category the owner adds later then self-registers in the nav with no code change. Query at render time and read each `{ _id, name, slug }`, **dropping Wix's auto-created `all-products` system category** (`slug === 'all-products'` — it contains every product) before you count or render; render the bar only when **more than one** category remains, and treat it as **non-fatal** (wrap in try/catch, render without the bar if it fails).

```js
import { categories } from '@wix/categories';
const res = await categories.queryCategories({
  treeReference: { appNamespace: '@wix/stores' },
}).exists('name', true).find();   // read the returned array per the SDK doc; ids are `_id`; link each to /category/<slug>
```

**⚠️ The query MUST carry a filter condition — chain `.exists('name', true)` (as above), do NOT call a bare `.find()`.** A `.find()` with no chained filter serializes an empty `"filter": {}`, which `categories/v1/categories/query` rejects with `400 INVALID_FILTER` ("Filter expression cannot contain an empty condition"). **This is fatal on the visitor/manual-client (non-Astro) path** — the call throws and the nav never renders; managed-Astro's server-side transport happens to tolerate the empty filter, so a bare `.find()` *looks* fine there but breaks the moment the same code runs client-side. `.exists('name', true)` is a tautology (every category has a `name`), so it matches **all** categories and is accepted on **both** paths — use this one shape everywhere. **Do NOT filter on `visible`** (`.eq('visible', true)`): unlike `name`, `visible` is **not declared filterable** on `queryCategories`, so it triggers a silently-swallowed `400` and the nav renders blank; if you ever need to hide a category, filter the returned array **client-side**. (`getCategoryBySlug(slug, { appNamespace: '@wix/stores' })` on the category page is unaffected — it takes no query filter.) This is a **distinct API from bookings' `categoriesV2`** — don't copy that module's query shape here; read the exact result-array key + field names from the `@wix/categories` SDK doc: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/introduction.md?apiView=SDK>.

### Filtering products by category

**Filter server-side by the live `categoryId` — keyed on the stable category id, so products the owner adds to a category later appear with no code change or re-publish.** This is the **prescribed** approach; do **not** freeze a seed-time `category→productIds` map into the code and filter client-side against it (a product added to that category in the backoffice would never appear on its category page — the exact "owner edit is lost" failure this recipe exists to prevent).

**⚠️ CRITICAL: category filtering MUST use `searchProducts`, NOT `queryProducts`.** `allCategoriesInfo.categories` is **not declared as filterable in `queryProducts`** — passing it there returns HTTP `400 "... is not declared as filterable"`, which the SDK **swallows silently**, leaving an empty category page that looks like "no products". This is the #1 way this breaks. Use Search Products:

```js
const { products } = await productsV3.searchProducts(
  { filter: { 'allCategoriesInfo.categories': { $matchItems: [{ id: categoryId }] } } },
  { fields: LIST_FIELDS },
);
```

- **`categoryId`** is the stable id from the live `categories.queryCategories()` result above (a category's `_id`) — read it from the render context, never a hardcoded seed-time id list.
- **Field:** `allCategoriesInfo.categories`, which includes **inherited parent categories** — a parent page still lists the products sitting in its children. `directCategoriesInfo.categories` (same `$matchItems` shape, also search-only) is the deliberate choice only when a page must show **direct assignments alone**: on a parent page in a nested tree it returns zero products.
- **Method:** `searchProducts`, never `queryProducts` (the field is only filterable in search).
- **Operator:** `$matchItems`, never `$hasSome` (the natural-looking guess returns nothing).
- **Inner key:** `id` (the category GUID), inside `$matchItems: [{ id: … }]`.
- **Never** the V1 `collectionIds` / `collections.id` paths — they return empty against V3 data.

Docs: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/supported-filters-and-sorting.md?apiView=SDK>

### Adding to cart — the V3 cart contract

Adding to cart is two ordered parts of **one feature**: resolve the variant first, then add it. The variant resolution is not a standalone concern — it exists only to feed the add call. Changing and removing lines (part 3) is the same cart contract, unordered.

**1 · Resolve the `variantId` (mandatory).** A **list/search** read carries no variant data. The **detail** read does: `getProduct` / `getProductBySlug` return `variantsInfo.variants[]` when the read requests `VARIANT_OPTION_CHOICE_NAMES` (`DETAIL_FIELDS` above), so a product page already holds its variants — under `variant.choices[].optionChoiceNames`. `readOnlyVariantsV3` is the variant-centric resource, for querying variants across products (or when all you hold is a list read):

```js
const { items } = await readOnlyVariantsV3
  .queryVariants()
  .eq('productData.productId', product._id)   // NOTE: productData.productId is the filter field
  .find();
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/read-only-variants-v3/query-variants.md?apiView=SDK>

Each `variant` from this resource carries `variant.optionChoices[].optionChoiceNames` — `{ optionName, choiceName }`. Match the buyer's selected options (Size = "Small", Color = "Red", …) against those names to pick the variant. For a **single-variant** product, use the only item. Fall back to `items[0]` if matching yields nothing. The id to send to the cart is **`variant.variantId ?? variant._id`**.

**2 · Add it.** Doc: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/add-line-items-to-current-cart.md?apiView=SDK> · catalogReference contract: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/e-commerce-integration.md?apiView=SDK>

```js
await currentCartV2.addLineItemsToCurrentCart({
  catalogItems: [{                                // the write shape uses `catalogItems`
    quantity,
    catalogReference: {
      catalogItemId: product._id,                 // the product's _id (the `_id` rule above)
      appId: '215238eb-22a5-4c36-9e7b-e7c08025e04e',
      options: { variantId },                     // the resolved variantId from part 1
    },
  }],
});
```

The add can succeed with an unbuyable line: find the returned line for the product/variant you just added and check its `status` — anything other than `'IN_STOCK'` must be surfaced to the buyer and must block checkout.

**⚠️ CRITICAL: `options.variantId` is MANDATORY for any product that has variants.** Adding by `catalogItemId` alone **fails** — the catalog can't resolve a variant-bearing product without it, and Cart V2 **rejects the add with an explicit error** rather than accepting an invalid line. The cart method's required-params list omits `variantId`, so it's an easy one to miss. Always resolve and include it (part 1 above).

**⚠️ CRITICAL: `options.options` is for MODIFIERS, not variant selection.** Product option selections (Size/Color) are resolved to a **variant** and referenced by `variantId`. `options.options` carries **`TEXT_CHOICES` modifier** selections (modifier key → choice key); a **`FREE_TEXT`** modifier's value goes in `catalogReference.options.customTextFields`, keyed by the modifier's `freeTextSettings.key`. Do **not** encode Size/Color as `options.options` — that is the coffee-grind bug: the variant never resolves, so Cart V2 rejects the add with an explicit error.

**3 · Change or remove a line.** `lineItemId` is the cart line's `_id`, never the product id.

```js
await currentCartV2.updateLineItemsInCurrentCart({
  lineItems: [{ lineItemId, quantity: { newQuantity } }],   // newQuantity minimum is 1
});
await currentCartV2.removeLineItemsFromCurrentCart([lineItemId]);   // a positional ARRAY, not an object
```

A decrement that would reach zero calls `removeLineItemsFromCurrentCart` instead. Docs: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/update-line-items-in-current-cart.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/remove-line-items-from-current-cart.md?apiView=SDK>

### Checkout — redirect to the hosted checkout page

The cart's `_id` **is** the checkout id — pass it into the redirect session's `ecomCheckout.checkoutId`. Read the current cart, then hand its id to a redirect session, which carries the visitor/member session across to the hosted checkout on its own domain.
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/get-current-cart.md?apiView=SDK>

```js
const { cart } = await currentCartV2.getCurrentCart();   // NOTE: returns { cart } — destructure it
const session = await redirects.createRedirectSession({
  ecomCheckout: { checkoutId: cart._id },   // the cart's _id IS the checkout id
  callbacks: { postFlowUrl: `${origin}/`, thankYouPageUrl: `${origin}/` },
});
window.location.href = session.redirectSession.fullUrl; // the hosted-checkout URL
```

**⚠️ The cart's `_id` is the checkout id.** Pass `cart._id` straight into the redirect session's `ecomCheckout.checkoutId`. And `getCurrentCart()` returns **`{ cart }`** — destructure it, or `cart` is `undefined` and `cart._id` throws *"Cannot read properties of undefined (reading '_id')"*.

**⚠️ CRITICAL: `origin` for `postFlowUrl`/`thankYouPageUrl` MUST be the `https://` published host — derive it from `window.location.origin`, NEVER `new URL(request.url).origin`.** The Headless redirect allowlist registers the site's **`https://`** host and treats **`http://<same host>` as a different, unlisted origin**. When the buyer returns from the hosted checkout (e.g. clicks "Continue Browsing"), the redirect goes through the allowlist — and an `http://` `postFlowUrl` **403s** with *"… isn't listed as an allowed redirect domain."* If you build the redirect session in a **server route** (`src/pages/api/*`), `new URL(request.url).origin` resolves to **`http://`** behind Wix's TLS-terminating proxy → guaranteed 403 on return. So **pass `window.location.origin` from the client** into the route (don't read the origin off the request), or force the scheme to `https`. Doc: <https://dev.wix.com/docs/go-headless/getting-started/setup/manage-urls/add-allowed-redirect-domains>.

### Formatting cart prices

**Product** prices from `productsV3` still carry a ready-to-show `actualPriceRange.minValue.formattedAmount` — use it directly. But **Cart V2 money does not**: every cart amount — line-item `pricing.unitPrice` / `pricing.totalPrice` **and** the `estimateCurrentCart`/`calculateCurrentCart` `summary.priceSummary.*` — is a `ConvertedMoney` `{ amount, convertedAmount }` with **no** formatted string. So once items are in the cart, you format the price yourself. The currency isn't on the money object; read it from the cart (`cart.customerInfo?.currencyCode ?? cart.businessInfo?.currencyCode`), and use `convertedAmount` (buyer's display currency) when present, else `amount` (site currency):

```js
function formatCartMoney(money, cart) {
  const value = money?.convertedAmount ?? money?.amount;
  const currency = cart?.customerInfo?.currencyCode ?? cart?.businessInfo?.currencyCode ?? 'USD';
  return value == null ? '' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value));
}
// e.g. line item: formatCartMoney(item.pricing.totalPrice, cart)
//      subtotal:  formatCartMoney(estimate.summary.priceSummary.subtotal, cart)
```

Never hardcode `$` or assume USD — stores run in EUR/GBP too.

### Showing stock state

Read the **V3** inventory fields: product-level in-stock is `product.inventory.availabilityStatus` — one of `IN_STOCK`, `OUT_OF_STOCK`, `PARTIALLY_OUT_OF_STOCK` (treat the partial state as buyable, with the out-of-stock choices disabled); variant-level is `variant.inventoryStatus.inStock`. An out-of-stock product with `product.inventory.preorderStatus === 'ENABLED'` is **pre-orderable** — label it "Pre-order" rather than sold out. Reading the V1 inventory field on V3 data returns `undefined` → everything renders out-of-stock (the all-OOS bug). These come from `productsV3` / `readOnlyVariantsV3`, not the V1 module.

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

**Cart lines carry no image — join it from the catalog.** Cart V2 does **not** populate `lineItem.attributes.image` at runtime (verified against a live cart), so collect each line's `source.catalogReference.catalogItemId`, read those products with `productsV3.queryProducts().in('_id', ids).find()`, and run each `media.main` through the same `imgSrc()` helper; cache the resolved URL per product for the session. (If you build the cart over an API route, do the join there and return ready URLs so the component never sees a `wix:image://`.)

### Rendering product descriptions

Don't print the raw node object. A product description is rich text (`description.nodes`). Render the rich-text nodes, or render `plainDescription` — which is an **HTML string** (the docs call it "the product description in HTML"), so inject it as HTML, not as text. Printing the raw node object, or escaping that HTML string, dumps literal `<p>…</p>` into the page.

### SEO on item pages (Astro, Wix-managed)

A **product detail** page is a Wix **item page**: its `<title>`/description/OG/canonical come from what the owner sets in the dashboard. On the Astro (Wix-managed) frontend, wire it per the canonical guide — **[Add SEO Support to Item Pages](https://dev.wix.com/docs/go-headless/wix-managed-headless/seo/add-seo-support-to-item-pages.md)** — which covers the three steps: export `wixMetadata` (registers the route → sitemap + dashboard SEO editor), call `loadSEOTagsServiceConfig(...)`, and render `<SEO.Tags>` (from `@wix/seo`; deps + `@wix/essentials ≥ 1.0.10` are in the guide's "Before you begin").

For a product page use:
- **`wixMetadata`** from `WIX_APPS.checkoutAndOrders.productPageMetadata` — referenced **directly** in the export (module scope). ⚠️ It's `WIX_APPS.checkoutAndOrders`, **not** `WIX_APPS.stores` (`stores.id` is the catalog id for `catalogReference`, a different value). The `identifiers` key is your route param; the token is `…productPageMetadata.identifiers.handle`.
- **`itemType`**: `seoTags.ItemType.STORES_PRODUCT`.

**⚠️ `pageUrl` must be the PUBLIC url.** Behind Wix's proxy the SSR request URL is the internal one — read the public page URL from the **`x-wix-forwarded-url`** request header and pass it as `loadSEOTagsServiceConfig`'s `pageUrl` (fall back to the request URL when the header is absent).

**If you build a dedicated category route** (e.g. `/category/[slug]` or `/search/[collection]`), wire it the same way with `WIX_APPS.checkoutAndOrders.categoryPageMetadata` + `seoTags.ItemType.STORES_CATEGORY`. (A category rendered only as a query-string *filter* on the products listing is a main page — it gets its SEO from automatic injection, no `wixMetadata` needed.)

Optional: render a `Product` schema.org JSON-LD `<script>` from the fetched product for rich results (see the guide's structured-data step).

---

## Conclusion
A correct Catalog V3 storefront frontend:
- imports **`productsV3` / `readOnlyVariantsV3` / `categories` / `currentCartV2` / `redirects`** — never the V1 `products`/`collections` modules;
- uses **`product._id`** (never `product.id`) as the cart's `catalogItemId`;
- resolves the **mandatory `variantId`** via `readOnlyVariantsV3` and passes it as `options.variantId` (not `options.options`);
- builds its category nav from a **live `categories.queryCategories()`** and filters category pages server-side with **`searchProducts` + `$matchItems: [{ id: categoryId }]`** keyed on the live `categoryId` — never a frozen seed-time `productIds` map, never `queryProducts` for category filtering, never `$hasSome`, never V1 `collectionIds`;
- reads inventory from the **V3** shape and renders rich-text descriptions, not raw nodes.
