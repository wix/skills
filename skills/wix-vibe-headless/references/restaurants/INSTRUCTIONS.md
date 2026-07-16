
# Wix Restaurants Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and the helper file(s) you need from `references/restaurants/`. All helpers import from `"./wix-client.js"`, so copy them into the same folder (e.g. `src/rest/`).
>
> | Need | Copy |
> |---|---|
> | Menu display (always) | `wix-restaurants-menu.js` |
> | Online ordering (cart + checkout) | `wix-restaurants-ordering.js` |
> | Table reservations | `wix-restaurants-reservations.js` |

Builds a real, client-only Wix restaurant experience. The browser talks to Wix directly over a
public `WIX_CLIENT_ID`. Never mock the menu; never hand-build `/checkout` or reservation URLs —
always go through the official cart + redirect-session and the reservations hold/reserve flow.

## When to use
- User wants a Wix restaurant site, an online food-ordering page, or a table-reservation page.
- User asks to "connect Wix Restaurants" or replace placeholder menu/ordering/booking UI with live data.
- Adding a menu, cart + checkout, or reservations over an existing Wix Restaurants setup.

## Prerequisites
1. A Wix site with the **Wix Restaurants Menus** app installed and **menu content already added**
   (this skill is read-only over the menu — it does NOT create menus/items).
2. For **online ordering**: at least one online-ordering **Operation** configured (Wix Restaurants
   Orders). For **reservations**: the **Table Reservations** app installed with at least one location
   and online reservations enabled. If a flow's backing app/config isn't set up, that flow returns
   empty — flag it and continue; don't fabricate data.
3. The site's public headless **`WIX_CLIENT_ID`**, provided in the handoff prompt (see the router `SKILL.md`).
   Paste it into `src/rest/wix-client.js` in place of the placeholder. It is a buyer-facing
   credential (it only mints anonymous visitor tokens), **not** a secret — hardcoding/committing
   it is fine.
4. The deployed app domain must be allow-listed on the OAuth client for Wix-hosted checkout to
   return. This is a **separate Wix setup flow the user completes later** — out of this skill's
   scope. If checkout return fails before that setup is done, that's expected; flag it and continue.

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the restaurant UI however the
project wants; wire it to these two snippets. Copy them into the app (e.g. `src/api/`) and only
adjust import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Set `WIX_CLIENT_ID` to the id
  from the prompt (replace the `<YOUR-CLIENT-ID>` placeholder). The visitor refresh token IS the
  cart identity; it is persisted to localStorage. Do not re-mint anonymously per load or the cart
  silently empties.
- `src/rest/wix-restaurants-menu.js` — **Menu (read-only):**
  `getFullMenu` (the assembled tree — start here), `listMenus`, `listSections`, `listItems`,
  `listVariants`, `listModifierGroups`, `listModifiers`, `listLabels`
- `src/rest/wix-restaurants-ordering.js` — **Online ordering:**
  `listOperations`, `getDefaultOperation`, `addItemToCart`, `getCurrentCart`,
  `updateCartItemQuantity`, `removeFromCart`, `checkout`
- `src/rest/wix-restaurants-reservations.js` — **Reservations:**
  `listReservationLocations`, `getTimeSlots`, `createHeldReservation`, `reserveReservation`

The Menu, Item, ModifierGroup, Operation, Cart, ReservationLocation, TimeSlot, and Reservation
shapes are documented as JSDoc at the top of each helper file. Read the relevant file(s) before
building the UI — they describe the key fields and link to the full reference for anything not shown.

## How to wire it (UI is the project's choice)
- **Menu page** — call `getFullMenu()` once. It returns `{ menus: [{ ...menu, sections: [{ ...section,
  items: [assembledItem] }] }] }`, already ordered by `sectionIds` / `itemIds`. Render each item's
  `name`, `description`, `image`, `labels` (`name` + `icon`), and `featured` flag. For price, show
  `item.price` (single) or the `item.variants[]` (each `{ name, price }`). **Restaurants prices are
  plain decimal strings with NO currency symbol** — format with the site's currency in the UI.
- **Item detail** — render `item.modifierGroups[]`: each group's `name`, its `rule`
  (`required`, `minSelections`, `maxSelections`), and `modifiers[]` (`name`, `additionalCharge`,
  `preSelected`, `inStock`). If `orderSettings.acceptSpecialRequests`, offer a free-text field.
- **Online ordering** — resolve an operation with `getDefaultOperation()` (or let the user pick from
  `listOperations()`); if it's `null`, show an "ordering unavailable" state. Add a dish with
  `addItemToCart(item.id, { operationId, menuId, sectionId, quantity })` — `menuId`/`sectionId` are
  the menu and section the item was shown under. Read the cart back with `getCurrentCart()`; mutate
  with `updateCartItemQuantity(lineItemId, qty)` / `removeFromCart(lineItemId)` using
  `cart.lineItems[].id` (not the item id).
- **Checkout** — `window.location.href = await checkout()`. After the visitor returns, the order is
  placed and the cart is empty — re-fetch with `getCurrentCart()` on return (e.g. on mount +
  `visibilitychange`) to clear the UI.
- **Reservations** — `listReservationLocations()` for the picker (use `location` details for the
  label; if a location's `configuration.onlineReservations.onlineReservationsEnabled` is false, hide
  it). Then `getTimeSlots(locationId, dateISO, partySize)` — render `availableTimeSlots` (already
  filtered to `AVAILABLE`). On slot pick, `createHeldReservation(locationId, slot.startDate,
  partySize)` → keep the returned `id` + `revision`. Collect the visitor's details, then
  `reserveReservation(id, revision, { firstName, phone, lastName?, email? })`. A `RESERVED` status is
  confirmed; `REQUESTED` means the location requires manual approval — tell the user it's pending.
- **Empty state** — if `getFullMenu()` returns no menus, show an empty state telling the user to add
  a menu in their Wix dashboard. Never invent menu items.

## Hard rules (do not violate)
- ✅ Order ONLY through the cart: `addItemToCart()` → `checkout()` (`create-checkout` →
  `/headless/v1/redirect-session` `fullUrl`), then redirect.
- ❌ Never hand-build `/checkout`, ordering, or reservation URLs.
- ❌ Never mock menus, items, prices, operations, locations, or time slots — render live Wix data or
  the empty state.
- ❌ Never generate fake reviews, ratings, or testimonials. Empty review UI only.
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public client id — safe to hardcode).
- ✅ `addItemToCart` requires `operationId`, `menuId`, and `sectionId` — it throws if any is missing.
- ✅ `lineItemId` for cart mutations is `cart.lineItems[].id`, not the item id.
- ✅ Reservations: offer only `AVAILABLE` slots; a HELD reservation expires in 10 minutes — pass the
  `revision` from the hold into `reserveReservation`, and restart the flow if it expired.
- ✅ Reservee `firstName` + `phone` (E.164, e.g. `+15551234567`) are mandatory to confirm.
- The engine fails loudly on purpose: `addItemToCart`/`checkout` throw on out-of-stock or empty
  carts; reservation helpers throw on unavailable slots or expired holds. A green path means it is
  really orderable/bookable — don't swallow these.

## Beyond the snippets
The snippets cover the common menu / ordering / reservation paths. For the "20%" they don't cover,
make the call yourself with `wixApiRequest` — but look up the exact endpoint, HTTP method, and
request body in the **official Wix API reference** first; never guess:
- Restaurants API reference: https://dev.wix.com/docs/api-reference/business-solutions/restaurants.md
- Selecting a specific **price variant** or applying **modifier up-charges** on the cart line: the
  restaurants `catalogReference.options` shape for these is not documented for client add-to-cart.
  The menu UI still displays them; confirm the shape before wiring them into `addItemToCart`:
  https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/sample-flows.md
- Fulfillment methods, delivery-address validation, scheduled (preorder) time slots, service fees:
  see the Online Orders section of the reference.
- **Member login + a "my orders" account view** → the **members** vertical
  (`references/members/INSTRUCTIONS.md`): ordering/reserving works anonymously, but signing a member
  in (custom login on your own UI) lets them see their own order/reservation history.

Keep the snippets as the default for everything they already do; reach for the API reference only
for the gap.

## Point the user to their dashboard
In some cases, users need to access the Wix dashboard in order to edit the restaurant content for their site — across up to three apps. To facilitate this, provide the user with deep links directly to the relevant dashboard pages; only mention the apps the project actually uses. Those pages are:
- **Menu** (always) — `https://manage.wix.com/dashboard/{metaSiteId}/wix-restaurants-menus-new` (`Dashboard → Restaurant Menus`; click **Manage Items** to add dishes; only visible menus appear in the app)
- **Online ordering** (if wired) — `https://manage.wix.com/dashboard/{metaSiteId}/wix-restaurants-orders-new/settings` (`Dashboard → Restaurant Orders → Settings`). Enable at least one fulfillment method before the site accepts orders — each has its own page: pickup `https://manage.wix.com/dashboard/{metaSiteId}/wix-restaurants-orders-new/settings/pickup`, delivery `.../wix-restaurants-orders-new/settings/delivery`, dine-in `.../wix-restaurants-orders-new/settings/dine-in`.
- **Table reservations** (if wired) — `https://manage.wix.com/dashboard/{metaSiteId}/wix-table-reservations/table-reservations` (`Dashboard → Table Reservations` → **Settings**; configure tables, availability, and enable online reservations)

Substitute the site's `metaSiteId` to complete the links (you have it from the handoff / `ListWixSites`). Include the in-dashboard navigation as a fallback.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (cart survives reload, same visitor)
- [ ] `getFullMenu()` renders real sections/items with prices, variants, modifiers, and labels
- [ ] Empty state shown when there are no menus (never invented items)
- [ ] Add to cart works with a real `operationId`/`menuId`/`sectionId`; out-of-stock items throw
- [ ] Quantity update / remove reflect in `getCurrentCart()`
- [ ] Checkout redirects via redirect-session `fullUrl` (no hand-built URL); cart re-fetched on return
- [ ] Reservations: only `AVAILABLE` slots offered; hold → reserve produces `RESERVED`/`REQUESTED`
- [ ] No mock data anywhere
- [ ] Told the user at least once that they can continue setting up their restaurant (menu / ordering / reservations) in the dashboard and provided deep links.
