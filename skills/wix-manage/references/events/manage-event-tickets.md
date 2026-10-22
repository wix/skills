---
name: "Manage Event Tickets"
description: "Manages the ticket types of a ticketed Wix event with the Ticket Definitions V3 API — adding, editing, repricing, hiding, reordering and deleting tickets, scheduling or ending ticket sales, and changing the ticket currency. Use when the user wants to add early-bird, VIP, child or donation tickets to an existing event, change a ticket's price or quantity, or set when tickets stop selling."
---

# Manage Event Tickets

## Goal
Manage the ticket types ("ticket definitions") of a ticketed event. A ticket definition is one
type of ticket — "General Admission", "VIP" — with its price, quantity and sale period. Individual
tickets that guests bought are orders and tickets, in [Manage Event Guests](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-event-guests).

**Not here:**
- Creating a new event together with its first tickets: [Create an Event](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/create-event#ticket-tiers).
- Closing or pausing registration for the whole event: an event setting, `PATCH https://www.wixapis.com/events/v3/events/<EVENT_ID>` with
  `{ "event": { "registration": { "registrationPaused": true } } }` ([Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events)).
  Do not close an event's registration by ending every ticket's sale period.
- Tickets per order, tax and reservation hold: also event settings, under
  `event.registration.tickets` (`ticketLimitPerOrder`, `taxSettings`, `reservationDurationInMinutes`)
  with the same `PATCH https://www.wixapis.com/events/v3/events/<EVENT_ID>`.

## Prerequisite — the Wix Events app

Every call here returns `428 WIX_EVENTS_APP_NOT_INSTALLED` on a site without the Wix Events app.
Install it with appDefId `140603ad-af8d-84a5-2c80-a0f60cb47351`:
`POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install` with
`{"tenant":{"tenantType":"SITE","id":"<SITE_ID>"},"appInstance":{"appDefId":"140603ad-af8d-84a5-2c80-a0f60cb47351"}}` —
`appDefId` nests under `appInstance`. See [Install Wix Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/install-wix-apps).

## Before you start

Tickets exist only on events created with `registration.initialType: "TICKETING"`. On an RSVP event
every call here fails `428 INVALID_EVENT_TYPE`, and the event can't be converted. Find the event and
check its type first — this exact body:

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

If it is RSVP, create nothing in this turn: tell the user an RSVP event can't be converted, that a
ticketed copy would be a new event and its RSVPs would not carry over, and ask whether to create
it — and with which tickets and prices. See [Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events).

Reference pages for these calls — use them rather than searching:
[Query Ticket Definitions](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/query-ticket-definitions),
[Create Ticket Definition](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/create-ticket-definition),
[Update Ticket Definition](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/update-ticket-definition); to
find the event, [Query Events](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events).

The examples use `https://www.wixapis.com/events/v3/ticket-definitions`. The reference's
`https://www.wixapis.com/events-ticket-definitions/v3/ticket-definitions` is the same API — either
base works.

## List an event's tickets

```bash
curl -X POST 'https://www.wixapis.com/events/v3/ticket-definitions/query' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "query": {
      "filter": { "eventId": { "$eq": "<EVENT_ID>" } },
      "cursorPaging": { "limit": 100 }
    },
    "fields": ["SALES_DETAILS"]
  }'
```

Always filter by `eventId` — without it the query returns every event's tickets. The response is
`ticketDefinitions[]`, with paging under `metadata` (not `pagingMetadata`). Each definition carries:
- `id` and `revision` — both needed to update it;
- `name`, `pricingMethod`, `feeType`, `hidden`, `initialLimit`, `salePeriod`;
- `saleStatus` — `SALE_SCHEDULED` (not on sale yet), `SALE_STARTED` or `SALE_ENDED`;
- with `SALES_DETAILS`: `salesDetails.soldCount`, `unsoldCount` (null when unlimited),
  `reservedCount`, `soldOut`.

Other filters: `name`, `hidden`, `saleStatus`, `pricingMethod.free`, `feeType` (`$eq`, `$in`, …).
To find a ticket by the name the user gave, filter `eventId` and `name` together.

## Add a ticket type

`POST https://www.wixapis.com/events/v3/ticket-definitions`, one call per ticket type, up to 100 per
event. Create them one after another, not in parallel; on `429`, wait and retry that call before
moving to the next, and count the successes before reporting. Then list the event's tickets once
([List an event's tickets](#list-an-events-tickets)) and report what is stored.

```bash
curl -X POST 'https://www.wixapis.com/events/v3/ticket-definitions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "ticketDefinition": {
      "eventId": "<EVENT_ID>",
      "name": "Student",
      "pricingMethod": { "fixedPrice": { "value": "12.00", "currency": "USD" } },
      "feeType": "FEE_ADDED_AT_CHECKOUT",
      "initialLimit": 30,
      "salePeriod": { "endDate": "2026-11-15T05:00:00Z", "displayNotOnSale": true }
    }
  }'
```

`salePeriod` dates are instants: "stop selling on November 15" for a New York event is the start
of that day in `America/New_York` — `2026-11-15T05:00:00Z` — not `T00:00:00Z`, which is 7pm the
evening before. Convert
from the event's `dateAndTimeSettings.timeZoneId`, and say the local date and time you set.
Before sending, check the instant: converted back to the event's time zone it must read 00:00 on
the requested date. If it doesn't, fix it before the create — not with a follow-up update.

A sale date the user gives without a year is the **next such date from today** — on 20 October
2026, "stop selling on December 1st" is 1 December 2026. A sale period can never end after the
event starts: check `salePeriod.endDate` against the event's `dateAndTimeSettings.startDate`
before sending, and ask if that date falls after the event starts.

**Currency:** use the one the user names, as given ("20 euros" is `EUR`) — a ticket in that
currency is accepted even when the event has no tickets yet. When the user names none, use the
event's existing currency (`pricingMethod.fixedPrice.currency` of its other tickets, or
`registration.tickets.currency` on the event). To move an event that already has tickets to
another currency, see [Change the currency](#change-the-currency). The response is `{ "ticketDefinition": { "id",
"revision": "1", "saleStatus", ... } }`.

| Ticket | `pricingMethod` | `feeType` |
| --- | --- | --- |
| Fixed price | `{ "fixedPrice": { "value": "25.00", "currency": "USD" } }` | `FEE_ADDED_AT_CHECKOUT` |
| Free | `{ "fixedPrice": { "value": "0", "currency": "USD" } }` | `NO_FEE` |
| Donation / pay what you want (minimum may be `"0"`) | `{ "guestPrice": { "value": "5.00", "currency": "USD" } }` | `FEE_ADDED_AT_CHECKOUT` |
| Several prices in one ticket | `{ "pricingOptions": { "optionDetails": [ { "optionId": "<NEW_GUID>", "name": "Adult", "price": { "value": "30.00", "currency": "USD" } }, { "optionId": "<NEW_GUID>", "name": "Child", "price": { "value": "15.00", "currency": "USD" } } ] } }` | `FEE_ADDED_AT_CHECKOUT` |

- **Service fee.** Free ticket: `NO_FEE`. Paid ticket: `FEE_ADDED_AT_CHECKOUT` (the guest pays the
  fee on top), or `FEE_INCLUDED` when the user wants to absorb the fee. On `400 INVALID_FEE_TYPE`,
  read the error's `description`: `feeRequired=false` means the site collects no ticket fees — retry
  that ticket once with `NO_FEE`; `feeRequired=true` means `NO_FEE` was sent on a paid ticket —
  retry once with `FEE_ADDED_AT_CHECKOUT`.
- **Several prices need an `optionId` on every option** — a GUID you generate. Without it the create
  fails with a bare `500 Internal Server Error`. Keep the ids from the response: an update must send
  them back.
- **`value` is a string** — `"value": 10` fails `400 Unexpected value for field value`.
- **Quantity is `initialLimit`**; omit it for unlimited. If the event has a seating map, the seats
  set the quantity and `initialLimit` is ignored.
- `name` is 1–30 characters, `description` up to 500, `policyText` up to 1000; a price option
  `name` up to 200 and up to 100 options.
- **Read-only, never send:** `pricingMethod.free`, `pricingMethod.pricingType`, `saleStatus`,
  `limited`, `actualLimit`, `limitPerCheckout`, `salesDetails`. They are ignored without an error, so
  a "free" flag or a per-checkout limit you send silently does nothing. The number of tickets one
  buyer can take per order is the event's `registration.tickets.ticketLimitPerOrder`.
- `428 INVALID_SALE_PERIOD` — `salePeriod.startDate` is not before `endDate` (on create and update).

## Change a ticket

`PATCH https://www.wixapis.com/events/v3/ticket-definitions/{ticketDefinition.id}`. The current
`revision` is required (`400 revision must not be empty` without it). Read the ticket right before
updating and send its `id`, current `revision`, and the fields you are changing.

**Price changes need `"mask": "pricingMethod"`.** The ticket update takes its field mask under the
key `mask` (not `fieldmask`); send it even though the reference schema omits it. Without it:
- a `fixedPrice` change returns `200` and bumps the `revision`, but the price is **not** changed;
- a `pricingOptions` change fails `400 INVALID_PATCH … field path is illegal`.

A narrower path such as `pricingMethod.fixedPrice.value` doesn't work either. Name, description,
policy, `initialLimit`, `hidden` and `salePeriod` apply without a mask.
Example — change a price:

```bash
curl -X PATCH 'https://www.wixapis.com/events/v3/ticket-definitions/<TICKET_DEFINITION_ID>' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  --data-binary '{
    "ticketDefinition": {
      "id": "<TICKET_DEFINITION_ID>",
      "revision": "<REVISION>",
      "pricingMethod": { "fixedPrice": { "value": "57.00", "currency": "USD" } }
    },
    "mask": "pricingMethod"
  }'
```

- **Change the price**: send the whole `pricingMethod` for the ticket's pricing kind, with
  `"mask": "pricingMethod"`. To change one price option of a several-prices ticket, send the full
  `pricingOptions.optionDetails` array — every option, each with its existing `optionId`, and the new
  price on the one that changes — with the same mask.
- **Rename / describe**: `name`, `description`, `policyText`.
- **Quantity**: `initialLimit` — not below the number already sold.
- **Then check the response.** The returned `ticketDefinition` must show the new value as well as a
  `revision` one higher — a higher `revision` alone proves nothing. If the value did not change, do
  not report success: read the ticket again and tell the user what is stored.

## Hide or show a ticket

`PATCH` as above with `"hidden": true` to hide a ticket from the event page so it can't be bought,
or `"hidden": false` to show it again. A hidden ticket can still be given to guests from the
dashboard; there is no private link or code that unlocks a hidden ticket for chosen buyers — say
so if the user asks for one.

## Sale period — schedule, end or reopen sales

`salePeriod` controls when one ticket can be bought:

| The user wants | `salePeriod` |
| --- | --- |
| Tickets go on sale later | `{ "startDate": "<ISO>" }` |
| Stop selling this ticket on a date (early bird) | `{ "endDate": "<ISO>" }` |
| Show the ticket while it's not on sale | add `"displayNotOnSale": true` |
| Stop selling this ticket now | `{ "endDate": "<now, ISO>" }` |
| Reopen an ended ticket | `{ "endDate": "<a future ISO date>" }` — `saleStatus` goes from `SALE_ENDED` back to `SALE_STARTED` |

Dates are ISO-8601 strings, rounded down to the minute. After the change, read `saleStatus` in the
response: `SALE_STARTED` means it is buyable now. If a reopened ticket still reads `SALE_ENDED`,
also check the event: a past event, a cancelled event, or `registration.registrationPaused: true`
stops all sales regardless of the ticket's sale period — reopen registration with `PATCH https://www.wixapis.com/events/v3/events/<EVENT_ID>` and
`{ "event": { "registration": { "registrationPaused": false } } }`.

Ending sales for **every** ticket is not how to close an event's registration — pause
registration on the event instead.

## Reorder tickets

`POST https://www.wixapis.com/events/v3/ticket-definitions/reorder`, moving one ticket before or
after another; this sets the order on the event page and in the dashboard:

```json
{
  "eventId": "<EVENT_ID>",
  "ticketDefinitionId": "<TICKET_TO_MOVE>",
  "beforeDefinitionId": "<TICKET_IT_GOES_BEFORE>"
}
```

Send exactly one of `beforeDefinitionId` or `afterDefinitionId` (neither fails
`400 INVALID_REORDER_INSTRUCTION`). For a full new order, move the tickets one at a time from
second to last, each with `afterDefinitionId` set to the ticket that should precede it. The call
returns `{}`. The list call sorts by creation date by default, not by this order, so don't use it
to check the result — report the order you applied and whether every reorder call returned 2xx.

## Delete tickets

- One: `DELETE https://www.wixapis.com/events/v3/ticket-definitions/{ticketDefinitionId}`.
- All tickets of an event, or a filtered set: `POST https://www.wixapis.com/events/v3/bulk/ticket-definitions/delete`
  with a **single-level** filter — `{ "filter": { "eventId": "<EVENT_ID>" } }`. Unlike the Events
  bulk calls, there is no inner `filter`. Always include `eventId`, or the call reaches other
  events' tickets. It returns `{}`, and a read right afterwards can still list the tickets — wait a
  few seconds and query again before reporting what was deleted.

Deleting a ticket that has sales is allowed — nothing stops it. Before deleting one
(`salesDetails.soldCount` above 0), tell the user how many were sold and confirm; hiding it is
usually what they want. Fetching a deleted ticket afterwards returns `404`.

## Change the currency

`POST https://www.wixapis.com/events/v3/ticket-definitions/currency` with
`{ "eventId": "<EVENT_ID>", "currency": "EUR" }` changes the currency of **all** the event's tickets.
Amounts are not converted — 10 USD becomes 10 EUR — so update prices afterwards if the user wants
converted prices. Before calling, read the event with `"fields": ["DASHBOARD"]`: when
`summaries.tickets.currencyLocked` is `true` the call fails `428 CURRENCY_LOCKED` — tell the user
the currency can no longer be changed. Decide from that flag, not from whether the event has orders.

## Count tickets

`POST https://www.wixapis.com/events/v3/ticket-definitions/count` with
`{ "filter": { "eventId": "<EVENT_ID>" }, "facet": ["saleStatus"] }` returns counts per sale status,
as `facets.saleStatus.counts` (for example `{ "SALE_STARTED": 2 }`).
For sold and remaining tickets, use the list call with `SALES_DETAILS` and sum `soldCount` and
`unsoldCount`.

## Not supported

Say so plainly rather than approximating:
- a private link or code that unlocks a hidden ticket;
- a per-person or per-email cap across separate orders (only the per-order limit exists);
- a waitlist for a sold-out ticketed event (waitlists are RSVP-only);
- moving a sold ticket to another event or occurrence;
- one ticket admitting several people — create a ticket type per group size, or collect names on
  the event's registration form ([Events Form API](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/form)).

## Related APIs
- **Ticket Definitions V3**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3) — [Update Ticket Definition](https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/update-ticket-definition)
- [Manage Wix Events](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-events) — registration settings, tickets per order, tax
- [Manage Event Guests](https://dev.wix.com/docs/api-reference/business-solutions/events/skills/manage-event-guests) — orders, sold tickets, check-in
