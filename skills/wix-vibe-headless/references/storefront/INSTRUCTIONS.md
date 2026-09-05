# Wix Storefront — ready-made client

The storefront ships the commerce hooks, server cart, REST transport, image helpers, and `Shop`
listing page. You build the presentation: product card, grid, variant controls, product detail
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
| `hooks/useShop.js` | Catalog listing, categories, cursor paging, sort, failure state; used by `Shop` |
| `hooks/useProductCard.js` | Card badges, prices, options summary, quick-add flag, images |
| `hooks/useVariantOptions.js` | Render-agnostic option and modifier groups for PDP controls |
| `lib/storeImage.js` | Wix image URL and gallery helpers |
| `components/CartButton.jsx` | Cart icon button with a live-count badge |
| `components/CartDrawer.jsx` | Cart drawer; mount once, opens through `useCart` |
| `components/WixManageBanner.jsx` | Preview-only manage banner for the Layout |
| `pages/Shop.jsx` | `/shop` page; imports your `ProductGrid` |
| `rest/wix-config.js` | Wix client and site ids |
| `rest/wix-client.js` | REST transport and visitor authentication |
| `rest/wix-store-catalog.js` | Product and category queries |
| `rest/wix-store-cart.js` | Cart mutations and hosted checkout |

**DO NOT READ SHIPPED SOURCE** except to resolve a specifically identified field/interface missing
below or an observed runtime error; read only the relevant file.
If deployment failed or files are missing, re-run the install/deploy step.

## Theme
Use the existing Base44 theme in `src/index.css` for new components. The shipped client already
uses it; don't add a parallel theme or restyle shipped pages.

## Presentation interfaces
Build `components/ProductCard.jsx`, `components/ProductGrid.jsx`, and `pages/ProductDetail.jsx`
from these contracts. `Shop` needs your grid; `/product/:slug` needs your PDP. Home, header, and
footer are yours to design; their integration is in **Routes and provider** below.

### Product card
```jsx
import { useProductCard } from "@/hooks/useProductCard";
import { useCart } from "@/context/CartContext";

export default function ProductCard({ product }) {
  const { addToCart, error } = useCart();
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
Display cart-context `error` for a failed quick-add (see **Cart**); failure does not open the drawer.

### Product grid and catalog data
```jsx
export default function ProductGrid({ products, loading, empty, emptyHint }) {
  // products: array | null (null while loading); loading: boolean
  // empty: heading string; emptyHint: optional supporting string
  // Render loading, empty, or the list of <ProductCard product={product} /> items.
}
```
For catalog data in your own pages, import `queryProducts` from `@/rest/wix-store-catalog`:
```js
const { products, nextCursor } = await queryProducts({ limit: 8 });
// Returns { products: object[], nextCursor: string | null }, never a bare array.
// Pass nextCursor as cursor for another page; default limit is 100.
```
Handle query failure separately from loading; don't leave a failed request on a spinner.

### Product detail
```jsx
import { useParams } from "react-router-dom";
import { useProductDetail } from "@/hooks/useProductDetail";
import { productGallery } from "@/lib/storeImage";

export default function ProductDetail() {
  const { slug } = useParams();
  const d = useProductDetail(slug);
  // d contains:
  // product: Wix product | null; .name, .slug, .plainDescription (HTML)
  // notFound: boolean; error: string | null (load error); retry: () => void
  // price, compareAtPrice: formatted strings ("" if absent), follow the selected variant
  // options, modifiers: arrays for useVariantOptions below
  // selectedOptions: { [optionId]: choiceId }; selectOption(optionId, choiceId)
  // modifierValues: { [key]: value }; setModifier(key, value)
  // variant: resolved variant | null; null if required choices are missing or no match exists
  // focusMediaUrl: selected choice image, then variant image, or null
  // quantity, setQuantity(n): number (may be "" mid-edit)
  // inStock, canAdd, adding: booleans
  // submit: async () => adds product + resolved variant + quantity + modifiers
  const images = productGallery(d.product); // [{ url, altText }], main first, de-duplicated
  // Render your PDP.
}
```
- Handle `error` with `retry()`, then `notFound`, then `!product` as loading.
- Render `product.plainDescription` as HTML; strike `compareAtPrice` only when present and different from `price`.
- Make the gallery follow `focusMediaUrl` when the selected option changes.
- Render the option/modifier controls below; show a selection hint when `options.length && !variant`.
- Keep quantity at least 1. Disable adding when `!canAdd || adding`; call `submit()` only with a loaded product and `canAdd`. `submit()` coerces quantity to at least 1 but does not itself enforce `canAdd`.
- `canAdd` checks variant resolution, variant stock, and mandatory modifier values. `inStock` defaults to true without a resolved variant; use `canAdd` for the full gate.
- `submit()` resets `adding` after completion and resolves without a cart result. Add failures live in `useCart().error`, not the PDP load `error`; show them even when the drawer is closed.

### Variant and modifier controls
```jsx
import { useVariantOptions } from "@/hooks/useVariantOptions";

const { optionGroups, modifierGroups } = useVariantOptions(
  d.options, d.modifiers, d.selectedOptions, d.modifierValues
);
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
Import from `@/lib/storeImage`; URLs may be null, so handle missing images.

| Helper | Contract |
|---|---|
| `storeImage(value)` | Accepts a URL string, `{ image: { url } }`, or `{ url }`; prefixes `//` with `https:`, returns other URLs unchanged or null when absent |
| `productImage(product)` | Normalised `product.media.main.image.url`, or null |
| `productGallery(product)` | `[{ url, altText }]` from the main image and `media.itemsInfo.items`, main first, de-duplicated; skips items without an image URL |
| `choiceImage(choice)` | First `choice.media.items[].mediaId` as a URL, or null; storefront reads use this field, not `linkedMedia` |
| `variantImage(variant)` | Uses `media.image.url`, then `media.id`, then `media.thumbnail.url`; never `media.uploadId` |
| `wixMediaUrl(mediaId)` | Converts a Wix media id to a static CDN URL; normalises existing URLs; null for missing/non-string input |
| `wixMediaId(url)` | Extracts the id after `/media/` for comparison across sizing URLs; returns input unchanged if unmatched |

Cart line images are at `lineItems[].attributes.image.url`; normalise them with `storeImage`.

### Cart
Use the named `useCart` export from `@/context/CartContext` within `CartProvider`.

```js
const {
  cart, itemCount, isOpen, setIsOpen, loading, error, clearError,
  addToCart, removeItem, updateQuantity, checkout, refreshCart,
} = useCart();
// cart: server cart | null; itemCount: sum of confirmed line quantities
// isOpen: boolean; setIsOpen(boolean); loading: mutation-in-progress boolean
// error: string | null; clearError(): clears it
// addToCart(productId, variantId?, qty = 1, { modifierChoices?, customTextFields? }?)
// removeItem(lineItemId); updateQuantity(lineItemId, qty)
// checkout(); refreshCart()
```
`addToCart` uses `product.id` and the resolved `variant.id` when needed. Extras are string maps:
`modifierChoices: { [modifier.key]: choiceKey }` and
`customTextFields: { [modifier.freeTextSettings.key]: userInput }`; include mandatory values.
Update/remove use `cart.lineItems[].id`, not a catalog product id.

The context's add/remove/update/checkout methods return promises resolving to `undefined` on
success or `null` on failure, storing the failure in `error`. They clear the previous error and
set `loading` during the operation. Successful add updates the server-cart snapshot and opens the
drawer; failed add does not open it. The drawer displays errors only while open, so custom add UI
must surface `error` too. These context methods do not return the updated cart or checkout URL.
The lower-level REST helpers can reject; don't apply their rejection contract to `useCart()`.

`checkout()` navigates to the hosted checkout URL; it refuses empty carts and lines with a status
other than `IN_STOCK`, and refreshes the cart after failure. `refreshCart()` replaces the snapshot
and resolves to `undefined`; its underlying read returns null for no cart or a failed request. It
does not set mutation `loading` or `error`.

Cart V2 money is `{ amount, convertedAmount }`, with no formatted string. `amount` is in site
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

Migrating from Cart V1 / Checkout V1? These helpers are V2-only; see the
[migration guide](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/migration-guide).

## Routes and provider (surgical `find_replace` on `src/App.jsx`, never a rewrite)
**No file reads needed to wire this.** Every shipped page and `WixManageBanner` is a default export that takes **no props** — wire them exactly as the snippet shows; nothing in those files needs looking up.
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it.
- Wrap the routed tree in `<CartProvider>` (from `@/context/CartContext`).
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every** page
  — including the shipped `Shop` and your own pages — so you **never edit the shipped `Shop` to add a
  header/footer** (it renders inside `<Outlet/>` as-is). Mount `<CartDrawer/>` once in the Layout.
- **Pin the top chrome as one fixed block.** Put `<WixManageBanner/>` (shipped, preview-only) **above**
  your `<Header/>` inside a single `position:fixed` top region — the header itself is plain in-flow
  markup, the region owns the fixing — so banner + header ride together (no scroll drift/gap). Pad
  the content by the region's measured height so it clears the chrome and self-corrects when the
  banner is dismissed.
- Routes under the Layout: `/shop` → `Shop` (shipped, renders your grid); `/product/:slug` → **your
  `ProductDetail`**; `/` → **your `Home`**.

Mount the default export `CartButton` from `@/components/CartButton` once in your header. It opens
the drawer and shows the live count, inheriting `currentColor`; use it as-is, without a nested button.

```jsx
import { useRef, useState, useEffect } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import CartDrawer from "@/components/CartDrawer";
import WixManageBanner from "@/components/WixManageBanner";   // shipped, preview-only · default export, no props
import Shop from "@/pages/Shop";                       // shipped · default export, no props
import ProductDetail from "@/pages/ProductDetail";     // YOU build
import Home from "@/pages/Home";       // YOU build
import Header from "@/components/Header";   // YOU build — plain in-flow markup, NOT position:fixed
import Footer from "@/components/Footer";   // YOU build

function Layout() {
  const topRef = useRef(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {                                  // measure the fixed region → pad content below it
    const ro = new ResizeObserver(() => setOffset(topRef.current?.offsetHeight ?? 0));
    if (topRef.current) ro.observe(topRef.current);
    return () => ro.disconnect();
  }, []);
  return (<>
    <div ref={topRef} style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 50 }}>
      <WixManageBanner />                    {/* null on the published site / when dismissed */}
      <Header />                             {/* your brand header, in-flow inside this fixed block */}
    </div>
    <div style={{ paddingTop: offset }}>     {/* clears the chrome; shrinks when the banner is dismissed */}
      <Outlet />                             {/* shipped Shop + your pages render here */}
      <Footer />
    </div>
    <CartDrawer />                           {/* overlays every page */}
  </>);
}

<CartProvider>
  <Routes>
    <Route element={<Layout />}>                                   {/* chrome wraps all */}
      <Route path="/" element={<Home />} />                        {/* yours */}
      <Route path="/shop" element={<Shop />} />                    {/* shipped, as-is */}
      <Route path="/product/:slug" element={<ProductDetail />} />  {/* yours */}
    </Route>
  </Routes>
</CartProvider>
```

## Extending the client
Building something beyond the shipped pages? Copy these:

```jsx
// Catalog list helpers return { <plural>, nextCursor } — destructure the array:
const { products, nextCursor } = await queryProducts({ limit: 24 });
const { categories } = await queryCategories();
const menu = categories.filter((c) => c.slug !== "all-products");   // drop Wix's system category
const { products: inCategory } = await queryProductsByCategory(menu[0].id, { limit: 24 });

// product.plainDescription is HTML → render as HTML (the PDP does this):
<div dangerouslySetInnerHTML={{ __html: product.plainDescription }} />
// image urls live at: product.media.main.image.url  ·  cart lineItems[].attributes.image.url
```

Fallback only — when you hit an error or need something not shown here (coupons, members, a field
these snippets don't have): read the relevant shipped file under `src/`, or look it up via the
**`wix-docs`** skill. Each helper in `wix-store-catalog.js` / `wix-store-cart.js` links its own
reference page inline; these are the areas they sit in:
- Stores catalog (products, categories, inventory): https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3.md
- eCommerce (cart, checkout, orders): https://dev.wix.com/docs/api-reference/business-solutions/e-commerce.md
- Headless redirect session (hosted checkout): https://dev.wix.com/docs/api-reference/business-management/headless/redirects.md

## Hard rules
- Style via base44 design tokens (`index.css` / shadcn Tailwind classes), never by rewriting the shipped pages or adding a parallel theme file. Everything you build (card, grid, PDP, variant controls, Home) draws from the same tokens.
- Header/footer live in a `Layout` around `<Outlet/>` (see **Routes and provider**) — never edit the shipped `Shop` to add chrome.
- The Layout's fixed top region owns positioning: `<WixManageBanner/>` above `<Header/>`; your `Header` is plain in-flow markup (not `position:fixed`).
- Checkout goes through the shipped cart (redirect-session) — never a hand-built `/checkout` URL.
- Render live Wix data or the shipped empty state — never mock products.
