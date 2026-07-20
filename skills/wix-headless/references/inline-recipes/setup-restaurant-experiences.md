---
name: "Setup Restaurant Experiences"
description: Seeds Wix Table Reservations **Experiences** — a reservation that IS a special dining occasion at the restaurant (wine tasting, cheese pairing, chef's table, tasting-menu evening), as opposed to a plain table booking or a Bookings service. Points to the live docs for the full create payload and carries only the earned gotchas the docs don't state (field-shape drift, payment policy, premium gating, when-to-use). The occasions/prices/schedule come from the request.
---
**RECIPE**: Business Recipe – Experiences Setup for Wix Table Reservations (Experiences API)

> **Standard call shape (every curl below).** `<AUTH>` = `Authorization: Bearer <TOKEN>` **and** `wix-site-id: <SITE_ID>`. Body-bearing requests also need `Content-Type: application/json`.

## When to use experiences (and when NOT to)

An **experience** is a **reservation that is itself a curated dining occasion at the restaurant** — it books seats at the restaurant's own reservation location but overrides the location's defaults with its own name, description, per-guest payment policy, party-size, schedule, and booking form. Reach for it when the brief names a **wine tasting, cheese/wine pairing, chef's table, or tasting-menu evening**.

- **Experience vs plain reservation:** a plain reservation just books a table; an experience books a *named, scheduled, often paid occasion*. Same booking mechanism, different intent.
- **Experience vs `bookings`:** the separate `bookings` vertical is for a **service/appointment/class with a provider** (spa, tutor, studio). If a restaurant *hosts and seats* the occasion, it's an experience — not a booking. (See `CAPABILITIES.md` — "Experiences vs bookings".)

## Prerequisites

- The **Table Reservations app** is installed (`SETUP.md` §2). **Experiences are a feature of that app — there is no separate app to install.**
- A **reservation location exists** — the install auto-provisions the default one (`setup-restaurant-reservations.md` STEP 1). Discover it and take its **`id`**; every experience is created against that `reservationLocationId`. No menu dependency.

## The docs are the source of truth for the payload — read them, don't guess

Read these `.md` twins directly (first priority; append `.md` to the article URL). This recipe deliberately does **not** re-inline the full schema — it changes, and the docs carry the complete, current field tree:

- **About Experiences** (what they are, how they bind to reservations/locations/time-slots): <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/experiences/introduction.md>
- **Create Experience** (the full create payload + example): <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/experiences/create-experience.md>
- **Query / Get Experience**: <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/experiences/query-experiences.md> · <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/experiences/get-experience.md>
- **Sample flow** (showcase + book an experience end-to-end): <https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/experiences/sample-flows.md>

Endpoint: `POST https://www.wixapis.com/table-reservations/experiences/v1/experiences`.

## The flow

1. **Discover the reservation location** (`setup-restaurant-reservations.md` STEP 1) → keep `reservationLocationId`.
2. **Create one experience per named occasion.** Build the body from the request (occasion name, per-guest price, party size, days/times, duration) per the **Create Experience** doc. Keep each returned `experience.id`. Set `configuration.visible: true` so it shows on the live site.
3. Per the "simple seeds" default, create only the occasions the brief names (typically 1–3); don't invent a full calendar.

Minimal shape (the doc has the complete tree — this is only the skeleton to orient against):

```jsonc
{ "experience": {
  "reservationLocationId": "<reservationLocationId>",
  "configuration": {
    "displayInfo": { "name": "…", "shortDescription": "…" },
    "paymentPolicy": { "paymentPolicyType": "PER_GUEST", "perGuestOptions": { "price": "55.00" } },
    "onlineReservations": {
      "partySize": { "min": 2, "max": 8 },
      "minimumReservationNotice": { "number": 24, "unit": "HOURS" },
      "maximumReservationNotice": { "number": 60, "unit": "DAYS" },
      "approval": { "mode": "AUTOMATIC" },
      "maxGuests": { "number": 16 },
      "businessSchedule": { "durationInMinutes": 90, "entries": [
        { "recurrence": "WEEKLY", "weeklyOptions": { "startDaysAndTimes": [ { "day": "FRIDAY", "time": "18:30" } ] } }
      ] }
    },
    "visible": true
  }
} }
```

## Earned gotchas (what the docs won't tell you — verified against the live API)

- **⚠️ Notice fields are FLAT under `onlineReservations`, not wrapped.** Send `onlineReservations.minimumReservationNotice` and `.maximumReservationNotice` **directly**. The Create-Experience doc *example* nests them inside a `noticePeriod` object — that wrapper is stale; the required-parameters list (same page) shows them flat, and the flat form is what the API accepts. Follow the parameter tree, not the example blob.
- **Required at create** (creation 400s without them): `reservationLocationId`; `configuration.displayInfo.name`; `configuration.paymentPolicy.paymentPolicyType`; `configuration.onlineReservations.partySize.min/max`, `.approval.mode`, `.minimumReservationNotice.{number,unit}`, `.maximumReservationNotice.{number,unit}`, `.maxGuests.number`. (Confirm against the doc — the list evolves.)
- **`paymentPolicyType`: `PER_GUEST` or `FREE`.** `PER_GUEST` needs `perGuestOptions.price` (decimal **string**, e.g. `"55.00"`; currency is the site's). `FREE` needs no price. Creating a `PER_GUEST` experience succeeds on a free site, but a guest **completing** a paid experience booking needs the same premium + payment provider that any paid reservation does (below).
- **`businessSchedule.entries[]`** carries the recurrence: `WEEKLY` with `weeklyOptions.startDaysAndTimes[{ day, time }]` (`day` is `MONDAY`…`SUNDAY`, `time` is `"HH:mm"`), or `ONE_TIME` with `oneTimeOptions`. `durationInMinutes` sits on `businessSchedule`, not per entry.
- **⚠️ Booking an experience is PREMIUM-GATED**, exactly like turning on online reservations (`setup-restaurant-reservations.md` STEP 3 → `428 PREMIUM_ONLY` on a free site). **Creating** the experience works on a free site; **booking** it at runtime needs the site to be premium with online reservations enabled. Record the precondition in the handoff; **don't fail the seed** over it.
- **Cover image (opt-in):** `configuration.displayInfo.coverImage` takes a Wix Media image (`{ id, url, … }`) — attach it in the imagery pass (`IMAGE_GENERATION.md`) only when `imagery` is on; otherwise omit and the frontend renders a themed block.
- **⚠️ Heads-up for the booking UI (not a seed step):** the experiences **sample-flow doc** (linked above) tells the frontend to call `getScheduledTimeSlots` with the experience GUID — **that parameter doesn't exist** (neither the SDK nor REST scopes slots to an experience), so it silently returns the *location's* slots. The frontend must instead project bookable times from the experience's own `businessSchedule`. Full detail: `how-to-code-restaurant-reservations.md` (Gotcha C).

## Keep

Nothing crosses into the handoff — experiences are read **live** on the frontend (`queryExperiences`). Track the created `experienceId`(s) only transiently (to confirm success / attach cover images). Frontend booking contract: `how-to-code-restaurant-reservations.md` (Experiences section).
