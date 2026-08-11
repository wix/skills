# Bookings — seeding

Seed a Wix Bookings catalog by **calling `seed-bookings.js`** — don't hand-write the REST calls.
It's a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every Wix
Bookings seed operation. Load it and call **`setupBookings` — the one-call path** — with plain data.

> **Transcribed from `wix-headless/references/inline-recipes/setup-bookings.md` — NOT yet live-verified.**

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const fs = require("fs");
// exec_tool's require can return EMPTY exports for these build-time modules — load the file itself:
const seed = (() => { const m = { exports: {} };
  new Function("module", "exports", "require", fs.readFileSync("/app/.agents/skills/wix-vibe-headless/references/bookings/seed/seed-bookings.js", "utf8"))(m, m.exports, require);
  return m.exports; })();
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

// ONE call: install → resolve staff → categories → services → CLASS sessions → images, all in the
// correct order with ids kept in memory (no hand-threading of scheduleId/resourceId). `category` is
// a NAME (resolved to an id internally). Free service: set free:true, omit price. CLASS `sessions`
// are local "YYYY-MM-DDThh:mm:ss".
const result = await seed.setupBookings(ctx, {
  services: [
    // `imageUrl` per service is optional and attached IN this one call. Pass a plain url — the module
    // imports it into Wix Media for you (bookings binds a service image by the Wix Media file id, not a
    // url). Use the FINAL https://media.base44.com/... url from the COMPLETED generate_image (it runs in
    // the background while you build — wait for it), never a still-generating /__generating__/<id>.png.
    { type: "APPOINTMENT", name: "Consultation", description: "…", tagLine: "…", price: 75, duration: 60, category: "Our Services", imageUrl: "https://media.base44.com/…" },
    { type: "CLASS", name: "Morning Yoga", description: "…", price: 20, capacity: 20, category: "Our Services",
      sessions: [{ start: "2026-08-10T09:00:00", end: "2026-08-10T10:00:00" }] },
  ],
  // staffResourceId defaults to the fresh install's owner (queryStaff()[0].resourceId).
});
// result: { services:[...], categories:[{id,name}], resourceId, sessionsScheduled, imagesAttached }

// fallback (finer control / re-attach): import the url to Wix Media, then patch one service after the fact.
// const file = await seed.importImage(ctx, imageUrl);   // → { id, url } (Wix Media file id + wixstatic url)
// await seed.attachServiceImage(ctx, { serviceId: s.id, revision: s.revision, image: { id: file.id, url: file.url, width: 1024, height: 1024 } });
```

**Seeding is additive — never delete or overwrite existing content.** Don't clean up, don't remove
"sample" data, don't reset. Just add.

## Escape hatch — individual functions
Reach for the functions below only when the one-call `setupBookings` doesn't fit (partial re-seed,
custom staff/ordering). `setupBookings` is built from them, in this order:

```js
await seed.installBookingsApp(ctx);
const staff = await seed.queryStaffWithRetry(ctx);                   // → [{resourceId,id,name}]; polls (fresh install provisions the owner async); use resourceId, NOT id
const cats = await seed.createCategories(ctx, ["Our Services"]);    // → [{id,name}]; every service needs a categoryId
const services = await seed.createServices(ctx, [                   // → [{id,slug,revision,type,scheduleId}]
  { type: "APPOINTMENT", name: "Consultation", price: 75, duration: 60, categoryId: cats[0].id, staffMemberIds: [staff[0].resourceId] },
  { type: "CLASS", name: "Morning Yoga", price: 20, capacity: 20, categoryId: cats[0].id },
]);
// CLASS only: schedule sessions with each class's returned scheduleId (local wall-clock times)
await seed.scheduleClassSessions(ctx, [
  { scheduleId: services[1].scheduleId, resourceId: staff[0].resourceId, start: "2026-08-10T09:00:00", end: "2026-08-10T10:00:00", capacity: 20 },
]);
// images (optional): import the url to Wix Media first (bookings binds by file id), then attach.
// Use the FINAL https://media.base44.com/... url only (never a /__generating__/ placeholder).
const file = await seed.importImage(ctx, imageUrl);   // → { id, url } (Wix Media file id + wixstatic url)
await seed.attachServiceImage(ctx, { serviceId: services[0].id, revision: services[0].revision, image: { id: file.id, url: file.url, width: 1024, height: 1024 } });
```

## Functions
| fn | does |
|---|---|
| `setupBookings(ctx, {services, staffResourceId?})` | **one-call**: install → staff → categories → services → CLASS sessions → images |
| `installBookingsApp(ctx)` | install the Wix Bookings app on the site |
| `queryStaff(ctx)` | `[{resourceId,id,name}]` — one shot; use `resourceId`, not `id` |
| `queryStaffWithRetry(ctx)` | STEP 1 — same, but polls until the default owner provisions after a fresh install (avoids `MISSING_APPOINTMENT_RESOURCES`) |
| `createStaff(ctx, [{name,description}])` | create named staff → `[{resourceId,id,name}]` (omit email/phone) |
| `queryCategories(ctx)` | `[{id,name}]` — reuse a category created earlier this run |
| `createCategories(ctx, names)` | STEP 2 — every service needs a `category.id` or it's invisible → `[{id,name}]`; reuses an existing same-named category (idempotent, no dupes on re-run) |
| `createServices(ctx, services)` | STEP 3 — one bulk create (APPOINTMENT/CLASS mixed) → `[{id,slug,revision,type,scheduleId,success,error}]` |
| `scheduleClassSessions(ctx, sessions)` | STEP 4 (CLASS only) — one bulk Calendar-Events-V3 create → `[{id,success,error}]` |
| `getService(ctx, serviceId)` | fetch a service (current `revision`; confirm an image landed) |
| `importImage(ctx, url)` | import an external url into Wix Media → `{id,url}` (file id + wixstatic url); bookings binds by this file id |
| `attachServiceImage(ctx, {serviceId,revision,image})` | optional — patch `media.mainMedia`/`coverMedia` (revision-checked); `image.id` MUST be a Wix Media file id from `importImage` |

Both bulk calls report per-item `success`/`error` — retry only the failed items **once** with the
same body; don't loop and don't re-create the ones that already succeeded.

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-bookings.md`.
