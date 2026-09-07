---
name: "Manage Wix Events — Publishing, Cancelling, Cloning and Counting"
description: "Operates on events that already exist with the Wix Events V3 API — publishing a draft, cancelling, deleting, cloning, updating an event's date or details, and counting events. Use when the user wants to publish or cancel an event, duplicate one, move an event's date, or count their events. Creating an event, its tickets or a recurring series is a separate recipe."
---

# Manage Wix Events — Publishing, Cancelling, Cloning and Counting

## Goal
Operate on events that already exist. Creating an event — including its date, location,
description, guest limit, ticket tiers and recurring occurrences — is
[Create an Event](create-wix-event.md).

## Prerequisite — the Wix Events app

Every endpoint here returns `428 WIX_EVENTS_APP_NOT_INSTALLED` against a site without the app.
Install it first — do not guess the install path:

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
`400 appInstance must not be empty`. See [Install Wix Apps](../app-installation/install-wix-apps.md).

## Publish, cancel and delete

| Action | Call | Resulting `status` |
| --- | --- | --- |
| Publish a draft | `POST /events/v3/events/{eventId}/publish` | `UPCOMING` |
| Cancel | `POST /events/v3/events/{eventId}/cancel` | `CANCELED` |
| Delete | `DELETE /events/v3/events/{eventId}` | — |

Publish and cancel take an empty body. Publishing is irreversible — a published event cannot
return to `DRAFT`. Cancelling closes registration but keeps the event; deleting removes it.

> **Draft events need the `WIX_EVENTS.READ_DRAFT_EVENTS` permission.** Without it, publishing a
> draft fails `403` — as does querying it, fetching it by slug, or adding ticket definitions to
> it. If you hit that `403`, the event was still created; the way forward is to create events
> already published rather than as drafts, which needs no publish step at all. See
> [Create an Event](create-wix-event.md).

## Clone an event

`POST /events/v3/events/{eventId}/clone` with an empty body copies the registration form,
notifications, translations and ticket configuration.

> **The clone does not keep the original's date.** Its start date is reset to roughly 14 days from
> now and it comes back as a `DRAFT`. For a duplicate on a particular date, follow the clone with
> an update — and note the draft permission above.

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

The Events API takes **no field mask and no `revision`** on update — send only the fields you are
changing. A `revision`, if you send one, is ignored rather than rejected.

**When moving a date, send `startDate` and `endDate` together.** `dateAndTimeSettings` is replaced
wholesale rather than merged, so a patch carrying only `startDate` leaves the event with no end and
fails `400 event cannot have negative duration` — an error naming neither the missing field nor the
replacement. `timeZoneId` is optional here, unlike on create; the stored one is kept.

Ticket definitions are the exception — `PATCH /events/v3/ticket-definitions/{ticketDefinition.id}`
*does* require the current `revision`, which increments on every update.

## Count events

`POST /events/v3/events/query` and read `pagingMetadata.total`:

```json
{ "query": { "paging": { "limit": 100 } } }
```

Query Events returns only published events — **drafts are excluded from both the results and the
total**, and including them needs the draft permission above. Create published, or publish first,
if the count is meant to include the event you just made.

`POST /events/v3/events/count-by-status` exists, but an empty request body returns empty `facets`
even when the site has events, so it is not the way to answer "how many events do I have".

## Gotchas & troubleshooting

- **An invalid enum value reports as a missing one** — a value outside an enum returns
  `<field> value is required` rather than "invalid value". If a field you *did* send is reported
  as required, suspect the value, not its presence.
- Dates are always ISO-8601 strings, never `{seconds, nanos}`, and `timeZoneId` is required
  whenever `dateAndTimeSettings` is sent — see [Create an Event](create-wix-event.md).

## Related APIs
- **Wix Events V3**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3)
- **Event Guests**: `POST /events/v2/guests/query` — who registered
- [Create an Event](create-wix-event.md) — create body, dates, location, capacity, tickets, recurring
