# Restaurants — playbook

The restaurant machinery ships as files — the assembled menu tree (menus → sections → items
with variants, modifiers, labels, every price formatted in the site's currency), the modifier
rule engine and the dish-ordering cart on the eCom current cart with the exact restaurant
`catalogReference` (context ids AND the visitor's choices), the hosted checkout, and the
table-reservation flow (hold → reserve, or a request when the restaurant approves by hand)
driven by the location's own form configuration, typed end-to-end. **The presentation is
yours**: you design and implement the dish card, the dish sheet, the menu surface, the
order-cart chrome, and the reservations surface on the shipped hooks/DTOs, plus the home page
and the brand. You never write ordering or reservation logic; you never skip designing.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro`, `styles/global.css`, and the two
pages' island imports. Files you **create**: your menu, dish-sheet, cart-chrome, and reservation
components, plus your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes)` — every `<img>` attribute for a DTO image (`src`, `srcSet`, `sizes`, lazy): `<img {...imgAttrs(item.imageUrl, "6rem")} alt={item.name} />`; `imgSrc()` / `imgSrcSet()` / `formatMoney()` underneath, already used by everything shipped |
| `wix/restaurants/types.ts` | the DTOs (`MenuData`, `MenuSection`, `MenuItem`, `OrderSelection`, `OrderCart`, `OrderingStatus`, `ReservationLocationInfo`, `ReservationSlot`, …) — contracts below |
| `wix/restaurants/menu.ts` | `fetchMenus` — the whole display-ordered menu tree, every price formatted with the site's currency + locale (read once from the eCommerce settings, `fetchSiteMoney`); the transport only — the id-array stitching, the item mapping, the money formatting, and the **modifier rule engine** (`initialSelection`, `toggleModifier`, `validateSelection`, `itemPrice`, `needsSelection`, `ruleLabel`) are in `menu-core.ts` beside it (shared with the REST layer) |
| `wix/restaurants/ordering.ts` · `order-store.ts` | the operation's state (`resolveOrdering`), each menu's ordering settings under it (`fetchMenuOrdering`), the operation's fulfillment methods, dish add-to-cart (Orders-app `catalogReference` with the selection) + eCom Cart V2 + the hosted checkout, and the shared cart state (module store — spans Astro islands); the request shapes, the availability-window check, and the refusal checks are in `ordering-core.ts` |
| `wix/restaurants/reservations.ts` | locations (enabled for online reservations, with name/address/timezone/approval/form config), AVAILABLE slots in the location's timezone, `holdReservation` → `completeReservation` (automatic approval), `requestReservation` (manual approval, no hold); the mappers, the form validation, and the reservee body are in `reservations-core.ts` |
| `wix/restaurants/time-core.ts` | wall-clock arithmetic in an IANA zone with `Intl` only (`zonedIso`, `zonedDayKey`, `zonedTimeLabel`, `zonedDateTimeLabel`) — what the two cores and the stores use for the restaurant's timezone |
| `wix/restaurants/menu-store.ts` · `reservation-store.ts` | the menu-browsing and reservation state machines, framework-free (`createMenuStore()`, `createReservationStore()` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/restaurants/useMenus.ts` | React binding of `menu-store.ts`: menu browsing + menu switching — contract below |
| `hooks/restaurants/useOrderCart.ts` | React binding of `order-store.ts`: order-cart state, the ordering gates, and actions — contract below |
| `hooks/restaurants/useReservation.ts` | React binding of `reservation-store.ts`: the whole reservation state machine — contract below |
| `components/restaurants/MenuView.tsx` (+ `MenuItemCard`, `MenuItemSheet`) · `OrderCartButton.tsx` · `OrderCartDrawer.tsx` · `ReservationView.tsx` | **reference implementations** — tested, plain, on the tokens; the layout mounts the cart chrome as shipped, and you replace all four with your own designs (new file names) |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, fonts — shared across verticals). Everything, shipped and yours, styles from these tokens |

The same data layer ships a second time as REST in `templates/restaurants/rest/` (`menu.ts`,
`ordering.ts`, `reservations.ts` — the same exports over `fetch`, importing the same `*-core.ts`);
`deploy.mjs --stack static` composes it with the stores into `js/wix/` (wiring below).

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot, the global.css import, and one `OrderCartButton` + one `OrderCartDrawer`, both `client:only`). If another vertical is also deployed, its layout won — merge the Menu/Reservations links + cart mounts there |
| `pages/menu.astro` | SSR menu — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/reservations.astro` | reservations — the island stays `client:only="react"` (availability is time-specific); swap the import to YOUR component |

## What you build — the design job

1. **The dish card + dish sheet + menu surface** — your card (photo treatment, price/variants,
   labels, sold-out state, add control) and your sheet for a dish with something to choose
   (variant radios, one fieldset per modifier group — radios when `singleSelect`, checkboxes
   otherwise — with its `ruleLabel`, quantity, the special-request note when
   `acceptsSpecialRequests`, the live `itemPrice`), and your menu layout (menu tabs when >1,
   section navigation, section rhythm), with skeletons while loading and an honest empty state —
   on `useMenus` + `useOrderCart` + the `menu-core` selection helpers.
2. **The order-cart chrome** — your header order button (live count) and your cart panel
   (lines with the platform's `descriptionLines` — variant, modifiers, note — quantity stepper,
   remove, subtotal, checkout CTA) — on `useOrderCart`, which owns ALL cart logic; you own how it looks.
3. **The reservations surface** — party/date/time query, slot pills, the details form built
   from `location.form` (first name + phone always; last name / email / custom fields as the owner
   configured; the marketing checkbox; terms and privacy links), the 10-minute countdown on the
   automatic path, and the confirmed vs pending states — on `useReservation`.
4. **The home page** — hero, a featured-dishes strip (fetch `fetchMenus()` in frontmatter →
   your cards; `item.featured` marks highlights), hours/location story, reserve CTA. Every card
   is a link to its dish on the menu: `/menu#item-<item.id>` (the shipped `MenuItemCard` renders
   that id; `#section-<section.id>` lands on the section). When the brief includes ordering and
   the item is orderable, the card may also carry the add-to-order control, on `useOrderCart`
   exactly as `MenuItemCard` does; a card the visitor cannot act on is a dead end.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).

### What a complete restaurant site shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins when it asks for something
else. Look at the seeded menu before designing (how many menus, sections, photos, variants, modifiers).

- **Menu:** dish names in view-source (the page fetches server-side and passes `initialMenus`);
  sections in the menu's own order; a dish card shows name, description, price (or its
  variants, or "Market price"), labels, and the add control; skeletons while `menus === null`,
  an honest empty state for `[]`. Prices render as given — they are already formatted in the
  site's currency (`""` only when the site's currency couldn't be read; then render nothing, never a
  guessed symbol).
- **Add control:** its states come from the data — hidden for a market-priced dish and for a menu
  whose `menuOrderable(menuId) === false` (not enabled for online ordering, or outside its hours —
  say so once at the menu level); "Sold out" (`item.soldOut`: the dish, or a required group with
  nothing in stock); the operation's reason when `ordering === false` ("Ordering unavailable", or
  "paused" with `orderingStatus.pausedUntilIso` rendered in `orderingStatus.timeZone`); else "Add to
  order". A dish with `needsSelection(item)` opens your sheet; a plain dish adds at once. Adding
  opens the cart drawer on its own; the header badge is the live `itemCount`.
- **Dish sheet:** open on `initialSelection(item)` (pre-selected in-stock modifiers, the cheapest
  variant); every change through `toggleModifier`; the CTA shows `itemPrice(item, selection,
  quantity, menu.money).formatted`; on submit `validateSelection` → per-group messages beside the
  group, then `addToOrder(item, { menuId, sectionId }, quantity, selection)`; out-of-stock
  modifiers disabled.
- **Cart:** lines with quantity stepper and remove, `descriptionLines` under the name, `subtotal`
  as given, checkout as a button in the drawer; the order survives a reload (same visitor token) —
  nothing to wire. Fulfillment (pickup/delivery, time) is collected on the hosted checkout;
  `fulfillment` (the operation's methods, fees formatted) is for a line of copy in the drawer, not a picker.
- **Reservations:** only AVAILABLE times offered, labelled in the restaurant's timezone; the query
  date defaults to today at the restaurant; `approval === "AUTOMATIC"` → hold → details form with
  the `holdSecondsLeft` countdown → confirm; `approval === "MANUAL"` (or `slot.manualApproval`) →
  pick → details form → request, no hold; `confirmed.outcome` "confirmed" reads as confirmed,
  "pending" as "pending the restaurant's approval"; the toggle-off and not-set-up cases read as
  "call us to book", never as a broken form. A location picker only when `locations.length > 1`
  (each has `name`, `address`).
- **Overlays you build** (cart drawer, dish sheet as a modal, mobile nav): mount at the document
  root, lock background scroll, close on Escape, return focus on close — as the shipped
  `OrderCartDrawer` does.
- **Copy:** nothing the restaurant didn't supply — no invented hours, reviews, or delivery
  promises; no Wix IDs or technical words in visible text.

### The contracts your components consume (tested and work as they are; read the source when something is off or the brief wants more)

```ts
// MenuData → sections → items, all display-ordered. EVERY money value is a formatted string in the
// site's currency + locale ("" when the currency couldn't be read); the decimal rides in *Amount.
// MenuData = { id, name, description, slug, sections, money: { currency, locale } }
// MenuItem = { id, name, description,
//   price /* formatted; null when variant- or market-priced */, priceAmount,
//   marketPrice /* true → "Market price", not orderable */,
//   variants: [{ variantId, name, price, priceAmount }],         // the cheapest is the default
//   imageUrl, gallery: string[], labels: [{ id, name, iconUrl }],
//   modifierGroups: [{ id, name, required, minSelections, maxSelections, rule, singleSelect,
//                      modifiers: [{ id, key /* `${id}~${index}` — the selection key */, name,
//                                    preSelected, additionalCharge /* "" when free */, additionalChargeAmount, inStock }] }],
//   inStock, soldOut /* !inStock or a required group with too few in-stock modifiers */,
//   orderable /* !marketPrice && !soldOut */, acceptsSpecialRequests, featured }
//
// The selection helpers (wix/restaurants/menu-core.ts) — the rule engine, framework-free:
//   OrderSelection = { variantId: string|null, modifiers: Record<groupId, key[]>, specialRequest }
//   initialSelection(item)                       → preSelected && inStock modifiers (first only when singleSelect), cheapest variant
//   toggleModifier(item, selection, groupId, key) → a new selection (singleSelect replaces, else toggles)
//   validateSelection(item, selection)           → { ok, errors: Record<groupId, message> }  (required → ≥1; ≥ min; ≤ max)
//   itemPrice(item, selection, quantity, menu.money) → { amount, formatted }  ((base + variant + modifiers) × qty)
//   needsSelection(item)                         → the dish needs a sheet (variants, groups, or a note)
//   ruleLabel(group)                             → "Choose 1" · "Choose up to 3" · "Choose 1 to 2" · "Optional"

// useMenus({ initialMenus? }) →
// { menus: MenuData[]|null /* null = loading → skeletons */,
//   activeMenuId, setActiveMenuId(id), activeMenu: MenuData|null, error }

// useOrderCart() →
// { cart: { lines, itemCount, subtotal, currency }|null,
//   ordering: boolean|null,                 // true only for an ENABLED operation; null = resolving
//   orderingStatus: { operationId, status: "ENABLED"|"DISABLED"|"PAUSED_UNTIL"|"NONE",
//                     pausedUntilIso, timeZone, fulfillmentIds, defaultFulfillmentType }|null,
//   menuOrderable(menuId): boolean|null,    // false → this menu takes no online orders now (no add control); null = unknown, let the add try
//   fulfillment: [{ id, type: "PICKUP"|"DELIVERY", name, fee, minOrderPrice }]|null,  // formatted; display only
//   busy /* the DRAWER's flag: any cart operation in flight */, pendingItemId /* the item whose add is in
//   flight, else null — a dish card's add control disables on THIS, never on busy */, error, open,
//   addToOrder(item, { menuId, sectionId }, quantity?, selection?),  // the DTO + ids from the render context — see hard rules
//   updateQuantity(lineItemId, qty), removeLine(lineItemId),
//   checkout(),                             // browser redirects to the Wix-hosted checkout
//   openCart(), closeCart(), refresh() }
// OrderLine = { lineItemId, itemName, quantity, unitPrice, linePrice, imageUrl,
//               descriptionLines /* variant, modifiers, note — as the platform labels them */,
//               status /* not "IN_STOCK" → can't check out */ }
// addToOrder rejects on refusal (no or paused operation, a sold-out dish, a modifier rule the
// selection breaks — "Choose one" etc., a refused line) AND records .error, opening the drawer on
// success — render .error in your cart surface and beside the add control.

// useReservation() →
// { locations: ReservationLocationInfo[]|null,  // enabled-for-online only, default first; or the default alone (then onlineReservationsEnabled false)
//   location, setLocationId(id),            // picker only when locations.length > 1
//   date, setDate("YYYY-MM-DD"), time, setTime("HH:mm"),   // the restaurant's wall clock (location.timeZone)
//   partySize, setPartySize(n),             // clamped to partySizeMin/Max
//   approval: "AUTOMATIC"|"MANUAL",         // for THIS party at THIS location (MANUAL_FOR_LARGE_PARTIES from the threshold up)
//   slots: ReservationSlot[]|null, findSlots(),   // AVAILABLE only; null until findSlots ran
//   selectedSlot, holdSlot(slot),           // AUTOMATIC: 10-minute hold; MANUAL: just selects → render the details form either way
//   held, holdSecondsLeft,                  // the hold and its countdown (null on the MANUAL path); 0 → the store sends the visitor back to the slots
//   reservee, setReserveeField("firstName"|"lastName"|"phone"|"email", value),
//   setMarketingConsent(bool), setCustomField(id, value),
//   fieldErrors: Record<string, string>,    // firstName · lastName · phone · email · custom:<id> — against location.form; {} when valid
//   canConfirm, confirm(),                  // gate the CTA on canConfirm; confirm reserves the hold or sends the request, by `approval`
//   confirmed: { reservationId, status, outcome: "confirmed"|"pending"|"other" }|null,
//   reset(), loading, error }
// ReservationLocationInfo = { id, name, address, timeZone, default, partySizeMin, partySizeMax,
//   approvalMode, manualApprovalPartySizeThreshold, onlineReservationsEnabled,
//   form: { lastNameRequired, emailRequired, marketingCheckbox: { checkedByDefault }|null,
//           customFields: [{ id, name, required }], terms: { url, text }|null, privacy: { url, text }|null, submitMessage } }
// ReservationSlot = { startIso, label /* "7:00 PM" at the restaurant */, dayKey, durationMinutes, manualApproval }.
// The hold, reserve, and request calls are premium-gated: on a non-premium site they fail with
// "site must be premium" in .error — render it, don't retry.
```

### The islands you create — skeletons

The class names in the shipped components are the Astro/React spelling of layout rules that hold
on every stack; on a stack where they don't deploy, keep the rule and write it in your own CSS.
Hooks first, branches after (an early return above a hook changes hook order and React throws).
The menu island renders on the server too (`client:load`); nothing in a render path may throw.

```tsx
// src/components/restaurants/YourMenu.tsx — YOU build it; pages/menu.astro mounts it with initialMenus.
import { useState } from "react";
import { useMenus } from "../../hooks/restaurants/useMenus";
import { useOrderCart } from "../../hooks/restaurants/useOrderCart";
import { imgAttrs } from "../../wix/media";
import { initialSelection, itemPrice, needsSelection, ruleLabel, toggleModifier, validateSelection } from "../../wix/restaurants/menu-core";
import type { MenuData, MenuItem, OrderSelection } from "../../wix/restaurants/types";

export default function YourMenu({ initialMenus }: { initialMenus?: MenuData[] }) {
  const { menus, activeMenuId, setActiveMenuId, activeMenu, error } = useMenus({ initialMenus });
  const { addToOrder, ordering, orderingStatus, menuOrderable, pendingItemId } = useOrderCart();
  // …you implement the render:
  //   • menus === null → skeletons; [] → your empty state (error when set)
  //   • menu tabs when menus.length > 1 (setActiveMenuId); a section nav when activeMenu.sections.length > 1;
  //     one notice when menuOrderable(activeMenu.id) === false ("not available for online ordering right now")
  //   • per section, YOUR dish card: <img {...imgAttrs(item.imageUrl, "6rem")} alt={item.name} /> when
  //     item.imageUrl, name, description, item.marketPrice ? "Market price" : item.price ?? variants, labels
  //   • the add control: hidden for item.marketPrice or menuOrderable(menuId) === false; "Sold out" when
  //     item.soldOut; the operation's reason when ordering === false; else "Add to order" — which, when
  //     needsSelection(item), opens YOUR sheet (below) and otherwise calls
  //     addToOrder(item, { menuId: activeMenu.id, sectionId: section.id }) — the ids of the menu and section
  //     the card is rendered under, never looked up again; the rejection message rendered beside it;
  //     disabled (and reading "Adding…") only while pendingItemId === item.id — never on the cart's busy,
  //     which is the drawer's flag and would dim every dish in the grid for every add
  //   • YOUR sheet: const [sel, setSel] = useState<OrderSelection>(() => initialSelection(item)); variant radios
  //     (sel.variantId), per group a fieldset titled `${g.name} · ${ruleLabel(g)}` with radios when g.singleSelect
  //     else checkboxes, keyed by m.key, onChange → setSel(toggleModifier(item, sel, g.id, m.key)), disabled when
  //     !m.inStock, m.additionalCharge beside it; a textarea when item.acceptsSpecialRequests → sel.specialRequest;
  //     a quantity stepper; the CTA reads itemPrice(item, sel, qty, activeMenu.money).formatted; on submit
  //     validateSelection(item, sel) → errors per group, else addToOrder(item, ctx, qty, sel)
}
```

```tsx
// src/components/restaurants/YourReservations.tsx — YOU build it; pages/reservations.astro mounts it client:only.
import { useReservation } from "../../hooks/restaurants/useReservation";

export default function YourReservations() {
  const r = useReservation();   // full contract above — the flow lives HERE
  // …you implement the render, in this order:
  //   r.locations === null → loading; [] or !r.location → "call us to book";
  //   !r.location.onlineReservationsEnabled → "online reservations aren't open yet";
  //   r.confirmed → outcome "confirmed" as confirmed (r.location.form.submitMessage when set), "pending" as
  //   pending approval, "other" as not completed; r.reset() to start over;
  //   else: a location picker only when locations.length > 1 (name, address); guests (bounded by
  //   partySizeMin/Max), date, time → r.findSlots(); a note when r.approval === "MANUAL"; r.slots as pills →
  //   r.holdSlot(slot); r.selectedSlot → the details form: first name + phone always, last name / email with
  //   an asterisk when r.location.form.lastNameRequired / emailRequired, one input per
  //   r.location.form.customFields (r.setCustomField), the marketing checkbox when form.marketingCheckbox
  //   (r.setMarketingConsent), terms/privacy links when form.terms / form.privacy; the countdown from
  //   r.holdSecondsLeft when r.held; r.fieldErrors beside the fields; the CTA gated by r.canConfirm reading
  //   "Complete reservation" (held) or "Request reservation" (manual); r.error inline
}
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state
machines behind the hooks do arrive — `wix/restaurants/menu-store.ts`, `reservation-store.ts`,
`order-store.ts` — so you never rewrite them: create a store per surface, `subscribe`, render from
`getState()`, call its actions. Their `*State` interfaces are the render contract; read those.
What you write is the rendering — dish card, dish sheet, menu, cart chrome, reservation form — and
for that read these first; they are tested code for exactly that behaviour:

1. `components/restaurants/MenuView.tsx` — the menu tabs / section nav / dish card / dish sheet,
   and the load-bearing wiring: each card threads its `menuId` + `sectionId` from the render
   context into `addToOrder`; the add control's states; the sheet on the `menu-core` selection
   helpers; the rejection message beside it.
2. `components/restaurants/OrderCartDrawer.tsx` — the cart overlay as working code: lines with
   stepper and remove, `status !== "IN_STOCK"` flagged, subtotal, checkout, `error` rendered.
3. `components/restaurants/ReservationView.tsx` — the state ladder in order: loading → not set up →
   toggle off → confirmed / pending → query → slots → hold or pick → the form from `location.form`;
   the confirm gate.

All under `templates/restaurants/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   winning layout instead if another vertical is also deployed).
2. Write your components under `src/components/restaurants/` (new names — don't overwrite the
   references), swap the island imports in `pages/menu.astro` and `pages/reservations.astro`.
   Menu island: `client:load` with the SSR props; reservations island and the cart chrome:
   `client:only="react"`. **Author your surfaces in as few messages as possible** — batch
   multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference files listed above before writing any surface.

`deploy.mjs restaurants --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts`
(the visitor client, configured with the public client id), `media.ts`, `money.ts`, and
`wix/restaurants/` — `menu.ts`, `ordering.ts`, `reservations.ts`, `types.ts`, the `*-core.ts`
rules (including `time-core.ts`), and the three stores `menu-store.ts`, `order-store.ts`,
`reservation-store.ts`. None of it is React. The hooks and components don't ship on this stack;
the stores replace the hooks, and you write the components in your framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createMenuStore({ initialMenus? })` per menu surface
  (`start()` when mounted, `stop()` when unmounted), `createReservationStore()` per reservation
  surface, the order store as-is (module-level: `subscribeOrderCart`/`getOrderCartState`,
  `isMenuOrderable`, `addOrderLine(item, { menuId, sectionId }, quantity?, selection?)`,
  `updateOrderLineQuantity`, `removeLineFromOrder`, `goToOrderCheckout`, `setOrderCartOpen`).
  State in, actions out — exactly the hooks' contracts above; the dish sheet's local state is an
  `OrderSelection` driven by the `menu-core` helpers;
- your dish card, sheet, cart drawer, and reservation form to the recommended defaults above — the
  shipped `MenuView.tsx`, `OrderCartDrawer.tsx`, `ReservationView.tsx` are readable as behaviour
  specs.

Routes `/menu`, `/reservations`; dev server on 4321; a static build goes through
`npx @wix/cli@latest release` with `site.outputDirectory` pointing at the build folder, an SSR
build is hosted by you.

### Wiring — static site (`--stack static`, no bundler)

Read the reference files listed above before writing any surface.

`deploy.mjs restaurants --stack static --out site` put the REST layer in `site/js/wix/` (browser
ESM, the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` —
pages, styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project
root (config, plan, seed output) is never the upload. Same function names and DTOs as the table
above, so the contracts on this page hold unchanged: `fetchMenus`, `fetchSiteMoney` from
`./js/wix/menu.js`; `resolveOrdering`, `resolveOperationId`, `fetchMenuOrdering`,
`fetchFulfillmentMethods`, `fetchOrderCart`, `addToOrder(item, { menuId, sectionId }, quantity?,
selection?)`, `updateOrderQuantity`, `removeOrderLine`, `orderCheckoutUrl` from
`./js/wix/ordering.js`; `fetchReservationLocations`, `fetchReservationSlots`, `holdReservation`,
`completeReservation`, `requestReservation` from `./js/wix/reservations.js`; the selection helpers
from `./js/wix/menu-core.js`. The state machines ship too: `createMenuStore` from
`./js/wix/menu-store.js` (`start()` once the page is up; `initialMenus` when you already have
them), `./js/wix/order-store.js` (the cart — `subscribeOrderCart`/`getOrderCartState`,
`isMenuOrderable`, `addOrderLine`, `updateOrderLineQuantity`, `removeLineFromOrder`,
`goToOrderCheckout`, `setOrderCartOpen`), and `createReservationStore` from
`./js/wix/reservation-store.js` (the whole reservation flow). No components ship — you write the
rendering in plain JS: one render function per surface that reads `getState()`, called from
`subscribe`, with the surface's controls calling the store's actions. The drawer opens after every
add on its own; overlays follow the OrderCartDrawer contract (root-level, scroll lock, Escape,
focus back). Pages are `menu.html` and `reservations.html` (a menu switch is local state, or
`menu.html?menu=<slug>` read from the query string). Wix static hosting serves files, not
directories — name the file and link to it. There are no item pages here: set `document.title`
and the meta description per page yourself, from the menu's `name` once it loads. The visitor
token persists in `localStorage` on its own; never mint per page. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs restaurants --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Then split by where the call runs. **The menu on the
server:** port `js/wix/menu.ts` and `menu-core.ts` to your language — the eCommerce-settings GET
for the site's currency + locale, three cursor-paged GETs for the visible menus/sections/items
(`paging.cursor` until `pagingMetadata.cursors.next` is empty), the id-array GETs for variants,
modifier groups, and modifiers (arrays repeat the key: `?variantIds=a&variantIds=b`, 100 per call),
labels, then the id-array stitching and the price formatting from the core — returning the same
`MenuData` tree as dicts, one anonymous visitor token per process for these public reads (mint and
refresh per `client.ts`) — and render the menu and the home page's featured dishes in your
templates, so dish names are in the HTML. **Ordering and reservations in the browser:** the cart
button and drawer on `./js/wix/order-store.js`, each dish card's add control calling
`addOrderLine(item, { menuId, sectionId }, quantity, selection)` with the item DTO and the ids the
template rendered it under (a `data-item` JSON attribute, data attributes for the ids), the
reservation form on `./js/wix/reservation-store.js` — exactly as the static wiring above; the
browser owns the visitor's token, so the server never handles per-visitor tokens. Routes stay
`/menu`, `/reservations`. Add your public https origin to the OAuth app's allowed domains before
checkout can return.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for
the menu read, run at build time with one anonymous token; the generator emits the menu page(s)
and the home page. Run `deploy.mjs restaurants --stack static --out <build dir>` so `js/wix/` is
inside the output the pages import from, point `site.outputDirectory` at that folder,
`wix release`. Pages sit at different depths: give the templates one base path to `js/wix/` (a
template variable, or root-relative `/js/wix/…`), never a relative `./js/wix/` — it breaks one
level down. The frozen menu is the first paint; the add controls, cart, and reservation flow run
client-side on it from the same modules, so the contracts above apply. Close with the live URL,
the rebuild + release command, and one line for the owner: dashboard edits to the menu reach the
site when that command runs; ordering and reservations are live regardless.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/menu` → your menu surface (`useMenus()` fetches
client-side when no `initialMenus`); `/reservations` → your reservation surface. Mount your
order button in the header and your drawer once. Deploy wrote the public client id into
`wix/config.ts`; nothing else to configure.

Routes on Wix hosting: the host serves files only, so a clean route answers 404 when loaded directly — hash routes, or one HTML file per route, decided before the first route is written; any URL handed to Wix as a return target must be one the host serves (SKILL.md step 1).

## Hard rules

- **Data and ordering logic only through the shipped exports** — `useOrderCart`/`addToOrder`
  own the restaurant `catalogReference` (the Orders app id + `operationId`/`menuId`/`sectionId`
  — all three — plus the visitor's choices as `options.priceVariant`, `options.modifierGroups`,
  `options.specialRequests`), the line-refusal checks, and the checkout redirect. Never
  re-derive any of it, never hand-build a checkout URL; extend by adding a function in
  `wix/restaurants/` for what they don't cover (API contracts: the `wix-docs` skill).
- **Thread `item` + `menuId` + `sectionId` from the render context** — each dish is rendered
  inside a known section of a known menu (the `fetchMenus` tree); pass the item DTO and those ids
  to `addToOrder`. Never look them up again.
- **Selections go through the rule engine** — a dish with variants, modifier groups, or a note
  gets a sheet: `initialSelection` → `toggleModifier` → `validateSelection` → `addToOrder(item, ctx,
  quantity, selection)`. Never send a modifier id as a selection key (keys are `MenuModifier.key`),
  never invent an option shape, never compute a price outside `itemPrice`.
- **Money is already formatted** — render `price`, `additionalCharge`, `fee`, `subtotal` as given;
  arithmetic uses the `*Amount` decimals; nothing prefixes a symbol, nothing assumes a currency.
- **Three gates before an add control shows "Add to order"**: `ordering === true` (the
  operation), `menuOrderable(menuId) !== false` (the menu's settings and hours), `item.orderable`
  (the dish). Each false state has its own copy; a market-priced dish has no control.
- **Reservations only through `useReservation`** (or its store) — AVAILABLE-only slots in the
  restaurant's timezone, the two approval paths (hold → reserve; request without a hold), the
  hold's `revision`, the form rules from `location.form`, and the real status all live in the data
  layer. Render the form from `location.form` (don't hardcode which fields exist or are required),
  gate the CTA on `canConfirm`, surface `error` and `fieldErrors` (holds expire in 10 minutes —
  the store counts down and restarts the flow).
- **The confirmed state must reflect REAL success**: render it only from `confirmed`, and only
  `outcome === "confirmed"` as confirmed — "pending" (REQUESTED, PAYMENT_INFORMATION_PENDING) as
  "pending the restaurant's approval", "other" as not completed. A visitor returning from the
  hosted checkout is NOT an order-success signal.
- **Honest unavailability**: `ordering === false` → the operation's reason on the add button
  (`orderingStatus.status`, `pausedUntilIso`); `menuOrderable(id) === false` → no add controls and
  one notice for that menu; `onlineReservationsEnabled === false` → a "call us to book" notice (the
  toggle is premium-gated). Never mock menus, dishes, prices, slots, or availability.
- **Fulfillment is collected on the hosted checkout** — pickup vs delivery, the time, the address.
  The shipped layer does not pre-qualify it (no ASAP/scheduled slot picker, no delivery-address
  check before checkout): that is a documented gap, not something to build ad hoc from the
  operation's scheduling fields. `fulfillment` is display copy ("Pickup and delivery", fees) only.
- Don't wrap shipped calls in your own API routes — they run client-side by design.
- **Cart totals come from `cart`** — never summed or hardcoded in the client; fees, tax, and
  delivery resolve on the hosted checkout. The sheet's `itemPrice` is a preview of one line, not a total.
- **Browsing, ordering and reserving need no login.** They run on the visitor session the
  shipped client already holds; don't add a members/auth flow unless the brief asks for accounts.
- **Call every hook before any conditional return.** Hooks first, branches after.
- Where the shipped components deploy (Astro, React): theme via the `@theme` tokens, and your
  markup uses Tailwind utilities on the same tokens — one design system across shipped and written
  code. No parallel theme files, no hardcoded palette values. Where they don't (`lib`, `static`,
  a port): style with whatever your stack does well, on one token set of your own; the rule that
  survives is the token set, not Tailwind.

## Point the user to their dashboard

Hand the owner these links — `{siteId}` is `siteId` in `wix.config.json` (the deploy JSON prints it as
`dashboardUrl`); a menu id fills the placeholder from the seed result.

| page | `https://manage.wix.com/dashboard/{siteId}/` + |
|---|---|
| Menus | `wix-restaurants-menus-new` |
| Edit a menu | `wix-restaurants-menus-new/menu/{menuId}` |
| Items | `wix-restaurants-menus-new/items` |
| Online orders board | `wix-restaurants-orders-new` |
| Ordering settings (pickup/delivery hours, fees, menu hours) | `wix-restaurants-orders-new/settings` |
| Reservations | `wix-table-reservations/table-reservations` |
| Floor plan | `wix-table-reservations/floor-plan` |
| Accept payments — connect a payment method | `wix-cashier/payments` |
| Upgrade the plan — online payments need premium | full URL: `https://www.wix.com/upgrade/website?metaSiteId={siteId}` |

Real paid orders need a connected payment method **and** a premium plan, and holding, completing, or
requesting an online reservation is premium-gated. Until both are done, a visitor who reaches hosted checkout sees **"We can't accept online payments. Contact us for help with your order."**
Hand both links above in the close and name the reservations gate; don't treat either as a code failure.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-restaurants.mjs` from the project
root. Seed a menu that exercises the UI (a few sections, an image per dish, at least one dish
with a size or a modifier group when the restaurant takes orders) and turn on the ordering +
reservations add-ons when the restaurant takes orders/bookings.

A fresh Menus install carries Wix's sample "Dinner Menu", and the menu page lists it next to the
seeded menus. Never delete it, or anything else on the site: the result's `preexistingMenus[]` names
what is there, and the closing message says so with the menus dashboard link so the owner removes it
there — never release a restaurant that serves the sample "Dinner Menu" without telling the owner.
