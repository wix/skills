---
name: "Create an Event with the Wix Events API"
description: "Creates an event with the Wix Events V3 API — one-off or recurring, RSVP, ticketed, registration-free or with external registration — including date and time, venue or online location, guest limit, description and ticket tiers. Covers the exact field shapes and the API's misleading validation messages. Use when the user wants to create or set up an event, an information-only event, or a repeating event — including a weekly workshop, class or meetup series held on set dates at a venue or online; a Bookings class or course is booked per session instead."
---

# Create an Event with the Wix Events API

## Goal
Create an event on a Wix site — one-off or recurring, RSVP, ticketed, registration-free or with
external registration, with ticket tiers. To change registration, publish, cancel, clone, update
or count events that already exist, see [Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events).

## First: pick the right "Events" API

Several unrelated Wix APIs are called "Events". Routing to the wrong one is the most expensive
mistake here, because the wrong API answers plausibly for several calls before failing.

| The user means | API | Base URL |
| --- | --- | --- |
| A public event guests attend — gala, concert, workshop, meetup | **Wix Events V3** — this recipe | `https://www.wixapis.com/events/v3/events` |
| A bookable session on a staff or service calendar | Calendar Events V3 | `https://www.wixapis.com/calendar/v3/events` |
| An entry on the marketing plan calendar | Marketing Calendar Event V1 | `https://www.wixapis.com/promote/marketing-plan-service/v1/events` |
| An automation trigger | Triggered Events | `https://www.wixapis.com/automations/v1/events/report` |

A recurring *class or course that guests book* — a session with a staff member or a service
calendar — is Bookings. A recurring *event series guests attend* — a weekly workshop, meetup or
class with a date and a venue — is Wix Events: use this recipe and don't look at Bookings unless
the user asks to book a service or appointment.

## Prerequisite — the Wix Events app

Every `https://www.wixapis.com/events/v3` call against a site without it returns `428 WIX_EVENTS_APP_NOT_INSTALLED`.
Install with appDefId `140603ad-af8d-84a5-2c80-a0f60cb47351` via
`POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install`, body
`{"tenant":{"tenantType":"SITE","id":"<SITE_ID>"},"appInstance":{"appDefId":"<APP_DEF_ID>"}}` —
`appDefId` nests under `appInstance`. See [Install Wix Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/install-wix-apps).

## Create the event

Reference pages: [Create Event](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/create-event) and, for the read-backs below,
[Query Events](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events). The bodies in this recipe — including the recurring one
— are complete for their cases; send them as shown rather than rebuilding them from the schema.

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

**What comes back** — the created event under `event`; the id you need for every follow-up call is
`event.id`:

```json
{
  "event": {
    "id": "<EVENT_ID>",
    "title": "Summer Gala",
    "slug": "summer-gala",
    "status": "UPCOMING",
    "location": { "name": "Grand Hall", "type": "VENUE", "locationTbd": true },
    "dateAndTimeSettings": {
      "startDate": "2026-09-15T19:00:00Z", "endDate": "2026-09-15T22:00:00Z",
      "timeZoneId": "America/New_York", "recurrenceStatus": "ONE_TIME"
    },
    "createdDate": "...", "updatedDate": "..."
  }
}
```

Update, cancel, publish and clone return the same `{ "event": { ... } }`; delete returns
`{ "eventId": "..." }`. Some fields are returned only when the request's `fields` array asks for
them: `"DETAILS"` adds `shortDescription`, `"TEXTS"` adds `description`, `"REGISTRATION"` adds
`registration` (including `rsvp.limit`), `"URLS"` adds `eventPageUrl`. Without `fields`, read the
result from the top-level fields above and do not treat a missing `registration` as an error.

> **Do not add `"draft": true` unless the user asked for a draft.** Draft events require the
> `WIX_EVENTS.READ_DRAFT_EVENTS` permission, and without it every follow-up call fails `403` —
> adding ticket definitions, querying the event, fetching it by slug, even publishing it. The
> event is created, but nothing can be done with it. Create it published and skip the publish
> step entirely.

## Date and time

**`startDate` and `endDate` are ISO-8601 strings** — never `{seconds, nanos}` objects, even where
the schema references `google.protobuf.Timestamp`.

| Rule | If broken |
| --- | --- |
| ISO-8601 strings | `400 Expected a string.` |
| `endDate` is required | `400 endDate.isDefined must be true, event cannot have negative duration` |
| `timeZoneId` is required, in [TZ database](https://www.iana.org/time-zones) form | `400 getTimeZoneId is not supported` |

> The `timeZoneId` error reads as though the field is unsupported. It is not — it means the field
> is **missing**. Add it; do not remove it.

Midnight is `00:00` of the next day. `2026-08-18T24:00:00.000Z` is not a valid ISO time.

**Relative dates** ("next month", "the last Saturday", "this Friday") are counted from today in the
event's time zone. Before creating, write down the local date and weekday you computed and check
them against the request — for example, on 20 October "the last Saturday of next month" is
Saturday 28 November. In JavaScript, `getMonth()` and the month argument of `Date.UTC()` are
0-based, so `getMonth() + 1` passed back to `Date.UTC()` lands a month late. After the create,
`dateAndTimeSettings.formatted.startDate` in the response shows the stored local date; if it
isn't the date you meant, fix it before reporting.

**Date to be announced:** send `dateAndTimeSettings` as
`{ "dateAndTimeTbd": true, "dateAndTimeTbdMessage": "Date coming soon" }` and nothing else. The
message is mandatory — omitting it fails `400 getScheduleTbdMessage must not be a blank`.

## Location

`location.type` is `VENUE` or `ONLINE`. There is no `TBD` type — a to-be-announced location is a
`VENUE` with `locationTbd: true`.

| Body | Result |
| --- | --- |
| `{ "name": "Grand Hall", "type": "VENUE" }` | Accepted, but stored with `locationTbd: true` — the event page shows the name in place of an address, as "to be announced" |
| `{ "name": "Grand Hall", "type": "VENUE", "address": { ... } }` | Accepted — a real venue, `locationTbd: false` |
| `{ "name": "To be announced", "locationTbd": true }` | Accepted — `type` defaults to `VENUE` |
| `{ "locationTbd": true }` | `400 Location address must not be a blank` |
| `{ "name": "TBA", "type": "TBD" }` | `400 type enum must be in [VENUE(0), ONLINE(1)]` |

**Online events:** use `{ "name": "Online", "type": "ONLINE" }`. For video-conference links, add
`"onlineConferencing": { "enabled": true, "type": "MEETING" }` (`WEBINAR` for a webinar) to `event`.
It needs a set date — not while the date is TBD — and a conferencing provider connected to the site.
Without one, `enabled: true` is accepted and **not applied**: the response reads
`onlineConferencing.enabled: false`, `type` `UNKNOWN_CONFERENCE_TYPE`. Check the response; if it is
still `false`, create the event without conferencing and tell the user to connect a provider in the
event's online settings — connecting one isn't possible through this API.

**A venue name alone is a placeholder, not a venue.** When the user gives an address, send it as
`address` so the event has a location and a map link. When they give only a name, create the event
with the name, tell them the location shows as to be announced, and offer to add the street
address — don't hold the event back to ask for it. The `address` shape:
`{ "country": "US", "subdivision": "US-NY", "city": "New York", "postalCode": "10001",
"streetAddress": { "number": "429", "name": "11th Ave" } }` — `subdivision` is the ISO-3166-2
code; the API fills in `formattedAddress` and `geocode`. Read `location.address.formattedAddress`
back and check the city: a short or ambiguous address can geocode to a different place, and the
fix is a fuller address (street number, postal code, `subdivision`).

## Registration type and capacity

`initialType` must be nested under `registration`; at the root of `event` it is treated as
omitted. It accepts exactly two values: **`RSVP`** and **`TICKETING`**.

> Ignore the values the error text and event object list (`TICKETS`, `RSVP_AND_TICKETS`,
> `EXTERNAL`, `NONE`) — each fails `400 ... initialType value is required`.

`initialType` can't be changed later, so pick it from the request: "RSVP", "sign up", "register"
→ `RSVP`; "sell tickets", "paid entry", or several ticket types → `TICKETING`. "Free" alone does not
mean RSVP — a ticketed event can sell `"0"` tickets.

To switch an **existing** event between RSVP and ticketed, don't create anything yet: explain that
a new event would replace it, that its RSVPs or orders would not carry over, and ask first — see
[Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events).

The other registration setups are flags on an RSVP or ticketed event, sent in the same
`registration` object:

| The user wants | `registration` |
| --- | --- |
| Guests RSVP on the site | `{ "initialType": "RSVP" }` |
| Guests buy tickets on the site | `{ "initialType": "TICKETING" }`, then add tickets |
| No registration — an information-only listing | `{ "initialType": "RSVP", "registrationDisabled": true }` |
| Guests register on another website | `{ "initialType": "RSVP", "external": { "url": "https://..." } }` |
| Only site members can register | add `"allowedGuestTypes": "MEMBER"` |

Never send `registration.type` or `registration.status` — they are read-only. If the created
event's `registration.type` is not what the user asked for (ask for it with
`"fields": ["REGISTRATION"]`), apply the flag with an update — do not recreate the event:
`PATCH https://www.wixapis.com/events/v3/events/<EVENT_ID>` with
`{ "event": { "registration": { "registrationDisabled": true } }, "fields": ["REGISTRATION"] }`
(or the `external` / `allowedGuestTypes` value from the table).

**Guest answers (RSVP events).** An RSVP event created without `rsvp.responseType` accepts only
"yes" — a guest or organizer adding a "no" fails `UNEXPECTED_RSVP_STATUS`. Send
`"rsvp": { "responseType": "YES_AND_NO" }` when guests can decline.

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
[Rich Content](https://dev.wix.com/docs/api-reference/assets/rich-content/skills/author-ricos-rich-content). `shortDescription` is returned only
with `"fields": ["DETAILS"]`, `description` only with `["TEXTS"]`; both are stored regardless.

## Ticket tiers

For events created with `"initialType": "TICKETING"`: one call per tier, against the `event.id`
the create call returned, one after another. After adding tickets, wait a few seconds before
reading `registration.status`: it reads `CLOSED_AUTOMATICALLY` until the first ticket is on sale,
then `OPEN_TICKETS`.

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

- **`feeType` is required.** Free ticket (`fixedPrice` of `"0"`): `NO_FEE`. Paid ticket:
  `FEE_ADDED_AT_CHECKOUT` (the guest pays the service fee), or `FEE_INCLUDED` when the user asked to
  absorb it. On `400 INVALID_FEE_TYPE`, read the error's `description`: `feeRequired=false` means
  the site collects no ticket fees — retry that ticket once with `NO_FEE`; `feeRequired=true` means
  `NO_FEE` was sent on a paid ticket — retry once with `FEE_ADDED_AT_CHECKOUT`.
- **`value` is a string** — `"value": 10` fails `400 Unexpected value for field value`. A free
  ticket is a `fixedPrice` of `"0"`.
- Quantity is **`initialLimit`**; omit it for unlimited.

For anything beyond a plain fixed or free price — a donation ticket, several prices in one ticket
(each option needs a generated `optionId`), a sale period or a hidden ticket — and for the full
list of read-only fields, follow [Manage Event Tickets](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-event-tickets#add-a-ticket-type).
Editing, repricing, reordering and deleting tickets are there too.

## Recurring events

Wix Events has **no recurrence rule** — no `RRULE`, no "weekly" pattern. Calculate every
occurrence yourself. The event's own `startDate`/`endDate` are the **first occurrence**, and
`individualEventDates` lists only the **remaining** ones (up to 1000). **Each occurrence needs its
own `timeZoneId`**; omitting it fails with a cryptic `ZoneOffset` error:

```json
"dateAndTimeSettings": {
  "startDate": "2026-10-20T18:00:00.000Z",
  "endDate": "2026-10-20T19:00:00.000Z",
  "timeZoneId": "America/New_York",
  "recurringEvents": {
    "individualEventDates": [
      { "startDate": "2026-10-27T18:00:00.000Z", "endDate": "2026-10-27T19:00:00.000Z", "timeZoneId": "America/New_York" },
      { "startDate": "2026-11-03T19:00:00.000Z", "endDate": "2026-11-03T20:00:00.000Z", "timeZoneId": "America/New_York" }
    ]
  }
}
```

That example creates **three** events: 20 Oct, 27 Oct and 3 Nov. **Do not repeat the first
occurrence inside `individualEventDates`** — it then exists twice (four events for three dates, one of
them marked `RECURRING_UPCOMING`). Leaving out the top-level `startDate`/`endDate` fails `400`.

**Work out each occurrence's date in the event's own time zone, then convert to UTC.** "Every
Thursday 7–9pm Pacific" is Thursday 19:00 in `America/Los_Angeles` — which is Friday 02:00 or 03:00
UTC, depending on daylight saving. Deriving the weekday from the UTC date, or applying one fixed
offset across a daylight-saving change, puts occurrences on the wrong day or hour. Check the local
weekday of every generated `startDate` before sending.

Don't query for an existing series before creating unless the user says one may exist — the
read-back below is the one check this flow needs.

Before creating, tell the user how many occurrences you will create and that each one is listed as
its own event, with its own registration or tickets. Pick a sensible horizon for "weekly".

**Then read the series back — always, before answering.** The create response carries only the
first occurrence (`recurrenceStatus: "RECURRING"`), with the series'
`dateAndTimeSettings.recurringEvents.categoryId`. Wait a few seconds, then:

```json
POST https://www.wixapis.com/events/v3/events/query
{ "query": { "filter": { "dateAndTimeSettings.recurringEvents.categoryId": { "$eq": "<CATEGORY_ID>" } }, "paging": { "limit": 100 } } }
```

Report `pagingMetadata.total` — the number of events that exist — not the number you intended. If
it is lower, wait a few seconds and query once more; occurrences appear shortly after the first.
Don't count by title: other events can share it.
Each occurrence is its own event with its own `id`: to change or cancel one later, find the
occurrence by its `startDate` and act on that `id` only ([Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events)).

## Gotchas & troubleshooting

- **An invalid enum value reports as a missing one** — `<field> value is required` rather than
  "invalid value". If a field you *did* send is reported as required, suspect the value.
- **`registration.type` / `registration.status` in a request do nothing** — they are read-only and
  dropped without an error. Use `registrationDisabled` or `external.url`.
- **Error text names internal accessors**: `getTimeZoneId`, `getScheduleTbdMessage`,
  `endDate.isDefined` each map to the plain field of the same name.

## Related APIs
- **Wix Events V3**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3)
- **Ticket Definitions V3**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3)
- [Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events) — registration settings, publish, cancel, delete, clone, update, count
- [Manage Event Tickets](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-event-tickets) — edit, hide, reorder and price tickets
