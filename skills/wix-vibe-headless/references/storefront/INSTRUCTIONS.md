# Wix Storefront — ready-made client

The storefront client is **shipped as real files**, not snippets to regenerate. It's a complete
catalog + PDP + server-cart + checkout, styled with your app's design tokens (base44's
`src/index.css` — the shadcn palette the design phase already set). Copy it into the app and wire
the routes — you generate almost none of the commerce code (variant resolution, modifiers, stock
gating, the server cart all ship and are correct).

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
| `hooks/useProductDetail.js` | PDP data — product + variant resolution for a slug, plus load/add state |
| `hooks/useShop.js` | catalog listing — category menu, cursor paging, sort, failure state |
| `hooks/useProductCard.js` | headless data layer for a grid tile — returns `leftBadges`, `promoBadge`, `priceDisplay`, `compareAtDisplay`, `colors`, `optionLabel`, `isQuickAddable`, `image`, `hoverImage`; **always use this to build your own product card UI on the grid** |
| `components/ProductCard.jsx` | reference implementation of a grid tile built on `useProductCard` — read it for inspiration, build your own component rather than using it directly |
| `components/ProductGrid.jsx` | reference grid layout (2-col mobile → auto-fill desktop) with skeleton + empty state — read it for the skeleton/empty-state patterns, build your own layout rather than using it directly |
| `components/ProductGallery.jsx` | PDP main image + thumbnails |
| `lib/storeImage.js` | `productImage()` / `productGallery()` / `storeImage()` — normalise Wix image urls |
| `components/CartButton.jsx` | header cart **icon** button with a live-count badge |
| `components/CartDrawer.jsx` | slide-over cart (mount once; opens from `useCart`) |
| `hooks/useVariantOptions.js` | headless data layer for options/modifiers — returns `optionGroups` + `modifierGroups` (normalised, render-agnostic); **always use this to build your own variant UI on the PDP** |
| `components/VariantPicker.jsx` | reference implementation of a variant selector built on `useVariantOptions` (pills + colour swatches) — read it for inspiration, but build your own component rather than using it directly |
| `components/WixManageBanner.jsx` | preview-only manage banner — drop it into your Layout (STEP 3) |
| `pages/Shop.jsx`, `pages/ProductDetail.jsx` | the two shipped routes (`/shop`, `/product/:slug`) |
| `rest/wix-config.js` | the two ids, written by the install step |
| `rest/wix-client.js` + `rest/wix-store-*.js` | REST transport + catalog/cart helpers |

They're already in place — go **straight to theming + wiring**, nothing to verify first. **Don't
`read_file` the shipped page/component/hook source to inspect it** — the table above says what each is
and every field shape you need is in the snippets below. Read a shipped file's source **only** on a
real fallback — a runtime error, or a field the snippets don't cover (see "Fallback only" at the
end). (Files missing? the install's `deploy` result lists what it wrote; re-run install, or copy
`references/storefront/app/` → `src/`.)


## STEP 2 — Theme (nothing to style on the shipped components)
The shipped components carry **no palette of their own** — they render from base44's design tokens
in `src/index.css` (`:root`/`.dark`: `--background`, `--foreground`, `--card`, `--primary`,
`--muted`, `--border`, `--radius`, `--font-*`) via shadcn Tailwind classes (`bg-card`,
`text-foreground`, `bg-primary`, `text-muted-foreground`, `border-border`, `rounded-lg`,
`font-display`). Those tokens are **already set to the brand by the design phase**, so the shipped
pages are themed with zero work here. To adjust the palette, edit `index.css` (`:root` **and**
`.dark`) — the base44 way; **never add a parallel theme file (e.g. a `theme.css`) or restyle the
shipped JSX.** Build the Home/Header you add (STEP 3) from the **same** base44 tokens/classes so it
matches automatically. A dark brand is just base44's dark palette in `index.css` — no per-component work.

## STEP 3 — Wire routes + provider (surgical `find_replace` on `src/App.jsx`, never a rewrite)
**No file reads needed to wire this.** Every shipped page and `WixManageBanner` is a default export that takes **no props** — wire them exactly as the snippet shows; nothing in those files needs looking up.
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it.
- Wrap the routed tree in `<CartProvider>` (from `@/context/CartContext`).
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every** page
  — including the shipped `Shop` / `ProductDetail` — so you **never edit the shipped pages to add a
  header/footer** (they render inside `<Outlet/>` as-is). Mount `<CartDrawer/>` once in the Layout.
- **Pin the top chrome as one fixed block.** Put `<WixManageBanner/>` (shipped, preview-only) **above**
  your `<Header/>` inside a single `position:fixed` top region — the header itself is plain in-flow
  markup, the region owns the fixing — so banner + header ride together (no scroll drift/gap). Pad
  the content by the region's measured height so it clears the chrome and self-corrects when the
  banner is dismissed.
- Routes under the Layout: `/shop` → `Shop`, `/product/:slug` → `ProductDetail` (both shipped, as-is).
  **You add `/` → your own Home** page.
- **Build your own variant selector on the PDP — this is required, not optional, and it's your chance to be creative.** `ProductDetail.jsx` ships with a `VariantPicker` import — remove it and replace with your own component built on `useVariantOptions`. Design the controls to fit the brief: the business type, the tone, the audience. A fashion brand might want large colour swatches and a size chart link; a tech store might want a compact dropdown. `VariantPicker.jsx` is in `src/` for reference — read it, don't use it:
- **Build your own product card for the grid — this is required, not optional, and it's your chance to be creative.** `ProductGrid.jsx` ships with a `ProductCard` import — replace it with your own component built on `useProductCard`. The hook hands you everything the tile needs (badges, price display, colour dots, quick-add flag, images) — you decide the layout, shape, hover behaviour, and CTA style. A lifestyle brand might want full-bleed images with an overlay gradient; a tech store might want a compact horizontal list item. `ProductCard.jsx` is in `src/` for reference — read it, don't use it:
- **Build your own grid layout — this is required, not optional, and it's your chance to be creative.** `ProductGrid.jsx` ships as a reference (2-col mobile → auto-fill desktop, 220px min) — replace it with an arrangement that fits the brief. A curated boutique might want a 3-col asymmetric editorial layout; a high-volume store might want a dense 4-col grid; a featured strip on the home page might want horizontal scroll. Keep the skeleton and empty-state patterns from `ProductGrid.jsx` (copy them into your own component) — the states themselves are correct, just the layout is yours to choose.

```jsx
import { Link } from "react-router-dom";
import { useCart } from "@/context/CartContext";
import { useProductCard } from "@/hooks/useProductCard";

export default function MyProductCard({ product }) {
  const { addToCart } = useCart();
  const {
    isSoldOut, isPreorder,
    leftBadges,       // [{ type: 'pre-order'|'sold-out'|'limited-stock', label }] — render left side of image
    promoBadge,       // { type: 'discount'|'ribbon', label } | null — render right side
    priceDisplay,     // "€10" or "€10 – €20" (range when variants differ)
    compareAtDisplay, // original price string | null
    colors,           // hex strings → render as dots (slice to how many you want)
    optionLabel,      // "3 sizes · 2 materials" or empty string
    isQuickAddable,   // true for single-variant, in-stock products
    image,            // primary image URL | null
    hoverImage,       // second image URL | null
  } = useProductCard(product);

  // Then render however you want:
  return (
    <div>
      {/* image, badges, price, colour dots, quick-add or "Choose options" CTA */}
      {isQuickAddable && <button onClick={() => addToCart(product.id)}>Quick add</button>}
      {!isQuickAddable && !isSoldOut && <Link to={`/product/${product.slug}`}>Choose options</Link>}
      {isSoldOut && isPreorder && <Link to={`/product/${product.slug}`}>Pre-order</Link>}
    </div>
  );
}
```

```jsx
import { useVariantOptions } from "@/hooks/useVariantOptions";

// options/modifiers/selectedOptions/modifierValues come from useProductDetail:
const { optionGroups, modifierGroups } = useVariantOptions(options, modifiers, selectedOptions, modifierValues);

// optionGroups: [{ id, name, isColor, choices: [{ choiceId, name, colorCode, isColorSwatch, inStock, selected }] }]
// modifierGroups: [{ key, name, mandatory, type: 'choices'|'text', choices?: [{ key, name, selected }], value?: string }]

// Then render however you want:
optionGroups.map((group) =>
  group.choices.map((c) =>
    c.isColorSwatch
      ? <MySwatch key={c.choiceId} color={c.colorCode} active={c.selected} disabled={!c.inStock}
                  onClick={() => selectOption(group.id, c.choiceId)} />
      : <MyPill  key={c.choiceId} active={c.selected} disabled={!c.inStock}
                  onClick={() => selectOption(group.id, c.choiceId)}>{c.name}</MyPill>
  )
);
modifierGroups.map((m) =>
  m.type === "text"
    ? <MyInput key={m.key} label={m.name} value={m.value} onChange={(v) => setModifier(m.key, v)} />
    : m.choices.map((c) =>
        <MyPill key={c.key} active={c.selected} onClick={() => setModifier(m.key, c.key)}>{c.name}</MyPill>
      )
);
```

```jsx
import { useRef, useState, useEffect } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import CartDrawer from "@/components/CartDrawer";
import WixManageBanner from "@/components/WixManageBanner";   // shipped, preview-only · default export, no props
import Shop from "@/pages/Shop";                       // shipped · default export, no props
import ProductDetail from "@/pages/ProductDetail";     // shipped · default export, no props
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
      <Outlet />                             {/* shipped Shop/ProductDetail render here, untouched */}
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
      <Route path="/product/:slug" element={<ProductDetail />} />  {/* shipped, as-is */}
    </Route>
  </Routes>
</CartProvider>
```

## What you build (not shipped)
The **home / landing page**, the **`Header`** (mount `<CartButton/>` in it) and a **`Footer`** — the
two you drop into the `Layout` (STEP 3) so they wrap every route — plus the overall brand story,
styled from the same base44 tokens/classes. **Compose the shipped pieces** — a
featured strip is just `queryProducts` + the shipped `ProductGrid`; the nav is a `<CartButton/>`
(a clean cart-**icon** button with a live-count badge — render it as-is, don't wrap it in your own
text button) + a link to `/shop`:

```jsx
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { queryProducts } from "@/rest/wix-store-catalog";
import ProductGrid from "@/components/ProductGrid";
import CartButton from "@/components/CartButton";

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

// Buy from a card → link to the PDP; the shipped ProductDetail owns options/variants + add-to-cart.
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
- Style via base44 design tokens (`index.css` / shadcn Tailwind classes), never by rewriting the shipped components or adding a parallel theme file.
- Header/footer live in a `Layout` around `<Outlet/>` (STEP 3) — never edit the shipped `Shop`/`ProductDetail` to add chrome.
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
- [ ] Brand palette lives in `index.css` (`:root`/`.dark`); no parallel theme file; shipped components/pages not restyled or rewritten.
- [ ] **Opened `/shop` and a product detail page** (not just the home page) and confirmed the shipped cards render themed (surface, text, brand color) with images.
- [ ] `Layout` (fixed `<WixManageBanner/>` + `<Header/>` region, then `<Outlet/>` + Footer) wraps all routes; shipped `Shop`/`ProductDetail` untouched; content clears the fixed chrome; `<CartProvider>` wraps the tree; `<CartDrawer/>` mounted; `<CartButton/>` in the header.
- [ ] Cart survives reload (same visitor); add / update-qty / remove work; checkout redirects; the drawer shows a **subtotal**.
- [ ] Empty catalog shows the shipped empty state; no mock products anywhere.
- [ ] A product with several images shows **thumbnails** on the PDP, and one with per-variant prices shows a **range** on its card.
- [ ] Categories seeded? The `/shop` menu lists them (minus the auto-created `all-products`) and filters; a catalog past one page shows **Load more**.
