# Wix Storefront — ready-made client

The storefront ships the commerce hooks, server cart, REST transport, image helpers, and cart UI.
You build the presentation: Shop page, product grid and cards, variant controls, product detail
(PDP) page, Home, header, and footer. Use the interfaces below and proceed directly to implementation.

The client talks to Wix over the public `WIX_CLIENT_ID` (anonymous visitor tokens). Never mock
products or hand-build a `/checkout` URL; the shipped cart uses the eCom redirect session.

## Prerequisites
- The site's **Wix Stores** catalog is the read/cart target. It's installed and seeded separately, in parallel with this build — so it may be empty at build time; render the empty state until products land.
- The public headless **`WIX_CLIENT_ID`** from your prompt (buyer-facing, safe to hardcode/commit).

## Already installed in `src/`
Successful deployment verified these files are in place; use this map without needing to read their source (`@/` → `src/`).

| file | what it is |
|---|---|
| `context/CartContext.jsx` | `CartProvider` and `useCart()`: server cart, add/update/remove, checkout |
| `hooks/useProductDetail.js` | PDP product, variant resolution, selection, load/add state |
| `hooks/useShop.js` | Catalog listing, categories, cursor paging, sort, failure state; use in your `Shop` |
| `hooks/useProductCard.js` | Card badges, prices, options summary, quick-add flag, images |
| `hooks/useVariantOptions.js` | Render-agnostic option and modifier groups for PDP controls |
| `lib/storeImage.js` | Wix image URL and gallery helpers |
| `components/CartButton.jsx` | Cart icon button with a live-count badge |
| `components/CartDrawer.jsx` | Cart drawer; mount once, opens through `useCart` |
| `components/WixManageBanner.jsx` | Preview-only manage banner; include only when the entry guide enables it |
| `rest/wix-config.js` | Wix client and site ids |
| `rest/wix-client.js` | REST transport and visitor authentication |
| `rest/wix-store-catalog.js` | Product and category queries |
| `rest/wix-store-cart.js` | Cart mutations and hosted checkout |

**DO NOT READ SHIPPED SOURCE** except to resolve a specifically identified field/interface missing
below or an observed runtime error; read only the relevant file.
If deployment failed or files are missing, re-run the install/deploy step.

## Theme
Use the existing Base44 theme in `src/index.css` for new components. The shipped client already
uses it; don't add a parallel theme or restyle shipped components.

## Presentation interfaces
Build `pages/Shop.jsx`, `components/ProductGrid.jsx`, `components/ProductCard.jsx`, and
`pages/ProductDetail.jsx` from these contracts. All paths are under `src/`. Home, header, and
footer are yours to design; their integration is in **Routes and provider** below.

### Shop page and product grid
Create both files below. The hook owns catalog data; your page owns its presentation.

```jsx
// src/pages/Shop.jsx
import { useShop, SORTS } from "@/hooks/useShop";
import ProductGrid from "@/components/ProductGrid";

export default function Shop() {
  const s = useShop();
  // Category controls: s.categories ({ id, name }), s.activeCategory;
  // select with s.setActiveCategory(category), or null for all products.
  // Sort controls: Object.entries(SORTS) -> [key, { label }];
  // selected value s.sort; change with s.setSort(key).
  // Optional filters: s.setFilters({ minPrice: 20, maxPrice: 100,
  //   inStockOnly: true, search: "linen" }); s.setFilters({}) clears them.
  // Apply a submitted/debounced search value; the hook queries on every change.
  // Render s.error with s.retry separately from loading/empty results.
  // On a later-page error, keep already loaded products visible.
  // Pagination: when s.hasMore, call s.loadMore(); disable while s.loadingMore.
  return (
    <ProductGrid
      products={s.products}
      loading={s.loading}
      empty={s.error ? "" : "No products yet."}
      emptyHint={s.error ? "" : "Try another category or check back later."}
    />
  ); // Add the controls and states above; layout and styling are yours.
}
```

```jsx
// src/components/ProductGrid.jsx
import ProductCard from "@/components/ProductCard";

export default function ProductGrid({ products, loading, empty, emptyHint }) {
  // products: array | null (null while loading); loading: boolean
  // empty: heading string; emptyHint: optional supporting string
  // Render loading, empty (when empty is nonempty), or ProductCard items.
  // Pass the full product: <ProductCard key={product.id} product={product} />.
  // Layout and styling are yours; this component does not fetch products.
}
```

### Product card
Pass a catalog product to `ProductCard`: use `product.id` for identity/quick-add, `product.name`
for the title, and `product.slug` for the PDP link. Pass the full object to `useProductCard`.

```jsx
import { useProductCard } from "@/hooks/useProductCard";
import { useCart } from "@/context/CartContext";

export default function ProductCard({ product }) {
  const { addToCart, loading, error } = useCart();
  const {
    isSoldOut, isPreorder, isPartiallyOutOfStock, // booleans
    leftBadges,       // [{ type: 'pre-order'|'sold-out'|'limited-stock', label }]
    promoBadge,       // { type: 'discount'|'ribbon', label } | null
    priceDisplay,     // formatted price or min–max range; may be undefined if absent
    compareAtDisplay, // formatted compare-at price | null
    colors,           // hex colour strings
    optionLabel,      // e.g. "3 sizes · 2 materials", or ""
    isQuickAddable,   // no product options and not sold out; does NOT check modifiers
    image, hoverImage,// normalised primary / second gallery URL | null
  } = useProductCard(product);
  // Render your card.
}
```
For quick-add, call `addToCart(product.id)` only when `isQuickAddable` and no mandatory
modifier needs input (`product.modifiers` entries have a `mandatory` boolean). Otherwise link to `/product/${product.slug}` for selection, including
pre-orders. Listing results have no full variants; the PDP hook loads and resolves them.
Use cart-context `loading` to disable repeated adds and display `error` on failure (see **Cart**);
failure does not open the drawer.

### Catalog hook reference
`useShop` and `SORTS` are named exports from `@/hooks/useShop`; the Shop skeleton above uses them.

```js
const {
  categories, activeCategory, setActiveCategory,
  products, loading, error, retry,
  hasMore, loadMore, loadingMore, sort, setSort, filters, setFilters,
} = useShop({ pageSize: 24 }); // optional argument; default pageSize 24
// categories: category[]; activeCategory: category | null (null = all products)
// setActiveCategory(categoryOrNull): starts a fresh product query, keeping sort/filters
// products: product[] | null; loading: boolean (fresh query, including sort/filter changes)
// error: string | null; retry(): reloads the active category's first page
// hasMore, loadingMore: booleans; loadMore(): appends another page when available
// sort: 'featured' | 'priceAsc' | 'priceHigh' | 'name' | 'newest'; setSort(key)
// filters: { minPrice?, maxPrice?, inStockOnly?, search? }
// setFilters(object): replaces filters; setFilters(previous => ({ ...previous, ...patch })) merges
// SORTS: { [key]: { label } } for those keys
```
Wix filters and sorts the full matching catalog before paging; the hook never sorts a loaded subset.
Changing category, sort, or filters resets products and the cursor; stale responses are ignored.
`featured` retains its existing key but means **Default order**, not merchant-curated placement.
Prices use the product's minimum actual variant price in site currency, in either direction and
for both bounds; this is not a selected-variant or checkout-discount price. Bounds are inclusive,
non-negative numbers (numeric strings accepted); null/empty omits a bound. Min must not exceed max.
`inStockOnly` matches `IN_STOCK` products, excluding partially stocked and preorder-only products.
`search` searches product names (up to 100 characters). These filters can be combined.

Initial product failure sets `error` and an empty array;
a later page failure preserves products and cursor; call `loadMore()` again to retry that page.
`retry()` starts over at page one with current selections. Render the error separately from
an empty catalog. Category loading fetches only the first 100 categories, excludes `visible: false`
and `slug: "all-products"`, and falls back to `[]` on failure without setting `error`.

For a standalone product selection or category menu, import these named functions from
`@/rest/wix-store-catalog`. They return promises and reject on invalid query options or request failure.

| Function | Result |
|---|---|
| `searchProducts({ limit = 100, cursor, categoryId, sort, minPrice, maxPrice, inStockOnly, search } = {})` | `{ products: product[], nextCursor: string or null }` — same sort/filter semantics as the hook |
| `queryProducts(options = {})` | `{ products: product[], nextCursor: string or null }` — visible catalog products |
| `queryCategories({ limit = 100, cursor } = {})` | `{ categories: category[], nextCursor: string or null }` — one category page |
| `queryProductsByCategory(categoryId, options = {})` | `{ products: product[], nextCursor: string or null }` — visible products in the category identified by `id` |

`queryProducts` and `queryProductsByCategory` accept the same options as `searchProducts`.
A cursor continues the original query; changed filters/sort require starting without one.
Products are the full listing objects consumed by `useProductCard`. Category menu fields are
`id`, `name`, `slug`, and `visible`. Filter out `visible === false` and the system category
`slug === "all-products"`; an empty category list is valid.

```js
const { categories, nextCursor: categoryCursor } = await queryCategories({ limit: 100 });
const menu = categories.filter((c) => c.visible !== false && c.slug !== "all-products");
// Once a category has been selected:
const { products, nextCursor } = await queryProductsByCategory(selectedCategory.id, { limit: 24 });
```
Destructure the arrays; these calls never return bare arrays. Pass a result's `nextCursor` back
as `cursor` to the same query for the next page, stopping at null. Keep category and product
cursors separate; changing category, sort, or filters starts without a cursor. Handle failure separately from
loading so a failed request does not leave a spinner.

### Product detail
```jsx
import { useParams } from "react-router-dom";
import { useProductDetail } from "@/hooks/useProductDetail";
import { useVariantOptions } from "@/hooks/useVariantOptions";
import { productGallery } from "@/lib/storeImage";

export default function ProductDetail() {
  const { slug } = useParams();
  const d = useProductDetail(slug);
  const { optionGroups, modifierGroups } = useVariantOptions(
    d.options, d.modifiers, d.selectedOptions, d.modifierValues
  );
  // Keep all hooks above every conditional return, including while the product loads.
  // d contains:
  // product: Wix product | null; .name, .slug, .plainDescription (HTML)
  // notFound: boolean; error: string | null (load error); retry: () => void
  // price, compareAtPrice: formatted strings ("" if absent), follow the selected variant
  // options, modifiers: arrays consumed by useVariantOptions above
  // selectedOptions: { [optionId]: choiceId }; selectOption(optionId, choiceId)
  // modifierValues: { [key]: value }; setModifier(key, value)
  // variant: resolved variant | null; null if required choices are missing or no match exists
  // focusMediaUrl: selected choice image, then variant image, or null
  // quantity, setQuantity(n): number (may be "" mid-edit)
  // inStock, canAdd, adding: booleans
  // submit: async () => adds product + resolved variant + quantity + modifiers
  // Replace these placeholders with your error, not-found, and loading UI.
  if (d.error) return null; // show d.error and offer d.retry()
  if (d.notFound) return null;
  if (!d.product) return null;

  const images = productGallery(d.product); // [{ url, altText }], main first, de-duplicated
  // Render your PDP using d, images, optionGroups, and modifierGroups.
  return null;
}
```
- Render `product.plainDescription` as HTML; strike `compareAtPrice` only when present and different from `price`.
- Make the gallery follow `focusMediaUrl` when the selected option changes.
- Render the option/modifier controls below; show a selection hint when `options.length && !variant`.
- Keep quantity at least 1. Disable adding when `!canAdd || adding`; call `submit()` only with a loaded product and `canAdd`. `submit()` coerces quantity to at least 1 but does not itself enforce `canAdd`.
- `canAdd` checks variant resolution, variant stock, and mandatory modifier values. `inStock` defaults to true without a resolved variant; use `canAdd` for the full gate.
- `submit()` resets `adding` after completion and resolves without a cart result. Add failures live in `useCart().error`, not the PDP load `error`; show them even when the drawer is closed.

### Variant and modifier controls
The product-detail example above provides both groups:
```js
// optionGroups: [{ id, name, isColor, choices: [
//   { choiceId, name, colorCode: string | null, isColorSwatch, inStock, selected }
// ] }]
// modifierGroups: [{ key, name, mandatory, type: 'choices'|'text',
//   choices?: [{ key, name, selected }], value?: string }]
// Select option: d.selectOption(group.id, choice.choiceId)
// Select modifier: d.setModifier(m.key, choice.key)
// Text modifier: d.setModifier(m.key, text)
```
Retired option choices are filtered out. Respect each choice's `inStock` and modifier's
`mandatory` flag; the hook supplies colour values and selection state without prescribing layout.

### Images
`useProductCard` returns normalized `image`/`hoverImage`, and `useProductDetail` returns normalized
`focusMediaUrl`; use them directly. For a gallery or images outside those hooks, import from
`@/lib/storeImage`:

| Helper | Contract |
|---|---|
| `productGallery(product)` | `[{ url, altText }]`, main image first, de-duplicated; skips entries without an image URL; empty array when no images |
| `productImage(product)` | Normalized primary image URL or null, for a standalone catalog image |
| `storeImage(value)` | Accepts a URL string, `{ image: { url } }`, or `{ url }`; prefixes `//` with `https:`, returns other URLs unchanged or null when absent |

Gallery URLs are normalized too. Handle missing images; don't reconstruct media URLs or resolve
choice/variant media yourself.

### Cart
Use the shipped `CartDrawer` and `CartButton` with `CartProvider`, as wired below. The drawer
already renders cart lines, quantities, subtotal, and checkout; you do not need to build a cart UI.
Your card/PDP adds products through the named `useCart` export from `@/context/CartContext`
within `CartProvider` (the PDP hook calls it for you).

```js
const { addToCart, isOpen, setIsOpen, loading, error, clearError } = useCart();
// addToCart(productId, variantId?, qty = 1, { modifierChoices?, customTextFields? }?)
// isOpen: boolean; setIsOpen(true): open the drawer; setIsOpen(false): close it
// loading: mutation-in-progress boolean; disable repeated adds while true
// error: string | null; clearError(): clears it
```
`addToCart` uses `product.id` and the resolved `variant.id` when needed. Extras are string maps:
`modifierChoices: { [modifier.key]: choiceKey }` and
`customTextFields: { [modifier.freeTextSettings.key]: userInput }`; include mandatory values.

The context's add/remove/update/checkout methods return promises resolving to `undefined` on
success or `null` on failure, storing the failure in `error`. They clear the previous error and
set `loading` during the operation. Successful add updates the server-cart snapshot and opens the
drawer; failed add does not open it. The drawer displays errors only while open, so your card/PDP
must surface `error` too. These context methods do not return the updated cart or checkout URL.
The lower-level REST helpers can reject; don't apply their rejection contract to `useCart()`.

#### Custom cart UI — optional
Only use these additional contracts if you choose to render your own cart surface. They come
from the same `useCart()` context; mutation results and error handling are described above.

```js
const { cart, itemCount, removeItem, updateQuantity, checkout, refreshCart } = useCart();
// cart: server cart | null; itemCount: sum of confirmed line quantities
// removeItem(lineItemId); updateQuantity(lineItemId, qty)
// checkout(); refreshCart()
```
For custom cart presentation, `cart?.lineItems ?? []` is the list. Each line has `id`,
`name.original`, and optional `attributes.image.url`. Option/modifier labels are in
`attributes.descriptionLines`: `[{ name: { original }, plainText?: { original },
colorInfo?: { original, code } }]`; use `plainText.original` or `colorInfo.original` for the value.
Update/remove use the line's `id`, not a catalog product id.

Normalize custom cart images with `storeImage(line.attributes?.image?.url)` (see **Images**).

`checkout()` navigates to the hosted checkout URL; it refuses empty carts and lines with a status
other than `IN_STOCK`, and refreshes the cart after failure. `refreshCart()` replaces the snapshot
and resolves to `undefined`; its underlying read returns null for no cart or a failed request. It
does not set mutation `loading` or `error`.

Cart money is `{ amount, convertedAmount }`, with no formatted string. `amount` is in site
currency; `convertedAmount` is in display currency. Format
`money.convertedAmount ?? money.amount` with `Intl.NumberFormat` and
`cart.customerInfo?.currencyCode ?? cart.businessInfo?.currencyCode` (the shipped drawer falls
back to `USD`). Use server `cart.subtotal` and line `pricing.totalPrice`; never sum lines yourself.
The cart has no `subtotalAfterDiscounts`, `discount`, or `appliedDiscounts`; discounted summary
totals require a currentCartV2 estimate/calculate `summary.priceSummary`, which these helpers do
not fetch. Tax and shipping resolve at checkout.

Line `quantityInfo.confirmedQuantity` is the current quantity; `availableQuantity` caps increases
when finite. `status` can be `IN_STOCK`, `PARTIALLY_IN_STOCK`, `OUT_OF_STOCK`, or
`REMOVED_FROM_CATALOG`; surface unavailable lines and prevent checkout until resolved.

## Routes and provider (surgical `find_replace` on `src/App.jsx`, never a rewrite)
**No shipped source reads needed to wire this.** `CartDrawer` and `CartButton`
are default exports that take **no props**. `CartProvider` is a named export accepting `children`;
wire these exactly as shown below.
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it.
- Wrap the routed tree in `<CartProvider>` (from `@/context/CartContext`).
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every** page
  — including your Shop and product-detail pages. Mount `<CartDrawer/>` once in the Layout.
- Routes under the Layout: `/shop` → **your `Shop`** (renders your grid); `/product/:slug` → **your
  `ProductDetail`**; `/` → **your `Home`**.

Mount the default export `CartButton` from `@/components/CartButton` once in your header. It opens
the drawer and shows the live count, inheriting `currentColor`; use it as-is, without a nested button.

```jsx
import { Routes, Route, Outlet } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import CartDrawer from "@/components/CartDrawer";
import Shop from "@/pages/Shop";                       // YOU build
import ProductDetail from "@/pages/ProductDetail";     // YOU build
import Home from "@/pages/Home";       // YOU build
import Header from "@/components/Header";   // YOU build
import Footer from "@/components/Footer";   // YOU build

function Layout() {
  return (<>
    <Header />
    <Outlet />
    <Footer />
    <CartDrawer />
  </>);
}

<CartProvider>
  <Routes>
    <Route element={<Layout />}>                                   {/* chrome wraps all */}
      <Route path="/" element={<Home />} />                        {/* yours */}
      <Route path="/shop" element={<Shop />} />                    {/* yours */}
      <Route path="/product/:slug" element={<ProductDetail />} />  {/* yours */}
    </Route>
  </Routes>
</CartProvider>
```

### Optional banner integration — enabled entry flows only
Follow the entry guide's banner choice. If it disables the banner, use the common wiring above
without a banner import, mount, or banner-specific fixed region.

When enabled, `WixManageBanner` is a default export with no props. It uses `WIX_METASITE_ID` from
`@/rest/wix-config`, links to that site's dashboard, and renders only in preview; it returns null
when dismissed or while the site id is a placeholder. Mount it once above the header in one fixed
region; keep the header in flow within that region and offset the content by its measured height
so dismissal or resizing leaves no gap or overlap. Replace only the example's `Layout` with:

```jsx
import { useRef, useState, useEffect } from "react";
import WixManageBanner from "@/components/WixManageBanner";

function Layout() {
  const topRef = useRef(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(() => setOffset(topRef.current?.offsetHeight ?? 0));
    if (topRef.current) ro.observe(topRef.current);
    return () => ro.disconnect();
  }, []);
  return (<>
    <div ref={topRef} style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50 }}>
      <WixManageBanner />
      <Header />
    </div>
    <div style={{ paddingTop: offset }}>
      <Outlet />
      <Footer />
    </div>
    <CartDrawer />
  </>);
}
```

## Missing capabilities
For anything these interfaces do not cover, consult the official Wix API documentation using
the documentation skill available in your environment.
For a specifically missing field/interface or an observed runtime error, read only the relevant
shipped file; catalog and cart helpers link their API references inline.

## Hard rules
- Style via base44 design tokens (`index.css` / shadcn Tailwind classes), never by rewriting the shipped components or adding a parallel theme file. Everything you build (Shop, grid, card, PDP, variant controls, Home) draws from the same tokens.
- Header/footer live in a `Layout` around `<Outlet/>` (see **Routes and provider**) — keep shared chrome out of individual pages.
- Checkout goes through the shipped cart (redirect-session) — never a hand-built `/checkout` URL.
- Render live Wix data or your empty state — never mock products.
