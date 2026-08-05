---
name: "Setup Events"
description: Initializes a Wix Events (Events V3) backend — creates one or more events (each TICKETING or RSVP) as drafts with future dates, adds ticket definitions for ticketed events, then publishes. Specifies the *how* (calls + format); counts, which events are ticketed vs RSVP, dates, and ticket tiers come from the request.
---
**RECIPE**: Business Recipe – Initial Setup for Wix Events (Events V3)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

A concise checklist for turning a freshly provisioned Wix site with the **Wix Events** app installed into a populated set of published, registerable events.
**Notice** that this recipe is **NOT** meant for coding purposes and is **ONLY** meant for initial Events backend setup. (The frontend read/registration contract is the sibling recipe `how-to-code-events.md`.)

> **This recipe is the *how*, not the *what*.** What to seed — how many events, which are ticketed vs free (RSVP), their dates/locations, and which ticket tiers and prices a ticketed event has — is determined by the request you're fulfilling. This recipe only specifies the calls and the request format; it does not decide quantities, types, or which events to create.

> **API surfaces:** events, ticket definitions, and publish all use **Events V3** on the **public** host `https://www.wixapis.com/events/v3/...`. The Wix Events **app id** (needed only by the frontend, kept here for reference) is `140603ad-af8d-84a5-2c80-a0f60cb47351`. The app is **pre-installed** by setup — do **not** reinstall it; if a create call returns `403`/app-not-installed, **fail loudly** with the response verbatim rather than trying to install it.

---

## Article: Steps for Setting Up Wix Events
**YOU MUST** complete all the following steps **in the given order** (1-3) without skipping any and **without requiring additional user input**. The **Attach images** step runs last, only when `imagery` is on.

**⚠️ CRITICAL ORDER REQUIREMENT: create each event as a DRAFT (STEP 1) → add its ticket definitions (STEP 2, ticketed only) → PUBLISH (STEP 3).** Two one-way constraints force this order:
- **`registration.initialType` is immutable after create** — a `TICKETING` event can never become `RSVP` (or vice-versa). Decide the type at create time from the request; never plan to convert.
- **Publishing is one-way** — once published, an event can't return to draft. So attach the ticket definitions to the *draft* first; publishing a ticketed event before its tickets exist ships a ticketed event with nothing to buy.

There is **no clean-up step** — a fresh Wix Events install ships **no** sample events, so there is nothing to delete first.

### STEP 1: Create the event(s) as a draft

Create one event per the request's event count (default 1). Each event is **either** `TICKETING` (paid tickets) **or** `RSVP` (free registration) — read which from the request. Create with `"draft": true` so STEP 2 can attach ticket definitions before the event goes live.

**⚠️ CRITICAL: dates MUST be in the future.** A past event is neither purchasable nor registerable and won't show in the live listing (the frontend filters to upcoming). Convert any human date from the request to a **future** ISO-8601 UTC instant; if none is given, default to a plausible near-future date (~60–90 days out) and note it in the kept output so the user can adjust.

**Ticketed event** (`TICKETING`) — `POST https://www.wixapis.com/events/v3/events`:

```bash
curl -X POST 'https://www.wixapis.com/events/v3/events' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "draft": true,
    "event": {
      "title": "Summer Synth Festival",
      "shortDescription": "One night of analog sound under the stars.",
      "location": {
        "name": "The Echo Lot",
        "type": "VENUE",
        "address": { "addressLine": "120 Harbor St", "city": "Seattle", "subdivision": "US-WA", "postalCode": "98101", "country": "US" }
      },
      "dateAndTimeSettings": {
        "startDate": "<FUTURE_DATE>T03:30:00.000Z",
        "endDate":   "<FUTURE_DATE>T07:00:00.000Z",
        "timeZoneId": "America/Los_Angeles",
        "showTimeZone": true
      },
      "registration": {
        "initialType": "TICKETING",
        "tickets": { "ticketLimitPerOrder": 8, "currency": "USD", "reservationDurationInMinutes": 20 }
      }
    },
    "fields": ["DETAILS", "TEXTS", "REGISTRATION", "URLS"]
  }'
```

**Free / RSVP event** (`RSVP`) — same call; only the `registration` block changes (no `tickets`):

```json
"registration": {
  "initialType": "RSVP",
  "rsvp": { "responseType": "YES_ONLY" }
}
```

**⚠️ CRITICAL FORMAT REQUIREMENTS:**
- **`registration.initialType` is `"TICKETING"` or `"RSVP"` and is immutable** — set it correctly at create time.
- **RSVP events seed NO form fields.** The registration form is **built-in** (first name + last name + email, required, can't be removed). Use `"responseType": "YES_ONLY"`, or `"YES_AND_NO"` to let guests decline. Do not seed custom fields.
- **`location`** — for a real venue use `"type": "VENUE"` with an `address` (`subdivision` is an ISO-3166-2 code like `US-WA`; `country` is ISO alpha-2). For an online event use `"type": "ONLINE"` with just a `name`. For an undecided venue use `"location": { "locationTbd": true, "name": "<placeholder>" }` instead of an address.
- **Dates** — `startDate`/`endDate` are ISO-8601 UTC (`...Z`), future, `endDate` after `startDate`; `timeZoneId` is an IANA tz.

**⚠️ Reading the response — the created event is under `event`, with `event.id` and `event.slug`.** A successful create returns `200` with this shape (REST view → `id`/`slug`):

```json
{ "event": {
  "id": "<eventId>",
  "slug": "summer-synth-festival",
  "title": "Summer Synth Festival",
  "status": "DRAFT",
  "registration": { "initialType": "TICKETING", "status": "CLOSED_MANUALLY" },
  "dateAndTimeSettings": { … },
  "location": { … }
} }
```

Keep each event's **`event.id`** (the GUID — needed for STEP 2 and STEP 3) and **`event.slug`** (defaults to the kebab-cased title — the frontend routes and the checkout redirect bind to it). `slug` is the URL identifier; do **not** confuse it with `id`.

### STEP 2: Create ticket definitions (TICKETING events only — skip for RSVP)

A ticketed event needs at least one **ticket definition** (a purchasable tier) or there's nothing to buy. Create **one tier per ticket tier in the request** (default a single `"General Admission"` tier if none named) against `POST https://www.wixapis.com/events/v3/ticket-definitions`. The tier-creates for one event are independent — they may be fired as one parallel batch.

```bash
curl -X POST 'https://www.wixapis.com/events/v3/ticket-definitions' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "ticketDefinition": {
      "eventId": "<eventId FROM STEP 1>",
      "name": "General Admission",
      "description": "Standing-room access to the full lineup.",
      "initialLimit": 200,
      "pricingMethod": { "fixedPrice": { "value": "65.00", "currency": "USD" } },
      "feeType": "FEE_INCLUDED"
    },
    "fields": ["SALES_DETAILS"]
  }'
```

**⚠️ CRITICAL FORMAT REQUIREMENTS:**
- **`pricingMethod.fixedPrice.value` is a decimal STRING** (`"65.00"`), not a number (`65`) — a number fails validation.
- **`name` is capped at 30 characters** — keep tier names short (`"Premium Floor"`, not `"Premium Floor Standing Pit Access"`).
- **`feeType`** — `"FEE_INCLUDED"` (guest pays exactly the listed price; the Wix fee is deducted from your payout) or `"FEE_ADDED_AT_CHECKOUT"` (fee shown on top). Pick one and be consistent. `"NO_FEE"` is valid **only** for free tickets (a `fixedPrice.value` of `"0"` — rare; prefer an RSVP event for free admission).
- **`initialLimit`** is the integer inventory cap for the tier; **omit it for unlimited** tickets.
- The event currency is set on the event (`registration.tickets.currency`, STEP 1); keep the tier currency consistent with it.

**⚠️ Reading the response — the created tier is under `ticketDefinition`, id at `ticketDefinition.id`:**

```json
{ "ticketDefinition": {
  "id": "<ticketDefinitionId>",
  "eventId": "<eventId>",
  "name": "General Admission",
  "initialLimit": 200,
  "pricingMethod": { "fixedPrice": { "value": "65.00", "currency": "USD" } },
  "feeType": "FEE_INCLUDED"
} }
```

Keep each **`ticketDefinition.id`** (the frontend lists tiers and reserves by it). On a partial failure, retry only the **failed** tier-creates **once** with the same format; do not loop.

### STEP 3: Publish the event

Once the event (and, for ticketed events, its ticket definitions) exists, publish it to go live: `POST https://www.wixapis.com/events/v3/events/{eventId}/publish` with body `{}`.

```bash
curl -X POST 'https://www.wixapis.com/events/v3/events/<eventId>/publish' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

A `200` with `status: "UPCOMING"` (plus `OPEN_TICKETS` on the registration for a ticketed event) means it's live. **Publishing is one-way** — there's no un-publish — so confirm the tickets are created (STEP 2) before publishing a ticketed event.

### STEP 4 (optional): Group events by a format / track — Event Categories

**Only when the request wants events grouped or filtered by a format/track** (e.g. talk / workshop / social). Wix Events has a first-class **Categories** API for this — use it; do **not** invent an endpoint. **⚠️ It is `v1`, NOT `v3`**, and the assign path is specific:

1. **Create one category per group** — `POST https://www.wixapis.com/events/v1/categories` with `{ "category": { "name": "Talks" } }` → keep `category.id`. One call each.
2. **Assign events to a category** — `POST https://www.wixapis.com/events/v1/categories/{categoryId}/events` with `{ "eventId": ["<eventId>", …] }`. **⚠️ The path is `/{categoryId}/events`, NOT `/assign`** (and `v1`, not `v3/categories`) — the wrong forms `404`.
3. **Verify via the EVENT read, not the category list.** Assignment can lag a few seconds — `listEventsByCategory` may briefly return `[]`, so don't gate on it. Confirm with `queryEvents` (or `getEventBySlug`) requesting **`fields: ["CATEGORIES"]`** — each event then carries `categories.categories[]` with the assigned `{ id, name }` (REST view — the id key is `id`, not `_id`).

Nothing else in the seed depends on categories, and the frontend filters **client-side** off the category name (`how-to-code-events.md`) — skip this step entirely if the request has no grouping.

### Attach images (imagery ON only — skip otherwise)

**Only when `imagery` is on** (`SEED.md` § "Entity images"). Events were created text-only; this pass-2 step writes a generated hero image onto each event's **`mainImage`**. Generate + import per `references/IMAGE_GENERATION.md` → keep `file.url` and its `file.id`, then update the event. This works **before or after publish** — updating an event (unlike publishing) is not one-way — so run it here regardless of an event's status.

**`mainImage` is an `Image` OBJECT `{ id, url, height, width, altText }`.** The binding field is the image **`id`** (the WixMedia image id); `url`/`altText` are descriptive. **⚠️ `height` and `width` are REQUIRED for the image to render** — the schema states the image only appears when both are defined, so always send them (use the generated dimensions, e.g. `1024`×`1024`). Events V3 uses **no `revision`** — this is a partial update keyed by `event.id`; pass only the field you're setting.

`PATCH https://www.wixapis.com/events/v3/events/{eventId}`:

```bash
curl -X PATCH 'https://www.wixapis.com/events/v3/events/<eventId>' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "event": { "id": "<eventId>", "mainImage": { "id": "<file.id>", "url": "<file.url>", "height": 1024, "width": 1024, "altText": "<alt>" } }, "fields": ["DETAILS"] }'
```

- **`mainImage` reads back only under the `DETAILS` fieldset** — pass `"fields": ["DETAILS"]` (as above, and on any confirming `getEvent`/`queryEvents`) or the response omits it and a confirm check looks empty.
- **Never block on image failure** (`SEED.md` § "Entity images" / IMAGE_GENERATION "Credits, cost & the not-generating fallback") — on failure, skip and leave the event text-only.

### Paid-ticket precondition — record it, do NOT block

Seeding **succeeds** and the event goes live regardless of payment setup. But **completing a paid purchase** later requires, in the site dashboard, both:
- a **premium plan**, and
- at least one **configured payment method** (Wix Payments / Stripe / PayPal).

Free / RSVP events need neither. This is **not** a seeding failure and **not** something to fix here — record it in the kept `notes` so it's surfaced plainly (*"Paid tickets require a premium plan + a configured payment method in the dashboard to complete a purchase."*). Never imply tickets are payable when no payment method is configured, and never fail the seed over it.

---

## Conclusion
Following these steps **in order** sets up a published Events V3 site:
- Every event is created with its **immutable `registration.initialType`** (`TICKETING` or `RSVP`) chosen up front, with **future** dates so it's purchasable/registerable and appears in the live listing.
- Every **ticketed** event has at least one **ticket definition** (price as a decimal string, name ≤ 30 chars, a valid `feeType`) created **before** publish; **RSVP** events seed no tickets and no form fields (the name + email form is built-in).
- Every event is **published** (one-way) so it's live, after its tickets exist.
- IDs kept for the coding handoff: `eventIds[]`, event `slug`s, and per ticketed event its `ticketDefinitionIds[]` (`[]` for RSVP).
- The paid-ticket precondition (premium plan + payment method) is **noted**, not treated as a failure.
- Events are seeded **text-only**; when `imagery` is on, the **Attach images** step writes a `mainImage` **object** onto each (`{ id, url, height, width }` — `height`/`width` REQUIRED or it won't render; no revision; PATCH `/events/v3/events/{eventId}`).
