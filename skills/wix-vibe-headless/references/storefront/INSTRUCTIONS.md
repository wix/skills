# Wix Storefront — ready-made client

The storefront client is **shipped as real files**, not snippets to regenerate. It's a complete
catalog + PDP + server-cart + checkout, styled entirely from `theme.css` tokens. Copy it into the
app, theme the tokens, wire the routes — you generate almost none of the commerce code (variant
resolution, modifiers, stock gating, the server cart all ship and are correct).

Talks to Wix directly over the public `WIX_CLIENT_ID` (anonymous visitor tokens). Never mock
products; never hand-build a `/checkout` URL — the shipped cart goes through the eCom
redirect-session.

## Prerequisites
- Wix Stores installed with products (this client is read/cart over the catalog; seeding is STEP 5).
- The public headless **`WIX_CLIENT_ID`** from your prompt (buyer-facing, safe to hardcode/commit).

## STEP 1 — The client is already in `src/`
The install step (base44.md STEP 1) deployed both the REST scaffolds (`src/rest/`) **and** this
storefront UI client into `src/`: `src/theme.css`, `src/context/CartContext.jsx`,
`src/hooks/useProductDetail.js`,
`src/components/{ProductCard,ProductGrid,CartButton,CartDrawer,VariantPicker}.jsx`,
`src/pages/{Shop,ProductDetail}.jsx`. Imports use the `@/` alias (→ `src/`). Nothing to copy —
confirm the files are there, then theme + wire (below). (Missing? re-run install, or copy
`references/storefront/app/` → `src/`.)

## STEP 2 — Credentials
In `src/rest/wix-client.js` set `WIX_CLIENT_ID` to the value from your prompt.

## STEP 3 — Theme (the styling step — do ONLY this to the shipped components)
Edit `src/theme.css` tokens to the brand: palette, `--font-display`/`--font-body`, `--radius`,
spacing. Every shipped component reads these vars, so this re-skins the whole storefront. **Do not
restyle the shipped components' JSX** — that's what keeps this a copy, not a regeneration. Style the
home page / header you build (STEP 4) from the same tokens so it matches. Dark brand → activate the
dark tokens with `document.documentElement.dataset.theme = "dark"`.

## STEP 4 — Wire routes + provider (surgical `find_replace` on `src/App.jsx`, never a rewrite)
`App.jsx` carries required platform auth scaffolding (`AuthProvider`/`useAuth`) — edit it in, don't
replace it.
- `import "@/theme.css";` once at the app entry.
- Wrap the routed tree in `<CartProvider>` (from `@/context/CartContext`).
- Mount `<CartDrawer />` once inside the provider (outside `<Routes>` so it overlays every page), and
  `<CartButton />` in the header you build.
- Routes: `/shop` → `Shop`, `/product/:slug` → `ProductDetail` (both shipped). **You add `/` → your
  own Home** page.

```jsx
import "@/theme.css";
import { CartProvider } from "@/context/CartContext";
import CartDrawer from "@/components/CartDrawer";
import CartButton from "@/components/CartButton";
import Shop from "@/pages/Shop";
import ProductDetail from "@/pages/ProductDetail";
import Home from "@/pages/Home";   // the home page YOU build

<CartProvider>
  {/* your header: mount <CartButton /> */}
  <Routes>
    <Route path="/" element={<Home />} />                        {/* yours */}
    <Route path="/shop" element={<Shop />} />                    {/* shipped */}
    <Route path="/product/:slug" element={<ProductDetail />} />  {/* shipped */}
  </Routes>
  <CartDrawer />
</CartProvider>
```

## What you build (not shipped)
The **home / landing page**, the **header/nav** (mount `<CartButton/>` in it), and the overall
layout & brand story — styled from the same `theme.css` tokens. **Compose the shipped pieces** — a
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
Everything visual reads `theme.css` tokens, so your home/nav match the shipped pages automatically.
`<CartButton/>` is an icon button (live-count badge) — drop it in as-is, it inherits `currentColor`.

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
  return <div style={{ background: "var(--color-surface)" }}><img src={src} alt={alt} /></div>;
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
- Theme via `theme.css` tokens, never by rewriting the shipped components.
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
- [ ] `theme.css` themed to the brand; shipped components not restyled.
- [ ] Routes wired; `<CartProvider>` wraps the tree; `<CartDrawer/>` mounted; `<CartButton/>` in the header.
- [ ] Cart survives reload (same visitor); add / update-qty / remove work; checkout redirects.
- [ ] Empty catalog shows the shipped empty state; no mock products anywhere.
