# Restaurants — seeding

Seed a Wix Restaurants site by **calling `seed-restaurants.js`** — don't hand-write the REST calls.
It's a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every seed
operation across the vertical's four recipes: the **menu** (always) plus three on-demand add-ons —
**online ordering**, **table reservations**, and **experiences**. `require` it and call the functions
with plain data.

> **NOT yet live-verified — transcribed from `setup-restaurants.md`, `setup-restaurant-orders.md`,
> `setup-restaurant-reservations.md`, `setup-restaurant-experiences.md`.**

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const seed = require("/app/.agents/skills/wix-vibe-headless/references/restaurants/seed/seed-restaurants.js");
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

// ── MENU (always; the seedable core) ────────────────────────────────────────────────────────────
await seed.installMenusApp(ctx);                    // if the site doesn't have Wix Restaurants Menus yet

// Clean is a JUDGMENT call — never auto-delete. Only remove the install's obvious default "Dinner
// Menu" on a fresh install; if it could be the owner's real menu, ask first (seeding is additive).
// Children before parents: items → sections → menus.
// const items = await seed.listMenuItems(ctx);   await seed.deleteMenuItems(ctx, items.map(i => i.id));
// const secs  = await seed.listMenuSections(ctx); await seed.deleteMenuSections(ctx, secs.map(s => s.id));
// const menus = await seed.listMenus(ctx);        for (const m of menus) await seed.deleteMenu(ctx, m.id);

const menu = await seed.createMenu(ctx, {           // builds items → sections → menu bottom-up
  name: "Dinner", description: "Evening menu",
  sections: [
    { name: "Antipasti", description: "To start", items: [
      { name: "Bruschetta al Pomodoro", description: "Grilled sourdough, San Marzano tomatoes, basil.", price: 9.50 },
    ] },
  ],
});                                                 // → { menuId, sectionIds, itemIds }

// imagery ON only: generate per IMAGE_GENERATION.md, then attach (full-replace — echo revision + price)
// await seed.attachItemImages(ctx, [{ id, revision, price, image: { id, url, height, width } }]);

// ── ONLINE ORDERING (add-on, on demand; MENU-FIRST) ──────────────────────────────────────────────
await seed.installOrdersApp(ctx);                   // auto-provisions a working ordering setup
await seed.setBusinessLocation(ctx, address);       // STEP 0 — REQUIRED (see preconditions)
const [op] = await seed.listOperations(ctx);        // verify the auto-created operation (never create one)
// if (op.onlineOrderingStatus !== "ENABLED") await seed.enableOperation(ctx, op.id, op.revision);
const methods = await seed.listFulfillmentMethods(ctx);      // reshape ONLY what the request names
// await seed.updateFulfillmentMethod(ctx, methods[0].id, { revision: methods[0].revision, name: "Delivery", fee: "5" });
const settings = await seed.queryMenuOrderingSettings(ctx);  // confirm each menu is onlineOrderingEnabled

// ── TABLE RESERVATIONS (add-on, on demand; INDEPENDENT of menu/ordering) ─────────────────────────
await seed.installTableReservationsApp(ctx);        // auto-provisions a default reservation location
await seed.setBusinessLocation(ctx, address);       // STEP 0 — shared with ordering (do it once if both)
const [loc] = await seed.listReservationLocations(ctx);      // discover the default (never create one)
// await seed.updateReservationLocation(ctx, loc.id, loc.revision, { onlineReservations: { partySize: { min: 2, max: 10 } } });
await seed.enableOnlineReservations(ctx, loc.id, loc.revision);  // PREMIUM-GATED — 428 on a free site (record, don't fail)

// ── EXPERIENCES (add-on WITHIN Table Reservations, on demand) ────────────────────────────────────
await seed.createExperiences(ctx, loc.id, [{ configuration: { /* per Create-Experience doc */ } }]);
```

## Functions

**Menu** (`setup-restaurants.md`)
| fn | does |
|---|---|
| `installMenusApp(ctx)` | install the Wix Restaurants Menus app |
| `listMenuItems(ctx)` / `deleteMenuItems(ctx, ids)` | list / bulk-delete items (sample-cleanup judgment) |
| `listMenuSections(ctx)` / `deleteMenuSections(ctx, ids)` | list / bulk-delete sections |
| `listMenus(ctx)` / `deleteMenu(ctx, menuId)` | list / delete a menu (no bulk delete — one per menu) |
| `createMenu(ctx, {name,description?,sections})` | items → sections → menu bottom-up → `{menuId,sectionIds,itemIds}` |
| `attachItemImages(ctx, [{id,revision,price,image}])` | imagery pass — full-replace PATCH (echo revision + priceInfo) |

**Shared** (ordering + reservations STEP 0)
| fn | does |
|---|---|
| `setBusinessLocation(ctx, location)` | full-override Update Location (or create if none) — REQUIRED for ordering |

**Online ordering** (`setup-restaurant-orders.md`) — verify/reshape the auto-provisioned setup
| fn | does |
|---|---|
| `installOrdersApp(ctx)` | install the Orders app (auto-provisions operation + methods + per-menu settings) |
| `listOperations(ctx)` | the auto-created operation(s) — never create one |
| `enableOperation(ctx, id, revision)` | PATCH `onlineOrderingStatus:"ENABLED"` (only if not already) |
| `listFulfillmentMethods(ctx)` | the three auto-created methods |
| `updateFulfillmentMethod(ctx, id, patch)` | rename / re-fee / disable (partial; `fee`/`minOrderPrice` decimal strings) |
| `createFulfillmentMethod(ctx, method)` | add one beyond the defaults (NOT auto-attached) |
| `setOperationFulfillmentIds(ctx, id, revision, ids)` | attach a created method (full array) |
| `queryMenuOrderingSettings(ctx)` | confirm each menu `onlineOrderingEnabled` + bound to the operation |
| `updateMenuOrderingSettings(ctx, id, patch)` | flip a menu orderable / display-only |

**Table reservations** (`setup-restaurant-reservations.md`) — configure the auto-provisioned location
| fn | does |
|---|---|
| `installTableReservationsApp(ctx)` | install the app (auto-provisions the default reservation location) |
| `listReservationLocations(ctx)` | discover the default (never create one — API can't) |
| `updateReservationLocation(ctx, id, revision, configuration)` | party-size / hours / turnover (config only; `location` immutable) |
| `enableOnlineReservations(ctx, id, revision)` | turn online reservations on — PREMIUM-GATED (428 on free) |

**Experiences** (`setup-restaurant-experiences.md`) — feature of Table Reservations (no extra install)
| fn | does |
|---|---|
| `createExperiences(ctx, reservationLocationId, experiences)` | one experience per named dining occasion → `[{id,name}]` |

## Ordering rules (do not violate)
- **Menu is bottom-up: items → sections → menu.** A section is created with its `itemIds`, a menu with
  its `sectionIds`, so each child must exist before its parent. `createMenu` does this in three phases.
- **`visible: true` at every level** (item, section, menu) — storefront queries return only visible
  entities. Baked in by `createMenu`.
- **Menu before ordering.** Seed the menu first, then the ordering add-on (as one unit) — each menu
  binds to the operation via a menu-ordering-settings object. Ordering auto-provisions per menu either
  way, but the verify step needs a menu to confirm against.
- **`setBusinessLocation` STEP 0 is required for ordering** — without a real address Wix limits ordering
  to "testing only" and checkout breaks. Shared with reservations (do it once if both add-ons run).
- **Reservations are independent** — they bind to a location, not a menu; no menu-first rule, nothing to
  bulk-seed (visitors create reservations at runtime).
- Operations and reservation locations are **auto-provisioned — never create them**; discover and PATCH.

## Preconditions (record in the handoff, do NOT fail the seed)
- **Ordering address (STEP 0)** — required; if the brief names none, set a clearly-marked placeholder and
  flag the owner to set their real business address before ordering works.
- **Paid checkout** needs a **premium plan + a configured payment method** (dashboard/premium — can't be
  done headlessly).
- **`enableOnlineReservations` is premium-only** — throws `428 PREMIUM_ONLY` on a non-premium site;
  expected and non-fatal, record it and continue (don't retry-spiral).
- **Booking an experience** is premium-gated the same way (create works on a free site; booking needs
  premium + online reservations enabled).

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover, use the
**`wix-docs`** skill to search + read the live Wix API reference — never guess. The **Experiences** create
payload especially lives in the docs (fields evolve). The authoritative source recipes are
`wix-headless/references/inline-recipes/setup-restaurants.md`, `setup-restaurant-orders.md`,
`setup-restaurant-reservations.md`, and `setup-restaurant-experiences.md`.
