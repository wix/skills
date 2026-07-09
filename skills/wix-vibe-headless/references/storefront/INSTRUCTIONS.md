
# Wix Storefront Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and both storefront helpers from `references/storefront/`. All helpers import from `"./wix-client.js"`, so copy them into the same folder (e.g. `src/rest/`). Copy **both** for a full storefront:
>
> | File | What it covers |
> |---|---|
> | `wix-store-catalog.js` | Products, categories, product detail, search |
> | `wix-store-cart.js` | Add to cart, cart management, checkout |

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
- `src/rest/wix-store-catalog.js` — **Catalog:**
  `queryProducts`, `queryProductsByCategory`, `getProductBySlug`, `countProducts`,
  `queryCategories`, `getCategoryBySlug`
- `src/rest/wix-store-cart.js` — **Cart & checkout:**
  `addToCart`, `getCurrentCart`, `updateCartItemQuantity`, `removeFromCart`, `checkout`

The Product and Cart shapes are documented as JSDoc comments at the top of each helper file.
Read them before building the UI — they describe the key fields and link to the full API
reference for anything not shown.

## How to wire it (UI is the project's choice)
- **Product grid** — `queryProducts()` for the listing (visible products only); pass
  `nextCursor` back as `cursor` to load the next page. Render fields directly from the Wix
  product object (see the `Product` typedef in `wix-store.js` for key fields). For price, use
  `actualPriceRange.minValue.formattedAmount` (already includes the currency symbol) — no
  manual formatting needed.
- **PDP** — `getProductBySlug(slug)` keyed off the URL slug; returns null on miss — show
  a not-found state, never invent a product. **Drive the whole PDP from the returned product
  object at runtime — build it generically, not around the one product you happened to inspect.**
  A catalog is heterogeneous: some products have `options`, some have `modifiers` (mandatory or
  optional), some track inventory, some none of these. Render a selector for **every** entry the
  product actually carries: one control per `product.options` (variant choices) **and** one per
  `product.modifiers` (TEXT_CHOICES → choice buttons/select; FREE_TEXT → a text input); render
  neither when the arrays are empty. Skipping modifiers is a common miss — a product with a
  **mandatory** modifier (e.g. "gift wrap?") whose control isn't rendered can never be added: the
  buyer can't satisfy the requirement, so `add-to-cart` returns 200 with an **empty** `lineItems`
  and the add silently no-ops.
- **Gate the Add-to-cart button** — disable it only until the requirements the product *actually
  has* are met, computed from the product object (never assume every product has options or
  modifiers): if `product.options` is non-empty, a variant must resolve from the selections; every
  `modifier.mandatory === true` must have a value. A product with no options and no mandatory
  modifiers is immediately addable — don't leave the button stuck. Optional modifiers never block.
  Then pass the selections to `addToCart` (see Cart below); never call it with a required selection missing.
- **Reflect stock in the UI** — the product object already carries availability at three levels; surface
  it rather than letting the buyer discover it only on click. Read it from the data at runtime (never
  hardcode):
  - **Grid / card:** `product.inventory.availabilityStatus` (`IN_STOCK` / `OUT_OF_STOCK` /
    `PARTIALLY_OUT_OF_STOCK`) — badge an out-of-stock product as sold out.
  - **Option choice:** `product.options[].choicesSettings.choices[].inStock` — disable/strike a choice
    (e.g. size L) that has no in-stock variant, before a full variant is even resolved.
  - **Variant:** `variantsInfo.variants[].inventoryStatus.inStock` — once selections resolve to a
    variant, disable Add-to-cart (label "Out of stock") when that variant is `inStock: false`.
  A product/variant with inventory tracking **off** reports `availabilityStatus: IN_STOCK` /
  `inStock: true` and stays freely addable — tracking-off is not "no data", it's "always available".
  `addToCart` still throws on a sold-out line as a backstop, but the UI should prevent reaching it.
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
- ✅ On the PDP, render a control for **every** `product.options` entry **and** every `product.modifiers`
  entry — never only variants. Keep Add-to-cart disabled until a variant resolves and every
  `modifier.mandatory === true` has a value; a mandatory modifier with no rendered control makes the
  product unbuyable (add-to-cart returns 200 with empty `lineItems`).
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

## Point the user to their dashboard
In some cases, users need to access the Wix dashboard in order to edit the store content for their site. To facilitate this, provide the user with deep links directly to the relevant dashboard pages. For store data those pages are:
- **Products** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-stores/products` (`Dashboard → Store → Products`; add/edit products, variants, inventory)
- **Categories** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-stores/categories/list` (`Dashboard → Store → Categories`; organize products into the category menu)

Substitute the site's `metaSiteId` to complete the links (you have it from the handoff / `ListWixSites`). Include the in-dashboard navigation as a fallback.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (cart survives reload, same visitor)
- [ ] Every product choice renders on the PDP — variant options **and** modifiers (mandatory ones included)
- [ ] Add-to-cart button stays disabled until all required choices are made (variant + mandatory modifiers)
- [ ] A product with a mandatory modifier adds successfully (its selection is sent, cart line appears)
- [ ] Stock reflected in the UI — sold-out product badged (grid), out-of-stock option choices and variants disabled/labelled (PDP)
- [ ] Add to cart works; out-of-stock items throw rather than add a dead line
- [ ] Quantity update / remove reflect in `getCurrentCart()`
- [ ] Checkout redirects via redirect-session `fullUrl` (no hand-built URL)
- [ ] Cart re-fetched on return from checkout (clears once the order is placed)
- [ ] Empty state shown when `countProducts()` is 0
- [ ] No mock products anywhere
- [ ] Told the user at least once that they can continue setting up their store in the dashboard and provided deep links.
