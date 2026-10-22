---
name: "Manage Wix Events — Publishing, Cancelling, Cloning and Counting"
description: "Operates on Wix events that already exist with the Wix Events V3 API — finding, updating (date, venue, details, page settings), controlling registration (close, reopen, registration-free, external, members-only, limits), switching between RSVP and ticketed (a new event — ask before creating it), publishing, cancelling, deleting, cloning and counting, including single occurrences of a recurring event. Use to close registration, move or cancel an event, or change how guests register."
---

# Manage Wix Events — Publishing, Cancelling, Cloning and Counting

## Goal
Operate on events that already exist. Creating an event — including its date, location,
description, guest limit and recurring occurrences — is [Create an Event](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/create-event).
Ticket types and prices use the [Ticket Definitions V3 API](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3); guests, RSVPs, orders and
check-in use the [RSVP V2](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2) and [Ticketing](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing) APIs —
this recipe doesn't manage ticket prices, sale periods, guests, RSVPs, orders or check-in (it only
makes the couple of ticket-definition calls that registration state depends on).

**Switching an event between RSVP and ticketed creates a new event, so it is two turns:** explain and
ask in the first, create only after the user says yes — see
[Switch an event between RSVP and ticketed](#switch-an-event-between-rsvp-and-ticketed).

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
`400 appInstance must not be empty`. See [Install Wix Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/install-wix-apps).

## Find an event

Every action below takes an `eventId` ([Query Events](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events)
is the reference for this call). When the user names the event instead, look it up with
`POST https://www.wixapis.com/events/v3/events/query` — `title` supports `$eq` and, for several names at once, `$in`; there is
no contains match:

```bash
curl -X POST 'https://www.wixapis.com/events/v3/events/query' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "query": {
      "filter": { "title": { "$eq": "Open House" } },
      "paging": { "limit": 100 }
    },
    "fields": ["DETAILS", "REGISTRATION"]
  }'
```

- **Send this body as it is** — no extra filter fields and no `sort`; a nested `registration`
  filter or a `sort` inside `filter` fails `400`. `filter` and `paging` are siblings under `query`; `paging` nested
  inside `filter` fails `400`.
- **Don't add `includeDrafts`.** `true` needs the draft-events permission and fails `403`; the
  default already returns every published event.
**Always send `paging.limit`** — its default is `0`, which returns no events. Matches come back in
`events[]` with the id at `events[].id`, and `pagingMetadata.total` is the count. Other filterable
fields: `status` (`UPCOMING`, `STARTED`, `ENDED`, `CANCELED`, `DRAFT`), `registration.initialType`,
`dateAndTimeSettings.startDate`, `slug`, `id`.

**One title can match several events** — every occurrence of a recurring event shares the title,
and duplicated events keep it too. When more than one comes back, pick by
`dateAndTimeSettings.startDate` and `status` if the user named a date; otherwise list the matches
with their dates and ask which one. Never act on all of them unless the user asked for the series.

Only when the user asks about **draft** events, add `"includeDrafts": true`. If that returns
`403 Requires WIX_EVENTS.READ_DRAFT_EVENTS permission`, say draft events are not readable from this
connection rather than answering from published events alone.

## Registration settings

Change registration with `PATCH https://www.wixapis.com/events/v3/events/{event.id}` and the
change under `event.registration` — never through ticket sale periods, and never by cancelling.

```bash
curl -X PATCH 'https://www.wixapis.com/events/v3/events/<EVENT_ID>' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "event": { "registration": { "registrationPaused": true } },
    "fieldmask": "registration.registrationPaused",
    "fields": ["REGISTRATION"]
  }'
```

**Updates merge: only the fields you send change.** A `fieldmask` — a comma-separated string with
the dotted path of each field you send (`registration.rsvp.limit,registration.rsvp.waitlistEnabled`) —
is optional for registration settings: every row of the table below, including the nested `rsvp`
and `tickets` objects, applies without one; the examples include it anyway. It is **required in two
cases** only: changing the `location` (see [Update an event](#update-an-event) — without a mask the
call returns `200` and the location does not change), and **clearing** a field, which you do by
listing its path and leaving it out of the body.

| The user wants | Under `event.registration` |
| --- | --- |
| Close / stop / pause registration, keep the event | `"registrationPaused": true` |
| Reopen registration | `"registrationPaused": false` |
| No registration — the event is information-only | `"registrationDisabled": true, "registrationPaused": false` |
| Guests register on another website | `"external": { "url": "https://..." }, "registrationPaused": false` |
| Back to registering on the site, from information-only (`type` `NONE`) | `"registrationDisabled": false` |
| Back to registering on the site, from external (`type` `EXTERNAL`) | send `"registration": {}` with `"fieldmask": "registration.external.url"` — `type` returns to `RSVP` or `TICKETING` |
| Only site members can register | `"allowedGuestTypes": "MEMBER"` (`VISITOR_OR_MEMBER` for everyone) |
| RSVP guest limit / waitlist | `"rsvp": { "limit": 50, "waitlistEnabled": true }` — the waitlist needs a limit; to remove the limit, mask `registration.rsvp.limit` with no value in the body and also send `"waitlistEnabled": false` (the waitlist flag is not reset for you) |
| RSVP answers offered | `"rsvp": { "responseType": "YES_ONLY" }` or `"YES_AND_NO"` — an event created without a `responseType` accepts only "yes" (a "no" RSVP fails `UNEXPECTED_RSVP_STATUS`) |
| RSVP registration opens / closes on dates | `"rsvp": { "startDate": "<ISO>", "endDate": "<ISO>" }` — both together; to remove the dates, mask both with no values |
| Tickets per order, reservation hold, tax | `"tickets": { "ticketLimitPerOrder": 10, "reservationDurationInMinutes": 15, "taxSettings": { "type": "ADDED_AT_CHECKOUT", "name": "VAT", "rate": "21" } }` |
| One registration form per ticket holder | `"tickets": { "guestsAssignedSeparately": true }` |

Limits: `ticketLimitPerOrder` 0–50 (default 20), `reservationDurationInMinutes` 5–30, tax `rate` a
decimal string, tax `name` 1–10 characters, tax `type` `INCLUDED_IN_PRICE` or `ADDED_AT_CHECKOUT`.

**Before closing registration**, read `status` and `registration` (`"fields": ["REGISTRATION"]`):
- `status` `ENDED` or `CANCELED` — there is nothing to close; say so.
- `registration.type` `NONE` or `EXTERNAL` — the event has no on-site registration to close; say so,
  and offer to switch it back to on-site registration first.
- `registration.status` `CLOSED_AUTOMATICALLY` — registration is already closed (sold out or past);
  say so rather than setting the flag.
- a ticketed event with no ticket types yet reads `CLOSED_AUTOMATICALLY` too — nobody can register,
  so there is nothing to close. Don't create a ticket to change that. Tell the user, and set
  `registrationPaused: true` so registration stays closed if tickets are added later.

**Pause vs disable.** "Close registration", "stop sign-ups" or "no more guests" →
`registrationPaused: true`. "Guests don't need to register" → `registrationDisabled: true`.

**Read back and report the result.** Ask for `registration` in the response with
`"fields": ["REGISTRATION"]`, as above, and confirm **the flag you sent comes back with the new
value** — `registration.registrationPaused: true`, `registrationDisabled: true`, or the
`external.url`. If it doesn't, the change did not apply: say so. Then report the derived fields:

| You sent | Expect |
| --- | --- |
| `registrationPaused: true` | `type` unchanged (`RSVP` / `TICKETING`); `status` `CLOSED_MANUALLY` — "Closed" in the dashboard's events list |
| `registrationPaused: false` | `status` back to `OPEN_RSVP`, `OPEN_RSVP_WAITLIST_ONLY` or `OPEN_TICKETS` (`SCHEDULED_RSVP` if RSVP dates are set in the future) |
| `registrationDisabled: true` | `type` `NONE`, `status` `UNKNOWN_REGISTRATION_STATUS` — "No registration" in the dashboard |
| `external.url` | `type` `EXTERNAL`, `status` `OPEN_EXTERNAL` |

Read `type` first, then `status`: `type` `NONE` means registration-free whatever the `status`.
Report `CLOSED_MANUALLY` as paused and `CLOSED_AUTOMATICALLY` as sold out, past, or a ticketed event
with no tickets — go by this table, not the reference's enum note on `CLOSED_MANUALLY`.

> **Never write `registration.type`, `registration.status` or `registration.initialType`.** Use the
> flags in the table. A PATCH that sets `"type": "NONE"` alone fails `400` with an unrelated date
> message (`startDate.isDefined must be true … getTimeZoneId is not supported`); inside a full event
> body it is ignored.

Ticket currency is a ticket-definition call, not an event field:
`POST https://www.wixapis.com/events/v3/ticket-definitions/currency` with
`{ "eventId": "<EVENT_ID>", "currency": "EUR" }` ([Change Currency](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/change-currency)).

## Switch an event between RSVP and ticketed

`registration.initialType` can't be changed, and ticket calls on an RSVP event fail
`428 INVALID_EVENT_TYPE`. For "make it free" don't switch — add a free ticket
(a `fixedPrice` of `"0"` with `feeType` `NO_FEE`, as in [Create an Event](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/create-event#ticket-tiers)).

**Turn 1 — explain and stop.** Find the event and confirm its type (one query). Then reply, and
end your turn with a question. Make **no** create, update or ticket call in this turn — "switch it"
or "convert it" is not the confirmation, because the result is a different event. Tell the user:
- the existing event can't be converted, so a new event would be created;
- RSVPs or orders on the original are **not** carried over;
- the original stays as it is until they decide to cancel or delete it;
- for a ticketed copy: which ticket names and prices to create (ask if they didn't say).

End the reply with the offer and the question, for example: "I can create a ticketed copy of Gala
with the same date, venue and description. Which tickets should it have, and at what price? Shall
I go ahead?"

**Turn 2 — only after the user replies yes:**

1. `GET https://www.wixapis.com/events/v3/events/<EVENT_ID>?fields=DETAILS&fields=TEXTS&fields=REGISTRATION`
   — read `title`, `location`, `dateAndTimeSettings`, `shortDescription`, `description`,
   `mainImage` and the `registration` settings.
2. `POST https://www.wixapis.com/events/v3/events` with those fields copied and
   `registration.initialType` set to the other type, as in
   [Create an Event](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/create-event#create-the-event). Do not copy `registration.type`,
   `registration.status`, `id`, `slug` or any read-only field.
3. For a ticketed copy, create the tickets against the **`event.id` returned by step 2** — not by
   querying the title again, which also matches the original RSVP event.
4. If the original had an agenda, policies or categories, copy them with the
   [Schedule Items](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/schedule-items), [Policies V2](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/policies-v2) and [Categories](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories) APIs.
5. Ask whether to cancel or delete the original. Do neither without a yes.

## Publish, cancel and delete

| Action | Call | Resulting `status` |
| --- | --- | --- |
| Publish a draft | `POST https://www.wixapis.com/events/v3/events/{eventId}/publish` | `UPCOMING` |
| Cancel | `POST https://www.wixapis.com/events/v3/events/{eventId}/cancel` | `CANCELED` |
| Delete | `DELETE https://www.wixapis.com/events/v3/events/{eventId}` | — |
| Cancel several | `POST https://www.wixapis.com/events/v3/bulk/events/cancel-by-filter` | `CANCELED` |
| Delete several | `POST https://www.wixapis.com/events/v3/bulk/events/delete-by-filter` | — |

Publish and cancel take an empty body, and neither can be undone.

**Cancel only when the user says the event is not happening** — it can email every registered
guest and can't be reopened. When they want registration closed but the event to go ahead, pause
registration instead (see [Registration settings](#registration-settings)). To bring a cancelled
event back, clone it ([Clone an event](#clone-an-event)) — the copy comes back live unless the clone
body sends `"draft": true`, so don't publish it again. Cancelled events stay in Query Events results — filter
by `status` to leave them out. `publish` on a cancelled event fails `428 EVENT_ALREADY_PUBLISHED`.

Publish, cancel, clone and update all return `{ "event": { "id", "title", "slug", "status", ... } }`
— the same event object [Create an Event](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/create-event#create-the-event) shows in full.
Delete returns `{ "eventId": "..." }` and the bulk calls return `{}`.

To cancel or delete a set of events in one call, send the ids to the bulk endpoint:

```json
{ "filter": { "filter": { "id": { "$in": ["<EVENT_ID>", "<EVENT_ID>"] } } } }
```

The conditions go two levels deep, `filter.filter.<field>`; a single level fails
`400 filter.filter must not be empty`. Resolve the ids with the query above first, and filter by
`id` rather than by `title`, so only the events you resolved are affected. **A bulk delete removes
events that have sold tickets or RSVPs, with no further warning** — check the
events' guests ([Query Event Guests](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/event-guests/query-event-guests)) and get the
user's confirmation first. Bulk calls
return `{}` with no per-event result, and a read straight afterwards can still show the events —
events with many guests or orders can take ten seconds or more. **Query the same ids again** every
couple of seconds for up to about twenty, then report what is actually gone or cancelled; if any
remain, delete or cancel those one by one.

> **Draft events need the `WIX_EVENTS.READ_DRAFT_EVENTS` permission.** Without it, publishing a
> draft fails `403` — as does querying it, fetching it by slug, or adding ticket definitions to
> it. If you hit that `403`, the event was still created; the way forward is to create events
> already published rather than as drafts, which needs no publish step at all. See
> [Create an Event](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/create-event).

## Recurring events — one occurrence or the whole series

Each occurrence of a recurring event has its own `id`; occurrences share a title and
`dateAndTimeSettings.recurringEvents.categoryId`.

- **One occurrence** ("cancel this Friday's class", "move the 12th to 7pm"): find the occurrence
  whose `dateAndTimeSettings.startDate` matches, and cancel, delete or update **that `id` only**.
  The other occurrences are untouched.
- **The whole series**: read one occurrence's `dateAndTimeSettings.recurringEvents.categoryId`, then
  list the series with `"filter": { "dateAndTimeSettings.recurringEvents.categoryId": { "$eq": "<CATEGORY_ID>" } }`
  in Query Events (or `GET https://www.wixapis.com/events/v3/events/category/<CATEGORY_ID>?paging.limit=100`).
  Then update each one, or cancel/delete them with the bulk call and `id.$in`. Updates go one call
  per occurrence; on `429`, wait and retry that call rather than moving on, and count the successes
  before reporting.
- A date or time change on one occurrence sends just that occurrence's `dateAndTimeSettings`.

After deleting a whole series, also delete its hidden category (`states` include `RECURRING_EVENT`,
named after the title)
(`DELETE https://www.wixapis.com/events/v1/categories/<CATEGORY_ID>`, id from the categories query).

Before cancelling or deleting more than one occurrence, list the dates that will be affected and
which of them have sold tickets or RSVPs ([Query Event Guests](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/event-guests/query-event-guests)), and
get the user's confirmation.

## Clone an event

`POST https://www.wixapis.com/events/v3/events/{eventId}/clone` with an empty body copies the registration form,
notifications, translations, descriptions and ticket configuration.

> **The clone is published, and it does not keep the original's date.** Unless the body says
> `"draft": true` it comes back `UPCOMING` — live on the site — with its start moved to roughly 14
> days from now (same time of day), and the title gets " (1)" appended. Cloning a cancelled event
> gives a fresh, open event.

To make the copy right in one call, send overrides in the clone body:

```json
{
  "event": {
    "title": "Spring Fair — second weekend",
    "dateAndTimeSettings": { "startDate": "2030-10-01T16:00:00.000Z", "endDate": "2030-10-01T19:00:00.000Z", "timeZoneId": "Europe/Dublin" }
  }
}
```

A title alone, or a title with both dates and `timeZoneId`, works. Overriding `registration` fails
`400` with a misleading date message — a clone keeps the original's `registration.initialType` and
cannot switch RSVP and ticketed (see [Switch an event between RSVP and ticketed](#switch-an-event-between-rsvp-and-ticketed)).
The copy comes back live. Add `"draft": true` only when the user asks for an unpublished copy
("don't publish it yet", "so I can review it first") — a draft also needs the draft-events
permission for every later call on it.

Then check the result's local time: `dateAndTimeSettings.formatted.startTime` in the response must
equal the original's (and the date must be the one asked for). If it doesn't, your UTC conversion
was off — fix the dates with an update before reporting.

## Update an event

`PATCH https://www.wixapis.com/events/v3/events/{event.id}` with the fields to change nested under `event`
([Update Event](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/update-event) is the reference for this call):

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

The Events API takes **no `revision`** on update — a `revision`, if you send one, is ignored rather
than rejected. Send only the fields you are changing: title, descriptions, slug, guest-list and
display settings, dates and registration settings all apply as sent. The exceptions that need a
`fieldmask` are the venue and clearing a field (see below and
[Registration settings](#registration-settings)).

**Moving a date: send `startDate` and `endDate` together.** With `startDate` alone, a move to a
later day puts the start after the stored end and fails `400 event cannot have negative duration`.
`timeZoneId` is optional here, unlike on create; the stored one is kept. Express the
times in the event's own time zone before converting to UTC — see
[Create an Event](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/create-event#date-and-time).
After the update, the response's `dateAndTimeSettings.formatted.startTime` must still be the original
local time when the user asked for the same time; if not, correct it before reporting.

**Changing the venue needs a `fieldmask`.** The reference schema does not list `fieldmask` — send it
anyway. Without it a `location` update returns `200` but saves only the name: the address is dropped
and `locationTbd` stays `true`. Send the venue with this mask:

```bash
curl -X PATCH 'https://www.wixapis.com/events/v3/events/<EVENT_ID>' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "event": {
      "location": {
        "name": "Grand Hall", "type": "VENUE", "locationTbd": false,
        "address": { "country": "IE", "city": "Dublin", "postalCode": "D02 X285",
                     "streetAddress": { "number": "1", "name": "Grafton Street" } }
      }
    },
    "fieldmask": "location.locationTbd,location.name,location.type,location.address",
    "fields": ["DETAILS"]
  }'
```

Read `location` back: `locationTbd` must be `false` and `address.formattedAddress` present. The
address is geocoded, so `formattedAddress` can differ from what the user typed (a nearby building
or the street's local-language name) — confirm the city matches, and if it is a different place,
say so and resend a fuller address (street number, postal code, `subdivision`).

**Event page settings** go through the same `PATCH`, under `event`:

| The user wants | Send under `event` | Read back with `fields` |
| --- | --- | --- |
| A different event URL | `"seoSettings": { "slug": "summer-gala-2027" }` | `SEO_SETTINGS` |
| Show the guest list to guests | `"guestListSettings": { "displayedPublicly": true }` | — |
| Hide the "details" button (registration-free events only) | `"eventDisplaySettings": { "hideEventDetailsButton": true }` | — |
| No event details page | `"eventDisplaySettings": { "hideEventDetailsPage": true }` — with external registration, visitors go straight to the external page | — |
| Video conferencing for an online event | `"onlineConferencing": { "enabled": true, "type": "MEETING" }` (`WEBINAR` for a webinar) — needs a connected conferencing provider, see below | `ONLINE_CONFERENCING_SESSION` |

- The URL slug is `seoSettings.slug` — the top-level `slug` is read-only. Lowercase letters,
  numbers and hyphens only (`400 INVALID_SLUG_FORMAT`), up to 130 characters, unique on the site
  (`428 SLUG_ALREADY_IN_USE`). The old URL redirects unless
  `seoSettings.advancedSeoData.settings.preventAutoRedirect` is `true`.
- Online conferencing needs a set date — not while the date is TBD — and a connected conferencing
  provider. On a site with none, `enabled: true` is accepted and **not applied**: the response
  still reads `onlineConferencing.enabled: false`, `type` `UNKNOWN_CONFERENCE_TYPE`. Check the
  response; if it is still `false`, tell the user to connect a provider in the event's online
  settings instead of reporting it done. Reading the join links needs the
  `ONLINE_CONFERENCING_SESSION` fieldset and its permission.

The agenda, policies and categories use the [Schedule Items](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/schedule-items), [Policies V2](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/policies-v2) and [Categories](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories) APIs.

Ticket definitions are the exception to the no-`revision` rule — their update *does* require the
current `revision` ([Update Ticket Definition](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/update-ticket-definition)).

## Count events

`POST https://www.wixapis.com/events/v3/events/query` and read `pagingMetadata.total`:

```json
{ "query": { "paging": { "limit": 100 } } }
```

Query Events returns every event that is not a draft — upcoming, started, **ended and cancelled
ones included** — so the total is not "upcoming events". Add `"filter": { "status": { "$eq": "UPCOMING" } }`
(or `$in` for several statuses) to count what the user means. **Drafts are excluded from both the
results and the total**, and including them needs `includeDrafts: true` and the draft permission
above. Each occurrence of a recurring event counts as one event.

To get a breakdown, `POST https://www.wixapis.com/events/v3/events/count-by-status` with a `facet`:

```json
{ "facet": ["status"] }
```

returns `pagingMetadata.total` and `facets.status.counts`, for example
`{ "UPCOMING": 4, "CANCELED": 3, "ENDED": 1 }`. Without `facet` the `facets` object comes back
empty. It takes the same `filter` as Query Events.

## Gotchas & troubleshooting

- **A `200` on update does not prove the change applied** — read-only fields in the body are
  dropped silently. Confirm from the returned event before telling the user it's done.
- **An invalid enum value reports as a missing one** — a value outside an enum returns
  `<field> value is required` rather than "invalid value". If a field you *did* send is reported
  as required, suspect the value, not its presence.
- **`includeDrafts` stays `false` unless the request is about drafts** — see
  [Find an event](#find-an-event). The `WIX_EVENTS.READ_DRAFT_EVENTS` note on the Query Events
  reference describes the permission; it does not mean the caller has it.
- Dates are always ISO-8601 strings, never `{seconds, nanos}`, and `timeZoneId` is required
  whenever `dateAndTimeSettings` is sent on create — see [Create an Event](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/create-event).

## Related APIs
- **Wix Events V3**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3) — [Update Event](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/update-event)
- [Create an Event](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/create-event) — create body, dates, location, capacity, recurring
- **Ticket Definitions V3**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3) — ticket types, prices, sale periods, currency
- **RSVP V2** and **Ticketing**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2), [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing) — RSVPs, ticket holders, orders, check-in
- **Events Form**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/form) — form questions and registration messages
- **Schedule Items**, **Policies V2**, **Categories**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/schedule-items), [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/policies-v2), [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories) — agenda, policies, categories
