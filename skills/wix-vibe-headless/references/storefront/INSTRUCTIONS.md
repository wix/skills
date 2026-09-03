# Wix Storefront — ready-made client

The storefront **commerce engine ships as real files** — the hooks, the server cart, the REST
transport, the image helpers, and the `Shop` listing page, all correct (variant resolution,
modifiers, stock gating, checkout). It reads from your app's design tokens (base44's `src/index.css`
— the shadcn palette the design phase already set).

**The presentation doesn't ship — you build it** (STEP 3): the product **card**, **grid**, **variant
controls**, and the whole **product (PDP) page**, plus **Home** and the **header/footer**. Each is
built on a shipped hook whose return type + field shapes are documented in the outline right next to
it — the data is handed to you done, the layout and look are yours. `Shop` renders once your
`ProductGrid` exists; the PDP renders once you build its page — that's the point.

Talks to Wix directly over the public `WIX_CLIENT_ID` (anonymous visitor tokens). Never mock
products; never hand-build a `/checkout` URL — the shipped cart goes through the eCom
redirect-session.

## Prerequisites
- The site's **Wix Stores** catalog is the read/cart target. It's installed and seeded separately (see **Seeding** below), in parallel with this build — so it may be empty at build time; the client renders the shipped empty state until products land.
- The public headless **`WIX_CLIENT_ID`** from your prompt (buyer-facing, safe to hardcode/commit).

## STEP 1 — The client is already in `src/`
The install step (base44.md STEP 1) deployed the whole storefront UI client + REST scaffolds into
`src/` (imports use the `@/` alias → `src/`). Here's every file and what it is — **this is your map,
so you don't need to open them:**

| file | what it is |
|---|---|
| `context/CartContext.jsx` | `useCart()` provider: server cart, add/update/remove, checkout |
| `hooks/useProductDetail.js` | PDP data — product + variant resolution for a slug, plus load/add state; **your product page (STEP 3) is built on it** |
| `hooks/useShop.js` | catalog listing — category menu, cursor paging, sort, failure state |
| `hooks/useProductCard.js` | headless data layer for a grid tile — returns `leftBadges`, `promoBadge`, `priceDisplay`, `compareAtDisplay`, `colors`, `optionLabel`, `isQuickAddable`, `image`, `hoverImage`; **your `ProductCard` (STEP 3) is built on it** |
| `lib/storeImage.js` | `productImage()` / `productGallery()` / `storeImage()` / `choiceImage()` — normalise Wix image urls; `productGallery(product)` → `[{ url, altText }]` (your PDP gallery); `choiceImage(choice)` resolves an option choice's photo (V3 read shape: `media.items[].mediaId`, not `linkedMedia`) |
| `components/CartButton.jsx` | header cart **icon** button with a live-count badge |
| `components/CartDrawer.jsx` | slide-over cart (mount once; opens from `useCart`) |
| `hooks/useVariantOptions.js` | headless data layer for options/modifiers — returns `optionGroups` + `modifierGroups` (normalised, render-agnostic); **your PDP's variant controls (STEP 3) render from it** |
| `components/WixManageBanner.jsx` | preview-only manage banner — drop it into your Layout (STEP 3) |
| `pages/Shop.jsx` | the shipped `/shop` listing page — renders your `ProductGrid` (you build `/product/:slug` and `/`) |
| `rest/wix-config.js` | the two ids, written by the install step |
| `rest/wix-client.js` + `rest/wix-store-*.js` | REST transport + catalog/cart helpers |

Everything in the table is already in place — go **straight to wiring + building your presentation**
(card, grid, variant controls, the product page, Home — STEP 3), nothing to verify first.
**Don't `read_file` the shipped page/hook source to inspect it** — the table says what each is and
every field shape you need is in the outlines below. Read a shipped file's source **only** on a real
fallback — a runtime error, or a field the outlines don't cover (see "Fallback only" at the end).
(Shipped files missing? the install's `deploy` result lists what it wrote; re-run install, or copy
`references/storefront/app/` → `src/`.)


## STEP 2 — Theme
The shipped pages carry **no palette of their own** — they render from base44's design tokens
in `src/index.css` (`:root`/`.dark`: `--background`, `--foreground`, `--card`, `--primary`,
`--muted`, `--border`, `--radius`, `--font-*`) via shadcn Tailwind classes (`bg-card`,
`text-foreground`, `bg-primary`, `text-muted-foreground`, `border-border`, `rounded-lg`,
`font-display`). Those tokens are **already set to the brand by the design phase**, so the shipped
pages are themed with zero work here. To adjust the palette, edit `index.css` (`:root` **and**
`.dark`) — the base44 way; **never add a parallel theme file (e.g. a `theme.css`) or restyle the
shipped pages.** Style the components you build (STEP 3) and the Home/Header you add from the
**same** base44 tokens/classes so everything matches automatically. A dark brand is just base44's
dark palette in `index.css` — no per-component work.

## STEP 3 — Wire routes + provider (surgical `find_replace` on `src/App.jsx`, never a rewrite)
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

**Build the presentation — it's all yours.** Each piece below is built on a shipped hook whose return
type + field shapes are in the outline right after this list — the data is done, the render is yours.
`Shop` won't show products until `ProductGrid` exists, and `/product/:slug` won't render until you
build the product page, so these aren't optional:

- **`components/ProductGrid.jsx`** — `Shop` and your Home render it. It receives `products`, `loading`,
  `empty`, `emptyHint` and owns three states (loading, empty, list) plus the layout. A boutique might
  want a 3-col editorial layout; a high-volume store a dense 4-col grid; a home strip a horizontal scroll.
- **`components/ProductCard.jsx`** — your grid maps each product to it. Built on `useProductCard`
  (badges, price display, colour dots, quick-add flag, images) — you decide layout, shape, hover, CTA.
  A lifestyle brand might want full-bleed images with an overlay gradient; a tech store a compact item.
- **`pages/ProductDetail.jsx`** — the **whole product page**, built on `useProductDetail`; route
  `/product/:slug` to it. Gallery, price, description, the variant controls (options/modifiers via
  `useVariantOptions`), the buy box — you arrange and style all of it (nothing PDP ships). This is the
  surface that usually looks most generic, so make the layout the brand's: an editorial split, a sticky
  buy column, a full-bleed gallery, large swatches vs a compact dropdown — your call.

```jsx
// components/ProductCard.jsx — your grid maps each product to it.
import { Link } from "react-router-dom";
import { useCart } from "@/context/CartContext";          // addToCart(product.id) for quick-add
import { useProductCard } from "@/hooks/useProductCard";

export default function ProductCard({ product }) {
  const { addToCart } = useCart();
  const {
    isSoldOut, isPreorder,
    leftBadges,       // [{ type: 'pre-order'|'sold-out'|'limited-stock', label }] — image top-left
    promoBadge,       // { type: 'discount'|'ribbon', label } | null — image top-right
    priceDisplay,     // "€10"  |  "€10 – €20" (range when variants differ)
    compareAtDisplay, // original price string | null — strike-through
    colors,           // hex strings → colour dots
    optionLabel,      // "3 sizes · 2 materials" | ""
    isQuickAddable,   // true → addToCart(product.id);  else <Link to={`/product/${product.slug}`}>
    image, hoverImage,// URLs | null
  } = useProductCard(product);
  // …you implement the tile.
}
```

```jsx
// Variant controls — render the product's options/modifiers from useVariantOptions.
// The inputs (options, modifiers, selectedOptions, modifierValues) come from useProductDetail (below).
import { useVariantOptions } from "@/hooks/useVariantOptions";

const { optionGroups, modifierGroups } = useVariantOptions(options, modifiers, selectedOptions, modifierValues);
// optionGroups:   [{ id, name, isColor, choices: [{ choiceId, name, colorCode, isColorSwatch, inStock, selected }] }]
// modifierGroups: [{ key, name, mandatory, type: 'choices'|'text', choices?: [{ key, name, selected }], value?: string }]
// pick a choice:  selectOption(group.id, choice.choiceId)
// set a modifier: setModifier(m.key, choice.key)   ·   text type: setModifier(m.key, e.target.value)
```

```jsx
// components/ProductGrid.jsx — Shop and your Home render it.
import ProductCard from "./ProductCard";                 // your card, above

export default function ProductGrid({ products, loading, empty, emptyHint }) {
  // products   — array | null (null while loading)
  // loading    — boolean
  // empty      — heading string for the no-products state
  // emptyHint  — sub-text string for the no-products state
  // …you implement: the loading state, the empty state (empty + emptyHint), and the layout
  //    mapping products → <ProductCard product={p} />.
}
```

```jsx
// pages/ProductDetail.jsx — YOU build the whole product page. Route `/product/:slug` to it.
// A thin view over useProductDetail: keep the data logic in the hook, render however fits the brand.
import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useProductDetail } from "@/hooks/useProductDetail";
import { productGallery } from "@/lib/storeImage";

export default function ProductDetail() {
  const { slug } = useParams();
  const d = useProductDetail(slug);
  // useProductDetail(slug) returns:
  //   product         Wix product | null (loading) — has .name, .plainDescription (HTML), .slug
  //   notFound        bool — dead link (distinct from error)
  //   error           string | null — failed load; call retry() to reload
  //   retry           () => void
  //   price           formatted string, follows the selection ("€24.00")
  //   compareAtPrice  formatted string — a "was" price; strike it only when it differs from price
  //   options, modifiers                                            → feed useVariantOptions for the variant controls (block above)
  //   selectedOptions, selectOption, modifierValues, setModifier    → also for the variant controls
  //   variant         resolved variant | null (null until every option is picked)
  //   focusMediaUrl   image url for the selected choice — make the gallery show it
  //   quantity, setQuantity(n)   number (may be "" mid-edit) — keep min 1
  //   inStock, canAdd, adding    booleans that gate the buy button
  //   submit          async () => adds the resolved variant + quantity + modifiers to the cart
  const images = useMemo(() => productGallery(d.product), [d.product]);  // [{ url, altText }], main first, de-duped

  // …you implement the page. Handle in order:
  //   error     → show d.error + a retry button (onClick={d.retry})
  //   notFound  → a "not found" message + a <Link to="/shop">
  //   !product  → a loading placeholder
  //   else the product view, laid out to fit the brand:
  //     • gallery from `images` — main + thumbnails, a carousel, a full-bleed hero (your call);
  //       make the shown image follow d.focusMediaUrl when a choice is selected
  //     • d.product.name · d.price (strike d.compareAtPrice when it differs) ·
  //       d.product.plainDescription (HTML → dangerouslySetInnerHTML)
  //     • variant controls — render d.options/d.modifiers via useVariantOptions (block above);
  //       d.selectOption / d.setModifier update the selection
  //     • a "pick an option to continue" hint when d.options.length && !d.variant
  //     • a quantity control (d.quantity / d.setQuantity, min 1 — a −/＋ stepper reads better than a
  //       native number input) + the buy button:
  //         <button disabled={!d.canAdd || d.adding} onClick={d.submit}>
  //           {d.adding ? "Adding…" : d.inStock ? "Add to cart" : "Out of stock"}</button>
}
```

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

## What you build (not shipped)
The **home / landing page**, the **`Header`** (mount `<CartButton/>` in it) and a **`Footer`** — the
two you drop into the `Layout` (STEP 3) so they wrap every route — plus the overall brand story,
styled from the same base44 tokens/classes. **Reuse your own `ProductGrid`** (STEP 3) and the shipped
cart pieces — a featured strip is just `queryProducts` + your `ProductGrid`; the nav is a `<CartButton/>`
(a clean cart-**icon** button with a live-count badge — render it as-is, don't wrap it in your own
text button) + a link to `/shop`:

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { queryProducts } from "@/rest/wix-store-catalog";
import ProductGrid from "@/components/ProductGrid";        // yours (STEP 3)
import CartButton from "@/components/CartButton";           // shipped

// Responsive header: choose ONE branch with a state flag, so <CartButton/> mounts once.
// Do NOT render a desktop nav AND a mobile nav toggled by `hidden md:flex` / `md:hidden`:
// these navs are inline-styled, and an inline `display` beats a Tailwind class, so `hidden`
// never applies — BOTH branches render and you get two cart buttons. One branch = one cart.
export function Header() {                                  // in your nav
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);            // keep it reactive to viewport changes
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      {/* brand/logo */}
      {mobile
        ? <YourMenu />                                       // your hamburger + <CartButton/> here
        : <div style={{ display: "flex", gap: 24 }}><Link to="/shop">Shop</Link><CartButton /></div>}
    </nav>
  );
}
export function Featured() {                                // on your home page
  const [products, setProducts] = useState(null);           // null → ProductGrid shows skeletons
  // NB: queryProducts returns { products, nextCursor } — destructure the array.
  useEffect(() => {
    queryProducts({ limit: 8 })
      .then(({ products }) => setProducts(products))
      .catch(() => setProducts([]));                        // land on the empty state, not a spinner
  }, []);
  return <ProductGrid products={products} loading={products === null} empty="Products coming soon." />;
}
```
Everything reads base44's design tokens (`index.css`), so your home/nav match the shipped pages
automatically. `<CartButton/>` is an icon button (live-count badge) — drop it in as-is, it inherits `currentColor`.

**Editing a component and the change doesn't show? It's the preview, not your code.** The dev preview
can serve a stale module after a write. Before diagnosing a visual bug you just "fixed", do a fresh
full navigate/reload of the preview and re-check — don't keep rewriting correct code against a stale
render.

## Using the client from your own UI (cart, hand-built images)

> Migrating from Cart V1 / Checkout V1? These helpers are V2-only — see the [migration guide](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/migration-guide) for the before/after.

```jsx
import { Link } from "react-router-dom";
import { useCart } from "@/context/CartContext";

// useCart() gives:
// { cart, itemCount, isOpen, setIsOpen, loading, error, clearError(),
//   addToCart(productId, variantId?, qty=1, { modifierChoices?, customTextFields? }?),
//   removeItem(lineItemId), updateQuantity(lineItemId, qty), checkout(), refreshCart() }
// Every mutation catches its own failure into `error` (the shipped CartDrawer renders it), so a
// refusal — an empty cart, or a line item whose status left IN_STOCK — reaches the buyer instead
// of becoming an unhandled rejection.
//
// Cart money: every amount is a ConvertedMoney { amount, convertedAmount } with NO formatted string —
// `amount` is in the site currency, `convertedAmount` in the display currency; format the number
// yourself (Intl.NumberFormat with the cart's currency —
// `cart.customerInfo?.currencyCode ?? cart.businessInfo?.currencyCode`) so the symbol and grouping
// match the locale. The V2 cart has no `subtotalAfterDiscounts`/`discount`/`appliedDiscounts`: it
// carries only a raw `cart.subtotal` (ConvertedMoney). The authoritative discounted totals come from
// a currentCartV2 estimate/calculate `summary.priceSummary`, not the cart — call that when you need
// the after-coupon figure; otherwise show `cart.subtotal`. Never sum line items yourself — tax and
// shipping resolve at checkout.
// A line's `status` (IN_STOCK / PARTIALLY_IN_STOCK / OUT_OF_STOCK) tells a quantity control whether
// another increment is still fulfillable.

function CartCount() {                                   // header badge
  const { itemCount, setIsOpen } = useCart();
  return <button onClick={() => setIsOpen(true)}>Cart ({itemCount})</button>;
}

// Buy from a card → link to the PDP; your ProductDetail (on useProductDetail) owns options/variants + add-to-cart.
// (Listing helpers return no variants — only getProductBySlug does — so buying happens on the PDP.)
const CardBuy = ({ product }) => <Link to={`/product/${product.slug}`}>View</Link>;

// Doing add-to-cart yourself? addToCart resolves for an option-less product; wrap it — it rejects on
// out-of-stock / empty cart / a missing required selection, and you show that message.
async function quickAdd(addToCart, product) {
  try { await addToCart(product.id); } catch (e) { alert(e.message); }
}

// An image you render yourself (hero / custom card): normalise the url through lib/storeImage — Wix
// returns these protocol-relative — and keep a token bg so a just-generated url that 404s for a
// second reads as a surface, not a blank block.
import { storeImage, productImage, productGallery } from "@/lib/storeImage";
function BrandImage({ url, alt }) {
  return <div className="bg-card"><img src={storeImage(url)} alt={alt} /></div>;
}
// productImage(product) → the catalog image · productGallery(product) → every image, main first,
// de-duplicated (media.itemsInfo.items repeats the main one and video items carry no image url).
```

## Extending the client
Building something beyond the shipped pages? Copy these:

```jsx
// Every catalog/cart list helper returns { <plural>, nextCursor } — destructure the array:
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
- Header/footer live in a `Layout` around `<Outlet/>` (STEP 3) — never edit the shipped `Shop` to add chrome.
- The Layout's fixed top region owns positioning: `<WixManageBanner/>` above `<Header/>`; your `Header` is plain in-flow markup (not `position:fixed`).
- Checkout goes through the shipped cart (redirect-session) — never a hand-built `/checkout` URL.
- Render live Wix data or the shipped empty state — never mock products.

## Point the user to their dashboard
Provide deep links so the owner can edit content (substitute the site's `metaSiteId`):
- **Products** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-stores/products`
- **Categories** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-stores/categories/list`

## Seeding
Seed the catalog per `seed/SEED.md` (the build-time `setupStore` module) — separate from this
client build; run in parallel.

## Verify (before declaring done)
- [ ] Client files copied into `src/`; `WIX_CLIENT_ID` set (not the placeholder).
- [ ] **The pieces you own exist and are wired:** `components/ProductCard.jsx`, `components/ProductGrid.jsx` (imported by `Shop` + your Home), and `pages/ProductDetail.jsx` (routed at `/product/:slug`, with working variant controls). `/shop` and a PDP compile and render (they won't until these exist).
- [ ] Brand palette lives in `index.css` (`:root`/`.dark`); no parallel theme file; the shipped `Shop` page not restyled or rewritten.
- [ ] **Opened `/shop` and a product detail page** (not just the home page) and confirmed your cards render themed (surface, text, brand color) with images; the grid shows its loading + empty states; the PDP shows the gallery, price, variant controls, and add-to-cart, and its error/not-found/loading states hold.
- [ ] `Layout` (fixed `<WixManageBanner/>` + `<Header/>` region, then `<Outlet/>` + Footer) wraps all routes; the shipped `Shop` untouched; content clears the fixed chrome; `<CartProvider>` wraps the tree; `<CartDrawer/>` mounted; `<CartButton/>` in the header.
- [ ] Cart survives reload (same visitor); add / update-qty / remove work; checkout redirects; the drawer shows a **subtotal**.
- [ ] Empty catalog shows the shipped empty state; no mock products anywhere.
- [ ] A product with several images shows **thumbnails** on the PDP, and one with per-variant prices shows a **range** on its card.
- [ ] Categories seeded? The `/shop` menu lists them (minus the auto-created `all-products`) and filters; a catalog past one page shows **Load more**.
