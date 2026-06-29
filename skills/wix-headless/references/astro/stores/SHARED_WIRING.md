# Phase 3 Components — Stores (TSX/Astro)

This is the **components** portion of the stores **merged build agent** (the build wave — `BUILD-astro.md` § "Step 4.5"). Your agent writes these files **first** (CSS → util → islands), then the stores pages (`pages-categories`, `pages-products`) that mount them — so everything is on disk before the page code references it. The code here depends on the **design tokens** (read from `.wix/design-tokens.css` on disk) but NOT on page markup.

**Write in this order:** `components-stores.css` → `back-in-stock.ts` → `SeoTags.astro` → TSX islands. See `./COMPONENTS_CSS.md` for the CSS contract and `./BACK_IN_STOCK.md` for the probe util spec.

## Scope

Files this agent OWNS (creates fresh, no designer output to read):

- `src/styles/components-stores.css` — scoped CSS for all stores contract classes + back-in-stock form. Write first; see `./COMPONENTS_CSS.md`.
- `src/utils/back-in-stock.ts` — SSR probe util. Write before the TSX islands that import it; see `./BACK_IN_STOCK.md`.
- `src/components/SeoTags.astro` — Renders `product.seoData.tags` into `<head>`
- `src/components/AddToCartButton.tsx` — React island; optimistic add-to-cart
- `src/components/ProductPurchase.tsx` — React island; option selectors + variant resolution + wraps AddToCartButton
- `src/components/BackInStockForm.tsx` — React island; back-in-stock subscription form

Files this agent MUST NOT touch:
- `src/utils/wix-image.ts` — **shared utility shipped by the build skill.** Import `resolveWixImageUrl` from `../utils/wix-image`; do NOT write your own copy (would shadow the shared util and drop other verticals' callers). The canonical source lives at `<SKILL_ROOT>/shared-utilities/wix-image.ts`; it's copied into projects by `seed-utilities.sh` during Setup.
- `src/components/CartView.tsx`, `src/components/CartBadge.tsx`, `src/utils/analytics.ts`, `src/styles/components-ecom.css` — owned by ecom
- Any `.astro` page — written by your agent's `pages-*` scopes (after the islands) or by another vertical
- `src/styles/global.css` — owned by designer foundation
- `src/layouts/Layout.astro` — owned by designer foundation (including the `components-stores.css` import line)
- Any designed component (`ProductCard.astro`, `Navigation.astro`, etc.) — owned by designers

## Coordination: design tokens

Read the design tokens from `.wix/design-tokens.css` (on disk, gate-verified present before the wave). The parent skill serializes your launch behind the designer foundation specifically so this file is already written when you start.

Reference the ACTUAL class names from the contract in React components (e.g. `className="add-to-cart-btn"`, not `className="addToCartButton"` or an invented name). See `references/shared/IMPLEMENTER.md` § "Contract class-name adaptation" for the full rule.

## Critical rules

1. **Import `productsV3`, never `products`** — V1 silently returns 0 results on V3 catalogs (used in `ProductPurchase.tsx` type definitions).
2. **Always include `variantId` in `catalogReference.options`** — even single-variant products have one. Without it, `addToCurrentCart` returns 200 OK but silently adds nothing.
3. **No HTML comments in `.astro` frontmatter** — frontmatter is TypeScript; use `//` or `/* */`. Build-fails with "Legacy HTML single-line comments are not allowed".
4. **Use brand-token Tailwind utilities on React islands** (e.g., `bg-bark`, `text-cream`), never default Tailwind colors (`bg-green-50`, `text-red-600`). See IMPLEMENTER.md § "Contract class-name adaptation" for the class-name rule itself.
5. **Analytics is fire-and-forget** — see `references/shared/IMPLEMENTER.md` § "Fire-and-forget analytics".

## Implementation

### 1. `src/styles/components-stores.css` — write this first

See `./COMPONENTS_CSS.md` for the full contract. Write before any TSX that references its class names.

### 2. `src/utils/back-in-stock.ts` — write before the form island

See `./BACK_IN_STOCK.md` for the full spec and exports.

### 3. `src/utils/analytics.ts` — not owned by this scope

> Import from it (`import { trackEvent } from "../utils/analytics"`) but do not write it. Shipped by the build skill as a seeded shared utility.

### 3. `src/utils/wix-image.ts` — not owned by this scope

> Import `resolveWixImageUrl` from `../utils/wix-image` but do not write it. Shipped by the build skill as a seeded shared utility that already exposes `resolveWixImageUrl(image, width?, height?)`. Writing your own copy shadows and breaks callers in other verticals (blog, cms).

### 4. `src/components/SeoTags.astro`

Renders merchant-edited SEO from the Wix dashboard into `<head>`. Mounted on the product detail page (by `product-pages` scope) via `Layout`'s `head` slot.

`product.seoData` is returned by default from `getProductBySlug` — no `fields` flag needed.

### 5. `src/components/AddToCartButton.tsx`

Optimistic add-to-cart button. Shows "Added ✓" immediately; fires API in background; reverts on failure. Dispatches `cart-updated` events so CartBadge can update badge count instantly.

Uses `@wix/ecom` `currentCart.addToCurrentCart`. Import the module and call it directly — `import { currentCart } from "@wix/ecom";` then `await currentCart.addToCurrentCart({ … })`. There is no client object: do **not** use `getWixClient` / `@wix/astro/client` / `client.use(...)` (they don't exist here — see `IMPLEMENTER.md` § "SDK access — call the module directly"). `WIX_STORES_APP_ID` is the Stores appDefId constant (`215238eb-22a5-4c36-9e7b-e7c08025e04e`) used in `catalogReference.appId`.

**Modifier support** — accepts pre-flattened `modifierChoices` and `customTextFields` from ProductPurchase and merges them into `catalogReference.options` per the Wix Stores Catalog V3 contract. ProductPurchase owns the flattening; this component just passes them through.

Class from contract: `addToCartButton` → `"add-to-cart-btn"`.

### 6. `src/components/CartBadge.tsx` — not owned by this scope

> Do not write this file. AddToCartButton dispatches `cart-updated` CustomEvents that CartBadge (owned by ecom) listens for.

### 7. `src/components/ProductPurchase.tsx`

Handles variant selection, quantity selector, stock awareness, and wraps `AddToCartButton`. Mounted on product detail pages (by `product-pages` scope) as:

```tsx
<ProductPurchase client:load product={product} inventoryByVariant={inventoryByVariant} />
```

**Prop contract — single `product` object.** The template accepts the full productsV3 product and destructures internally. This mirrors `ProductCard.astro`'s `{ product }` contract so both stores components take the same shape (prevents a shape mismatch where a fallback-written `[slug].astro` passes `product` as a whole while the component expects flat props).

Key behaviors:
- `hasMeaningfulOptions` — a product has meaningful options only when at least one option has >1 choice. Dummy single-choice options (e.g., "Type: Standard") are treated as no options.
- Out of stock → renders just the message, no button.
- No meaningful options → renders quantity + AddToCartButton with default variant ID.
- Has options → renders pill selectors + quantity + AddToCartButton with resolved variant ID.
- **Modifiers** — customization choices that do NOT create separate variants. Pills for `modifierRenderType === "TEXT_CHOICES"` / `"SWATCH_CHOICES"`, textarea for `"FREE_TEXT"`. Mandatory modifiers must have a value before add-to-cart is enabled. Selections flatten into `{ options: { [modifier.key]: choice.key }, customTextFields: { [modifier.freeTextSettings.key]: text } }` before being handed to AddToCartButton.
- **OOS gating** — source of truth is `inventoryByVariant` (from `inventoryItemsV3`). `variantsInfo[].inventoryStatus.inStock` is a stale cached flag and is only used when the live map is empty. See PRODUCT_PAGES.md for the detail-page query that populates `inventoryByVariant`.

Classes from contract (stores pack):

- **Global** (CSS in foundation's `global.css`):
  - `productPurchase` → `"product-purchase"` (outer wrapper — use on the root `<div>`)
- **Scoped** (CSS in `components-stores.css`, written by this scope — see `./COMPONENTS_CSS.md`):
  - `optionGroup` → `"option-group"`
  - `optionLabel` → `"option-label"`
  - `optionChoices` → `"option-choices"`
  - `optionPill` → `"option-pill"` (state modifier `.selected` for active choice)
  - `quantitySelector` → `"quantity-selector"`
  - `quantityBtn` → `"quantity-btn"`
  - `quantityValue` → `"quantity-value"`
  - `stockStatus` → `"stock-status"`

**Do not invent new class names** — if a new interactive control needs a class, add it to the pack's `contractKeys.scoped` first.

### 8. `src/components/CartView.tsx` — not owned by this scope

> Do not write this file.

## Return format

```json
{
  "status": "complete",
  "phase": "stores-components",
  "scope": "components",
  "summary": "Wrote components-stores.css, back-in-stock probe util, and React islands",
  "data": {
    "islands": ["ProductPurchase.tsx", "AddToCartButton.tsx", "BackInStockForm.tsx"],
    "astroComponents": ["SeoTags.astro"],
    "globalContractClassesReferenced": ["addToCartButton", "productPurchase"],
    "scopedContractClassesReferenced": ["optionGroup", "optionLabel", "optionChoices", "optionPill", "stockStatus", "quantitySelector", "quantityBtn", "quantityValue"]
  },
  "files": [
    "src/styles/components-stores.css",
    "src/utils/back-in-stock.ts",
    "src/components/SeoTags.astro",
    "src/components/AddToCartButton.tsx",
    "src/components/ProductPurchase.tsx",
    "src/components/BackInStockForm.tsx"
  ],
  "errors": []
}
```

## Anti-patterns

| WRONG | CORRECT |
|-------|---------|
| Read designer `.astro` files | Not needed — this scope doesn't touch pages |
| Import `products` from `@wix/stores` | Use `productsV3` |
| Write `src/utils/wix-image.ts` | Import from it — shared util already exposes `resolveWixImageUrl` |
| Hardcode `className="btn-primary"` | Use contract class `className="add-to-cart-btn"` |
| Default Tailwind color utilities on React islands (`bg-green-50`, `bg-blue-500`) | Brand `@theme` utilities (`bg-bark`, `text-cream`) or contract class names |
| `<!--` HTML comments in `.astro` frontmatter | `//` or `/* */` — frontmatter is TypeScript |
| Omit `WIX_STORES_APP_ID` constant | Hardcoded `215238eb-22a5-4c36-9e7b-e7c08025e04e` in AddToCartButton for `catalogReference.appId` |
| Introspect `node_modules/@wix/*` | All symbols are documented here; if missing, use docs-search REST (see `DOCS_SEARCH.md`) |
| Write `CartView.tsx`, `CartBadge.tsx`, or `analytics.ts` | Not owned by this scope — do not write |
| Pass flat props to `ProductPurchase` (`productId`, `options`, `variantsInfo`, …) | Pass the whole product: `<ProductPurchase product={product} inventoryByVariant={inventoryByVariant} />` |