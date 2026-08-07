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

## STEP 1 — Copy the client into `src/` (run as-is, via exec_tool)
The REST scaffolds (`wix-client.js`, `wix-store-catalog.js`, `wix-store-cart.js`) are already in
`src/rest/` from the platform install step. This adds the UI layer — context, hooks, components,
pages, and `theme.css`:

```js
const fs = require("fs");
// recursive; overlays into src/, leaves src/rest and App.jsx untouched
fs.cpSync("/app/.agents/skills/wix-vibe-headless/references/storefront/app", "/app/src", { recursive: true });
return fs.readdirSync("/app/src");
```
Files added: `src/theme.css`, `src/context/CartContext.jsx`, `src/hooks/useProductDetail.js`,
`src/components/{ProductCard,ProductGrid,CartButton,CartDrawer,VariantPicker}.jsx`,
`src/pages/{Shop,ProductDetail}.jsx`. Imports use the `@/` alias (→ `src/`).

## STEP 2 — Credentials
In `src/rest/wix-client.js` set `WIX_CLIENT_ID` to the value from your prompt.

## STEP 3 — Theme (the styling step — do ONLY this to the shipped components)
Edit `src/theme.css` tokens to the brand: palette, `--font-display`/`--font-body`, `--radius`,
spacing. Every shipped component reads these vars, so this re-skins the whole storefront. **Do not
restyle the shipped components' JSX** — that's what keeps this a copy, not a regeneration. Style the
home page / header you build (STEP 4) from the same tokens so it matches.

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
layout & brand story — styled from the same `theme.css` tokens. The shipped `Shop`/`ProductCard`
are your reference for pulling catalog data (see below).

## Extending the client (read the files, don't guess shapes)
The shipped files under `src/` are the source of truth for field shapes and correct usage — **read
them before writing a new Wix call.** Two things bite otherwise:
- Every catalog/cart list helper returns a **wrapper object, not a bare array** — `queryProducts`/
  `queryCategories`/… → `{ <plural>, nextCursor }`. Destructure the array (`Shop.jsx` shows it);
  calling `.map`/`.filter` on the return throws `… is not a function`.
- `product.plainDescription` is **HTML** despite the name (the PDP renders it correctly); image URLs
  come as objects — `product.media.main.image.url`, `lineItems[].image.url`.

For anything the shipped client doesn't cover (coupons, members, a field not used yet), look up the
exact endpoint/shape in the **`wix-docs`** skill — never guess.

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
