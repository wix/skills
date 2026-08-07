---
name: "Restaurants Reservations Setup"
description: "Configures Wix Table Reservations: party size limits, party and seat pacing, turnover times per party size, manual approval of online requests, the reservation business schedule, and creating or managing individual reservations through their lifecycle. Use when a merchant wants to accept table bookings, change how many guests they seat, set how long a table is held, require approval before a booking is confirmed, block a night, or when asked to create, seat, cancel or mark a reservation as a no-show. Reservations are a separate app from online ordering — menus and pickup or delivery hours are not configured here."
---

# Restaurants Reservations Setup

Table bookings live in the **Wix Table Reservations** app, separate from Menus and Orders. This recipe covers reservation settings and the reservation lifecycle. For online ordering see [Restaurants Orders Settings](restaurants-orders-settings.md); for the menu itself see [Restaurants Menus Setup](restaurants-menus-setup.md).

## When to Use

- Setting minimum and maximum party size, or how long a table is held
- Limiting how many parties or guests can be seated in the same 15 minutes
- Requiring staff approval before an online booking is confirmed
- Setting the hours reservations can be booked for
- Creating a booking, seating a party, cancelling, or marking a no-show
- Unsure which app owns the request? Start from [Configure Restaurants from Prompt](configure-restaurants-from-prompt.md)

## Prerequisites

1. Wix Table Reservations installed on the site (`f9c07de2-5341-40c6-b096-8eb39de391fb`) — it is independent of the ordering apps, so a site that takes online orders may not have it
2. **At least one location configured in Business Info.** Every other call depends on it
3. API access with reservations permissions

## Two Rules That Decide Whether This Works

### Rule 1: reservation locations are not created here

A reservation location represents one physical restaurant and holds its calendar, pacing, and table rules. It can only be **created or archived through the Dashboard or the Locations API** — never through the Reservations APIs. Read the existing ones and update them.

The same call also refuses to change a location's `location` object. Address changes belong to the Locations API.

If listing returns nothing, the site has no location configured in Business Info yet. Say so rather than trying to create one.

### Rule 2: several settings have two spellings, and sending both fails

The server keeps a newer and a deprecated field in sync, and a `GET` returns **both** spellings:

| Use this | Not this |
|---|---|
| `partySize` | `partiesSize` |
| `turnoverTimeRules` | `turnoverRules` |

Echoing the whole object back therefore sends both, and if their values disagree the request is rejected. Send only the newer field, and strip the deprecated twin from anything you read before writing it back. Manual approval is a third shape rather than a twin — `approval.mode`, either `"AUTOMATIC"` or `"MANUAL"`.

## Flow

### Step 1: Find the Reservation Location

List or query reservation locations and pick one. Sites with several restaurants have one per physical location, so match on the location before changing anything.

### Step 2: Update Its Configuration

Everything a merchant means by "our booking rules" lives on the reservation location under `configuration.onlineReservations`:

- **Party size** — minimum and maximum guests bookable online.
- **Turnover time** — how long a table is held, usually varying by party size. "90 minutes for a table of four" is a turnover rule, not a global setting.
- **Party pacing** — how many parties may *start* within any 15-minute window. Stops the kitchen being hit by ten bookings at 19:00.
- **Seat pacing** — the same cap expressed in guests rather than parties.
- **Manual approval** — when on, online bookings arrive as `REQUESTED` and staff confirm them. When off, they are confirmed immediately.
- **Business schedule** — the hours bookings can be made for.

`PATCH /table-reservations/reservation-locations/v1/reservation-locations/{id}`, body wrapped in `reservationLocation` with `id` and the current `revision`. Party of 10 max, 90-minute turnover, staff approval:

```json
{
  "reservationLocation": {
    "id": "<RESERVATION_LOCATION_ID>",
    "revision": "4",
    "configuration": {
      "onlineReservations": {
        "onlineReservationsEnabled": true,
        "partySize": { "min": 1, "max": 10 },
        "defaultTurnoverTime": 90,
        "approval": { "mode": "MANUAL" }
      }
    }
  }
}
```

`defaultTurnoverTime` is minutes and applies to every party; `turnoverTimeRules` overrides it per party size, which is what "90 minutes for a table of four" means. Pacing reads `timeSlotInterval` (15 by default), so party and seat pacing are per 15-minute slot. `minimumReservationNotice` is `{ number, unit }`, e.g. 30 `MINUTES`.

### Step 3: Check Availability Before Booking

Time slot availability is computed from party size, pacing rules, the business schedule, and existing bookings — never assume a time is free. Get time slots for a date and party size, or check one specific slot, which also reports which table combinations fit and flags pacing conflicts.

### Step 4: Create the Reservation

Two shapes, and picking the wrong one strands guests:

- **Direct** — create the reservation with all details at once via `Create Reservation`, bypassing `HELD` entirely. It lands in `RESERVED` (or `REQUESTED` for an online-source reservation when the location requires manual approval). Use it for staff taking a booking over the phone or entering one from the dashboard — that is the offline/staff path, and offline bookings are `RESERVED` regardless of the manual-approval setting. With the `MANAGE RESERVATIONS (FULL)` scope you can set the status explicitly and override online-availability and table rules.
- **Held, then reserved** — hold the slot, collect the guest's details, then convert it. Right for a guest-facing flow, because it stops two people taking the same table while one is still typing. A held reservation **expires after 10 minutes**, and it cannot be moved out of `HELD` with a normal update — it has to be converted with the dedicated reserve call.

Any reservation not made as a walk-in requires the guest's first name and phone number. The hold takes only the slot; the reserve call adds the guest:

```json
POST .../reservations/hold
{ "reservationDetails": { "reservationLocationId": "<ID>", "startDate": "2026-09-04T19:00:00Z", "partySize": 4 } }

POST .../reservations/{reservationId}/reserve
{ "reservee": { "firstName": "Dana", "phone": "+15555550123" }, "revision": "1" }
```

`startDate` is an ISO timestamp, `partySize` an integer. `reservee` and `revision` are both required on reserve — that `revision` is the held reservation's, from the hold response.

### Step 5: Move It Through the Lifecycle

`HELD → REQUESTED → RESERVED → SEATED → FINISHED`, with `DECLINED`, `CANCELED` and `NO_SHOW` as exits. `PAYMENT_INFORMATION_PENDING` appears when the location requires payment, and clears to `RESERVED` on its own once paid — do not try to force it.

A reservation's `source` records how it was made and decides which statuses it can start in: `ONLINE` (made through the site or app — the only path that begins in `HELD`), `OFFLINE` (made by staff, e.g. a phone booking entered in the dashboard — starts in `RESERVED` or `REQUESTED` via `Create Reservation`, skipping `HELD`), or `WALK_IN` (a guest who arrived without a booking). `source` is set on creation, not updated later.

**Reservations that require payment create an eCommerce order.** When a reservation location charges a per-guest or per-reservation fee, takes a deposit, or holds a card as a guarantee, the reservation is backed by an eCommerce order whose line item carries `catalogReference.appId` `f9c07de2-5341-40c6-b096-8eb39de391fb` (the Table Reservations app) and `catalogItemId` equal to the reservation ID. The reservation's `paymentStatus` mirrors that order — `FREE` (no charge), `NOT_PAID`, `PAID`, `PARTIALLY_PAID`, `PARTIALLY_REFUNDED`, `FULLY_REFUNDED`. A no-show or late cancellation fee, where the location's policy applies one, is charged and refunded against the same order. Free reservations have no order.

Report the outcome in the merchant's words: which party, what time, how many guests.

## Endpoints

Under `https://www.wixapis.com` with an `Authorization` header:

| Purpose | Call |
|---|---|
| List, read, update a reservation location | `GET` `/table-reservations/reservation-locations/v1/reservation-locations[/{id}]`, `POST` `.../query`, `PATCH` `.../{id}` |
| Get time slots for a date and party size | `POST /table-reservations/reservations/v1/time-slots` |
| Check one time slot | `POST /table-reservations/reservations/v1/check-time-slot` |
| Create a reservation | `POST /table-reservations/reservations/v1/reservations` |
| Hold a slot for 10 minutes, then convert it | `POST /table-reservations/reservations/v1/reservations/hold`, `POST .../{reservationId}/reserve` |
| Find reservations, cancel one | `POST /table-reservations/reservations/v1/reservations/query`, `POST .../{reservationId}/cancel` |

Read field shapes from the [Reservations API docs](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/introduction) rather than from this table.

## Error Handling

| Error | Cause | Action |
|---|---|---|
| Validation error naming two fields that mean the same thing | Both the current and deprecated spelling were sent with different values, usually from echoing a GET | Send only `partySize`, `turnoverTimeRules`, `approval` |
| Application error changing a location's `location` | That object is owned by the Locations API | Change the address there instead |
| Listing reservation locations returns nothing | No location configured in Business Info | Tell the merchant to add one; it cannot be created from here |
| Error changing a `HELD` reservation's status | Normal updates cannot move a reservation out of `HELD`, and it expires after 10 minutes | Use the reserve call, or start again if it expired |
| Reservation rejected on create | Non walk-in bookings require the guest's first name and phone | Collect both before creating |
| Slot looks open but booking fails | Party or seat pacing, not table availability | Check the slot first — it reports pacing conflicts explicitly |

## What This Skill Does NOT Cover

- **Online ordering — hours, pickup, delivery** — a different app; see [Restaurants Orders Settings](restaurants-orders-settings.md)
- **Menus, sections, items, prices** — see [Restaurants Menus Setup](restaurants-menus-setup.md)
- **Orders customers placed online** — see [Restaurants Orders Management](restaurants-orders-management.md)
- **Floor plans and table definitions** — dashboard only, see [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md)
- **Experiences** (wine tastings, chef's tables) — a separate Reservations API, not covered here yet

If you cannot complete a change, say plainly that it was not applied and hand back the dashboard page — the reservations pages are listed in [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md). Never report a setting as saved, noted, or configured without a successful call behind it.
