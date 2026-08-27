# Events — seeding

Seed by **running `seed-events.mjs` with a plan file** — don't hand-write the REST calls.
The script mints its own site token via the Wix CLI (logged-in session + `wix.config.json`
required), installs the Wix Events app if needed, resolves the site currency, and creates
everything in the one order that works (create DRAFT → tiers → publish — the registration
type is immutable and publishing is one-way).

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/references/events/seed/seed-events.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to 3 events** (the seed shows
the shape; the owner adds the rest in the dashboard) and make them exercise the UI: mix
`TICKETING` and `RSVP` (≥1 of each), give a ticketed event 2 tiers, and give every event an
image (an events page without images looks broken) — either an `imageUrl` (a real https URL,
verified with `curl -sI` → 200 before seeding) or an `imagePrompt` (AI-generated, **1 Wix AI
credit per image**, account-billed): brand-contextual — subject, aesthetic/mood, palette,
lighting — always ending "no text, no watermarks". Images resolve in parallel and never block
the seed; a failed image leaves that event text-only.

```json
{
  "events": [
    { "type": "TICKETING", "title": "Summer Synth Festival",
      "shortDescription": "One night of analog sound under the stars.",
      "startDate": "2026-11-07T03:30:00.000Z", "endDate": "2026-11-07T07:00:00.000Z",
      "timeZoneId": "America/Los_Angeles",
      "location": { "name": "The Echo Lot", "type": "VENUE",
        "address": { "addressLine": "120 Harbor St", "city": "Seattle", "subdivision": "US-WA", "postalCode": "98101", "country": "US" } },
      "ticketTiers": [
        { "name": "General Admission", "price": "45.00", "initialLimit": 200 },
        { "name": "Front Row", "price": "85.00", "description": "First two rows.", "initialLimit": 40 }
      ],
      "category": "Concerts", "imageUrl": "https://…" },
    { "type": "TICKETING", "title": "Vinyl Mixing Workshop",
      "shortDescription": "Hands-on turntable session, decks provided.",
      "startDate": "2026-11-14T18:00:00.000Z", "endDate": "2026-11-14T20:00:00.000Z",
      "timeZoneId": "America/Los_Angeles",
      "location": { "name": "Studio B", "type": "VENUE",
        "address": { "addressLine": "9 Pine Ave", "city": "Seattle", "subdivision": "US-WA", "postalCode": "98101", "country": "US" } },
      "ticketTiers": [{ "name": "Workshop Seat", "price": "30.00", "initialLimit": 16 }],
      "category": "Workshops", "imageUrl": "https://…" },
    { "type": "RSVP", "title": "Community Listening Night",
      "shortDescription": "Free open-deck evening — bring a record.",
      "startDate": "2026-11-20T19:00:00.000Z", "endDate": "2026-11-20T22:00:00.000Z",
      "timeZoneId": "America/Los_Angeles",
      "location": { "name": "The Back Room", "type": "VENUE",
        "address": { "addressLine": "120 Harbor St", "city": "Seattle", "subdivision": "US-WA", "postalCode": "98101", "country": "US" } },
      "category": "Community", "imageUrl": "https://…" }
  ]
}
```

- `type` — `TICKETING` (paid tiers; buyers pay on Wix's hosted checkout) or `RSVP` (free;
  the built-in name+email form — seed NO form fields). **Immutable after create** — decide
  from the brief, never plan to convert.
- **Dates are future ISO-8601 UTC** (`…Z`), `endDate` after `startDate`, `timeZoneId` an
  IANA tz. A past event isn't registerable and won't show in the live listing; no date in
  the brief → default ~60–90 days out and say so.
- `ticketTiers` — TICKETING only, created before publish. `price` is a **decimal STRING**
  (`"45.00"`, never a number), `name` ≤ 30 chars, omit `initialLimit` for unlimited. Tier
  currency is the site currency (resolved automatically).
- `location` — `{ name, type: "VENUE", address }` (address `subdivision` is ISO-3166-2 like
  `US-WA`, `country` ISO alpha-2), `{ name, type: "ONLINE" }`, or
  `{ locationTbd: true, name }`.
- `category` — a name; created and assigned for you. Skip when the brief has no grouping.
- `rsvpResponseType` — `"YES_AND_NO"` to let guests decline (default `"YES_ONLY"`).

The result JSON carries a `notes` array — when any event is ticketed it reminds that
**completing a paid purchase needs a premium plan + a configured payment method** in the
dashboard. That's an owner step, not a seeding failure; relay it.

**Seeding is additive — never delete or overwrite existing content**; ask first if a cleanup
seems needed.

## Escape hatch — individual functions
`setupEvents` composes exported steps — `installEventsApp`, `getSiteCurrency`, `createEvent`,
`createTicketTiers`, `publishEvent`, `createEventCategories`, `assignEventsToCategory`,
`importImage`, `setEventMainImage`, plus `makeCtx()` — import them only for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; the
authoritative source recipe is `wix-headless/references/inline-recipes/setup-events.md`.
