# Events seed — create events + ticket definitions via the Wix Events REST API

The `seed` scope for the events pack. Create one or more events (each `TICKETING` or `RSVP`), add ticket definitions for ticketed events, then **publish**. Returns the event IDs + slugs + ticket-definition IDs for Phase 4 to bind to.

> Read `references/shared/IMPLEMENTER.md` first (token mint-once rule, REST headers, return contract, failure-mode discipline). This file is the events-specific recipe.

All calls use the universal headers from `references/shared/AUTHENTICATION.md`:
`Authorization: Bearer $TOKEN` · `wix-site-id: $SITE_ID` · `Content-Type: application/json`.

---

## Step 1 — Mint the token (once)

```bash
SITE_ID="<siteId>"                                   # from wix.config.json (inlined)
TOKEN=$(npx @wix/cli@latest token --site "$SITE_ID") # mint ONCE; reuse for every call
```

`npx @wix/cli@latest token …` returns a byte-identical token within a run — never re-mint (see IMPLEMENTER.md).

## Step 2 — Wix Events is pre-installed

The Wix Events app (`appDefId 140603ad-af8d-84a5-2c80-a0f60cb47351`) is installed in Phase 2 (SETUP.md Step 4a). Do **not** reinstall. If a create call returns `403`/app-not-installed, surface it — don't try to install from the seeder.

## Step 3 — Create the event (Events V3)

`POST https://www.wixapis.com/events/v3/events`

Create one event per `intent.events.eventCount` (default 1). **`registration.initialType` is immutable after create** — pick `TICKETING` or `RSVP` from `intent.events.eventType` and never plan to convert. **Dates MUST be in the future** (a past event isn't purchasable/registerable). Create as a **draft** (`"draft": true`) so you can attach ticket definitions before going live.

**Ticketed event** (`intent.events.eventType === "TICKETING"`):

```bash
curl -sS -X POST "https://www.wixapis.com/events/v3/events" \
  -H "Authorization: Bearer $TOKEN" -H "wix-site-id: $SITE_ID" -H "Content-Type: application/json" \
  -d '{
    "draft": true,
    "event": {
      "title": "<event title from brand>",
      "shortDescription": "<one-line teaser>",
      "location": {
        "name": "<venue name>",
        "type": "VENUE",
        "address": { "addressLine": "<street>", "city": "<city>", "subdivision": "<ISO-3166-2, e.g. US-WA>", "postalCode": "<zip>", "country": "<ISO alpha-2, e.g. US>" }
      },
      "dateAndTimeSettings": {
        "startDate": "<FUTURE ISO-8601 UTC, e.g. 2026-09-20T03:30:00.000Z>",
        "endDate":   "<FUTURE ISO-8601 UTC, after startDate>",
        "timeZoneId": "<IANA tz, e.g. America/Los_Angeles>",
        "showTimeZone": true
      },
      "registration": {
        "initialType": "TICKETING",
        "tickets": { "ticketLimitPerOrder": 8, "currency": "USD", "reservationDurationInMinutes": 20 }
      }
    }
  }'
```

**Free / RSVP event** (`intent.events.eventType === "RSVP"`) — the registration form is built-in (name + email, can't be removed), so seed no fields and no tickets:

```bash
# registration block only differs:
"registration": {
  "initialType": "RSVP",
  "rsvp": { "responseType": "YES_ONLY" }   # or "YES_AND_NO" to let guests decline
}
```

Capture from the response: `event.id` (the event GUID), `event.slug` (defaults to the kebab-cased title — needed by the frontend redirect + routes). For a location that's not yet known, set `location.locationTbd: true` with a `location.name` instead of an address.

> **Date helper.** `intent.events` may give a human date; convert to a FUTURE ISO-8601 UTC instant. If no date is supplied, default to a plausible near-future date (e.g. ~60–90 days out) and note it in the return so the user can adjust.

## Step 4 — Create ticket definitions (TICKETING only)

`POST https://www.wixapis.com/events/v3/ticket-definitions` — one call per tier in `intent.events.ticketTiers[]` (default a single `"General Admission"` tier if none provided). Fire the N tier-creates as one parallel batch (independent calls).

```bash
curl -sS -X POST "https://www.wixapis.com/events/v3/ticket-definitions" \
  -H "Authorization: Bearer $TOKEN" -H "wix-site-id: $SITE_ID" -H "Content-Type: application/json" \
  -d '{
    "ticketDefinition": {
      "eventId": "<event.id from Step 3>",
      "name": "<tier name, ≤30 chars, e.g. General Admission>",
      "description": "<what the tier includes>",
      "initialLimit": <integer inventory cap, e.g. 200>,
      "pricingMethod": { "fixedPrice": { "value": "65.00", "currency": "USD" } },
      "feeType": "FEE_INCLUDED"
    }
  }'
```

- `name` is capped at **30 chars** — keep tier names short.
- `pricingMethod.fixedPrice.value` is a **decimal STRING** (`"65.00"`, not `65`).
- `feeType`: `FEE_INCLUDED` (guest pays exactly the listed price, fee deducted from your payout) or `FEE_ADDED_AT_CHECKOUT` (fee shown on top). Pick one and be consistent; `NO_FEE` is only valid for free tickets.
- A **free** standalone ticket (rare — usually use RSVP instead) is `fixedPrice.value: "0"`.
- Omit `initialLimit` for unlimited tickets.

Capture each returned `ticketDefinition.id`.

## Step 5 — Publish the event

`POST https://www.wixapis.com/events/v3/events/{eventId}/publish` with body `{}`.

```bash
curl -sS -X POST "https://www.wixapis.com/events/v3/events/<eventId>/publish" \
  -H "Authorization: Bearer $TOKEN" -H "wix-site-id: $SITE_ID" -H "Content-Type: application/json" -d '{}'
```

A 200 with `status: "UPCOMING"` (+ `OPEN_TICKETS` for ticketed) means it's live. **Publishing is one-way** — create the tickets first, then publish.

## Step 6 — Paid-ticket precondition (note, don't block)

Seeding succeeds and the event goes live regardless. But **completing a paid purchase** requires, in the site dashboard:
- a **premium plan**, and
- at least one **configured payment method** (Wix Payments / Stripe / PayPal).

Free/RSVP events need neither. Record this in your return `notes` so the orchestrator can surface it plainly to the user — never imply tickets are payable when no payment method is configured.

## Return contract

End your message with the fenced JSON block (per `references/shared/RETURN_CONTRACT.md`):

```json
{
  "phase": "seed-events",
  "status": "ok",
  "seeded": {
    "events": [
      { "id": "<eventId>", "slug": "<event-slug>", "title": "<title>", "type": "TICKETING",
        "ticketDefinitionIds": ["<defId>", "..."] }
    ]
  },
  "notes": "Paid tickets require a premium plan + a configured payment method in the dashboard to complete a purchase.",
  "recipeCalls": [{ "url": "https://www.wixapis.com/events/v3/events", "status": 200 }]
}
```

`ticketDefinitionIds` is `[]` for RSVP events. `type` is `"TICKETING"` or `"RSVP"` per event.

## Common failure modes

| Wrong | Right |
|---|---|
| Create the event with a **past** date | Events must be in the future to be purchasable/registerable. Convert `intent` dates to a future ISO-8601 UTC instant; default ~60–90 days out if unspecified. |
| Try to flip an `RSVP` event to `TICKETING` (or vice-versa) after create | `registration.initialType` is **immutable**. Decide from `intent.events.eventType` at create time. |
| Publish before creating ticket definitions | Publishing is **one-way**. Create the event (draft) → ticket definitions → **then** publish, or you ship a ticketed event with no tickets. |
| Send `pricingMethod.fixedPrice.value` as a number (`65`) | It's a **decimal string** (`"65.00"`). A number fails validation. |
| Ticket `name` > 30 chars | Capped at 30 — keep tier names short ("Premium Floor", not "Premium Floor Standing Pit Access"). |
| Seed form fields for an RSVP event | The RSVP registration form is **built-in** (name + email, non-removable). Seed no fields. |
| Block seeding because no payment method is configured | Seeding still succeeds — the event + tickets are created and live. The payment-method/premium requirement only gates *completing a paid purchase*. Note it; don't fail. |
| Reinstall the Wix Events app from the seeder | It's pre-installed in Phase 2. A 403 means surface-and-stop, not install. |
