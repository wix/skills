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
| `hooks/useProductDetail.js` | PDP data — product + variant resolution for a slug |
| `components/ProductCard.jsx`, `ProductGrid.jsx` | product listing UI (grid + card, with empty state) |
| `components/CartButton.jsx` | header cart **icon** button with a live-count badge |
| `components/CartDrawer.jsx` | slide-over cart (mount once; opens from `useCart`) |
| `components/VariantPicker.jsx` | option/variant selector used on the PDP |
| `components/WixManageBanner.jsx` | dev-only manage banner — drop it into your Layout (STEP 4) |
| `pages/Shop.jsx`, `pages/ProductDetail.jsx` | the two shipped routes (`/shop`, `/product/:slug`) |
| `rest/wix-config.js` | **you set the ids here** (STEP 2) |
| `rest/wix-client.js` + `rest/wix-store-*.js` | REST transport + catalog/cart helpers |

They're already in place — go **straight to theming + wiring**, nothing to verify first. **Don't
`read_file` the shipped page/component/hook source to inspect it** — the table above says what each is
and every field shape you need is in the snippets below. Read a shipped file's source **only** on a
real fallback — a runtime error, or a field the snippets don't cover (see "Fallback only" at the
end). (Files missing? the install's `deploy` result lists what it wrote; re-run install, or copy
`references/storefront/app/` → `src/`.)

## STEP 2 — Credentials
Write `src/rest/wix-config.js` with your `WIX_CLIENT_ID` and `WIX_METASITE_ID` from the prompt — the
one place both ids live.

## STEP 3 — Theme (nothing to style on the shipped components)
The shipped components carry **no palette of their own** — they render from base44's design tokens
in `src/index.css` (`:root`/`.dark`: `--background`, `--foreground`, `--card`, `--primary`,
`--muted`, `--border`, `--radius`, `--font-*`) via shadcn Tailwind classes (`bg-card`,
`text-foreground`, `bg-primary`, `text-muted-foreground`, `border-border`, `rounded-lg`,
`font-display`). Those tokens are **already set to the brand by the design phase**, so the shipped
pages are themed with zero work here. To adjust the palette, edit `index.css` (`:root` **and**
`.dark`) — the base44 way; **never add a parallel theme file (e.g. a `theme.css`) or restyle the
shipped JSX.** Build the Home/Header you add (STEP 4) from the **same** base44 tokens/classes so it
matches automatically. A dark brand is just base44's dark palette in `index.css` — no per-component work.

## STEP 4 — Wire routes + provider (surgical `find_replace` on `src/App.jsx`, never a rewrite)
**No file reads needed to wire this.** Every shipped page and `WixManageBanner` is a default export that takes **no props** — wire them exactly as the snippet shows; nothing in those files needs looking up.
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it.
- Wrap the routed tree in `<CartProvider>` (from `@/context/CartContext`).
- Put your **header + footer in a `Layout`** that renders `<Outlet/>` between them, and nest every
  route under one pathless `<Route element={<Layout/>}>`. Your brand chrome then wraps **every** page
  — including the shipped `Shop` / `ProductDetail` — so you **never edit the shipped pages to add a
  header/footer** (they render inside `<Outlet/>` as-is). Mount `<CartDrawer/>` once in the Layout.
- **Pin the top chrome as one fixed block.** Put `<WixManageBanner/>` (shipped, dev-only) **above**
  your `<Header/>` inside a single `position:fixed` top region — the header itself is plain in-flow
  markup, the region owns the fixing — so banner + header ride together (no scroll drift/gap). Pad
  the content by the region's measured height so it clears the chrome and self-corrects when the
  banner is dismissed.
- Routes under the Layout: `/shop` → `Shop`, `/product/:slug` → `ProductDetail` (both shipped, as-is).
  **You add `/` → your own Home** page.

```jsx
import { useRef, useState, useEffect } from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import { CartProvider } from "@/context/CartContext";
import CartDrawer from "@/components/CartDrawer";
import WixManageBanner from "@/components/WixManageBanner";   // shipped, dev-only · default export, no props
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
      <WixManageBanner />                    {/* null in prod / when dismissed */}
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
two you drop into the `Layout` (STEP 4) so they wrap every route — plus the overall brand story,
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
  const [products, setProducts] = useState([]);
  // NB: queryProducts returns { products, nextCursor } — destructure the array.
  useEffect(() => { queryProducts({ limit: 8 }).then(({ products }) => setProducts(products)); }, []);
  return <ProductGrid products={products} empty="Products coming soon." />;
}
```
Everything reads base44's design tokens (`index.css`), so your home/nav match the shipped pages
automatically. `<CartButton/>` is an icon button (live-count badge) — drop it in as-is, it inherits `currentColor`.

**Editing a component and the change doesn't show? It's the preview, not your code.** The dev preview
can serve a stale module after a write. Before diagnosing a visual bug you just "fixed", do a fresh
full navigate/reload of the preview and re-check — don't keep rewriting correct code against a stale
render.

## Using the client from your own UI (cart, hand-built images)

```jsx
import { Link } from "react-router-dom";
import { useCart } from "@/context/CartContext";

// useCart() gives:
// { cart, itemCount, isOpen, setIsOpen, loading,
//   addToCart(productId, variantId?, qty=1, { modifierChoices?, customTextFields? }?),
//   removeItem(lineItemId), updateQuantity(lineItemId, qty), checkout(), refreshCart() }

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

// An image you render yourself (hero / custom card): make the url https + keep a token bg so a
// just-generated url that 404s for a second reads as a surface, not a blank block.
function BrandImage({ url, alt }) {
  const src = url?.startsWith("//") ? `https:${url}` : url;      // ProductCard already does this
  return <div className="bg-card"><img src={src} alt={alt} /></div>;
}
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
// image urls live at: product.media.main.image.url  ·  cart lineItems[].image.url
```

Fallback only — when you hit an error or need something not shown here (coupons, members, a field
these snippets don't have): read the relevant shipped file under `src/`, or look it up via the
**`wix-docs`** skill.

## Hard rules
- Set `WIX_CLIENT_ID` (STEP 2) — not the placeholder.
- Style via base44 design tokens (`index.css` / shadcn Tailwind classes), never by rewriting the shipped components or adding a parallel theme file.
- Header/footer live in a `Layout` around `<Outlet/>` (STEP 4) — never edit the shipped `Shop`/`ProductDetail` to add chrome.
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
- [ ] Cart survives reload (same visitor); add / update-qty / remove work; checkout redirects.
- [ ] Empty catalog shows the shipped empty state; no mock products anywhere.
