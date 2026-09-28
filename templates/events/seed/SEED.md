# Events — seeding

Seed by **running `seed-events.mjs` with a plan file** — don't hand-write the REST calls.
The script mints its own site token via the Wix CLI (logged-in session + `wix.config.json`
required), installs the Wix Events app if needed, sets the site currency when the plan names one, and creates
everything in the one order that works (create DRAFT → tiers → publish — the registration
type is immutable and publishing is one-way).

```bash
# from the project root (where wix.config.json lives):
node <SKILL_ROOT>/templates/events/seed/seed-events.mjs plan.json
```

`plan.json` is plain data — write it from the brief. **Default to 3 events** (the seed shows
the shape; the owner adds the rest in the dashboard) and make them exercise the UI: mix
`TICKETING` and `RSVP` (≥1 of each), give a ticketed event 2 tiers, and give every event an
image (an events page without images looks broken) — the default is an `imagePrompt`
(AI-generated, ~1 Wix AI credit per image, account-billed): brand-contextual — subject,
aesthetic/mood, palette, lighting — always ending "no text, no watermarks". At least one image in the set shows the real subject of the business — the actual product/space/service, not abstract decoration. For an asset the user actually
supplied use `imagePath` (a file on this machine — uploaded to Wix Media) or `imageUrl`
(their own hosted URL; verify it with `curl -sI` → 200) — never a stock-photo or guessed URL. Images resolve in parallel and never block the
seed; a failed image leaves that event text-only.

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
  Wix creates the name+email form — the seed adds no fields; the owner extends it in the
  dashboard and the site renders whatever the form holds). **Immutable after create** —
  decide from the brief, never plan to convert.
- **Dates are future ISO-8601 UTC** (`…Z`), `endDate` after `startDate`, `timeZoneId` an
  IANA tz. A past event isn't registerable and won't show in the live listing; no date in
  the brief → default ~60–90 days out and say so.
- `ticketTiers` — TICKETING only, created before publish. `price` is a **decimal STRING**
  (`"45.00"`, never a number), `name` ≤ 30 chars, omit `initialLimit` for unlimited. Tier
  currency is the site currency, fixed at creation: a wrong one means deleting the event.
  `feeType` (optional) says who pays the Wix ticket service fee: `FEE_INCLUDED` (default — out of
  the price), `FEE_ADDED_AT_CHECKOUT` (the buyer pays 2.5% on top; the event page shows the line),
  or `NO_FEE` (free tickets; sites that don't require a fee). When Wix answers `INVALID_FEE_TYPE`
  the seed retries the same tier with `NO_FEE`, then `FEE_ADDED_AT_CHECKOUT`, and reports the one
  that took in the result's per-event `feeTypes`.
- `currency` — 3-letter ISO code at the top of the plan, set **only when the brief names one**: a
  sentence about currency, or a price written with its unit ("9 dollars", "$9", "€20"). Do **not**
  infer it from a language, a country, or an address. The seed sets the site to it before creating
  anything, because prices are stored in the site currency at create time; a new site starts in the
  currency of the account that created it, not the business's.
- `location` — `{ name, type: "VENUE", address }` (address `subdivision` is ISO-3166-2 like
  `US-WA`, `country` ISO alpha-2), `{ name, type: "ONLINE" }`, or
  `{ locationTbd: true, name }`.
- `category` — a name; created and assigned for you. Skip when the brief has no grouping.
- `rsvpResponseType` — `"YES_AND_NO"` to let guests decline (default `"YES_ONLY"`).
- `rsvpLimit` — RSVP only: the number of spots; `waitlist: true` opens a wait list once they are
  taken (the page then offers "Join the waitlist").
- `registrationOpensAt` — RSVP only: a future ISO-8601 UTC instant. The event publishes with
  registration SCHEDULED and the page says when it opens — for a brief like "RSVP opens next week".
  The API pairs it with a closing instant: `registrationClosesAt` (default: the event's `startDate`).
- `guests` — RSVP only: how many additional guests one RSVP may bring. Added to the registration
  form through the Events Forms API after the event is created (a count 0..N and the guests' names);
  the result's per-event `guestControl` is `true` when it landed. When it did not, the event exists
  without it and the owner adds the guest control in the dashboard — say so in the closing message.

The result JSON carries a `notes` array — when any event is ticketed it reminds that
**completing a paid purchase needs a premium plan + a configured payment method** in the
dashboard. That's an owner step, not a seeding failure; relay it.

**Seeding is additive — never delete or overwrite existing content**; ask first if a cleanup
seems needed.

## Supplied content

The general rules are in `templates/shared/SUPPLIED-CONTENT.md`. For events, each event the user
lists is one entry. Its title becomes `title`; its date and time become `startDate` and `endDate` in
ISO with the `timeZoneId` the user stated; the venue and address become `location`; named tickets
with prices become `ticketTiers` on a `TICKETING` event, and an event with no tickets is `RSVP`; a
category becomes `category`; their image becomes `imageUrl`. A date without a year or without a
time zone is a question for the user, never a guess.

## Escape hatch — individual functions
`setupEvents` composes exported steps — `installEventsApp`, `getSiteCurrency`, `createEvent`,
`createTicketTiers`, `publishEvent`, `createEventCategories`, `assignEventsToCategory`,
`importImage`, `setEventMainImage`, plus `makeCtx()` — import them only for a partial re-seed.

## Reference
Unexpected shape or an uncovered operation → read the live Wix API reference; every call the script
makes carries a `docs:` line with its reference page.
