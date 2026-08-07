# Storefront template — wiring

A working Wix Stores storefront core: catalog + PDP + server-cart + checkout, styled entirely from
`theme.css` tokens. Install + copy it in, theme the tokens, wire routes + the provider, seed. You
generate almost none of the commerce machinery (variant resolution, modifiers, stock gating, server
cart all ship) — you build the **home/landing page, header/nav, and overall layout** yourself.

## Files the template ships (copied into `src/` by the install step below)
```
src/wix.config.json               WIX_CLIENT_ID + WIX_METASITE_ID — the ONE file you fill
src/rest/wix-client.js            visitor-token transport (imports wix.config.json)
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

## 2. Credentials (one file)
Fill `src/wix.config.json` with `WIX_CLIENT_ID` and `WIX_METASITE_ID` from your prompt. The client
imports it (`wix-client.js`) and the seed step reads it — don't hardcode ids anywhere else.

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
const { WIX_METASITE_ID } = require("/app/src/wix.config.json");   // the file you filled in step 2
// Load the seed module (build-time; not shipped). exec_tool's plain `require` can return EMPTY
// exports for this file, so load it via a module wrapper:
const fs = require("fs");
const s = (() => { const m = { exports: {} };
  new Function("module", "exports", "require",
    fs.readFileSync("/app/.agents/skills/wix-base44-headless/templates/storefront/seed/seed-store.js", "utf8"))(m, m.exports, require);
  return m.exports; })();
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

// ONE call: install (+wait for V3) → products → categories → images, ids kept in memory.
// categories map name -> product NAMES; imageUrl per product only when imagery is on.
await s.setupStore(ctx, {
  products: [
    { name: "…", description: "…", price: 49.99, quantity: 12, imageUrl: imageUrls[0] /*, options? only for real buyer choices */ },
  ],
  categories: { "…": ["…"] },   // omit if the brief names none
});
```
Seeding is **additive — never delete or overwrite existing content.** Don't clean up, don't remove
"sample" data, just add. Unexpected shape or an operation the module doesn't cover → the
**`wix-docs`** skill; never guess.

## 6. Done
- Mount the dev-only manage banner if the app carries `wix-manage-banner.js` (links to the Wix back
  office), and point the user to `https://manage.wix.com/dashboard/{metaSiteId}`.
- Dashboard deep links: products `…/wix-stores/products`, categories `…/wix-stores/categories/list`.

## Verify
- `WIX_CLIENT_ID` set (not the placeholder); cart survives reload (same visitor token).
- PDP renders every option **and** modifier; add-to-cart stays disabled until a variant resolves and
  every mandatory modifier is filled; out-of-stock choices disabled.
- Add / update-qty / remove reflect in the drawer; checkout redirects; empty catalog shows the empty state.
