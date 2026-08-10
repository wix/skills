---
name: "Manage Wix Events — Tickets, Publishing, Cloning and Recurring Series"
description: "Manages existing events with the Wix Events V3 API — ticket definitions and pricing (fixed price, free, donation, multiple tiers), publishing a draft, cancelling, deleting, cloning, updating an event's date or details, counting events, and creating a recurring series. Use when the user wants to add or price tickets, publish or cancel an event, duplicate an event, move an event's date, count their events, or set up a repeating event."
---

# Manage Wix Events — Tickets, Publishing, Cloning and Recurring Series

## Goal
Operate on events that already exist: sell tickets, publish, cancel, delete, clone, update,
count, and build recurring series. To create the event in the first place — including its date,
location, description and guest limit — see [Create an Event](create-wix-event.md).

## Prerequisite — the Wix Events app must be installed

Every endpoint here returns `428 WIX_EVENTS_APP_NOT_INSTALLED` against a site without the app.
Install it first — do not guess the install path, which is easy to get wrong:

```bash
curl -X POST 'https://www.wixapis.com/apps-installer-service/v1/app-instance/install' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "tenant": { "tenantType": "SITE", "id": "<SITE_ID>" },
    "appInstance": { "appDefId": "140603ad-af8d-84a5-2c80-a0f60cb47351" }
  }'
```

`appDefId` nests under `appInstance`, not at the root — at the root it fails with
`400 appInstance must not be empty`. See [Install Wix Apps](../app-installation/install-wix-apps.md)
for the full flow.

## Ticket definitions

Ticket definitions belong to events created with `"initialType": "TICKETING"`. Tickets are a
separate API; up to 100 definitions per event.

```bash
curl -X POST 'https://www.wixapis.com/events/v3/ticket-definitions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
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
| A fixed-price ticket | `{ "fixedPrice": { "value": "25.00", "currency": "USD" } }` |
| A free ticket | `{ "fixedPrice": { "value": "0", "currency": "USD" } }` |
| A donation / pay-what-you-want ticket, with a minimum | `{ "guestPrice": { "value": "5.00", "currency": "USD" } }` |

Easy to get wrong:

- **`feeType` is required** — `FEE_ADDED_AT_CHECKOUT` (fee on top of the price) or
  `FEE_INCLUDED` (fee absorbed into it).
- **`value` is a string.** `"value": 10` fails with `400 Unexpected value for field value`.
- **There is no writable `free` flag.** `pricingMethod.free` is read-only, computed from the
  price; sending `{"free": true}` fails with `value fixedPrice or guestPrice or pricingOptions
  must not be empty`.
- **The quantity field is `initialLimit`**, not `initialQuantity`. Omit it for unlimited tickets.
- `limitPerCheckout` is read-only — it cannot be set on create.
- `name` is capped at 30 characters, `description` at 500.

**Multiple tiers** — call the endpoint once per tier with the same `eventId`. For "General
Admission at $20 and VIP at $50", that is two calls, each with its own `name`, `fixedPrice` and
`initialLimit`. There is no bulk-create for ticket definitions.

## Publish, cancel and delete

| Action | Call | Resulting `status` |
| --- | --- | --- |
| Publish a draft | `POST /events/v3/events/{eventId}/publish` | `UPCOMING` |
| Cancel | `POST /events/v3/events/{eventId}/cancel` | `CANCELED` |
| Delete | `DELETE /events/v3/events/{eventId}` | — |

Publish and cancel take an empty body. Publishing is irreversible — a published event cannot
return to `DRAFT`. Cancelling closes registration but keeps the event; deleting removes it.

## Clone an event

`POST /events/v3/events/{eventId}/clone` with an empty body copies the registration form,
notifications, translations and ticket configuration.

> **The clone does not keep the original's date.** Its start date is reset to roughly 14 days
> from now, and it comes back as a `DRAFT`. If the user wanted a duplicate on a particular date,
> follow the clone with an update, then publish it.

## Update an event

`PATCH /events/v3/events/{event.id}` with the fields to change nested under `event`:

```bash
curl -X PATCH 'https://www.wixapis.com/events/v3/events/<EVENT_ID>' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "event": {
      "dateAndTimeSettings": {
        "startDate": "2026-10-15T19:00:00.000Z",
        "endDate": "2026-10-15T22:00:00.000Z",
        "timeZoneId": "America/New_York"
      }
    }
  }'
```

The Events API takes **no field mask and no `revision`** on update — send only the fields you
are changing. Send `dateAndTimeSettings` complete when moving a date: `startDate`, `endDate` and
`timeZoneId` together, since the same required-field rules apply as on create.

Ticket definitions are the exception — `PATCH /events/v3/ticket-definitions/{ticketDefinition.id}`
*does* require the current `revision`, which increments on every update.

## Count events

`POST /events/v3/events/query` and read `pagingMetadata.total`:

```json
{ "query": { "paging": { "limit": 100 } } }
```

Query Events returns only published events — **drafts are excluded from both the results and the
total**. Create with `"draft": false`, or publish first, if the count is meant to include the
event you just made.

`POST /events/v3/events/count-by-status` exists, but an empty request body returns empty `facets`
even when the site has events, so it is not the way to answer "how many events do I have".

## Recurring events

Wix Events has **no recurrence rule** — no `RRULE`, no "weekly" pattern. Calculate every
occurrence date yourself and list them all (up to 1000), alongside the normal top-level
`startDate` / `endDate` / `timeZoneId`:

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

For "a weekly event starting next week", generate the dates yourself — pick a sensible horizon
(a few months) and say how many occurrences you created. The event returns
`recurrenceStatus: "RECURRING"`. Each occurrence is an independent event with its own ID,
updatable and deletable on its own; all share a generated `recurringEvents.categoryId`. Query by
that `categoryId` to retrieve the whole series.

## Gotchas & troubleshooting

- **An invalid enum value reports as a missing one.** A value outside an enum returns
  `<field> value is required` rather than "invalid value" — true for `feeType` and
  `registration.initialType`. If a field you *did* send is reported as required, suspect the
  value, not its presence.
- Dates are always ISO-8601 strings, never `{seconds, nanos}` — see
  [Create an Event](create-wix-event.md).

## Related APIs
- **Wix Events V3**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3)
- **Ticket Definitions V3**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3)
- **Event Guests**: `POST /events/v2/guests/query` — who registered
- [Create an Event](create-wix-event.md) — the create body, dates, location, capacity
