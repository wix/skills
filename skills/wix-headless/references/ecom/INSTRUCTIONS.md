---
name: ecom-implementer
description: "Implements vertical-agnostic ecommerce — cart page, checkout redirect, thank-you page, cart badge. Scopes: components, components-css, pages. Extends references/shared/IMPLEMENTER.md."
---

# Ecom Implementer

Extends `references/shared/IMPLEMENTER.md`. Read that file first for phase routing, REST auth + doc lookups, prompt-inlined inputs (read only your `.wix/seeded.json` slice), return contract, style conventions, and common failure modes.

## Scope routing

| Scope | Phase | Reference |
|-------|-------|-----------|
| `components` | Components (CartView, CartBadge TSX + `src/styles/components-ecom.css` + `src/utils/discounts.ts`) | `../astro/ecom/CART_WIRING.md` |
| `pages` | Pages (cart.astro, thank-you.astro, Navigation CartBadge mount) | `../astro/ecom/CART_PAGES.md` |


Note: `ecom` is never triggered independently — it's co-loaded by verticals that require it (`stores` today; `bookings`, `events` in the future). No `seed` scope — ecom has no data of its own; it works off line items from whichever catalog app is installed.

## Files this vertical creates / contributes

See `<SKILL_ROOT>/references/verticals/ecom.md` frontmatter.

## Files to write

The `components` scope writes (CSS first, then TSX):
- `src/styles/components-ecom.css` — scoped CSS for ecom contract classes. First line must be `@reference "./global.css";`. See `../astro/ecom/COMPONENTS_CSS.md`.
- `src/utils/discounts.ts` — Wix Ecom Discount Rules fetch + per-product match utility. **It MUST export exactly these two names** — the stores consumers import them verbatim (`../astro/stores/PRODUCT_PAGES.md`, `../astro/stores/HOME_AND_NAV.md`), so renaming them breaks the product pages at build time (`"fetchLiveOffers" is not exported by discounts.ts`):
  ```ts
  export async function fetchLiveOffers(): Promise<Offer[]>;          // memoized per-request discount-rules fetch (auth.elevate)
  export function offersForProduct(offers: Offer[], productId: string): Offer[];  // offers matching one product
  ```
  Do **not** rename them to `getDiscountRules` / `findDiscountForProduct` / etc. Uses `auth.elevate()` from `@wix/essentials` (`discountRules.queryDiscountRules` requires `ECOM.DISCOUNT_RULES_READ`; a visitor client returns empty silently without elevation). Consumers: stores `pages-products` / `pages-home-and-nav` (ProductCard ribbon + offer callout). Write this before CartView/CartBadge — they import it.
- `src/components/CartView.tsx`
- `src/components/CartBadge.tsx`

## CSS ownership — ecom pack

Ecom-specific component CSS lives in `src/styles/components-ecom.css` (written by the `components` scope — see `../astro/ecom/COMPONENTS_CSS.md`), NOT in the designer's `global.css`. The classes the pack owns:

- `.cart-summary` — the bordered/sticky summary panel on `/cart`. Compound bordered card; sticky on desktop.
- `.cart-total` — the row inside the summary that anchors the total amount with a top rule and display-serif typography.
- `.cart-empty` — the centered empty-state on `/cart` when the cart is empty. Includes the inline override of `.checkout-btn` so the "Browse Products" CTA isn't a full-width brick.
- `.checkout-btn` — primary checkout button with `:disabled` and `:hover:not(:disabled)` states. Composes from `.btn-primary` (which IS designer-owned in `global.css`).
- `.cart-item-*` — row, image, name, qty controls — all live here. Most are utility-only; the few that need scoped rules (e.g. line-item separator borders) belong here, not in `global.css`.

The designer's `global.css` declares only tokens, the `.btn` family, decorative slots, the editorial-rule, and the site-shell shells. If `global.css` ships with a partial rule for any class above, that's a designer bug — flag it in your return JSON's `errors` array (`{code: "GLOBAL_CSS_LEAK", class: "<name>"}`) and override with the complete rule in `components-ecom.css`.

See `references/shared/STYLING.md` § "Component-specific CSS is owned by the component, not the designer" for the boundary rule.

## Cross-vertical event contract

`cart-updated` CustomEvent on `window`:
- **Dispatchers:** `AddToCartButton` (stores), `CartView` (ecom)
- **Listener:** `CartBadge` (ecom)