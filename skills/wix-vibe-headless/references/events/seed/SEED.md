# Events — seeding

Seed Wix Events (Events V3) by **calling `seed-events.js`** — don't hand-write the REST calls. It's
a build-time module (run via `exec_tool`, not shipped in the app) that abstracts every Wix Events
seed operation. `require` it and call the functions with plain data.

> **NOT yet live-verified — transcribed from `setup-events.md`.** Endpoints/fields are as written in
> the recipe; if a live call disagrees, trust the docs (see Fallback).

Two one-way constraints fix the order: `registration.initialType` (`TICKETING`/`RSVP`) is **immutable**
after create, and **publishing is one-way**. So per event: create DRAFT → (ticketed) add tiers → publish.
Wix Events is **pre-installed** by setup — never reinstall (a 403 means fail loudly). There is no
clean-up step (a fresh install ships no sample events).

```js
// build-time exec_tool
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix"); // Base44 (generic: use $TOKEN)
const seed = require("/app/.agents/skills/wix-vibe-headless/references/events/seed/seed-events.js");
const ctx = { token: accessToken, siteId: WIX_METASITE_ID };

// STEP 1 — create each event as a DRAFT. TICKETING = paid tiers; RSVP = free built-in form (no fields to seed).
// Dates MUST be in the future (ISO-8601 UTC); default ~60–90 days out and note it if the request gives none.
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

// Attach images (imagery ON only): generate per IMAGE_GENERATION.md, then set mainImage. height/width REQUIRED or it won't render.
await seed.setEventMainImage(ctx, { eventId: ev.id, id: file.id, url: file.url, height: 1024, width: 1024, altText: ev.slug });
```

**Paid-ticket precondition — record, do NOT block:** seeding succeeds and the event goes live
regardless of payment setup, but *completing a paid purchase* later needs a premium plan **and** a
configured payment method in the dashboard. Note it in the kept output; never fail the seed over it.
Free/RSVP events need neither.

## Functions
| fn | does |
|---|---|
| `createEvent(ctx, event)` | STEP 1 — create ONE draft event (no bulk; loop for many) → `{id, slug}` |
| `createTicketTiers(ctx, eventId, tiers)` | STEP 2 — TICKETING only, parallel batch → `[{id}]` |
| `publishEvent(ctx, eventId)` | STEP 3 — publish (one-way) |
| `createEventCategories(ctx, names)` | STEP 4 (opt) — v1 Categories, one call each → `[{id,name}]` |
| `assignEventsToCategory(ctx, categoryId, eventIds)` | STEP 4 (opt) — path `/{categoryId}/events`, body `{eventId:[…]}` |
| `setEventMainImage(ctx, {eventId,id,url,height,width,altText})` | imagery ON — PATCH `mainImage` (no revision) |

## Fallback
If a call returns a shape you didn't expect, or you need an operation this module doesn't cover,
use the **`wix-docs`** skill to search + read the live Wix API reference — never guess. The
authoritative source recipe is `wix-headless/references/inline-recipes/setup-events.md`.
