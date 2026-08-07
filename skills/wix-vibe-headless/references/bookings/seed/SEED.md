# Bookings — seeding

Seed a Wix Bookings catalog by **calling `seed-bookings.js`** — don't hand-write the REST calls.
It's a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every Wix
Bookings seed operation. `require` it and call the functions with plain data.

> **Transcribed from `wix-headless/references/inline-recipes/setup-bookings.md` — NOT yet live-verified.**

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const seed = require("/app/.agents/skills/wix-vibe-headless/references/bookings/seed/seed-bookings.js");
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

await seed.installBookingsApp(ctx);                      // if the site doesn't have Wix Bookings yet

// Clean is a JUDGMENT call — never auto-delete. Only remove obvious install samples on a fresh
// install; if what's there could be the owner's real services, ask first (seeding is additive).
const existing = await seed.listServices(ctx);
// await seed.deleteServices(ctx, existing.filter(isObviousSample).map(s => s.id));

// ⚠️ ORDER: staff (STEP 1) + category (STEP 2) BEFORE services (STEP 3); sessions (STEP 4) AFTER.
const staff = await seed.queryStaff(ctx);                // fresh install has a default "Business Owner"
const resourceId = staff[0].resourceId;                  // NB: resourceId, NOT staff.id
const cats = await seed.createCategories(ctx, ["Our Services"]);   // fresh install ships ZERO categories

const services = await seed.createServices(ctx, [
  { type: "APPOINTMENT", name: "Consultation", description: "…", tagLine: "…",
    price: 75, duration: 60, categoryId: cats[0].id, staffMemberIds: [resourceId] },
  { type: "CLASS", name: "Morning Yoga", description: "…", capacity: 20,
    price: 20, categoryId: cats[0].id },   // free service: set free:true, omit price
]);

// CLASS only — needs each class's returned scheduleId, else its calendar is empty:
await seed.scheduleClassSessions(ctx, services.filter(s => s.type === "CLASS").map(s => ({
  scheduleId: s.scheduleId, resourceId, start: "2026-08-10T09:00:00", end: "2026-08-10T10:00:00", capacity: 20,
})));

// imagery ON only: generate per IMAGE_GENERATION.md, then patch each service (revision-checked):
// await seed.attachServiceImage(ctx, { serviceId: s.id, revision: s.revision, image: { id, url, width, height } });
```

## Functions
| fn | does |
|---|---|
| `installBookingsApp(ctx)` | install the Wix Bookings app on the site |
| `listServices(ctx)` | `[{id,name}]` — for the sample-cleanup judgment |
| `deleteServices(ctx, ids)` | delete each service (only obvious samples) |
| `queryStaff(ctx)` | `[{resourceId,id,name}]` — STEP 1; use `resourceId`, not `id` |
| `createStaff(ctx, [{name,description}])` | create named staff → `[{resourceId,id,name}]` (omit email/phone) |
| `queryCategories(ctx)` | `[{id,name}]` — reuse a category created earlier this run |
| `createCategories(ctx, names)` | STEP 2 — every service needs a `category.id` or it's invisible → `[{id,name}]` |
| `createServices(ctx, services)` | STEP 3 — one bulk create (APPOINTMENT/CLASS mixed) → `[{id,slug,revision,type,scheduleId,success,error}]` |
| `scheduleClassSessions(ctx, sessions)` | STEP 4 (CLASS only) — one bulk Calendar-Events-V3 create → `[{id,success,error}]` |
| `getService(ctx, serviceId)` | fetch a service (current `revision`; confirm an image landed) |
| `attachServiceImage(ctx, {serviceId,revision,image})` | imagery ON — patch `media.mainMedia`/`coverMedia` (revision-checked) |

Both bulk calls report per-item `success`/`error` — retry only the failed items **once** with the
same body; don't loop and don't re-create the ones that already succeeded.

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-bookings.md`.
