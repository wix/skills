---
name: "Manage Event Guests"
description: "Manages the people registered for a Wix event — RSVPs on RSVP events, and orders, tickets and ticket holders on ticketed events: listing and counting guests, adding or removing a guest, changing an RSVP, checking guests in, and marking orders paid. Use when the user asks who is coming or how many registered, or wants to add, remove or check in a guest. Notes what the API can't do, such as refunds and resending emails."
---

# Manage Event Guests

## Goal
Read and change who is registered for an event. How guests are stored depends on the event's
`registration.initialType`:

| Event type | Guests are | API |
| --- | --- | --- |
| `RSVP` | RSVPs — one per person who responded, with up to 10 additional guests each | RSVP V2, `https://www.wixapis.com/events/v2/rsvps` |
| `TICKETING` | Orders (the buyer) containing tickets (one per attendee) | Orders and Tickets, `https://www.wixapis.com/events/v1/...` |
| either | A combined read-only guest view | Event Guests, `https://www.wixapis.com/events/v2/guests/query` |

Find the event and its type first — this exact body:

```bash
curl -X POST 'https://www.wixapis.com/events/v3/events/query' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "query": {
      "filter": { "title": { "$eq": "<EVENT_TITLE>" } },
      "paging": { "limit": 100 }
    },
    "fields": ["REGISTRATION"]
  }'
```

- `paging` is a sibling of `filter` inside `query`; nested inside `filter` it fails `400`.
- Send it as is: no extra filter fields and no `sort` — a nested `registration` filter or a `sort`
  inside `filter` fails `400`. Read the type and dates from the result instead.
- Don't send `includeDrafts` — `true` needs a draft-events permission and fails `403`.
- The id is `events[].id`, the type `events[].registration.initialType`. If several events match,
  pick by date or ask ([Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events#find-an-event)).

Registration rules (closing registration, guest limit, waitlist)
are event settings under `event.registration`, changed with `PATCH https://www.wixapis.com/events/v3/events/<EVENT_ID>` ([Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events)).

**Find the event first, then work only on its branch.** Its `registration.initialType` decides
everything below: `RSVP` uses only the RSVP calls, `TICKETING` only the ticketing ones. Look up
schemas only for the calls of that branch — never prepare both.

**Reference pages for the calls below** — the full contract of each; use these rather than
searching for them:

| Call | Reference |
| --- | --- |
| Find the event | [Query Events](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events), [Get Event](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/get-event) |
| Guests, any event | [Query Event Guests](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/event-guests/query-event-guests) |
| RSVP events | [Search RSVPs](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/search-rsvps), [Get RSVP](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/get-rsvp), [Create RSVP](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/create-rsvp), [Update RSVP](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/update-rsvp), [Delete RSVP](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/delete-rsvp) |
| Ticketed events | [Create Ticket Reservation](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/ticket-reservations/create-ticket-reservation), [Checkout](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/checkout), [List Orders](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/list-orders), [List Tickets](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/tickets/list-tickets) |
| Ticketed events: ticket types | [Query Ticket Definitions](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/query-ticket-definitions), [Create Ticket Definition](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/create-ticket-definition) |

Follow only the branch for the event's type: an RSVP event never needs the ticketing calls.

## Prerequisite — the Wix Events app

Every call here returns `428 WIX_EVENTS_APP_NOT_INSTALLED` on a site without the Wix Events app.
Install it with appDefId `140603ad-af8d-84a5-2c80-a0f60cb47351`:
`POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install` with
`{"tenant":{"tenantType":"SITE","id":"<SITE_ID>"},"appInstance":{"appDefId":"140603ad-af8d-84a5-2c80-a0f60cb47351"}}` —
`appDefId` nests under `appInstance`. See [Install Wix Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/install-wix-apps).

## List an event's guests

**Any event — the combined view.** `POST https://www.wixapis.com/events/v2/guests/query`:

```bash
curl -X POST 'https://www.wixapis.com/events/v2/guests/query' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "query": {
      "filter": { "eventId": "<EVENT_ID>", "attendanceStatus": "ATTENDING" },
      "cursorPaging": { "limit": 100 }
    },
    "fields": ["GUEST_DETAILS", "GUEST_TOTAL"]
  }'
```

Each of `guests[]` has `guestType` (`RSVP`, `BUYER` or `TICKET_HOLDER`), `attendanceStatus`
(`ATTENDING`, `NOT_ATTENDING`, `IN_WAITLIST`), `rsvpId` or `orderNumber`/`ticketNumber`,
`contactId`, `totalGuests` (only with `GUEST_TOTAL`), and — with `GUEST_DETAILS` —
`guestDetails.{firstName, lastName, email, phone, formResponse, checkedIn}`. Without
`GUEST_DETAILS` the names and emails are not returned; without `GUEST_TOTAL` there is no
`totalGuests` to count with. Page with `pagingMetadata.cursors.next`.

**Count people, not records.** On a ticketed event a buyer appears once as `BUYER` and once per
ticket as `TICKET_HOLDER`, so one order of 2 tickets is 3 guest records. To count attendees, filter
`"guestType": "TICKET_HOLDER"` (ticketed) or sum `totalGuests` over `RSVP` guests with
`ATTENDING` (RSVP), and say which you counted.

Attendance mapping: an RSVP `YES` is `ATTENDING`, `WAITLIST` is `IN_WAITLIST`, `NO` is
`NOT_ATTENDING`; an order that is `PAID`, `FREE` or `OFFLINE_PENDING` is `ATTENDING`, and `PENDING`
is `NOT_ATTENDING`.

**Confirm a change from its response, not a search.** The RSVP search lags a few seconds behind
writes; to read back a guest you just added or changed, use the create or update response or the
single `GET`, or wait a few seconds before searching.

**RSVP events — with form answers.** `POST https://www.wixapis.com/events/v2/rsvps/search`:

```json
{
  "search": {
    "filter": { "eventId": "<EVENT_ID>", "status": "YES" },
    "search": { "expression": "jane", "fields": ["firstName", "lastName", "email"] },
    "cursorPaging": { "limit": 100 }
  },
  "fields": ["DETAILS", "CONTACT_DETAILS", "FORM"]
}
```

`rsvps[]` carry `id`, `revision`, `status`, `firstName`, `lastName`, `email` (with
`CONTACT_DETAILS`), `form.inputValues` (with `FORM`), `totalGuests`, `guestList.guests[]` (each
with an integer `guestId` and `checkInDetails`), and `fullyCheckedIn`. Drop `search.search` to list
everyone. Totals per event: `GET https://www.wixapis.com/events/v2/rsvps/summaries?eventId=<EVENT_ID>`
returns `yesGuestCount`, `noGuestCount`, `waitlistGuestCount`, `totalRsvpCount`.

**Ticketed events — orders and tickets.**
- Orders: `GET https://www.wixapis.com/events/v1/orders?eventId=<EVENT_ID>&fieldset=DETAILS&fieldset=TICKETS&limit=100`
  — `orders[]` with `orderNumber`, `fullName`, `email`, `status`, `ticketsQuantity`, `totalPrice`,
  `tickets[]`. Add `&fieldset=FORM` for the buyer's form answers, `&status=OFFLINE_PENDING` to list
  unpaid pay-at-the-door orders, `&searchPhrase=<name or email>` to find one.
- Tickets: `GET https://www.wixapis.com/events/v1/tickets?eventId=<EVENT_ID>&fieldset=GUEST_DETAILS&fieldset=TICKET_DETAILS&limit=100`
  — `tickets[]` with `ticketNumber`, `orderNumber`, `ticketDefinitionId`, `name`, `guestFullName`,
  `checkIn`, `orderStatus`. Add `&fieldset=GUEST_FORM` for each ticket holder's answers (filled only
  when the event collects one form per ticket); otherwise the answers are on the order's `FORM`.
- Sales totals: `GET https://www.wixapis.com/events/v1/orders/summary?eventId=<EVENT_ID>`.

These two are `GET` list calls with repeated query parameters — there is no `POST .../query` for
orders or tickets. Exclude archived ones with `&tag=NON_ARCHIVED` (orders) or
`&state=ORDER_ACTIVE&state=TICKET_ACTIVE` (tickets). Both page by offset: the response carries
`total`, `offset` and `limit`; repeat the call with `&offset=<offset + limit>` until you have
`total` items, and don't report a list or count as complete before then.

## Add a guest manually

A request that names both the guest and the event is the user's explicit instruction to add
them — proceed without asking again. Ask first when the event or the guest is ambiguous, for a
mandatory form answer you don't have, or which ticket to use when it isn't clear. Send the usual
confirmation email unless the user said not to.

Take the branch from the event's `registration.initialType` (from the find query) and read only
that branch: an RSVP event never needs ticket definitions, reservations or checkout.

**RSVP event.** The two calls below are complete for adding a guest — no schema lookup is needed.
1. `GET https://www.wixapis.com/events/v3/events/<EVENT_ID>?fields=FORM` — read
   `event.form.controls[].inputs[]` for each input's `name`, `mandatory` flag and `options`.
2. `POST https://www.wixapis.com/events/v2/rsvps`:

```bash
curl -X POST 'https://www.wixapis.com/events/v2/rsvps' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "rsvp": {
      "eventId": "<EVENT_ID>",
      "firstName": "Jane",
      "lastName": "Doe",
      "email": "jane@example.com",
      "status": "YES",
      "form": {
        "inputValues": [
          { "inputName": "firstName", "value": "Jane" },
          { "inputName": "lastName", "value": "Doe" },
          { "inputName": "email", "value": "jane@example.com" }
        ]
      },
      "disableNotifications": false
    }
  }'
```

- On a form with only the built-in name and email, `form` is optional — the top-level `firstName`,
  `lastName` and `email` are enough. Once the form has extra questions, `form.inputValues` must
  use the input names from step 1 and include every mandatory one — otherwise
  `400 INVALID_FORM_RESPONSE` (for example `input custom [''] must not be empty`). Ask the user for
  mandatory answers you don't have, or send `"ignoreFormValidation": true` in `options` if they
  want the guest added without them.
- **Duplicates are not reliably rejected** — a second RSVP with the same email can be created
  without an error. Before adding, search the event's RSVPs for that email (the `rsvps/search` call
  above, with `search.expression`). Only if that finds one, change it instead of adding another
  (Get and Update RSVP below); otherwise go straight to the create.
- For a guest bringing others, add `{ "inputName": "additionalGuests", "value": "2" }` and
  `{ "inputName": "guestNames", "values": ["Pat Lee", "Sam Lee"] }` to `inputValues`, and
  `"additionalGuestDetails": { "guestCount": 2, "guestNames": ["Pat Lee", "Sam Lee"] }` — only when
  the form has an additional-guests control. The RSVP then counts as 3 people: `totalGuests` 3
  and one `guestList.guests[]` entry each (ids 1, 2, 3; ask for them with `"fields": ["DETAILS"]`),
  and the event's `yesGuestCount` goes up by 3 while `totalRsvpCount` goes up by 1. A count above the
  control's `maxGuests` fails `400 INVALID_FORM_RESPONSE`; a count without names fails
  `400 ADDITIONAL_GUESTS_MUST_HAVE_NAMES`.
- **Full event.** A "yes" for a full event fails `428 RSVPS_CLOSED` — whether or not it has a
  waitlist. Offer the user the waitlist first: send `"status": "WAITLIST"` (works when
  `waitlistEnabled` is on). If they want the guest to take a place anyway, retry once with **both**
  `"options": { "ignoreLimits": true, "ignoreResponseStatus": true }` — `ignoreLimits` alone still
  fails `RSVPS_CLOSED`, and `ignoreResponseStatus` alone fails `GUEST_LIMIT_EXCEEDED` ("guest
  limit … exceeded").
- **Closed or not-yet-open registration** fails `428 RSVPS_CLOSED` / `RSVPS_NOT_STARTED`; if the
  user wants the guest added anyway, retry once with `"options": { "ignoreResponseStatus": true }`.
  In both cases tell the user the limit or closed registration was overridden. Don't send these
  options up front.
- `disableNotifications: true` turns notifications off for this RSVP. The API records the flag but
  doesn't report whether an email went out, so tell the user notifications were turned off rather
  than that no email was sent.
- `428 MEMBER_ALREADY_REGISTERED` / `MEMBER_EMAIL_ALREADY_REGISTERED` — an RSVP for this member or
  email already exists; find it with the search above and change it instead.
- `400 UNEXPECTED_RSVP_STATUS` — the event only accepts "yes" (`rsvp.responseType` `YES_ONLY`, the
  default); to record a "no", switch it with `PATCH https://www.wixapis.com/events/v3/events/<EVENT_ID>` and
  `{ "event": { "registration": { "rsvp": { "responseType": "YES_AND_NO" } } } }`.
- `428 INVALID_EVENT_TYPE` — the event is ticketed; use the ticket flow below.

**Ticketed event.** A manual guest is a reservation followed by a checkout:

1. Pick the ticket definition ([Manage Event Tickets](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-event-tickets#list-an-events-tickets)).
   For complimentary guests ("free", "comp", "on the guest list") use a **free** ticket
   (`fixedPrice.value` `"0"`, `feeType` `NO_FEE`). If the event has none, offer to create a hidden
   free ticket for them; never put comp guests on a paid ticket.
2. `POST https://www.wixapis.com/events/v1/ticket-reservations`:

```json
{
  "ticketReservation": {
    "tickets": [ { "ticketDefinitionId": "<TICKET_DEFINITION_ID>", "quantity": 2 } ],
    "additionalReservationSettings": { "enableHiddenTicketReservation": true }
  }
}
```

   - `additionalReservationSettings` goes **inside** `ticketReservation`. Send it only when the
     ticket is hidden; a hidden ticket without it — or with it at the body's top level — fails
     `428 TICKET_DEFINITION_HIDDEN`.
   - **If the event's first public ticket was created just now, wait for registration to open
     before reserving.** It opens a second or two after the first ticket goes on sale: read
     `GET https://www.wixapis.com/events/v3/events/<EVENT_ID>?fields=REGISTRATION` until
     `registration.status` is `OPEN_TICKETS`, waiting about a second between reads (up to five
     reads), then reserve. Doing this in the same script as the ticket creates saves a retry.
   - `428 REGISTRATION_CLOSED` on a hidden ticket: registration hasn't opened yet (see above) or
     the event has no visible ticket on sale. Wait and retry once; if it persists, tell the user the
     event needs a public ticket first (or reopen registration: `PATCH https://www.wixapis.com/events/v3/events/<EVENT_ID>` with
     `{ "event": { "registration": { "registrationPaused": false } } }`).
   - `"disableTicketLimitValidation": true` (same object) lets the reservation exceed the ticket's
     remaining quantity and can oversell the event — send it only after the user agrees to go over
     the limit.
   - Read `ticketReservation.id`. The reservation expires at `expirationDate` — check out straight
     away.
3. `POST https://www.wixapis.com/events/v1/checkout`, with one `guests[]` entry per ticket, each
   form built from the event's form as for RSVPs:

```json
{
  "eventId": "<EVENT_ID>",
  "reservationId": "<RESERVATION_ID>",
  "buyer": { "firstName": "Jane", "lastName": "Doe", "email": "jane@example.com" },
  "guests": [
    { "form": { "inputValues": [ { "inputName": "firstName", "value": "Jane" }, { "inputName": "lastName", "value": "Doe" }, { "inputName": "email", "value": "jane@example.com" } ] } },
    { "form": { "inputValues": [ { "inputName": "firstName", "value": "Pat" }, { "inputName": "lastName", "value": "Lee" }, { "inputName": "email", "value": "pat@example.com" } ] } }
  ],
  "options": { "silent": false }
}
```

   The response's `order` has the `orderNumber` and `status` — `FREE` for free tickets.

   **Who holds each ticket.** Unless the event collects one form per ticket, every ticket is held
   by the buyer: the extra `guests[]` entries are not stored, and the guest query shows the buyer's
   name and email on each ticket. With `registration.tickets.guestsAssignedSeparately: true` (set it
   with `PATCH https://www.wixapis.com/events/v3/events/<EVENT_ID>` and `{ "event": { "registration": { "tickets": { "guestsAssignedSeparately": true } } } }`,
   with the user's agreement) each `guests[]` entry becomes that ticket's holder, under their own name — send one
   entry per ticket.

`checkout.options` decide how a paid ticket is settled — set them from what the user said, never
by default:
- `"payInPerson": true` — the guest pays at the door; the order is `OFFLINE_PENDING`, and its total
  includes the service fee when the ticket's `feeType` is `FEE_ADDED_AT_CHECKOUT`.
- `"markAsPaid": true` — **only** when the user says the guest already paid outside the site. It
  records the order as `PAID`; on a comp guest it reports revenue that was never received.
- `"silent": true` — no confirmation email.
- `"ignoreFormValidation": true` — skip mandatory form answers the user doesn't have.

If checkout fails, delete the reservation so its tickets are released:
`DELETE https://www.wixapis.com/events/v1/ticket-reservations/<RESERVATION_ID>`.

## Change an RSVP

`PATCH https://www.wixapis.com/events/v2/rsvps/{rsvp.id}` with the RSVP's current `revision`:

```json
{
  "rsvp": { "id": "<RSVP_ID>", "revision": "<REVISION>", "eventId": "<EVENT_ID>", "status": "YES" }
}
```

- Move someone off the waitlist: `status` from `WAITLIST` to `YES`. If that fails because the event
  is full, tell the user; only when they agree to go over the limit, retry once with
  `"options": { "ignoreLimits": true, "ignoreResponseStatus": true }`.
- Mark someone not attending: `status` `NO`.
- Several at once (up to 100): `PATCH https://www.wixapis.com/events/v2/bulk/rsvps/update` with
  `{ "rsvps": [ { "rsvp": { "id": "<RSVP_ID>", "revision": "<REVISION>", "status": "NO" } } ], "returnEntity": true }`,
  then check `results[].itemMetadata.success` and report failures.
- **Take the `revision` from a fresh read** (`GET https://www.wixapis.com/events/v2/rsvps/<RSVP_ID>`),
  never from the create response. On `INVALID_REVISION` (single or bulk item), read the RSVP again
  and retry once.

## Remove a guest

Confirm first. Deleting an RSVP can't be undone; archiving an order or ticket hides it from the
guest list and can be reversed by sending the same call with `"archived": false`.
- RSVP: `DELETE https://www.wixapis.com/events/v2/rsvps/<RSVP_ID>`.
- Several RSVPs: `POST https://www.wixapis.com/events/v2/bulk/rsvps/delete-by-filter` with
  `{ "filter": { "eventId": "<EVENT_ID>", "id": { "$in": ["<RSVP_ID>"] } } }`. Always include
  `eventId`: the filter otherwise spans every event, and an empty filter is refused
  (`400 EMPTY_FILTER`). It runs asynchronously and returns a `jobId`: wait a few seconds, then
  confirm with an RSVP search — not with the event's `summaries` counts, which update later.
- Ticketed: archive the order — `PATCH https://www.wixapis.com/events/v1/events/<EVENT_ID>/orders`
  with `{ "orderNumber": ["<ORDER_NUMBER>"], "archived": true, "fields": { "paths": ["archived"] } }`
  — or a single ticket, `PATCH https://www.wixapis.com/events/v1/tickets` with
  `{ "eventId": "<EVENT_ID>", "ticketNumber": ["<TICKET_NUMBER>"], "archived": true }`. Archiving
  does not refund the payment.

## Check guests in

- RSVP: `POST https://www.wixapis.com/events/v2/rsvps/<RSVP_ID>/check-in` with
  `{ "guestIds": [1] }` — integer `guestList.guests[].guestId` values read from that RSVP (search
  with `DETAILS`), matched to the person by `fullName`; not GUIDs — a GUID fails
  `400 Not a numeric value`. For a guest you just added, create the RSVP with
  `"fields": ["DETAILS"]`: its response already carries `guestList.guests[].guestId` (the RSVP's own
  guest is `1`), so no extra read is needed. Undo: same body to `.../cancel-check-in`.
- Ticketed: `POST https://www.wixapis.com/events/v1/tickets/check-in` with
  `{ "eventId": "<EVENT_ID>", "ticketNumber": ["<TICKET_NUMBER>"] }` (up to 100). Undo:
  `DELETE https://www.wixapis.com/events/v1/tickets/check-in?eventId=<EVENT_ID>&ticketNumber=<TICKET_NUMBER>`.

`428 GUEST_ALREADY_CHECKED_IN` / `GUEST_NOT_CHECKED_IN` mean there is nothing to change. Count
checked-in guests with the guest query filtered `"guestDetails.checkedIn": true`.

## Mark an order as paid

`POST https://www.wixapis.com/events/v1/events/<EVENT_ID>/orders/confirm` with
`{ "orderNumber": ["<ORDER_NUMBER>"] }` moves `OFFLINE_PENDING`, `PENDING` or `INITIATED` orders to
`PAID` and emails the tickets to the buyer. `PAID` and `FREE` orders are unchanged. Confirm with
the user first. The order number is the code shown on the order, such as `FM9X-EHKF-ZO`. The
response is `orders[]` — read `status` `PAID` there; a separate order read immediately afterwards
can come back without a status.

## Not available through the API

Say so, and point the user to the event's Guests or Orders page in the dashboard:
- **Refunds.** No Events API refunds an order; refunds are issued through the payment provider
  from the order in the dashboard. Archiving or cancelling does not refund.
- **Resending a confirmation or ticket email.** There is no resend call.
- **Export to CSV.** Build the list from the queries above and give it to the user instead.
- **Moving a ticket to another date or occurrence, or upgrading it.** The workaround is a new
  manual guest on the other event and archiving the original order — confirm both steps.
- **Importing a guest list.** Add guests one by one with the calls above.

## Related APIs
- **RSVP V2**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2) — [Create Rsvp](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/create-rsvp)
- **Ticketing (orders, tickets, reservations)**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing)
- **Event Guests**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/registration/event-guests)
- [Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events) — registration settings, guest limit, waitlist
- [Manage Event Tickets](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-event-tickets) — ticket types and prices
- **Events Form**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/form) — the questions guests answer
