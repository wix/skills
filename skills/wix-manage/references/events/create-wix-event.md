---
name: "Create an Event with the Wix Events API"
description: "Creates an event with the Wix Events V3 API — the required request body, ISO-8601 date and time settings, venue/online/TBD location, RSVP vs ticketed registration, guest capacity, short vs rich-text descriptions, ticket tiers and pricing, and recurring series. Covers the exact field shapes and the API's misleading validation messages. Use when the user wants to create an event, set its date, location, description, guest limit or ticket prices, or set up a repeating event."
---

# Create an Event with the Wix Events API

## Goal
Create an event on a Wix site — one-off or recurring, RSVP or ticketed, with ticket tiers. To
publish, cancel, clone, update or count events that already exist, see
[Manage Wix Events](manage-wix-events.md).

## First: pick the right "Events" API

Several unrelated Wix APIs are called "Events". Routing to the wrong one is the most expensive
mistake here, because the wrong API answers plausibly for several calls before failing.

| The user means | API | Base path |
| --- | --- | --- |
| A public event guests attend — gala, concert, workshop, meetup | **Wix Events V3** — this recipe | `/events/v3/events` |
| A bookable session on a staff or service calendar | Calendar Events V3 | `/calendar/v3/events` |
| An entry on the marketing plan calendar | Marketing Calendar Event V1 | `/promote/marketing-plan-service/v1/events` |
| An automation trigger | Triggered Events | `/automations/v1/events/report` |

A recurring *class or course that guests book* is Bookings. A recurring *event series guests
attend* is Wix Events.

## Prerequisite — the Wix Events app

Every `/events/v3` call against a site without it returns `428 WIX_EVENTS_APP_NOT_INSTALLED`.
Install with appDefId `140603ad-af8d-84a5-2c80-a0f60cb47351` via
`POST /apps-installer-service/v1/app-instance/install`, body
`{"tenant":{"tenantType":"SITE","id":"<SITE_ID>"},"appInstance":{"appDefId":"<APP_DEF_ID>"}}` —
`appDefId` nests under `appInstance`. See [Install Wix Apps](../app-installation/install-wix-apps.md).

## Create the event

```bash
curl -X POST 'https://www.wixapis.com/events/v3/events' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "event": {
      "title": "Summer Gala",
      "location": { "name": "Grand Hall", "type": "VENUE" },
      "dateAndTimeSettings": {
        "startDate": "2026-09-15T19:00:00.000Z",
        "endDate": "2026-09-15T22:00:00.000Z",
        "timeZoneId": "America/New_York"
      },
      "registration": { "initialType": "RSVP" }
    }
  }'
```

`title`, `location`, `dateAndTimeSettings` and `registration.initialType` are required. The event
is created published (`status: "UPCOMING"`).

> **Do not add `"draft": true` unless the user asked for a draft.** Draft events require the
> `WIX_EVENTS.READ_DRAFT_EVENTS` permission, and without it every follow-up call fails `403` —
> adding ticket definitions, querying the event, fetching it by slug, even publishing it. The
> event is created, but nothing can be done with it. Create it published and skip the publish
> step entirely.

## Date and time

**`startDate` and `endDate` are ISO-8601 strings, not `{seconds, nanos}` objects.** The spec types
them as `string` / `format: date-time` but also points at `google.protobuf.Timestamp`, whose
fields are `seconds` and `nanos`. That is the internal form and must not be sent. This applies to
every date-time field across the Wix APIs.

| Rule | If broken |
| --- | --- |
| ISO-8601 strings | `400 Expected a string.` |
| `endDate` is required | `400 endDate.isDefined must be true, event cannot have negative duration` |
| `timeZoneId` is required, in [TZ database](https://www.iana.org/time-zones) form | `400 getTimeZoneId is not supported` |

> The `timeZoneId` error reads as though the field is unsupported. It is not — it means the field
> is **missing**. Add it; do not remove it.

Midnight is `00:00` of the next day. `2026-08-18T24:00:00.000Z` is not a valid ISO time.

**Date to be announced:** send `dateAndTimeSettings` as
`{ "dateAndTimeTbd": true, "dateAndTimeTbdMessage": "Date coming soon" }` and nothing else. The
message is mandatory — omitting it fails `400 getScheduleTbdMessage must not be a blank`.

## Location

`location.type` is `VENUE` or `ONLINE`. There is no `TBD` type — a to-be-announced location is a
`VENUE` with `locationTbd: true`.

| Body | Result |
| --- | --- |
| `{ "name": "Grand Hall", "type": "VENUE" }` | Accepted |
| `{ "name": "To be announced", "locationTbd": true }` | Accepted — `type` defaults to `VENUE` |
| `{ "locationTbd": true }` | `400 Location address must not be a blank` |
| `{ "name": "TBA", "type": "TBD" }` | `400 type enum must be in [VENUE(0), ONLINE(1)]` |

For a street address add `address`:
`{ "country": "US", "subdivision": "US-NY", "city": "New York", "postalCode": "10001",
"streetAddress": { "number": "429", "name": "11th Ave" } }` — `subdivision` is the ISO-3166-2
code; the API fills in `formattedAddress` and `geocode`.

## Registration type and capacity

`initialType` must be nested under `registration`; at the root of `event` it is treated as
omitted. Accepted values are **`RSVP`**, **`TICKETING`**, `EXTERNAL` and `NONE`.

> The API's error text advertises `[RSVP,TICKETS,RSVP_AND_TICKETS]`. Those do not work —
> `TICKETS` is rejected. Use `TICKETING`.

`initialType` is immutable: an `RSVP` event can never become `TICKETING` or vice versa. Choose
correctly at creation — "register by RSVP, not tickets" means `RSVP`.

**Guest limit (RSVP events).** The cap is `registration.rsvp.limit`:
`"registration": { "initialType": "RSVP", "rsvp": { "limit": 30 } }`. A `limit` placed directly
on `registration` is **silently ignored** — no cap, no error. Add `waitlistEnabled: true` for a
waitlist. Ticketed events cap per tier instead, via `initialLimit` below.

## Description — two different fields

| Field | Type | Use for |
| --- | --- | --- |
| `shortDescription` | plain string, max 500 | One line under the event title |
| `description` | Ricos rich content object | The formatted body on the event page |

A plain sentence belongs in `shortDescription`. A string sent to `description` fails
`400 Expected an object` — it takes a Ricos `{ "nodes": [...] }` tree, as built in
[Rich Content](../rich-content/author-ricos-rich-content.md). `shortDescription` is returned only
with `"fields": ["DETAILS"]`, `description` only with `["TEXTS"]`; both are stored regardless.

## Ticket tiers

For events created with `"initialType": "TICKETING"`. One call per tier — there is no
bulk-create, and up to 100 tiers per event.

```bash
curl -X POST 'https://www.wixapis.com/events/v3/ticket-definitions' \
  -H 'Content-Type: application/json' -H 'Authorization: <AUTH>' \
  --data-binary '{
    "ticketDefinition": {
      "eventId": "<EVENT_ID>",
      "name": "General Admission",
      "pricingMethod": { "fixedPrice": { "value": "25.00", "currency": "USD" } },
      "feeType": "FEE_ADDED_AT_CHECKOUT",
      "initialLimit": 100
    }
  }'
```

| To create | `pricingMethod` |
| --- | --- |
| Fixed price | `{ "fixedPrice": { "value": "25.00", "currency": "USD" } }` |
| Free | `{ "fixedPrice": { "value": "0", "currency": "USD" } }` |
| Donation, with a minimum | `{ "guestPrice": { "value": "5.00", "currency": "USD" } }` |

- **`feeType` is required** — `FEE_ADDED_AT_CHECKOUT` or `FEE_INCLUDED`.
- **`value` is a string.** `"value": 10` fails `400 Unexpected value for field value`.
- **No writable `free` flag** — `pricingMethod.free` is read-only; a free ticket is a `fixedPrice`
  of `"0"`.
- Quantity is **`initialLimit`**, not `initialQuantity`; omit for unlimited. `limitPerCheckout` is
  read-only. `name` max 30 chars.

## Recurring events

Wix Events has **no recurrence rule** — no `RRULE`, no "weekly" pattern. Calculate every
occurrence yourself and list them all (up to 1000). **Each occurrence needs its own
`timeZoneId`**; omitting it fails with a cryptic `ZoneOffset` error:

```json
"dateAndTimeSettings": {
  "startDate": "2026-10-20T18:00:00.000Z",
  "endDate": "2026-10-20T19:00:00.000Z",
  "timeZoneId": "America/New_York",
  "recurringEvents": {
    "individualEventDates": [
      { "startDate": "2026-10-20T18:00:00.000Z", "endDate": "2026-10-20T19:00:00.000Z", "timeZoneId": "America/New_York" },
      { "startDate": "2026-10-27T18:00:00.000Z", "endDate": "2026-10-27T19:00:00.000Z", "timeZoneId": "America/New_York" }
    ]
  }
}
```

Pick a sensible horizon for "weekly" and say how many occurrences you created. The event returns
`recurrenceStatus: "RECURRING"`. Each occurrence is an independent event with its own ID; all
share a generated `recurringEvents.categoryId`, which is how you query the series.

## Gotchas & troubleshooting

- **An invalid enum value reports as a missing one** — `<field> value is required` rather than
  "invalid value". If a field you *did* send is reported as required, suspect the value.
- **Error text names internal accessors**: `getTimeZoneId`, `getScheduleTbdMessage`,
  `endDate.isDefined` each map to the plain field of the same name.

## Related APIs
- **Wix Events V3**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3)
- **Ticket Definitions V3**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3)
- [Manage Wix Events](manage-wix-events.md) — publish, cancel, delete, clone, update, count
