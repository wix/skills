# Events — seeding

Seed Wix Events (Events V3) by **calling `seed-events.js`** — don't hand-write the REST calls. It's
a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every Wix Events
seed operation. `require` it and call the functions with plain data.

> **NOT yet live-verified — transcribed from `setup-events.md`.** Endpoints/fields are as written in
> the recipe; if a live call disagrees, trust the docs (see Fallback).

Two one-way constraints fix the order: `registration.initialType` (`TICKETING`/`RSVP`) is **immutable**
after create, and **publishing is one-way**. So per event: create DRAFT → (ticketed) add tiers → publish.
`setupEvents` **installs the Wix Events app first** (idempotent — a re-install returns 200), so seeding works even if the site doesn't have it yet.

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const fs = require("fs");
// exec_tool's require can return EMPTY exports for these build-time modules — load the file itself:
const seed = (() => { const m = { exports: {} };
  new Function("module", "exports", "require", fs.readFileSync("/app/.agents/skills/wix-vibe-headless/references/events/seed/seed-events.js", "utf8"))(m, m.exports, require);
  return m.exports; })();
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

// DEFAULT — one call runs the whole flow per event (create DRAFT → tiers → publish), then resolves
// category NAMES → ids + assigns and attaches main images. Ids are kept in memory; nothing is
// hand-threaded across exec calls. Dates MUST be in the future (ISO-8601 UTC); default ~60–90 days
// out and note it if the request gives none. price is a decimal STRING; ticket name <= 30 chars;
// omit ticketTiers for RSVP/free, omit imageUrl if you have none.
const summary = await seed.setupEvents(ctx, {
  events: [{
    title: "Summer Synth Festival", shortDescription: "One night of analog sound.",
    type: "TICKETING", startDate: "2026-10-01T03:30:00.000Z", endDate: "2026-10-01T07:00:00.000Z",
    timeZoneId: "America/Los_Angeles",
    location: { name: "The Echo Lot", type: "VENUE", address: { addressLine: "120 Harbor St", city: "Seattle", subdivision: "US-WA", postalCode: "98101", country: "US" } },
    ticketTiers: [{ name: "General Admission", price: "65.00", initialLimit: 200 }],
    category: "Talks",
    // imageUrl is optional and attached IN this one call. Pass a plain url — the module imports it to
    // Wix Media for you (events binds the main image by file id). Use the FINAL https://media.base44.com/...
    // url from the COMPLETED generate_image (it runs in the background while you build — wait for it),
    // never a still-generating /__generating__/<id>.png placeholder. altText defaults to the event slug.
    imageUrl: "https://media.base44.com/…",
  }],
});
// summary -> { events: [{ id, slug, ticketCount, category }], categories: [{ id, name }], imagesAttached }
```

**Seeding is additive — never delete or overwrite existing content.** Don't clean up, don't remove
"sample" data, don't reset. Just add.

## Escape hatch — individual functions
Reach for the functions below only when the one-call `setupEvents` doesn't fit (re-running a single
step, a shape it doesn't model). `setupEvents` is built from them, in this order:

```js
// STEP 1 — create each event as a DRAFT. TICKETING = paid tiers; RSVP = free built-in form (no fields to seed).
const ev = await seed.createEvent(ctx, {
  title: "Summer Synth Festival", shortDescription: "One night of analog sound.",
  type: "TICKETING", startDate: "2026-10-01T03:30:00.000Z", endDate: "2026-10-01T07:00:00.000Z",
  timeZoneId: "America/Los_Angeles",
  location: { name: "The Echo Lot", type: "VENUE", address: { addressLine: "120 Harbor St", city: "Seattle", subdivision: "US-WA", postalCode: "98101", country: "US" } },
});

// STEP 2 — TICKETING only: add tiers BEFORE publish. price is a decimal STRING; name <= 30 chars; omit initialLimit for unlimited.
const tiers = await seed.createTicketTiers(ctx, ev.id, [{ name: "General Admission", price: "65.00", initialLimit: 200 }]);

// STEP 3 — publish (one-way; ticketed events only after tiers exist)
await seed.publishEvent(ctx, ev.id);

// STEP 4 (optional) — group by a format/track (v1 Categories)
const cats = await seed.createEventCategories(ctx, ["Talks"]);
await seed.assignEventsToCategory(ctx, cats[0].id, [ev.id]);

// Attach images (optional): import the url to Wix Media (events binds by file id), then set mainImage.
const file = await seed.importImage(ctx, imageUrl);   // → { id, url } (Wix Media file id + wixstatic url)
await seed.setEventMainImage(ctx, { eventId: ev.id, id: file.id, url: file.url, height: 1024, width: 1024, altText: ev.slug });
```

**Paid-ticket precondition — record, do NOT block:** seeding succeeds and the event goes live
regardless of payment setup, but *completing a paid purchase* later needs a premium plan **and** a
configured payment method in the dashboard. Note it in the kept output; never fail the seed over it.
Free/RSVP events need neither.

## Functions
| fn | does |
|---|---|
| `setupEvents(ctx, {events})` | **DEFAULT** — one call: per event create DRAFT → tiers → publish, then resolve category names → assign + attach images → `{events, categories, imagesAttached}` |
| `createEvent(ctx, event)` | STEP 1 — create ONE draft event (no bulk; loop for many) → `{id, slug}` |
| `createTicketTiers(ctx, eventId, tiers)` | STEP 2 — TICKETING only, parallel batch → `[{id}]` |
| `publishEvent(ctx, eventId)` | STEP 3 — publish (one-way) |
| `createEventCategories(ctx, names)` | STEP 4 (opt) — v1 Categories, one call each → `[{id,name}]` |
| `assignEventsToCategory(ctx, categoryId, eventIds)` | STEP 4 (opt) — path `/{categoryId}/events`, body `{eventId:[…]}` |
| `importImage(ctx, url)` | import an external url into Wix Media → `{id,url}` (file id + wixstatic url); the main image binds by this file id |
| `setEventMainImage(ctx, {eventId,id,url,height,width,altText})` | optional — PATCH `mainImage` (no revision); `id` = a Wix Media file id from `importImage` |

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-events.md`.
