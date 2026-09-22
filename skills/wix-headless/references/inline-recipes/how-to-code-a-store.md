---
name: "How to Code a Store"
description: The frontend contract for a Catalog V3 storefront — which SDK modules to import, the exact product reads (listing, product page, categories), how to resolve the variant and price the buyer actually gets, the exact add-to-cart shape, cart totals, checkout, and what a complete storefront shows. Specifies the *how* (modules + exact calls + the failure modes the docs omit); which products/categories to render come from the catalog the storefront reads.
---
**RECIPE**: How to Code a Wix Online Store Frontend (Catalog V3 + eCommerce Cart V2)

A concise contract for writing the **frontend code** of a storefront against a Catalog V3 store: the shop/category gallery, the product page, cart, and checkout. **This recipe is the *how* (which modules, which calls, which fields, which rules), not the *what*** — which products to show and how the store looks are decided by the request you're fulfilling and the catalog you read. The one exception is the last section: what a *complete* storefront shows, because a wired-but-thin store is the most common failure.

> **This recipe is for CODING the storefront, not for seeding it.** It assumes a Catalog V3 store already exists (products, variants, categories, inventory). It says nothing about creating products — only how to read and purchase them from frontend code. Read the catalog; never create, repair, or fake catalog content from the frontend. If content is missing, show an honest state and report the gap.

> **⚠️ Reading rule — always append `.md?apiView=SDK` to every doc link below.** The Wix docs render two views of the same page. The **bare / REST view shows `id`**; the **`?apiView=SDK` view shows `_id`** — and the SDK is what your frontend calls. Reading the REST view by mistake is the single most common source of the cart-killing `product.id` bug (see the `_id` rule under *Listing products*). Fetch the `.md?apiView=SDK` form directly; don't re-discover these with search.

---

## The modules and the client (read this first)

**Stores app id** (a constant you will need for the cart's `catalogReference`):
`215238eb-22a5-4c36-9e7b-e7c08025e04e`

**⚠️ CRITICAL: use the V3 SDK modules, never the V1 ones.** The store is seeded with Catalog **V3** data. The legacy V1 `products` / `collections` modules read a different shape against the same data and fail in ways the SDK swallows silently (empty category pages, unresolved variants, `400`s on server-side filters). Import only:

| Need | Package | Module |
|---|---|---|
| Products (list, search, count, get by slug — variants come inside) | `@wix/stores` | `productsV3` |
| Categories (nav, category page) | `@wix/categories` | `categories` |
| Current cart (add / read / update / estimate) | `@wix/ecom` | `currentCartV2` |
| Standalone cart for Buy Now | `@wix/ecom` | `cartV2` |
| Redirect to hosted checkout | `@wix/redirects` | `redirects` |
| Promotions, product groups, inventory, back-in-stock — **only when the catalog has them** | `@wix/stores` | see *Catalog-conditional capabilities* |

> Migrating from Cart V1 / Checkout V1? The code below is V2-only — see the [migration guide](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/migration-guide) for the before/after. **Never** import the V1 `products` or `collections` modules from `@wix/stores`, `currentCart` (V1), `checkout.createCheckout`, or `createCheckoutFromCurrentCart`.

**Auth / client — framework split:**
- **Astro (Wix-managed):** authentication is ambient. Call `currentCartV2` / `productsV3` / `categories` directly from server components and backend routes (`src/pages/api/*.ts`) — **no `createClient`, no `OAuthStrategy`, no `clientId`.**
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client and reuse it:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { productsV3 } from '@wix/stores';
  import { categories } from '@wix/categories';
  import { currentCartV2, cartV2 } from '@wix/ecom';
  import { redirects } from '@wix/redirects';

  const client = createClient({
    modules: { productsV3, categories, currentCartV2, cartV2, redirects },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  ```
  The `clientId` is public, not a secret. **One visitor identity per shopper**, persisted by the strategy — never a shared token, and never an API key or app secret in browser code.

---

## The fields you request (two constants, reused everywhere)

Every product read takes a `fields` array; without it the response is missing the things the storefront renders. Define these **once** and reuse them so home, shop, category, and product pages can't drift:

```js
// Listing / gallery / homepage rails — summary data, 24 products at a time.
const LIST_FIELDS = [
  'CURRENCY',           // formattedAmount on every price (without it prices are bare numbers)
  'PLAIN_DESCRIPTION',  // plainDescription for cards
  'MEDIA_ITEMS_INFO',   // media.itemsInfo.items — the hover image
  'MIN_PRICE_VARIANT',  // variantSummary.minPriceVariant — Direct Add's variant id + the card price
  'DISCOUNT_INFO',      // priceAfterDiscount on that variant (automatic discounts)
];
// Product page — one complete purchasable product.
const DETAIL_FIELDS = [
  ...LIST_FIELDS,
  'DESCRIPTION', 'INFO_SECTION', 'INFO_SECTION_DESCRIPTION',  // rich description + info sections
  'VARIANT_OPTION_CHOICE_NAMES',     // populates variantsInfo.variants — WITHOUT it variants are null
  'PRODUCT_CHOICES_MEDIA_REFERENCES',// per-choice images (choice.media.items[].mediaId — the swatch photo)
  'SUBSCRIPTION_PRICES_INFO',        // subscription plans + prices, when the product has them
  'BREADCRUMBS_INFO',                // category breadcrumbs for the PDP
];
```

## The shapes you read (field cheat-sheet)

The exact field paths the storefront reads, and the **plausible-wrong sibling** each is mistaken for. All `amount`s are **strings**. These are **read** shapes; the cart-add body (under *Adding to cart*) is a separate **write** shape, and the `_id` rule applies to read **entities**, not to request params.

```jsonc
product = {
  _id,                                            // links · cart catalogItemId   (NOT .id → empty → HTTP 500)
  slug, name, visible,                            // only visible:true is returned to a visitor token
  currency,                                       // present when CURRENCY is requested
  actualPriceRange:    { minValue: { amount, formattedAmount }, maxValue: {...} },  // the RANGE before a variant is picked
  compareAtPriceRange: { minValue: {...}, maxValue: {...} },                          // "was" range (NOT price.actualPrice.amount — that's the seed/WRITE shape → $NaN)
  ribbon: { name },  additionalRibbons: [{ name }],  // ALL of them render (see Ribbons)
  discountInfo: { discountRuleNames: [] },        // automatic-discount names, product level (DISCOUNT_INFO)
  inventory: { availabilityStatus, preorderStatus },   // "IN_STOCK" | "OUT_OF_STOCK" | "PARTIALLY_OUT_OF_STOCK"; preorderStatus "ENABLED"
  media: { main: { image }, itemsInfo: { items: [{ image, altText }] } },   // image is a wix:image:// id → resolve it (see Rendering images)
  plainDescription, description,                  // plain string; description.nodes is the rich-text form
  options: [{ _id, name, optionRenderType, choicesSettings: { choices: [{ choiceId, name, colorCode, inStock, visible, media }] } }],
  modifiers: [{ key, name, mandatory, modifierRenderType, freeTextSettings: { key }, choicesSettings: { choices: [{ key, name }] } }],
  variantSummary: { minPriceVariant: { _id, price } },          // LIST reads (MIN_PRICE_VARIANT)
  variantsInfo: { variants: [ variant ] },                       // DETAIL reads (VARIANT_OPTION_CHOICE_NAMES)
  subscriptionPricesInfo, allowOneTimePurchases,                 // when SUBSCRIPTION_PRICES_INFO is requested
  seoData,                                        // merchant SEO settings — always present on Product/Category (no field enum)
}

variant = {
  _id,                                            // → cart options.variantId
  visible,
  choices: [{ optionChoiceIds: { optionId, choiceId }, optionChoiceNames: { optionName, choiceName } }],
  price: { actualPrice: { amount, formattedAmount }, compareAtPrice: {...} | undefined, priceAfterDiscount: {...} | undefined },
  inventoryStatus: { inStock, preorderEnabled },  // variant-level stock (booleans)
  media,                                          // the resolved image for this combination, when set
}

// currentCartV2.getCurrentCart()  →  { cart: { _id, lineItems: [...] } }   // NOTE: returns { cart } — destructure it
lineItem = { _id, name: { original }, quantityInfo: { confirmedQuantity, availableQuantity }, pricing: { unitPrice: { amount, convertedAmount }, totalPrice: {...} }, attributes: { image, descriptionLines }, status }
// price → pricing.unitPrice (ConvertedMoney, NO formatted string in V2 — format it yourself); qty → quantityInfo.confirmedQuantity; image → attributes.image (wix:image:// → resolve)

// the cart's _id is the checkout id → pass to the redirect session:
// redirects.createRedirectSession({ ecomCheckout: { checkoutId: cart._id }, callbacks })  →  { redirectSession: { fullUrl } }
```

---

## The storefront features (build the ones the site needs)

Each section below is a **self-contained storefront feature** — implement only the ones the site uses. The only ordering is *within* a feature (e.g. resolve the variant before adding it to the cart). The gallery and the product page are **two different reads** — summary data for many products vs one complete product — so don't build one "products" flow and reuse it for both.

### Listing products (and the `_id` rule)

Query products with `productsV3.searchProducts()` (the gallery: filter/sort/paging server-side) or `productsV3.queryProducts()` (a simple all-products list). Always pass `LIST_FIELDS`.
Docs: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/query-products.md?apiView=SDK>

**⚠️ `queryProducts()` returns a builder, not a Promise.** Pass requested fields, then chain `.limit(...)`/`.find()`:

```js
const { items } = await productsV3.queryProducts({ fields: LIST_FIELDS }).limit(24).find();
```

Do not pass a search/filter object to `queryProducts`; use `searchProducts` for that (below).

**⚠️ CRITICAL: the entity id is `_id`, NOT `id`.** The SDK normalizes every entity's id to **`_id`**. `product.id` is `undefined` in SDK code. This is the cart-killer: feeding `product.id` into the cart's `catalogItemId` sends an empty string and the add returns **HTTP 500** (`"catalogItemId" has size 0`). Use `product._id` everywhere — in links, as the cart `catalogItemId`, as the variant id. (If a field name surprises you, you are probably reading the REST doc view — re-open it with `?apiView=SDK`.)

**Scope of the `_id` rule — entity reads only.** Request params name their own fields (the redirect session takes `ecomCheckout.checkoutId`, *not* `_id` — even though the value you pass is the cart's `_id`). Don't assume every id-shaped field is spelled `_id`.

**Visibility:** only `visible: true` products are returned to a visitor token, so a missing product usually means it wasn't seeded visible — not a query bug.

### The gallery query — sort, filter, and page on Wix, never on a loaded page

Search Products applies sort, filter, and search **across the whole catalog before** paging — the only correct place for them. Re-sorting or filtering an array you already fetched only rearranges the slice you happen to hold, and a catalog past the page size silently truncates. The shape (two arguments — the search, then `{ fields }`):

```js
const conditions = [{ visible: true }];
if (categoryId) conditions.push({ 'allCategoriesInfo.categories': { $matchItems: [{ id: categoryId }] } });
// Search rejects two operators in ONE field object — price bounds are SEPARATE conditions joined by $and:
if (minPrice != null) conditions.push({ 'actualPriceRange.minValue.amount': { $gte: String(minPrice) } });
if (maxPrice != null) conditions.push({ 'actualPriceRange.minValue.amount': { $lte: String(maxPrice) } });
if (inStockOnly)      conditions.push({ 'inventory.availabilityStatus': { $eq: 'IN_STOCK' } });
const filter = { $and: conditions };

const SORTS = {
  featured:  undefined,                                                   // the catalog's own order — NOT a sales ranking
  priceAsc:  [{ fieldName: 'actualPriceRange.minValue.amount', order: 'ASC' },  { fieldName: 'name', order: 'ASC' }],
  priceDesc: [{ fieldName: 'actualPriceRange.minValue.amount', order: 'DESC' }, { fieldName: 'name', order: 'ASC' }],
  nameAsc:   [{ fieldName: 'name', order: 'ASC' }],
  newest:    [{ fieldName: 'createdDate', order: 'DESC' }, { fieldName: 'name', order: 'ASC' }],
};

const { products, pagingMetadata } = await productsV3.searchProducts(
  {
    ...(cursor
      ? {}                                  // a cursor CONTINUES the original query — send it alone
      : { filter, ...(SORTS[sort] ? { sort: SORTS[sort] } : {}),
          ...(search ? { search: { expression: search.trim(), fields: ['name'] } } : {}) }),
    cursorPaging: { limit: 24, ...(cursor ? { cursor } : {}) },
  },
  { fields: LIST_FIELDS },
);
const nextCursor = pagingMetadata?.cursors?.next ?? null;      // null → no more pages
const { count } = await productsV3.countProducts({ filter });   // the "N products" line; issue alongside the page
```

- **Any change to category, sort, filters, or search starts over without a cursor.** Reset paging; ignore responses from a superseded query (version or abort in-flight requests so a late older response can't roll back a newer selection).
- Keep filter/sort state in the URL so back/forward and refresh preserve it — but translate back to the IDs Wix expects before querying.
- Page size **24**. Offer "load more" or prev/next from the cursor; never raise the limit to avoid paging.
- Docs: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/supported-filters-and-sorting.md?apiView=SDK>

**⚠️ CRITICAL: category filtering MUST use `searchProducts`, NOT `queryProducts`.** The categories field is **not declared as filterable in `queryProducts`** — passing it there returns HTTP `400 "... is not declared as filterable"`, which the SDK **swallows silently**, leaving an empty category page that looks like "no products". Use the exact condition above:

- **Field:** `allCategoriesInfo.categories` — includes parent categories, so a product in a subcategory shows on the parent's page too.
- **`categoryId`** is the stable id from the live `categories.queryCategories()` result (a category's `_id`) — read it from the render context, never a hardcoded seed-time id list (a product the owner adds to the category later must appear with no code change).
- **Operator:** `$matchItems`, never `$hasSome` (the natural-looking guess returns nothing). **Inner key:** `id` (the category GUID).
- **Never** the V1 `collectionIds` / `collections.id` paths — they return empty against V3 data.

### Category navigation — list categories live

**Build the category nav/rail from a live `categories` query (`@wix/categories`), never from a seeded category list** — a category the owner adds later then self-registers in the nav with no code change. Render the bar only when it returns **more than one** category, and treat it as **non-fatal** (wrap in try/catch, render without the bar if it fails).

```js
import { categories } from '@wix/categories';
const res = await categories.queryCategories({
  treeReference: { appNamespace: '@wix/stores' },
}).exists('name', true).find();   // items: { _id, name, slug, visible, parentCategory? }; link each to /category/<slug>
```

**⚠️ The query MUST carry a filter condition — chain `.exists('name', true)` (as above), do NOT call a bare `.find()`.** A `.find()` with no chained filter serializes an empty `"filter": {}`, which `categories/v1/categories/query` rejects with `400 INVALID_FILTER` — **fatal on the visitor/manual-client (non-Astro) path** (managed-Astro's server-side transport happens to tolerate it, so a bare `.find()` *looks* fine there and breaks the moment the same code runs client-side). `.exists('name', true)` is a tautology, so it matches **all** categories and is accepted on **both** paths. **Do NOT filter on `visible`** (`.eq('visible', true)`) — `visible` is **not declared filterable** on `queryCategories`, so it triggers a silently-swallowed `400` and the nav renders blank; filter `visible === false` out of the returned array **client-side**. Skip the auto-created `all-products` system category. Page through when the store has more than one page. Index by `_id`, rebuild parent/child from `parentCategory`, and **keep the `_id` for product queries — the slug is only for URLs and route matching.** This is a **distinct API from bookings' `categoriesV2`** — don't copy that module's query shape here: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/introduction.md?apiView=SDK>.

For a **category page**, resolve the slug from the URL with `categories.getCategoryBySlug(slug, { appNamespace: '@wix/stores' })` → its `_id` feeds the gallery query above, its `name`/`description` head the page, its `seoData` is the page's SEO input. A missing or `visible: false` category is a real **404**, never a fallback to all products.

### The product page read (one call, variants included)

The product page needs **one complete product** — a different read from the gallery:

```js
const { product } = await productsV3.getProductBySlug(slug, { fields: DETAIL_FIELDS });
if (!product) return notFound();   // a real 404 — NEVER fall back to the first product in a list
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product-by-slug.md?apiView=SDK>

**⚠️ `variantsInfo` is `null` unless `VARIANT_OPTION_CHOICE_NAMES` is in `fields`** — the docs say variants "aren't returned" and that's true of a bare read; with the field, `product.variantsInfo.variants` carries every variant with its `optionChoiceIds`, `price`, and `inventoryStatus`. There is no second call to make. (`readOnlyVariantsV3` still exists for bulk variant queries; the product page doesn't need it.)

Render `description` as rich text (or `plainDescription` for plain), the info sections as sections/accordions matching their length, breadcrumbs from `breadcrumbsInfo`, and **every** image in `media.itemsInfo.items` as a browsable gallery (main first, de-duplicated) — not just `media.main`.

### Prices — which one the buyer actually pays

Three prices can exist on a variant; the precedence is exact:

```js
// price = variant.price (PDP, after selection) or variantSummary.minPriceVariant.price (cards).
// Each field is { amount, formattedAmount } — render formattedAmount.
function sellingPrice(price) {
  if (price?.priceAfterDiscount !== undefined) {              // explicit check: a valid ZERO discount price is a real price
    return { current: price.priceAfterDiscount, original: price.actualPrice };   // strike actualPrice, NOT compareAtPrice
  }
  return { current: price?.actualPrice, original: price?.compareAtPrice };     // original may be undefined
}
```

- **Before a variant is selected**, show the product range (`actualPriceRange.minValue`–`maxValue`, one value when equal) — never an empty price and never an arbitrary variant. Once every option is chosen, switch to the selected variant's `sellingPrice(variant.price)` and update the buy button's price with it.
- **Strike the original only when it is defined and higher than the current price**, and label it ("was", "regular price") — strikethrough or color alone doesn't carry the meaning for assistive tech.
- **On cards, never pair a price *range* with one lone struck "was" minimum** — it implies a saving that may not apply to every variant. Show the "was" only for a single-price product; otherwise omit the comparison until a variant is picked.
- `discountInfo.discountRuleNames` (product level) names the automatic discounts — render the names if you like, but **never compute a percentage or a savings claim yourself**; the cart's calculated summary is the only source of applied discounts.
- **A ribbon is a label, never proof of a price.** Don't infer "on sale" from a "Sale" ribbon, and don't render a ribbon from a compare-at price.

### Ribbons — render all of them

A product carries a primary `ribbon.name` **and** up to four `additionalRibbons[].name`. Render **every** label, on cards and on the product page, with one shared presentation (same shape, typography, placement; a semantic accent such as a "Sale" color is fine but applied by label, not by which field it came from). Wrap or use a clearly labeled overflow control — never keep only the first.

### Variants — resolve by choice IDs, from the product itself

Selections start **empty** (no pre-picked first choice — a buyer who never noticed the default would buy the wrong color). Key the variants by their sorted **choice IDs**; option order then doesn't matter:

```js
const key = (choiceIds) => [...choiceIds].sort().join('_');
const variantByKey = new Map();
for (const v of product.variantsInfo?.variants ?? []) {
  if (v.visible === false) continue;
  const k = key(v.choices.map((c) => c.optionChoiceIds.choiceId));
  if (variantByKey.has(k)) throw new Error(`Two variants share the choices ${k}`); // report, don't silently overwrite
  variantByKey.set(k, v);
}
// selected = { [optionId]: choiceId } — the buyer's picks so far (option._id → choice.choiceId)
const complete = product.options.every((o) => selected[o._id]);
const variant = complete ? (variantByKey.get(key(Object.values(selected))) ?? null) : null;   // null = combination doesn't exist
const available = (v) => v.inventoryStatus?.inStock !== false || v.inventoryStatus?.preorderEnabled === true;
```

- **Which choices to disable:** before any selection, use each choice's own flags (`choice.inStock ?? true`, `choice.visible ?? true`). After a selection, a choice is selectable when at least one visible variant compatible with the current picks is `available` (in stock **or** preorder-enabled).
- **A single-variant product** (no options) resolves to its only variant — `variantsInfo.variants[0]` on the PDP, `variantSummary.minPriceVariant` on a card.
- Changing an option **resets quantity to 1**. Modifiers never take part in the key — they're separate inputs (next section).
- **A choice image** lives at `choice.media.items[].mediaId` (with `PRODUCT_CHOICES_MEDIA_REFERENCES`); a resolved variant may carry `variant.media`. Make choice media *available* (highlight it in the gallery) rather than replacing the gallery on every option change.

**Which action to show** — precedence, top wins: **(1)** the chosen combination doesn't exist → "unavailable"; **(2)** preorder (before selection: `inventory.preorderStatus === 'ENABLED'` and the product is out of stock; after: the variant's `preorderEnabled`) → "Pre-order"; **(3)** back-in-stock notify (see *Catalog-conditional*); **(4)** out of stock; **(5)** purchasable. Until the buyer has picked everything, the button is disabled with a **neutral** reason next to it ("Choose a size") — not error styling; promote to an error only after they try to buy.

### Adding to cart — the Cart V2 contract

One serializer builds the catalog item for **both** the product page and any gallery add. Doc: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/add-line-items-to-current-cart.md?apiView=SDK> · catalogReference contract: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/e-commerce-integration.md?apiView=SDK>

```js
function catalogItem({ product, variant, quantity, modifierChoices = {}, customTextFields = {}, subscriptionOptionId, preorder }) {
  return {
    quantity,                                                 // top-level, beside catalogReference
    catalogReference: {
      appId: '215238eb-22a5-4c36-9e7b-e7c08025e04e',
      catalogItemId: product._id,                             // the product's _id (the `_id` rule)
      options: {
        variantId: variant._id,                               // MANDATORY for any product with options
        ...(Object.keys(modifierChoices).length ? { options: modifierChoices } : {}),        // { [modifier.key]: choice.key }
        ...(Object.keys(customTextFields).length ? { customTextFields } : {}),               // { [modifier.freeTextSettings.key]: text }
        ...(subscriptionOptionId ? { subscriptionOptionId } : {}),                           // a recurring plan only; omit for one-time
        ...(preorder ? { preOrderRequested: true } : {}),                                    // preorder only
      },
    },
  };
}

const { cart } = await currentCartV2.addLineItemsToCurrentCart({ catalogItems: [item] });   // `catalogItems` — never Cart V1's `lineItems`
```

**⚠️ CRITICAL: `options.variantId` is MANDATORY for any product that has variants.** Adding by `catalogItemId` alone **fails** — Cart V2 rejects the add with an explicit error. The method's required-params list omits `variantId`, so it's easy to miss. Resolve it (previous section) and include it.

**⚠️ CRITICAL: `options.options` is for MODIFIERS, not variant selection.** Product option selections (Size/Color) are resolved to a **variant** and referenced by `variantId`. `options.options` maps a **choice modifier**'s `key` to the chosen choice `key`; `customTextFields` maps a **free-text modifier**'s `freeTextSettings.key` to the buyer's text. Do **not** encode Size/Color as `options.options` — that is the coffee-grind bug: the variant never resolves, so Cart V2 rejects the add.

**Validate before calling:** every option selected; every `mandatory` modifier filled (a choice modifier's value is one of its choices, a free-text modifier's value non-empty); quantity ≥ 1 and not above the known ceiling; a plan chosen when subscriptions are shown; a resolved variant. Show each missing thing next to its control.

**Read the result, don't assume it.** Find the returned line (`lineItems[].source.catalogReference.catalogItemId` + `options.variantId`); a line whose `status` isn't `IN_STOCK`, or no line / `confirmedQuantity: 0`, means the add was refused — surface it. Then update your cart state from the returned `cart` (or `getCurrentCart()`) and **open the cart drawer**.

**CRITICAL: `ITEM_NOT_FOUND_IN_CATALOG` for a product that exists is a catalog defect, not a stale id.** A `DIGITAL` product whose variant has no `digitalProperties.digitalFile` is rejected under that code, and one with no stock is rejected as `exceeds available inventory` — both read back `visible: true`. Fix the product (`setup-online-store.md` → digital products); re-reading ids won't help.

**Serialize price-affecting operations** (add/update/remove) per cart so a stale response can't overwrite newer state; disable checkout while one is pending. If an add may have succeeded before a timeout, re-read the cart before offering a retry — don't replay it blindly and double the line.

### Three ways to buy from the gallery

Route each card by what the product needs from the buyer:

1. **Direct Add** — no options, no modifiers, no subscriptions: add `variantSummary.minPriceVariant._id` with quantity 1, through the same serializer.
2. **Quick Add** — the product has options or choice modifiers: fetch the full product lazily when the picker opens (`productsV3.getProduct(product._id, { fields: DETAIL_FIELDS })`), require a resolved variant and mandatory modifiers, fix quantity at 1. Anchor the picker **to its card** (an inline or attached panel; a bottom sheet on mobile) — a centered dialog is the exception for a demonstrably large configuration, not the default. Its first view shows identity, price, the first required choice, and the action.
3. **Go to the product page** — the product has a free-text modifier or subscriptions: the gallery can't collect those inputs.

### Cart totals — from Wix, never computed in the client

Line prices come with the cart (`pricing.totalPrice`). The **subtotal after discounts** comes from the estimate, never from summing lines yourself, and delivery/tax resolve at checkout:

```js
const { summary } = await currentCartV2.estimateCurrentCart();   // after every add/update/remove
// summary.priceSummary.subtotal  — items after item-level discounts
// summary.priceSummary.discount  — the CART-level discount only (a coupon / cart rule), not the sum of every saving
// summary.priceSummary.total     — estimated, without delivery/tax unless you asked for them
```

- Show **Subtotal**, a **Discount** row only when it's non-zero, and **"Shipping and taxes are calculated at checkout"** — never a hardcoded shipping charge, free-shipping threshold, tax, or delivery date, and never a synthesized `0` for something that wasn't calculated.
- `estimateCurrentCart` is a display nicety — if it fails, the cart is still valid; show lines without the summary row.
- Doc: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/estimate-current-cart.md?apiView=SDK>

### Checkout — redirect to the hosted checkout page

The cart's `_id` **is** the checkout id — pass it into the redirect session's `ecomCheckout.checkoutId`. Read the current cart, refuse an empty one or any line whose `status` isn't `IN_STOCK` (say which), then hand the id to a redirect session, which carries the visitor/member session across to the hosted checkout on its own domain.
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/get-current-cart.md?apiView=SDK>

```js
const { cart } = await currentCartV2.getCurrentCart();   // NOTE: returns { cart } — destructure it
const session = await redirects.createRedirectSession({
  ecomCheckout: { checkoutId: cart._id },   // the cart's _id IS the checkout id
  callbacks: { postFlowUrl: `${origin}/`, thankYouPageUrl: `${origin}/` },
});
window.location.assign(session.redirectSession.fullUrl); // the hosted-checkout URL — navigate the FULL document
```

**⚠️ `getCurrentCart()` returns `{ cart }`** — destructure it, or `cart` is `undefined` and `cart._id` throws.

**⚠️ CRITICAL: `origin` for `postFlowUrl`/`thankYouPageUrl` MUST be the `https://` published host — derive it from `window.location.origin`, NEVER `new URL(request.url).origin`.** The Headless redirect allowlist registers the site's **`https://`** host and treats **`http://<same host>` as a different, unlisted origin**. When the buyer returns from the hosted checkout, an `http://` `postFlowUrl` **403s** with *"… isn't listed as an allowed redirect domain."* If you build the redirect session in a **server route**, `new URL(request.url).origin` resolves to **`http://`** behind Wix's TLS-terminating proxy → guaranteed 403 on return. So **pass `window.location.origin` from the client**, or force `https`. Doc: <https://dev.wix.com/docs/go-headless/getting-started/setup/manage-urls/add-allowed-redirect-domains>.

Keep the checkout button's copy destination-neutral ("Continue to secure checkout"). Wix-hosted checkout owns confirmation and thank-you; never build a local `/checkout` route or claim an order completed from a redirect alone. **Checkout must be reachable directly from the cart drawer** — a separate cart page is optional, never a mandatory step before checkout.

**Buy Now** — a Buy Now button must **not** add to (or replace) the shopper's current cart. Create a **standalone** cart with the same catalog item, then hand *its* `_id` to the same redirect-session call above:

```js
const cart = await cartV2.createCart({ cart: { source: { channelType: cartV2.ChannelType.WEB } }, catalogItems: [item] });
// then: redirects.createRedirectSession({ ecomCheckout: { checkoutId: cart._id }, callbacks })
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart.md?apiView=SDK>. **⚠️ VERIFY IN A LIVE BUILD** that the redirect session accepts a standalone cart's id under the visitor identity before shipping Buy Now; if it doesn't, keep Buy Now off rather than routing it through the current cart.

### Formatting cart prices

**Product** prices from `productsV3` carry a ready-to-show `formattedAmount` — use it directly. But **Cart V2 money does not**: every cart amount — line-item `pricing.unitPrice` / `pricing.totalPrice` **and** the estimate's `summary.priceSummary.*` — is a `ConvertedMoney` `{ amount, convertedAmount }` with **no** formatted string. The currency isn't on the money object; read it from the cart, and use `convertedAmount` (buyer's display currency) when present, else `amount` (site currency):

```js
function formatCartMoney(money, cart) {
  const value = money?.convertedAmount ?? money?.amount;
  const currency = cart?.customerInfo?.currencyCode ?? cart?.businessInfo?.currencyCode ?? 'USD';
  return value == null ? '' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value));
}
```

Never hardcode `$` or assume USD — stores run in EUR/GBP too.

### Showing stock state and quantity

Read the **V3** inventory fields: product-level is `product.inventory.availabilityStatus` (`IN_STOCK` | `OUT_OF_STOCK` | `PARTIALLY_OUT_OF_STOCK`), variant-level is `variant.inventoryStatus.inStock` / `preorderEnabled`. Reading the V1 inventory field on V3 data returns `undefined` → everything renders out-of-stock (the all-OOS bug). In the cart, `quantityInfo.availableQuantity` caps the stepper when it's finite.

If you show a quantity ceiling from a tracked inventory count, **a tracked zero stays zero**: use `Math.max(0, remaining)`, never `remaining || 99999` — that `||` turns "sold out" into "buy any amount". Untracked inventory gets a deliberate UI ceiling (e.g. 99). Wix rejects an over-stock add explicitly either way — surface that message; don't clamp silently.

### Rendering product images

Product media may come back as a **`wix:image://v1/<hash>/<file>#originWidth=…` identifier, not a ready URL**. Putting that string straight into `<img src>` shows nothing. `media.main` may carry **either** an already-absolute `.url` (a placeholder seeded when imagery is off) **or** an `.image` that is a `wix:image://` id needing resolution — handle both with **one** helper and reuse it on every page that renders an image:

```js
import { media } from '@wix/sdk';
function imgSrc(mediaLike, w = 600, h = 600) {
  const v = mediaLike?.image ?? mediaLike?.url ?? mediaLike;   // the value can be a string or {url}
  if (!v) return '';
  if (typeof v === 'string' && v.startsWith('wix:image://')) return media.getScaledToFillImageUrl(v, w, h, {});
  return typeof v === 'string' ? v : (v.url ?? '');            // already an absolute https URL
}
// Responsive delivery: several scaled candidates + sizes, so a card never downloads a hero-sized file.
function imgSrcSet(mediaLike, widths = [320, 480, 640, 960], ratio = 1) {
  return widths.map((w) => `${imgSrc(mediaLike, w, Math.round(w * ratio))} ${w}w`).join(', ');
}
// <img src={imgSrc(m, 640, 640)} srcset={imgSrcSet(m)} sizes="(min-width: 1024px) 25vw, 50vw" loading="lazy" width="640" height="640" alt={item.altText ?? product.name} />
```

**⚠️ Do NOT write `m.url ?? m.image` (or `image?.url ?? image`).** That returns the bare **`wix:image://` string** whenever `.url` is absent — exactly the Wix-Media case — and the browser fails it with **`ERR_UNKNOWN_URL_SCHEME`**. The `wix:image://` branch must go through `media.getScaledToFillImageUrl`; never return it raw. **Never hand-build a `static.wixstatic.com/.../v1/fit/...` URL** either — the format is easy to get wrong and the image then **403s**. Doc: <https://dev.wix.com/docs/sdk/core-modules/sdk/media>

**This applies to cart line-item images too** — a cart `lineItem.attributes.image` is the same identifier; run it through the same helper. Give every image a stable aspect ratio (`aspect-ratio` + `object-fit`) and `width`/`height` so the grid doesn't jump while loading; lazy-load below the fold. Never stretch a thumbnail into a hero — when hero-scale media is absent, compose the hero from typography or a product tile instead.

### Rendering product descriptions

Don't print the raw node object. A product description is rich text (`description.nodes`) — render the nodes (headings, lists, links, emphasis preserved, sanitized), or use `plainDescription` for a plain string. Printing the raw node object dumps literal `<p>…</p>` into the page. Info sections (`INFO_SECTION`) are the same shape — render them as sections or accordions, don't flatten them into one paragraph.

### SEO on item pages

A **product page** and a **category page** are Wix **item pages**: their `<title>`/description/OG/canonical come from what the owner sets in the dashboard (the entity's `seoData`).

**Astro (Wix-managed):** wire the canonical guide — **[Add SEO Support to Item Pages](https://dev.wix.com/docs/go-headless/wix-managed-headless/seo/add-seo-support-to-item-pages.md)** — export `wixMetadata`, call `loadSEOTagsServiceConfig(...)`, render `<SEO.Tags>` (from `@wix/seo`; deps in the guide). For a product page: **`wixMetadata`** from `WIX_APPS.checkoutAndOrders.productPageMetadata` (⚠️ `checkoutAndOrders`, **not** `WIX_APPS.stores` — `stores.id` is the catalog id for `catalogReference`), `identifiers` = your route param (`…productPageMetadata.identifiers.handle`), **`itemType`** `seoTags.ItemType.STORES_PRODUCT`. A dedicated category route uses `categoryPageMetadata` + `seoTags.ItemType.STORES_CATEGORY`. (A category rendered only as a query-string *filter* on the shop page is a main page — automatic SEO, no `wixMetadata`.)

**Non-Astro (you render the head yourself):** map `product.seoData` / `category.seoData` tags into the head and fill only what's missing from truthful entity data. Rules that hold on both paths: **one** document title and **one** canonical per page (a merchant override wins over a generated fallback; a tag the merchant disabled stays absent); a missing entity returns a **real 404**, never a rendered shell with another product's tags; clear route tags on client navigation so a product's metadata can't leak into the next page; a `Product` JSON-LD block only from real data — never fabricated reviews, ratings, or availability.

### Catalog-conditional capabilities (build when the catalog has them — never fabricate them)

Read the catalog first; then, **only when the data is present**:

- **Subscriptions** (`subscriptionPricesInfo` present): show each plan's price and billing interval as comparable terms; require an **explicit** plan choice (never pre-select the first); offer one-time purchase only when `allowOneTimePurchases` is true; serialize a recurring plan as `subscriptionOptionId`, omit it for one-time. Don't apply the one-time automatic-discount price to a subscription quote.
- **Preorder** (`inventory.preorderStatus === 'ENABLED'` / `variant.inventoryStatus.preorderEnabled`): label "Pre-order", include `preOrderRequested: true`. Preorder and a subscription plan may coexist.
- **Product groups** (`extendedFields.namespaces['@stores/product-groups'].productGroupId` is a string): the group's members are **navigation between products** (the "same shirt in linen" case), not variants — query the group via the Product Groups API and render members as choices that navigate to the member's slug.
- **Positioned promotions**: `promotionsV3.resolvePromotions(categoryId)` returns category-gallery banners with a **one-based** `position` — insert at `position - 1` only once that many products have loaded. They are editorial media, not evidence of a discount, and they belong to that category's gallery, not the homepage. Docs: <https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/promotions-v3.md>
- **Back-in-stock ("Notify me")**: only when the store's back-in-stock settings allow it, the selected variant is out of stock, and you have an implemented, session-safe notification endpoint — a form whose submit goes nowhere is not a graceful placeholder.
- **Filter facets** beyond price/stock (color, size): the option choice fields (`options.choicesSettings.choices.choiceId` with `$hasSome`) discover *products*; Quick Add or the PDP still resolves the actual variant.

For the exact shapes of the group, notification, and inventory APIs, find the method pages via `DOC_DISCOVERY.md` (`document_type: SDK`); they aren't pinned here because most catalogs don't use them.

---

## What a complete storefront shows

The API wiring above is necessary, not sufficient. **Read `experience-store.md`** (same folder) before designing — the store's own bar on top of `DESIGN.md`/`CONTENT.md`: derive the direction from the catalog, what the homepage, gallery, product page, and cart must show, the overlay contract, truthful commerce copy, and image discipline. `CAPABILITIES.md` → stores carries the same bar in plain language for the handoff.

---

## Conclusion
A correct Catalog V3 storefront frontend:
- imports **`productsV3` / `categories` / `currentCartV2` / `cartV2` / `redirects`** — never the V1 `products`/`collections` modules or Cart V1;
- requests **`LIST_FIELDS` / `DETAIL_FIELDS`** on every read, and uses **`product._id`** (never `product.id`) as the cart's `catalogItemId`;
- reads the product page with **`getProductBySlug` + `VARIANT_OPTION_CHOICE_NAMES`** and resolves the variant by **sorted choice IDs** — selections start empty, the mandatory **`variantId`** goes in `options.variantId` (not `options.options`);
- prices with **`priceAfterDiscount` → `actualPrice` → `compareAtPrice`** precedence and renders **every ribbon**, never inferring one from the other;
- sorts, filters, and pages **on Wix** (`searchProducts` + `$matchItems: [{ id: categoryId }]` on `allCategoriesInfo.categories`, cursor paging at 24) — never a frozen seed-time list, never `queryProducts` for categories, never `$hasSome`, never V1 `collectionIds`;
- shows cart totals from **`estimateCurrentCart`**, checks out through the **redirect session** with an `https://` origin, and keeps Buy Now on a standalone cart;
- builds the homepage, gallery, product page, and side cart to the bar in `experience-store.md` — the store is the surfaces, not the calls.
