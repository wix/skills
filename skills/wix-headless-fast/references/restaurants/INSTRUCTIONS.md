# Restaurants — playbook

The restaurant machinery ships as files — the assembled menu tree (menus → sections → items
with variants, modifiers, labels), the dish-ordering cart on the eCom current cart with the
exact restaurant `catalogReference`, the hosted checkout, and the table-reservation
hold → reserve flow, typed end-to-end. **The presentation is yours**: you design and
implement the dish card, the menu surface, the order-cart chrome, and the reservations
surface on the shipped hooks/DTOs, plus the home page and the brand. You never write
ordering or reservation logic; you never skip designing.

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the contracts below are everything you
need. Open a shipped file's source only on a real fallback (runtime error / uncovered field),
or to read a reference component's pattern.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` · `wix/media.ts` · `wix/money.ts` | shared auth seam + helpers (deploy configures; nothing to set) |
| `wix/restaurants/types.ts` | the DTOs (`MenuData`, `MenuSection`, `MenuItem`, `OrderCart`, `ReservationSlot`, …) — contracts below |
| `wix/restaurants/menu.ts` | `fetchMenus` — the whole display-ordered menu tree, one call |
| `wix/restaurants/ordering.ts` · `order-store.ts` | dish add-to-cart (Orders-app catalogReference) + eCom Cart V2 + shared cart state (module store — spans Astro islands) |
| `wix/restaurants/reservations.ts` | locations, AVAILABLE slots, `holdReservation`, `completeReservation` — the exact hold→reserve sequence lives here |
| `hooks/restaurants/useMenus.ts` | menu browsing + menu switching — contract below |
| `hooks/restaurants/useOrderCart.ts` | order-cart state + actions — contract below |
| `hooks/restaurants/useReservation.ts` | the whole reservation state machine — contract below |
| `components/restaurants/MenuView.tsx` (+ `MenuItemCard`) · `OrderCartButton.tsx` · `OrderCartDrawer.tsx` · `ReservationView.tsx` | **REFERENCE implementations** — correct, plain; build your own instead of shipping them |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

Astro stack additionally gets:

| file | what it is |
|---|---|
| `layouts/SiteLayout.astro` | site chrome — **yours to brand** (keep the `seo-tags` slot, global.css import, and one OrderCartButton + one OrderCartDrawer, both `client:only`). If another vertical is also deployed, its layout won — merge the Menu/Reservations links + cart mounts there |
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
Style everything with Tailwind utilities on the tokens.

### The contracts your components consume

```ts
// MenuData → sections → items, all display-ordered:
// MenuItem = { id, name, description, price /* display string; null when variant-priced */,
//   marketPrice /* true → "Market price", not orderable */,
//   variants: [{ variantId, name, price }], imageUrl, labels: [{ id, name, iconUrl }],
//   modifierGroups: [{ id, name, required, minSelections, maxSelections,
//                      modifiers: [{ id, name, preSelected, additionalCharge, inStock }] }],
//   inStock, featured }
// ⚠ MENU prices carry NO currency symbol unless the platform formatted them — render as
//   given; if plain decimals, prefix the brand's currency yourself. Order-cart prices ARE
//   formatted. Modifier groups are DISPLAY-ONLY (selections aren't sent on the cart line).

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
```

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass — merge into the
   winning layout instead if another vertical is also deployed).
2. Write your components under `src/components/restaurants/` (new names — don't overwrite the
   references), swap the island imports in `pages/menu.astro` and `pages/reservations.astro`.
   Menu island: `client:load` with the SSR props; reservations island and the cart chrome:
   `client:only="react"`. **Author your surfaces in as few messages as possible** — batch
   multiple Writes per message.
3. Write `pages/index.astro` (home) — it exists from the scaffold; Read it before overwriting.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite
plugins — deploy added the dep). Routes: `/menu` → your menu surface (`useMenus()` fetches
client-side when no `initialMenus`); `/reservations` → your reservation surface. Mount your
order button in the header and your drawer once.

## Hard rules

- **Ordering logic only through the shipped exports** — `useOrderCart`/`addToOrder` own the
  restaurant `catalogReference` (the Orders app id + `operationId`/`menuId`/`sectionId` — all
  three, no `variantId`), the line-refusal checks, and the checkout redirect. Never re-derive
  any of it, never hand-build a checkout URL.
- **Thread `menuId` + `sectionId` from the render context** — each dish is rendered inside a
  known section of a known menu (the `fetchMenus` tree); pass those ids to `addToOrder`.
  Never look them up again.
- **Modifier groups are display-only** — show them on the dish (diners read them; staff sees
  choices at the counter), but don't invent a way to send selections: that cart-line shape
  isn't documented. Send quantity only, as shipped.
- **Reservations only through `useReservation`** — AVAILABLE-only slots, the hold's
  `revision`, the firstName+phone requirement, and the RESERVED/REQUESTED split all live in
  the data layer. Gate the CTA on `canConfirm`, surface `error` (holds expire in 10 minutes —
  the hook already restarts the flow).
- **The confirmed state must reflect REAL success**: render it only from `confirmed`, and
  render `REQUESTED` as "pending the restaurant's approval", never as confirmed. A visitor
  returning from the hosted checkout is NOT an order-success signal.
- **Honest unavailability**: `ordering === false` → an "ordering unavailable" state on the
  add button; `onlineReservationsEnabled === false` → a "call us to book" notice (the toggle
  is premium-gated). Never mock menus, dishes, prices, slots, or availability.
- Theme via the `@theme` tokens; no parallel theme files, no hardcoded palettes.

## Point the user to their dashboard

Give the owner the dashboard link (`https://manage.wix.com/dashboard/<siteId>`) plus:
`…/wix-restaurants-menus-new` (edit the menu), `…/wix-restaurants-orders-new/settings`
(fulfillment: pickup/delivery hours, fees), `…/wix-table-reservations/table-reservations`
(tables, availability). Real paid orders need a premium plan + a connected payment method,
and the online-reservations toggle itself is premium — mention both.

## Seeding

Per `seed/SEED.md` — plain-data `plan.json` into `seed-restaurants.mjs` from the project
root. Seed a menu that exercises the UI (a few sections, an image per dish) and turn on the
ordering + reservations add-ons when the restaurant takes orders/bookings.

## Verify (before declaring done)

- [ ] `/menu` renders the live menu SSR (view-source shows dish names) through YOUR
      components, sections in seeded order; an empty backend shows your honest empty state.
- [ ] Add to order works (drawer opens, count badge is live); quantity ± / remove work; the
      order survives a reload (same visitor token); checkout redirects to the Wix-hosted
      checkout — or, with no ordering operation, your "ordering unavailable" state shows.
- [ ] `/reservations`: only AVAILABLE times offered; hold → details form → confirm produces
      your RESERVED or REQUESTED state; a non-premium site shows your honest
      "reservations aren't open yet" notice instead of a broken form.
- [ ] Dish card / menu / cart chrome / reservations / home are YOUR designs on the tokens;
      data-layer/hook files unedited.
- [ ] Dashboard links handed to the owner, with the premium notes.
