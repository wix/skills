# Storefront template — wiring

A complete Wix Stores storefront: catalog + PDP + server-cart + checkout, styled entirely from
`theme.css` tokens. Copy it in, theme the tokens, wire 3 routes + the provider, seed. You generate
almost nothing — the hard logic (variant resolution, modifiers, stock gating, server cart) ships.

## Files (copy `templates/storefront/src/*` → the app's `src/`)
```
src/rest/wix-client.js            visitor-token transport (set WIX_CLIENT_ID here)
src/rest/wix-store-catalog.js     queryProducts / getProductBySlug / countProducts / categories
src/rest/wix-store-cart.js        addToCart / getCurrentCart / update / remove / checkout
src/context/CartContext.jsx       <CartProvider> + useCart() — server-cart mirror
src/hooks/useProductDetail.js     all PDP logic (variant + modifier + stock gating)
src/components/ProductCard.jsx    grid tile
src/components/ProductGrid.jsx    responsive grid + empty state
src/components/CartButton.jsx     header trigger with live item count
src/components/CartDrawer.jsx     slide-over cart → checkout
src/components/VariantPicker.jsx  PDP option + modifier controls
src/pages/Home.jsx                hero (rewrite copy) + featured strip
src/pages/Shop.jsx                catalog
src/pages/ProductDetail.jsx       PDP (thin view over the hook)
src/theme.css                     THE styling surface — edit tokens, not components
seed/seed-store.js                build-time seed module (call its fns; see below)
```
Imports use the `@/` alias (→ `src/`). If the app has no `@/` alias, either add it to
`vite.config.js`/`jsconfig.json` or rewrite the imports to relative paths.

## 1. Credentials
In `src/rest/wix-client.js` set `WIX_CLIENT_ID` to the public client id from your prompt.

## 2. Theme (this is the styling step — do ONLY this)
Edit `src/theme.css` tokens to the brand: palette, `--font-display`/`--font-body`, `--radius`,
spacing. Every component reads these vars, so this re-skins the whole site. **Do not restyle the
components' JSX.** Rewrite the hero copy in `Home.jsx` to the brand — that's app-specific.

## 3. Wire routes + provider (surgical `find_replace` on `src/App.jsx` — never rewrite it)
- `import "@/theme.css";` once at the app entry.
- Wrap the routed tree in `<CartProvider>` (from `@/context/CartContext`).
- Put `<CartDrawer />` once inside the provider (outside `<Routes>` so it overlays every page), and
  `<CartButton />` in the header.
- Add routes: `/` → `Home`, `/shop` → `Shop`, `/product/:slug` → `ProductDetail`.

```jsx
import "@/theme.css";
import { CartProvider } from "@/context/CartContext";
import CartDrawer from "@/components/CartDrawer";
import CartButton from "@/components/CartButton";
import Home from "@/pages/Home";
import Shop from "@/pages/Shop";
import ProductDetail from "@/pages/ProductDetail";

// inside the existing Router (keep the platform AuthProvider/useAuth scaffolding intact):
<CartProvider>
  {/* header: <CartButton /> */}
  <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/shop" element={<Shop />} />
    <Route path="/product/:slug" element={<ProductDetail />} />
  </Routes>
  <CartDrawer />
</CartProvider>
```

## 4. Seed (build-time, via exec_tool — see `seed/seed-store.js` header for the exact calls)
```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
// require the seed module straight from the installed skill (build-time; not shipped in the app):
const s = require("/app/.agents/skills/wix-base44-headless/templates/storefront/seed/seed-store.js");
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

await s.installStoresApp(ctx);                    // if Wix Stores isn't installed yet
const products = await s.bulkCreateProducts(ctx, [
  { name: "…", description: "…", price: 49.99, quantity: 12 /*, options? only for real buyer choices */ },
]);
const cats = await s.createCategories(ctx, ["…"]);            // only if the brief names categories
await s.addProductsToCategories(ctx, { [cats[0].id]: products.map(p => p.id) });
// imagery: generate per-product images, then ONE bulk attach:
await s.attachProductImages(ctx, products.map((p, i) => ({ id: p.id, revision: p.revision, url: imageUrls[i], altText: p.slug })));
```
Seeding is **additive** — never delete/overwrite existing content; if a cleanup seems needed, ask
first. Unexpected shape or an operation the module doesn't cover → the **`wix-docs`** skill; never
guess.

## 5. Done
- Mount the dev-only manage banner if the app carries `wix-manage-banner.js` (links to the Wix back
  office), and point the user to `https://manage.wix.com/dashboard/{metaSiteId}`.
- Dashboard deep links: products `…/wix-stores/products`, categories `…/wix-stores/categories/list`.

## Verify
- `WIX_CLIENT_ID` set (not the placeholder); cart survives reload (same visitor token).
- PDP renders every option **and** modifier; add-to-cart stays disabled until a variant resolves and
  every mandatory modifier is filled; out-of-stock choices disabled.
- Add / update-qty / remove reflect in the drawer; checkout redirects; empty catalog shows the empty state.
