---
name: "Create an Event with the Wix Events API"
description: "Creates an event with the Wix Events V3 API — the required request body, ISO-8601 date and time settings, venue/online/TBD location, RSVP vs ticketed registration, guest capacity, and short vs rich-text descriptions. Covers the exact field shapes and the API's misleading validation messages. Use when the user wants to create an event, set its date, location, description or guest limit, or choose between RSVP and ticketing."
---

# Create an Event with the Wix Events API

## Goal
Create an event on a Wix site — one-off or recurring, RSVP or ticketed — with the Wix Events
V3 API. To publish, cancel, clone, count, add tickets or set up a recurring series, see
[Manage Wix Events](manage-wix-events.md).

## First: pick the right "Events" API

Several unrelated Wix APIs are called "Events". Routing to the wrong one is the most expensive
mistake on this surface, because the wrong API answers plausibly for several calls before
failing.

| The user means | API | Base path |
| --- | --- | --- |
| A public event guests attend — gala, concert, workshop, meetup | **Wix Events V3** — this recipe | `/events/v3/events` |
| A bookable session on a staff or service calendar | Calendar Events V3 | `/calendar/v3/events` |
| An entry on the marketing plan calendar | Marketing Calendar Event V1 | `/promote/marketing-plan-service/v1/events` |
| An automation trigger | Triggered Events | `/automations/v1/events/report` |

A recurring *class or course that guests book* is Bookings, not Wix Events. A recurring
*event series guests attend* is Wix Events.

## Prerequisite — the Wix Events app must be installed

Every `/events/v3` call against a site without the app returns:

```
428  {"message":"Events app not installed for metaSiteId=...",
      "details":{"applicationError":{"code":"WIX_EVENTS_APP_NOT_INSTALLED"}}}
```

Install it with appDefId `140603ad-af8d-84a5-2c80-a0f60cb47351` — see
[Install Wix Apps](../app-installation/install-wix-apps.md). Confirm with the user first unless
they already asked for the event to be created.

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
    },
    "draft": true
  }'
```

`title`, `location`, `dateAndTimeSettings` and `registration.initialType` are all required.
Drop `"draft": true` to create the event already published; a draft has `status: "DRAFT"` and
is invisible on the site until published with `POST /events/v3/events/{eventId}/publish`
(empty body), which moves it to `UPCOMING`.

## Date and time

**`startDate` and `endDate` are ISO-8601 strings, not `{seconds, nanos}` objects.**

The spec types these fields as `string` / `format: date-time` but also carries a pointer to the
`google.protobuf.Timestamp` message, whose fields are `seconds` and `nanos`. That message
describes the *internal* representation and must not be sent — it fails with
`400 {"message":"Expected a string."}`. This applies to every date-time field across the Wix
APIs, not only Events.

| Rule | If broken |
| --- | --- |
| `startDate` / `endDate` are ISO-8601 strings | `400 Expected a string.` |
| `endDate` is required | `400 endDate.isDefined must be true, event cannot have negative duration` |
| `timeZoneId` is required, in [TZ database](https://www.iana.org/time-zones) form (`America/New_York`) | `400 getTimeZoneId is not supported` |

> The `timeZoneId` error reads as though the field is unsupported. It is not — it means the
> field is **missing**. Add `timeZoneId`; do not remove it.

**Date to be announced:** send `dateAndTimeSettings` as
`{ "dateAndTimeTbd": true, "dateAndTimeTbdMessage": "Date coming soon" }` and nothing else. The
message is mandatory — omitting it fails with `400 getScheduleTbdMessage must not be a blank`.

## Location

`location.type` is `VENUE` or `ONLINE`. There is no `TBD` type — a to-be-announced location is
a `VENUE` with `locationTbd: true`.

| Body | Result |
| --- | --- |
| `{ "name": "Grand Hall", "type": "VENUE" }` | Accepted |
| `{ "name": "Zoom", "type": "ONLINE" }` | Accepted |
| `{ "name": "To be announced", "locationTbd": true }` | Accepted — `type` defaults to `VENUE` |
| `{ "locationTbd": true }` | `400 Event location is invalid ... Location address must not be a blank` |
| `{ "name": "TBA", "type": "TBD", "locationTbd": true }` | `400 type enum must be in [VENUE(0), ONLINE(1)]` |

For a real street address, add an `address` object:

```json
"location": {
  "name": "Javits Center", "type": "VENUE",
  "address": {
    "country": "US", "subdivision": "US-NY", "city": "New York", "postalCode": "10001",
    "streetAddress": { "number": "429", "name": "11th Ave" }
  }
}
```

`subdivision` is the ISO-3166-2 code (`US-NY`), and the API fills in `formattedAddress` and
`geocode` on the response. A `VENUE` with no `address` comes back with `locationTbd: true` set
by the API whether or not you sent it.

## Registration type and capacity

`initialType` must be nested under `registration`; at the root of `event` it is treated as
omitted and fails with the same error. Accepted values are **`RSVP`**, **`TICKETING`**,
`EXTERNAL` and `NONE`.

> The API's error text for this field advertises `[RSVP,TICKETS,RSVP_AND_TICKETS]`. Those
> values do not work — `TICKETS` is rejected. Use `TICKETING`.

`initialType` is immutable: an `RSVP` event can never become a `TICKETING` event or vice versa
(either can later become `EXTERNAL` or `NONE` via `registration.type`). Choose correctly at
creation time — "people should register by RSVP, not tickets" means `RSVP`.

**Guest limit.** For an RSVP event, the cap is `registration.rsvp.limit`:

```json
"registration": { "initialType": "RSVP", "rsvp": { "limit": 30 } }
```

A `limit` placed directly on `registration` is **silently ignored** — the event is created with
no cap and no error. Set `waitlistEnabled: true` alongside it to let guests join a waitlist once
the limit is reached. For a ticketed event the cap is per ticket type, via `initialLimit` on the
ticket definition — see [Manage Wix Events](manage-wix-events.md).

## Description — two different fields

| Field | Type | Use for |
| --- | --- | --- |
| `shortDescription` | plain string, max 500 | A one-line description under the event title |
| `description` | Ricos rich content object | The formatted body on the event page |

A plain sentence belongs in `shortDescription`. Sending a string to `description` fails with
`400 {"message":"Expected an object"}` — it takes a Ricos `{ "nodes": [...] }` tree, as built in
[Rich Content](../rich-content/author-ricos-rich-content.md):

```json
"description": { "nodes": [ { "type": "PARAGRAPH", "id": "p1", "paragraphData": {},
  "nodes": [ { "type": "TEXT", "id": "", "nodes": [],
               "textData": { "text": "Monthly meetup to discuss a new book.", "decorations": [] } } ] } ] }
```

`shortDescription` is only returned when the request asks for `"fields": ["DETAILS"]`, and
`description` only with `"fields": ["TEXTS"]`. Both are stored regardless.

## Gotchas & troubleshooting

- **An invalid enum value reports as a missing one.** Sending a value outside an enum returns
  `<field> value is required` rather than "invalid value". If a field you *did* send is reported
  as required, suspect the value, not its presence.
- **Error text names internal accessors, not request fields.** `getTimeZoneId`,
  `getScheduleTbdMessage` and `endDate.isDefined` each map to the plain field of the same name.
- `title` is required, min 1 and max 120 characters. There is no separate name field.

## Related APIs
- **Wix Events V3**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3)
- [Manage Wix Events](manage-wix-events.md) — tickets, publish, cancel, clone, recurring, count
- [Install Wix Apps](../app-installation/install-wix-apps.md) — the `428` pre-flight
