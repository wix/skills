
# Wix Storefront Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and this vertical's `references/storefront/wix-store.js`. Copy **both** into your app's `src/rest/` side by side — the helper does `import { wixApiRequest } from "./wix-client.js"`, so they must land in the same folder.

Builds a real, client-only Wix storefront. The browser talks to Wix directly over a
public `WIX_CLIENT_ID`. Never mock products; never hand-build `/checkout` URLs — always
go through the eCom cart + redirect-session.

## When to use
- User wants a Wix eCommerce store or asks to "connect Wix".
- Replacing placeholder/mock products with live Wix data.
- Adding cart, checkout, categories, or product detail pages over an existing Wix Stores catalog.

## Prerequisites
1. A Wix site with **Wix Stores installed and products already added** (this skill does
   NOT provision — it's read-only over the catalog).
2. The site's public headless **`WIX_CLIENT_ID`**, provided in the handoff prompt (the
   Wix Business Manager surfaces a copyable prompt with the id filled in — see
   the router `SKILL.md`). Paste it into `src/rest/wix-client.js` in place of the placeholder. It is a
   buyer-facing credential (it only mints anonymous visitor tokens), **not** a secret, so
   hardcoding/committing it is fine.
3. The deployed app domain must be allow-listed on the OAuth client for Wix-hosted
   checkout to return. This is a **separate Wix setup flow the user completes later** —
   out of this skill's scope. If checkout return fails before that setup is done, that's
   expected; flag it and continue.

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the storefront's UI
however the project wants; wire it to these two snippets. Copy them into the app (e.g.
`src/api/`) and only adjust import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Set `WIX_CLIENT_ID` to
  the id from the prompt (replace the `<YOUR-CLIENT-ID>` placeholder). The visitor refresh
  token IS the cart identity; it is persisted to localStorage. Do not re-mint anonymously
  per load or the cart silently empties.
- `src/rest/wix-store.js` — exports:
  - **Products:** `queryProducts`, `queryProductsByCategory`, `getProductBySlug`, `countProducts`
  - **Categories:** `queryCategories`, `getCategoryBySlug`
  - **Cart:** `addToCart`, `updateCartItemQuantity`, `removeFromCart`, `getCurrentCart`
  - **Checkout:** `checkout`

The Product and Cart shapes are documented as JSDoc comments at the top of `wix-store.js`.
Read them before building the UI — they describe the key fields and link to the full API
reference for anything not shown.

## How to wire it (UI is the project's choice)
- **Product grid** — `queryProducts()` for the listing (visible products only); pass
  `nextCursor` back as `cursor` to load the next page. Render fields directly from the Wix
  product object (see the `Product` typedef in `wix-store.js` for key fields). For price, use
  `actualPriceRange.minValue.formattedAmount` (already includes the currency symbol) — no
  manual formatting needed.
- **PDP** — `getProductBySlug(slug)` keyed off the URL slug; returns null on miss — show
  a not-found state, never invent a product.
- **Categories** — `queryCategories()` for a category menu; `getCategoryBySlug(slug)` for
  a category landing page. Pass `category.id` to `queryProductsByCategory(categoryId, { limit?, cursor? })`
  to list only the products in that category; paginate exactly like `queryProducts`.
- **Cart** — `addToCart(catalogItemId, variantId?, qty?, { modifierChoices?, customTextFields? }?)`,
  `updateCartItemQuantity(lineItemId, qty)`, `removeFromCart(lineItemId)`.
  - `variantId` (`variantsInfo.variants[].id` from `getProductBySlug`) — required for products with
    options; resolve it by matching the buyer's selections to `variant.choices[].optionChoiceIds`.
  - `modifierChoices` — `{ [modifier.key]: choiceKey }` for `TEXT_CHOICES` modifiers.
  - `customTextFields` — `{ [modifier.freeTextSettings.key]: userInput }` for `FREE_TEXT` modifiers.
    Mandatory modifiers must be included. See the eCommerce integration guide:
    https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/e-commerce-integration.md
  - Use `cart.lineItems[].id` as `lineItemId` (not `catalogItemId`) for mutations.
  - Read the cart back with `getCurrentCart()` rather than mirroring it locally.
- **Checkout** — `window.location.href = await checkout()`. After the buyer returns from
  hosted checkout the order is placed and the cart is empty — re-fetch with
  `getCurrentCart()` on return (e.g. on mount + `visibilitychange`) to clear the UI.
- **Empty state** — if `countProducts()` is 0, show an empty state telling the user to
  add products in their Wix dashboard. Never invent products.

## Hard rules (do not violate)
- ✅ Checkout ONLY via `checkout()` (`create-checkout` → `/headless/v1/redirect-session`
  `fullUrl`), then redirect.
- ❌ Never hand-build `/checkout`, cart-add, or product permalinks for purchase.
- ❌ Never mock products — render live Wix data or the empty state.
- ❌ Never generate fake reviews, ratings, or testimonials. Empty review UI only.
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public client id — safe to hardcode).
- ✅ `lineItemId` for cart mutations is `cart.lineItems[].id`, not `catalogItemId`.
- ✅ Pass `addToCart`'s `variantId` (`variantsInfo.variants[].id`) for products with variants; omit for products without.
- ✅ Pass `modifierChoices` (`{ [modifier.key]: choiceKey }`) for TEXT_CHOICES modifiers; pass `customTextFields`
  (`{ [modifier.freeTextSettings.key]: userInput }`) for FREE_TEXT modifiers. Include mandatory modifiers.
- The engine fails loudly on purpose: `addToCart`/`checkout` throw on out-of-stock or
  empty carts. A green path means it is really buyable — don't swallow these.

## Beyond the snippets
The snippets cover the common storefront paths. If you hit a use case they don't cover
(e.g. coupons, members/auth, a product field not shown in the typedef), make the call
yourself with `wixApiRequest` — but look up the exact endpoint, HTTP method, and request
body in the **official Wix API reference** first; never guess:
- Official Wix API reference: https://dev.wix.com/docs/api-reference.md
- eCommerce integration guide (modifiers, custom text, variants): https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/e-commerce-integration.md

Keep the snippets as the default for everything they already do; reach for the API
reference only for the gap.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (cart survives reload, same visitor)
- [ ] Add to cart works; out-of-stock items throw rather than add a dead line
- [ ] Quantity update / remove reflect in `getCurrentCart()`
- [ ] Checkout redirects via redirect-session `fullUrl` (no hand-built URL)
- [ ] Cart re-fetched on return from checkout (clears once the order is placed)
- [ ] Empty state shown when `countProducts()` is 0
- [ ] No mock products anywhere
