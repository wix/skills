---
name: "Create Random Booking Service"
description: Create a random, valid Wix Bookings service (APPOINTMENT, CLASS, or COURSE) with sensible randomized attributes. Supports a load-test mode that biases toward high capacity and wide availability so the service never throttles a load test. Emits the created resource IDs as JSON.
---

# Create a Random Valid Booking Service

Use this recipe when the request is to create a **random** service ("surprise me",
"any service", "a random bookings service"), or to provision a service for a
**load test**. It produces a fully valid service by following the validation
process in [create-and-update-booking-services.md](create-and-update-booking-services.md) —
read that recipe for the exact API calls, payment rules, staff/category steps, and
event-creation constraints. This recipe only adds the randomization and the
load-test biasing, and defines the JSON output contract.

## Inputs

- Site auth (`<AUTH>`) — owner-level token.
- Optional intent: **load-test mode** (the caller says "load-test mode" or "for a load test").

## Step 1 — Pick a random type

Choose uniformly at random: `APPOINTMENT`, `CLASS`, or `COURSE`.

## Step 2 — Pick random attributes

- **Name:** pick from a type-appropriate set, e.g.
  - APPOINTMENT: "Quick Consultation", "Strategy Session", "Personal Training", "Career Coaching", "Wellness Check"
  - CLASS: "Morning Yoga", "HIIT Bootcamp", "Spin Class", "Pilates Flow", "Dance Fitness"
  - COURSE: "Photography Basics", "Web Development", "Cooking Masterclass", "Guitar Lessons", "Business Strategy"
  Prefix with "Load Test " in load-test mode so it is easy to identify and delete.
- **Duration (APPOINTMENT only):** random multiple of 15 in [15, 120] minutes.
- **Price:** random; decide free vs paid. In load-test mode either is fine.

## Step 3 — Derive a VALID payment (never skip this)

Follow the payment validation table in the authoritative recipe:

- **Free** → `payment.rateType: "NO_FEE"`, `payment.options: {online:false, inPerson:true}` (no `fixed`).
- **Paid** → `payment.rateType: "FIXED"`, `payment.fixed.price.value: "<amount>"` (amount > 0), and a valid `options` combo (e.g. `{online:true, inPerson:false}`).
- Always set `onlineBooking.enabled: true`.
- Never emit `NO_FEE` with `online:true`, and never emit `options` with both false.

## Step 4 — Type-specific fields + load-test biasing

- **APPOINTMENT:** query staff (`POST /bookings/v1/staff-members/query` with `fields:["RESOURCE_DETAILS"]`), use their `resourceId` values in `staffMemberIds`; set `schedule.availabilityConstraints.sessionDurations: [<duration>]`. In load-test mode assign **all** returned staff to maximize concurrent slots.
- **CLASS / COURSE:** omit `staffMemberIds` and `sessionDurations`; set `defaultCapacity`. In load-test mode use `defaultCapacity: 1000`; otherwise a normal value (e.g. 10).

## Step 5 — Ensure a category

Query categories; if none exist, create a "General" category. Assign `category.id`.

## Step 6 — Create the service

Call `POST https://www.wixapis.com/bookings/v2/bulk/services/create` with `{services:[{…}]}`.
Read `service_id` from `results[0].item.service.id` and `schedule_id` from `results[0].item.schedule.id`.

## Step 7 — Create sessions (CLASS / COURSE only)

CLASS/COURSE are not bookable until events exist. Create sessions with
`POST https://www.wixapis.com/calendar/v3/bulk/events/create` on the returned
`schedule_id`, honoring the event rules from the authoritative recipe (each event
needs a `resources` entry; `recurrenceRule.days` uses a single full day name per
event; `start.localDate` must be today or later; `event.type` = `CLASS` or `COURSE`).
In load-test mode create sessions spanning a wide future window so slots never run out.
Record the created event IDs and one concrete `session_id` (query availability or read
the created event instance) for JMeter.

## Step 8 — Emit the output contract (REQUIRED)

Finish by printing exactly one fenced JSON block (no other JSON in the final message):

```json
{
  "service_id": "<id>",
  "schedule_id": "<id>",
  "service_type": "APPOINTMENT | CLASS | COURSE",
  "session_id": "<id or empty>",
  "event_ids": ["<id>"],
  "category_id": "<id>",
  "staff_member_ids": ["<resourceId>"],
  "service_name": "<name>",
  "duration_minutes": 60,
  "price": 0,
  "capacity": 1000
}
```

The caller saves this block verbatim to a file and passes it to the load-test
`provision.sh --from <file>`.
