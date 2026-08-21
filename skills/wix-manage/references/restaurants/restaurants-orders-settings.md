---
name: "Restaurants Orders Settings"
description: "Configures Wix Restaurants online ordering through the Online Orders APIs: operations (scheduling, preparation time, ordering status including pause-until), pickup and delivery fulfillment methods (availability windows, ordering cutoff, fees, minimum order), per-menu ordering availability, one-off closures, and service fee rules. Use to turn ordering on, off or paused, set pickup or delivery hours, set a last-order or cutoff time, change prep time, allow scheduled orders, close for a holiday, or add a service charge. Carries the rules that decide correctness: with ASAP ordering the cutoff is the window end minus prep time, and an availability range never crosses midnight."
---

# Restaurants Orders Settings

Ordering settings live in the **Wix Restaurants Orders** app, separate from the menus: this covers *when and how* customers order, [Menus Setup](restaurants-menus-setup.md) covers what is on the menu.

## When to Use

- Ordering on, off or paused; a minimum order; a service charge
- Pickup or delivery hours, a last-order or cutoff time, prep time, preorders
- Closing for a holiday, or a menu orderable only at certain hours
- Unsure which setting a request maps to? Start from [Configure Restaurants from Prompt](configure-restaurants-from-prompt.md)

## Prerequisites

Wix Restaurants Orders installed, restaurant management permissions, and — for menu-related changes — a menu with items. Everything attaches to an **operation**; operations are created and deleted automatically with operation groups and business locations, so read the ones that exist and never create one. Pickup and delivery are the fulfillment types; dine-in is dashboard-only.

## Rule 1: with immediate ordering, the cutoff is derived, not stored

For an operation set to immediate (ASAP) ordering there is no cutoff or last-order field:

```
last order = window end − preparation time − delivery time (delivery only)
```

So "stop pickup orders at 01:30" with 30 minutes prep needs a window ending **02:00**; 01:30 silently yields a 01:00 cutoff. Work backwards from the sentence, then state the resulting last-order time — it cannot be read off the settings. Prep time is on the **operation**, the window on the **fulfillment method**: two updates for one request. On a **preorder-only** operation the deadline is a real setting instead — advance notice or a weekly schedule — so use it, not window arithmetic.

## Rule 2: an availability range never crosses midnight

A range starts and ends inside one weekday. Hours run 0–23, so `24:00` cannot be expressed and an end at or before its start is invalid. Late-night hours are therefore **two ranges on every day**: "open 11am–2am daily" gives every weekday `00:00` → `02:00` (the previous night's tail, yielding the 01:30 cutoff) and `11:00` → `23:59`.

Rule 1 then applies to **each range separately**, so the evening range's cutoff is 23:29. Whether an order in that last half-hour is accepted against the following `00:00` range is not something the settings tell you — say so rather than promising unbroken ordering across midnight, and confirm with the time-slot call.

## Step 1: Confirm the Intent, Then Pick the Operation

Business hours, ordering cutoff and prep time are three different numbers, and merchants routinely give one meaning another. For "open 11am to 2am", ask whether orders stop at closing or earlier and how long prep takes — before mutating anything. Then list operations and pick one by business location; if more than one fits, ask.

## Step 2: Update the Operation

Scheduling (immediate versus preorder-only), prep time, how far ahead orders may be placed, and ordering status — accepting, not accepting, or paused until a time.

`PATCH /restaurants-operations/v1/operations/{operationId}`, body wrapped in `operation` with `id` and the `revision` you just read. 30 minutes of prep:

```json
{
  "operation": {
    "id": "<OPERATION_ID>",
    "revision": "3",
    "orderScheduling": {
      "type": "ASAP",
      "asapOptions": {
        "preparationTime": {
          "type": "MAX_TIME",
          "maxTimeOptions": { "timeUnit": "MINUTES", "duration": 30 }
        }
      }
    }
  }
}
```

Prep time is nested three deep and named by scheduling type: `asapOptions.preparationTime`, with `type: "MAX_TIME"` and `maxTimeOptions`, or `"RANGE"` and `rangeOptions`. The response returns the incremented `revision`.

## Step 3: Update the Fulfillment Methods

List and update the pickup or delivery one: availability (Rules 1 and 2), `enabled`, `fee`, `minOrderPrice`, instructions. Keep methods one-to-one with operations — sharing one breaks the site. Delivery areas and timing: [Delivery Setup](restaurants-orders-delivery-setup.md).

`PATCH /fulfillment-methods/v1/fulfillment-methods/{fulfillmentMethodId}`, body wrapped in `fulfillmentMethod`. Pickup at the bar, open 11:00–02:00 (Rule 2's split), one weekday shown:

```json
{
  "fulfillmentMethod": {
    "id": "<FULFILLMENT_METHOD_ID>",
    "revision": "7",
    "type": "PICKUP",
    "pickupOptions": { "instructions": "Pick up at the bar" },
    "availability": {
      "availableTimes": [
        {
          "dayOfWeek": "MON",
          "timeRanges": [
            { "startTime": { "hours": 0, "minutes": 0 }, "endTime": { "hours": 2, "minutes": 0 } },
            { "startTime": { "hours": 11, "minutes": 0 }, "endTime": { "hours": 23, "minutes": 59 } }
          ]
        }
      ]
    }
  }
}
```

One `availableTimes` entry per `dayOfWeek` (`"MON"`…`"SUN"`), each with its own `timeRanges`; times are `{ hours, minutes }` integers, not strings, and an omitted day has no availability. Availability, fee, minimum and `enabled` update alone — but a body writing `pickupOptions` or `deliveryOptions` **must also carry `type`**, on updates as well as creates. `availability.timeZone` and the pickup address come back filled from the site; do not write them.

## Step 4: Set Per-Menu Availability

Per menu, `onlineOrderingEnabled` plus an `availability` with `type: "ALWAYS_AVAILABLE"` or a custom schedule — *in addition to* the fulfillment window, so a customer can order only when both allow that moment. Each object names its `operationId` and `businessLocationId`, where a "wrong menu shows" mismatch is visible. One-off closures are availability exceptions (`POST /restaurants-availability-exceptions/v1/availability-exceptions`), not edited weekly windows.

## Step 5: Add a Service Fee, if asked

A service charge is a **service fee rule** — its own entity (`GET`, `POST` `/service-fees/v1/rules`), not a field on the operation or method. List existing rules first; merchants often already have one to change instead. State back what the customer sees at checkout.

## Step 6: Read It Back

Report the effective first and last order times in the merchant's own words, then verify with the time-slot call. It returns `timeslotsPerFulfillmentType[]` — each entry carrying `timeSlot.startTime`, `timeSlotStatus`, `fulfillmentInfo[].maxTime` (prep plus delivery, minutes) and `fulfilmentType`, one `l` unlike every other field. Empty array: nobody can order.

## Endpoints

Under `https://www.wixapis.com`, `Authorization` header:

| Purpose | Call |
|---|---|
| Operations | `GET`, `PATCH` `/restaurants-operations/v1/operations[/{operationId}]` |
| Fulfillment methods | `GET` `/fulfillment-methods/v1/fulfillment-methods`, `POST` `.../query`, `PATCH` `.../{fulfillmentMethodId}` |
| Menu ordering settings | `POST /menu-ordering-settings/v1/menu-ordering-settings/query`, `PATCH .../{menuOrderingSettingsId}` |
| Verify what customers see | `GET /restaurants-operations/v1/operations/{operationId}/first-available-time-slot-per-fulfillment-type` |

Each entity has its own page under the [Online Orders API](https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/introduction) — full field shapes there, not here.

## Error Handling

| Error | Cause | Action |
|---|---|---|
| `400 ONE_OF_ALIGNMENT` naming `type` | The message states the inverse of the rule: `type` is *missing* from a body writing `pickupOptions`/`deliveryOptions` | Add `type: "PICKUP"` or `"DELIVERY"`; do not remove it, and a `fieldMask` does not help |
| 400 mentioning `revision` | Stale or missing — every update needs the current one | Re-read, resend with the revision you just got |
| 400 on an availability range | End at or before start, usually crossing midnight | Split into two ranges per Rule 2 |
| Configured, but nobody can order — or the wrong menu shows | The menu's settings point at no operation or a different one (a new menu is not orderable by default); the method is disabled; or operation and menu sit in different business locations, which fails at checkout rather than at save | Check those three in order, then confirm with the time-slot call |
| Right hours, wrong clock time | Availability is read in the site's timezone, read-only here | Fix site properties, not the windows |
| Delivery stopped but pickup should continue | Disabling is per method; the operation's ordering status stops everything | Set `enabled: false` on that method — never delete it, that loses its hours, fees and area |

## What This Skill Does NOT Cover

- **Menus and prices** — [Menus Setup](restaurants-menus-setup.md). **Delivery areas and fees** — [Delivery Setup](restaurants-orders-delivery-setup.md)
- **Launching from scratch** — [Orders Setup](restaurants-orders-setup.md). **Placed orders** — [Orders Management](restaurants-orders-management.md). **Bookings** — [Reservations Setup](restaurants-reservations-setup.md)
- **Connecting a payment method** — required for checkout, configured outside Restaurants

If you cannot complete a change, say plainly that it was not applied and hand back the dashboard page from [Dashboard Navigation](restaurants-dashboard-navigation.md). Never report a setting as saved without a successful call behind it.
