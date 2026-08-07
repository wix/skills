# Storefront template — wiring

A working Wix Stores storefront core: catalog + PDP + server-cart + checkout, styled entirely from
`theme.css` tokens. Install + copy it in, theme the tokens, wire routes + the provider, seed. You
generate almost none of the commerce machinery (variant resolution, modifiers, stock gating, server
cart all ship) — you build the **home/landing page, header/nav, and overall layout** yourself.

## Files the template ships (copied into `src/` by the install step below)
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
src/pages/Shop.jsx                catalog
src/pages/ProductDetail.jsx       PDP (thin view over the hook)
src/theme.css                     THE styling surface — edit tokens, not components
```
(`seed/seed-store.js` stays in the skill — required at build time, step 4, not copied into the app.)
Imports use the `@/` alias (→ `src/`). If the app has no `@/` alias, add it to
`vite.config.js`/`jsconfig.json` or rewrite the imports to relative paths.

**You build (not shipped):** the home/landing page (`/`), the header/nav (mount `<CartButton/>` in
it), and the overall layout — styled from the same `theme.css` tokens so it matches.

## 1. Install the skill + copy the template in (one exec_tool call — run as-is)
```js
const { execSync } = require('child_process');
const { cpSync, existsSync, readdirSync } = require('fs');

// install the skill (lands under /app/.agents/skills/)
const out = execSync('CI=1 npx -y skills add wix/skills/skills/wix-base44-headless --yes 2>&1',
  { cwd: '/app', timeout: 60000, shell: '/bin/bash' }).toString();

// copy the storefront template into src/ (recursive; overlays folders, leaves App.jsx alone)
const TPL = '/app/.agents/skills/wix-base44-headless/templates/storefront/src';
if (!existsSync(TPL)) throw new Error('storefront template missing');
cpSync(TPL, '/app/src', { recursive: true });

return { installed: /installed|found/i.test(out), src: readdirSync('/app/src') };
```

## 2. Credentials
In `src/rest/wix-client.js` set `WIX_CLIENT_ID` to the public client id from your prompt.

## 3. Theme (this is the styling step — do ONLY this to the template components)
Edit `src/theme.css` tokens to the brand: palette, `--font-display`/`--font-body`, `--radius`,
spacing. Every component reads these vars, so this re-skins the whole site. **Do not restyle the
template components' JSX.** Style the home page / header you build from the same tokens.

## 4. Wire routes + provider (surgical `find_replace` on `src/App.jsx` — never rewrite it)
- `import "@/theme.css";` once at the app entry.
- Wrap the routed tree in `<CartProvider>` (from `@/context/CartContext`).
- Put `<CartDrawer />` once inside the provider (outside `<Routes>` so it overlays every page), and
  `<CartButton />` in the header you build.
- Add the template routes `/shop` → `Shop`, `/product/:slug` → `ProductDetail`. **You add `/` → your
  own Home** page.

```jsx
import "@/theme.css";
import { CartProvider } from "@/context/CartContext";
import CartDrawer from "@/components/CartDrawer";
import CartButton from "@/components/CartButton";
import Shop from "@/pages/Shop";
import ProductDetail from "@/pages/ProductDetail";
import Home from "@/pages/Home";   // <- the home page YOU build

// inside the existing Router (keep the platform AuthProvider/useAuth scaffolding intact):
<CartProvider>
  {/* your header: mount <CartButton /> in it */}
  <Routes>
    <Route path="/" element={<Home />} />              {/* yours */}
    <Route path="/shop" element={<Shop />} />          {/* template */}
    <Route path="/product/:slug" element={<ProductDetail />} />  {/* template */}
  </Routes>
  <CartDrawer />
</CartProvider>
```

## 5. Seed (build-time, via exec_tool — see `seed/seed-store.js` header for the exact calls)
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

## 6. Done
- Mount the dev-only manage banner if the app carries `wix-manage-banner.js` (links to the Wix back
  office), and point the user to `https://manage.wix.com/dashboard/{metaSiteId}`.
- Dashboard deep links: products `…/wix-stores/products`, categories `…/wix-stores/categories/list`.

## Verify
- `WIX_CLIENT_ID` set (not the placeholder); cart survives reload (same visitor token).
- PDP renders every option **and** modifier; add-to-cart stays disabled until a variant resolves and
  every mandatory modifier is filled; out-of-stock choices disabled.
- Add / update-qty / remove reflect in the drawer; checkout redirects; empty catalog shows the empty state.
