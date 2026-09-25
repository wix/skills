# Restaurants — playbook

The restaurant machinery ships as files — the assembled menu tree (menus → sections → items
with variants, modifiers, labels), the dish-ordering cart on the eCom current cart with the
exact restaurant `catalogReference`, the hosted checkout, and the table-reservation
hold → reserve flow, typed end-to-end. **The presentation is yours**: you design and
implement the dish card, the menu surface, the order-cart chrome, and the reservations
surface on the shipped hooks/DTOs, plus the home page and the brand. You never write
ordering or reservation logic; you never skip designing.

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field this playbook doesn't cover) or when the brief wants a behaviour they don't offer —
then read the file that owns it and change or extend it. On `lib`, `static`, and a port the
components don't deploy at all, and each wiring section below opens with the files to read before
writing their equivalents. Files you edit: `SiteLayout.astro`, `styles/global.css`, and the two
pages' island imports. Files you **create**: your menu, cart-chrome, and reservation components,
plus your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` | shared auth seam (deploy configures it — nothing to set by hand) |
| `wix/media.ts` · `wix/money.ts` | `imgAttrs(url, sizes)` — every `<img>` attribute for a DTO image (`src`, `srcSet`, `sizes`, lazy): `<img {...imgAttrs(item.imageUrl, "6rem")} alt={item.name} />`; `imgSrc()` / `imgSrcSet()` / `formatMoney()` underneath, already used by everything shipped |
| `wix/restaurants/types.ts` | the DTOs (`MenuData`, `MenuSection`, `MenuItem`, `OrderCart`, `ReservationSlot`, …) — contracts below |
| `wix/restaurants/menu.ts` | `fetchMenus` — the whole display-ordered menu tree, one call; the transport only — the id-array stitching and item mapping are in `menu-core.ts` beside it (shared with the REST layer) |
| `wix/restaurants/ordering.ts` · `order-store.ts` | dish add-to-cart (Orders-app `catalogReference`) + eCom Cart V2 + the hosted checkout, and the shared cart state (module store — spans Astro islands); the request shapes and refusal checks are in `ordering-core.ts` |
| `wix/restaurants/reservations.ts` | locations, AVAILABLE slots, `holdReservation`, `completeReservation` — the exact hold → reserve sequence; the mappers and the reservee body are in `reservations-core.ts` |
| `wix/restaurants/menu-store.ts` · `reservation-store.ts` | the menu-browsing and reservation state machines, framework-free (`createMenuStore()`, `createReservationStore()` — `getState`/`subscribe` + actions, one instance per surface); the hooks below bind them to React, every other stack uses them directly |
| `hooks/restaurants/useMenus.ts` | React binding of `menu-store.ts`: menu browsing + menu switching — contract below |
| `hooks/restaurants/useOrderCart.ts` | React binding of `order-store.ts`: order-cart state + actions — contract below |
| `hooks/restaurants/useReservation.ts` | React binding of `reservation-store.ts`: the whole reservation state machine — contract below |
| `components/restaurants/MenuView.tsx` (+ `MenuItemCard`) · `OrderCartButton.tsx` · `OrderCartDrawer.tsx` · `ReservationView.tsx` | **reference implementations** — tested, plain, on the tokens; the layout mounts the cart chrome as shipped, and you replace all four with your own designs (new file names) |
| `styles/global.css` | **the design system**: Tailwind v4 + the `@theme` token block (colors, radii, fonts — shared across verticals). Everything, shipped and yours, styles from these tokens |

The same data layer ships a second time as REST in `references/restaurants/rest/` (`menu.ts`,
`ordering.ts`, `reservations.ts` — the same exports over `fetch`, importing the same `*-core.ts`);
`deploy.mjs --stack static` composes it with the stores into `js/wix/` (wiring below).

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot, the global.css import, and one `OrderCartButton` + one `OrderCartDrawer`, both `client:only`). If another vertical is also deployed, its layout won — merge the Menu/Reservations links + cart mounts there |
| `pages/menu.astro` | SSR menu — **keep the frontmatter**, swap the island import to YOUR component |
| `pages/reservations.astro` | reservations — the island stays `client:only="react"` (availability is timezone-specific); swap the import to YOUR component |

## What you build — the design job

1. **The dish card + menu surface** — your card (photo treatment, price/variants, labels,
   sold-out state, add-to-order) and your menu layout (menu tabs when >1, section navigation,
   section rhythm), with skeletons while loading and an honest empty state — on `useMenus` +
   `useOrderCart`.
2. **The order-cart chrome** — your header order button (live count) and your cart panel
   (lines, quantity stepper, remove, subtotal, checkout CTA) — on `useOrderCart`, which owns
   ALL cart logic; you own how it looks.
3. **The reservations surface** — party/date/time query, slot pills, the 10-minute-hold
   details form (first name + phone required), and the confirmed vs pending-approval states —
   on `useReservation`.
4. **The home page** — hero, a featured-dishes strip (fetch `fetchMenus()` in frontmatter →
   your cards; `item.featured` marks highlights), hours/location story, reserve CTA.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).

### What a complete restaurant site shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins when it asks for something
else. Look at the seeded menu before designing (how many menus, sections, photos, variants).

- **Menu:** dish names in view-source (the page fetches server-side and passes `initialMenus`);
  sections in the menu's own order; a dish card shows name, description, price (or its
  variants, or "Market price"), labels, and the add control; skeletons while `menus === null`,
  an honest empty state for `[]`.
- **Add control:** three states from the data — "Add to order", "Sold out" (`!inStock`),
  "Ordering unavailable" (`ordering === false`); a market-priced dish has no control. Adding
  opens the cart drawer on its own; the header badge is the live `itemCount`.
- **Cart:** lines with quantity stepper and remove, `subtotal` as given, checkout as a button in
  the drawer; the order survives a reload (same visitor token) — nothing to wire.
- **Reservations:** only AVAILABLE times offered; hold → details form → confirm; `RESERVED`
  reads as confirmed, `REQUESTED` as "pending the restaurant's approval"; the toggle-off and
  not-set-up cases read as "call us to book", never as a broken form.
- **Overlays you build** (cart drawer, mobile nav): mount at the document root, lock background
  scroll, close on Escape, return focus on close — as the shipped `OrderCartDrawer` does.
- **Copy:** nothing the restaurant didn't supply — no invented hours, reviews, or delivery
  promises; no Wix IDs or technical words in visible text.

### The contracts your components consume (tested and work as they are; read the source when something is off or the brief wants more)

```ts
// MenuData → sections → items, all display-ordered:
// MenuItem = { id, name, description, price /* display string; null when variant-priced */,
//   marketPrice /* true → "Market price", not orderable */,
//   variants: [{ variantId, name, price }], imageUrl, labels: [{ id, name, iconUrl }],
//   modifierGroups: [{ id, name, required, minSelections, maxSelections,
//                      modifiers: [{ id, name, preSelected, additionalCharge, inStock }] }],
//   inStock, featured }
// MENU prices carry NO currency symbol unless the platform formatted them — render as given;
// if plain decimals, prefix the brand's currency yourself. Order-cart prices ARE formatted.
// Modifier groups are DISPLAY-ONLY (selections aren't sent on the cart line).

// useMenus({ initialMenus? }) →
// { menus: MenuData[]|null /* null = loading → skeletons */,
//   activeMenuId, setActiveMenuId(id), activeMenu: MenuData|null, error }

// useOrderCart() →
// { cart: { lines, itemCount, subtotal, currency }|null,
//   ordering: boolean|null,                 // false → show "ordering unavailable"; null = resolving
//   busy, error, open,
//   addToOrder(itemId, { menuId, sectionId }, qty?),  // ids from the render context — see hard rules
//   updateQuantity(lineItemId, qty), removeLine(lineItemId),
//   checkout(),                             // browser redirects to the Wix-hosted checkout
//   openCart(), closeCart(), refresh() }
// OrderLine = { lineItemId, itemName, quantity, unitPrice, linePrice, imageUrl,
//               descriptionLines, status /* not "IN_STOCK" → can't check out */ }
// addToOrder rejects on refusal (no ordering operation, a sold-out dish) AND records .error,
// opening the drawer on success — render .error in your cart surface and beside the add control.

// useReservation() →
// { locations: [{ id, partySizeMin, partySizeMax, approvalMode, onlineReservationsEnabled }]|null,
//   location, setLocationId(id),            // picker only when locations.length > 1
//   date, setDate("YYYY-MM-DD"), time, setTime("HH:mm"), partySize, setPartySize(n),
//   slots: ReservationSlot[]|null, findSlots(),   // AVAILABLE only; null until findSlots ran
//   held, holdSlot(slot),                    // 10-minute hold → render the details form
//   reservee, setReserveeField(field, value), // firstName + phone (E.164) required
//   canConfirm, confirm(),                    // gate the CTA on canConfirm
//   confirmed: { reservationId, status: "RESERVED"|"REQUESTED" }|null,
//   reset(), loading, error }
// ReservationSlot = { startIso, label /* "7:00 PM" */, dayKey, durationMinutes, manualApproval }.
// The hold and reserve calls are premium-gated: on a non-premium site they fail with
// "site must be premium" in .error — render it, don't retry.
```

### The islands you create — skeletons

The class names in the shipped components are the Astro/React spelling of layout rules that hold
on every stack; on a stack where they don't deploy, keep the rule and write it in your own CSS.
Hooks first, branches after (an early return above a hook changes hook order and React throws).
The menu island renders on the server too (`client:load`); nothing in a render path may throw.

```tsx
// src/components/restaurants/YourMenu.tsx — YOU build it; pages/menu.astro mounts it with initialMenus.
import { useMenus } from "../../hooks/restaurants/useMenus";
import { useOrderCart } from "../../hooks/restaurants/useOrderCart";
import { imgAttrs } from "../../wix/media";
import type { MenuData } from "../../wix/restaurants/types";

export default function YourMenu({ initialMenus }: { initialMenus?: MenuData[] }) {
  const { menus, activeMenuId, setActiveMenuId, activeMenu, error } = useMenus({ initialMenus });
  const { addToOrder, ordering, busy } = useOrderCart();
  // …you implement the render:
  //   • menus === null → skeletons; [] → your empty state (error when set)
  //   • menu tabs when menus.length > 1 (setActiveMenuId); a section nav when activeMenu.sections.length > 1
  //   • per section, YOUR dish card: <img {...imgAttrs(item.imageUrl, "6rem")} alt={item.name} /> when
  //     item.imageUrl, name, description, item.marketPrice ? "Market price" : item.price ?? variants,
  //     labels, modifier groups as text (display-only)
  //   • the add control calls addToOrder(item.id, { menuId: activeMenu.id, sectionId: section.id }) —
  //     the ids of the menu and section the card is rendered under, never looked up again; disabled
  //     when !item.inStock ("Sold out"), ordering === false ("Ordering unavailable"), or busy; hidden
  //     for item.marketPrice; the rejection message rendered beside it
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
  //   r.confirmed → RESERVED as confirmed, REQUESTED as pending approval, r.reset() to start over;
  //   else: guests (bounded by partySizeMin/Max), date, time → r.findSlots(); r.slots as pills →
  //   r.holdSlot(slot); r.held → the details form (firstName + phone required) and the confirm
  //   button gated by r.canConfirm; r.error inline; a location picker only when locations.length > 1
}
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `components/` or `hooks/` arrives. The state
machines behind the hooks do arrive — `wix/restaurants/menu-store.ts`, `reservation-store.ts`,
`order-store.ts` — so you never rewrite them: create a store per surface, `subscribe`, render from
`getState()`, call its actions. Their `*State` interfaces are the render contract; read those.
What you write is the rendering — dish card, menu, cart chrome, reservation form — and for that
read these first; they are tested code for exactly that behaviour:

1. `components/restaurants/MenuView.tsx` — the menu tabs / section nav / dish card, and the
   load-bearing wiring: each card threads its `menuId` + `sectionId` from the render context into
   `addToOrder`; the add control's three states; the rejection message beside it.
2. `components/restaurants/OrderCartDrawer.tsx` — the cart overlay as working code: lines with
   stepper and remove, `status !== "IN_STOCK"` flagged, subtotal, checkout, `error` rendered.
3. `components/restaurants/ReservationView.tsx` — the state ladder in order: loading → not set up →
   toggle off → confirmed → query → slots → hold → details form; the confirm gate.

All under `references/restaurants/app/`.

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
rules, and the three stores `menu-store.ts`, `order-store.ts`, `reservation-store.ts`. None of it
is React. The hooks and components don't ship on this stack; the stores replace the hooks, and you
write the components in your framework to the contracts on this page:

- bind the stores with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createMenuStore({ initialMenus? })` per menu surface
  (`start()` when mounted, `stop()` when unmounted), `createReservationStore()` per reservation
  surface, the order store as-is (module-level: `subscribeOrderCart`/`getOrderCartState`,
  `addOrderLine`, `updateOrderLineQuantity`, `removeLineFromOrder`, `goToOrderCheckout`,
  `setOrderCartOpen`). State in, actions out — exactly the hooks' contracts above;
- your dish card, cart drawer, and reservation form to the recommended defaults above — the
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
above, so the contracts on this page hold unchanged: `fetchMenus` from `./js/wix/menu.js`;
`resolveOperationId`, `fetchFulfillmentMethods`, `fetchOrderCart`, `addToOrder`,
`updateOrderQuantity`, `removeOrderLine`, `orderCheckoutUrl` from `./js/wix/ordering.js`;
`fetchReservationLocations`, `fetchReservationSlots`, `holdReservation`, `completeReservation`
from `./js/wix/reservations.js`. The state machines ship too: `createMenuStore` from
`./js/wix/menu-store.js` (`start()` once the page is up; `initialMenus` when you already have
them), `./js/wix/order-store.js` (the cart — `subscribeOrderCart`/`getOrderCartState`,
`addOrderLine`, `updateOrderLineQuantity`, `removeLineFromOrder`, `goToOrderCheckout`,
`setOrderCartOpen`), and `createReservationStore` from `./js/wix/reservation-store.js` (the whole
reservation flow). No components ship — you write the rendering in plain JS: one render function
per surface that reads `getState()`, called from `subscribe`, with the surface's controls calling
the store's actions. The drawer opens after every add on its own; overlays follow the
OrderCartDrawer contract (root-level, scroll lock, Escape, focus back). Pages are `menu.html`
and `reservations.html` (a menu switch is local state, or `menu.html?menu=<slug>` read from the
query string). Wix static hosting serves files, not directories — name the file and link to it.
There are no item pages here: set `document.title` and the meta description per page yourself,
from the menu's `name` once it loads. The visitor token persists in `localStorage` on its own;
never mint per page. `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference files listed above before writing any surface.

Run `deploy.mjs restaurants --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Then split by where the call runs. **The menu on the
server:** port `js/wix/menu.ts` and `menu-core.ts` to your language — seven GETs with literal
paths and query params (arrays repeat the key: `?variantIds=a&variantIds=b`), then the id-array
stitching from the core — returning the same `MenuData` tree as dicts, one anonymous visitor token
per process for these public reads (mint and refresh per `client.ts`) — and render the menu and
the home page's featured dishes in your templates, so dish names are in the HTML. **Ordering and
reservations in the browser:** the cart button and drawer on `./js/wix/order-store.js`, each dish
card's add control calling `addOrderLine(itemId, { menuId, sectionId })` with the ids the template
rendered it under (data attributes), the reservation form on `./js/wix/reservation-store.js` —
exactly as the static wiring above; the browser owns the visitor's token, so the server never
handles per-visitor tokens. Routes stay `/menu`, `/reservations`. Add your public https origin to
the OAuth app's allowed domains before checkout can return.

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

## Hard rules

- **Data and ordering logic only through the shipped exports** — `useOrderCart`/`addToOrder`
  own the restaurant `catalogReference` (the Orders app id + `operationId`/`menuId`/`sectionId`
  — all three, no `variantId`), the line-refusal checks, and the checkout redirect. Never
  re-derive any of it, never hand-build a checkout URL; extend by adding a function in
  `wix/restaurants/` for what they don't cover (API contracts: the `wix-docs` skill).
- **Thread `menuId` + `sectionId` from the render context** — each dish is rendered inside a
  known section of a known menu (the `fetchMenus` tree); pass those ids to `addToOrder`.
  Never look them up again.
- **Modifier groups are display-only** — show them on the dish (diners read them; staff sees
  choices at the counter), but don't invent a way to send selections: that cart-line shape
  isn't documented. Send quantity only, as shipped.
- **Reservations only through `useReservation`** (or its store) — AVAILABLE-only slots, the
  hold's `revision`, the firstName+phone requirement, and the RESERVED/REQUESTED split all live
  in the data layer. Gate the CTA on `canConfirm`, surface `error` (holds expire in 10 minutes —
  the store already restarts the flow).
- **The confirmed state must reflect REAL success**: render it only from `confirmed`, and
  render `REQUESTED` as "pending the restaurant's approval", never as confirmed. A visitor
  returning from the hosted checkout is NOT an order-success signal.
- **Honest unavailability**: `ordering === false` → an "ordering unavailable" state on the
  add button; `onlineReservationsEnabled === false` → a "call us to book" notice (the toggle
  is premium-gated). Never mock menus, dishes, prices, slots, or availability.
- Don't wrap shipped calls in your own API routes — they run client-side by design.
- **Cart totals come from `cart`** — never summed or hardcoded in the client; fees, tax, and
  delivery resolve on the hosted checkout.
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
| Ordering settings (pickup/delivery hours, fees) | `wix-restaurants-orders-new/settings` |
| Reservations | `wix-table-reservations/table-reservations` |
| Floor plan | `wix-table-reservations/floor-plan` |

Real paid orders need a premium plan + a connected payment method, and holding or completing an online
reservation is premium-gated — mention both.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-restaurants.mjs` from the project
root. Seed a menu that exercises the UI (a few sections, an image per dish) and turn on the
ordering + reservations add-ons when the restaurant takes orders/bookings.
