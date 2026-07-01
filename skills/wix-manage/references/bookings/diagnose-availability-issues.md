---
name: "Diagnose Bookings Availability Issues"
description: "Diagnoses why an appointment/course service has no bookable time slots. Runs the DiagnoseAvailability endpoint for automated setup/config reasons, then performs manual configuration checks the endpoint does not yet emit — staff not serving the service location, and working-hours gaps that miss part of a multi-day service."
---
# Diagnose Bookings Availability Issues

## Description

Use this recipe when a site owner reports **"customers can't book my service"**, **"there are no available time slots"**, or **"the calendar shows nothing available"** for a Wix Bookings service.

Diagnosis happens in **two layers**:

1. **Automated diagnosis** — call the `DiagnoseAvailability` endpoint. It returns ordered, machine-readable reason codes (each with a suggested owner action) for the most common setup/configuration problems.
2. **Manual configuration checks** — for problems the endpoint does **not yet emit** (it currently implements only a subset of the defined reason codes), inspect the service, staff, work locations, and working-hours events directly. This layer catches the two classic misconfigurations:
   - **Staff assigned to a service but not serving the service's location** → the service is offered at a location where no assigned staff works, so no slots are produced.
   - **Working-hours gap on a multi-day service** → e.g. a 3-full-day course whose staff works from day 1 `00:00` to day 3 `23:59` — one minute short of the required span, so the full multi-day slot can never be formed.

> Run layer 1 first. If it returns concrete `reasons`, fix those and re-check. If it returns **UNDETERMINED** (empty `reasons` and `hasAvailability: false`), move to layer 2.

---

## Prerequisites

- **Wix Bookings app installed** (App ID: `13d21c63-b5ec-5912-8397-c3a5ddb27a97`).

> **Note:** If Bookings APIs return errors, the app may not be installed. Use [List Installed Apps](../app-installation/list-installed-apps.md) to verify and [Install Wix Apps](../app-installation/install-wix-apps.md) to install it.

- The service you are diagnosing must be **appointment-based** (the diagnose endpoint targets appointment services; course/multi-day working-hours coverage is checked manually in layer 2).
- You need the `serviceId` and, for resource-scoped checks, the staff member's `resourceId`.

---

## Overview

### What the endpoint does

`DiagnoseAvailability` is a read-only custom action that explains **why availability is empty** rather than returning slots. Unlike `ListAvailabilityTimeSlots` (which just returns nothing when there's a problem), it returns *causes*.

- **Endpoint:** `POST https://www.wixapis.com/_api/service-availability/v2/time-slots/diagnose`
- **Exposure:** INTERNAL, maturity ALPHA — callable by users and Wix apps only. Behind a feature toggle; when the toggle is off it returns `hasAvailability: false` with **empty** `reasons` (indistinguishable from UNDETERMINED — proceed to layer 2).
- **Does NOT** apply booking-policy, customer-choice, or per-request slot filters. It diagnoses **setup/configuration**, not policy-driven bookability (too-early / too-late / fully-booked). For policy issues, inspect `ListAvailabilityTimeSlots` with `bookingPolicyViolations`.
- **`hasAvailability` is never `true` yet** — the current implementation detects *problems* and never positively confirms availability. So `hasAvailability: false` + empty `reasons` means **"no blocking cause found"**, not "no availability."

### Three diagnosis modes

Provide at least one of `serviceId` / `resourceId` (else `MISSING_ARGUMENTS`):

| Mode | Inputs | Answers |
|------|--------|---------|
| **Service** | `serviceId` | Is the service itself set up to produce slots? |
| **Resource** | `resourceId` | Is this staff member / resource set up to be bookable? |
| **Service + Resource** | both | Can *this* staff member serve *this* service? (assignment + working hours, in service context) |

---

## Step 1 — Run the automated diagnosis

### Request

```bash
curl -X POST 'https://www.wixapis.com/_api/service-availability/v2/time-slots/diagnose' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "serviceId": "<SERVICE_ID>",
    "fromLocalDate": "2026-07-01T00:00:00",
    "toLocalDate": "2026-09-29T00:00:00",
    "timeZone": "America/New_York"
  }'
```

**Fields:**

| Field | Notes |
|-------|-------|
| `serviceId` | Service to diagnose. Provide this or `resourceId`. |
| `resourceId` | Staff member / resource to diagnose. Provide this or `serviceId`. Provide **both** to check a specific staff member in the context of a specific service. |
| `fromLocalDate` | `YYYY-MM-DDThh:mm:ss` (ISO-8601). Optional; defaults to now. |
| `toLocalDate` | Optional; defaults to `fromLocalDate` + 90 days. |
| `timeZone` | IANA tz (e.g. `America/New_York`). Defaults to the site's time zone. |
| `locations` | Locations to diagnose. Empty ⇒ all locations the service offers. |
| `deep` | **Leave `false`.** `true` currently returns `DIAGNOSTIC_DEPTH_NOT_SUPPORTED`. |

### Response

```json
{
  "hasAvailability": false,
  "reasons": [
    {
      "code": "NO_ASSIGNED_STAFF_OR_RESOURCES",
      "suggestedAction": "ASSIGN_STAFF_OR_RESOURCES"
    }
  ],
  "resolvedContext": {
    "serviceId": "<SERVICE_ID>",
    "resolvedLocations": [ { "id": "...", "locationType": "BUSINESS" } ],
    "durationInMinutes": 60,
    "bufferTimeInMinutes": 15,
    "fromLocalDate": "2026-07-01T00:00:00",
    "toLocalDate": "2026-09-29T00:00:00"
  }
}
```

- `reasons` are ordered **most-specific first**. Fix the first reason, then re-run.
- `resolvedContext` echoes the inputs actually used (resolved locations, duration, buffer, window) — invaluable for confirming you diagnosed what you meant to.
- Empty `reasons` ⇒ **UNDETERMINED** → go to **Step 2**.

### Reason codes → owner fix

| `code` | `suggestedAction` | What it means & how to fix | Emitted today? |
|--------|-------------------|----------------------------|----------------|
| `NO_ASSIGNED_STAFF_OR_RESOURCES` | `ASSIGN_STAFF_OR_RESOURCES` | Service has no staff/resources assigned. Assign at least one. | ✅ (service mode) |
| `RESOURCE_HAS_NO_WORKING_HOURS` | `CHECK_STAFF_WORKING_HOURS` | Staff member has no working-hours schedule. Configure working hours (see [Bookings Staff Setup](bookings-staff-setup.md)). | ✅ (resource / service+resource mode) |
| `RESOURCE_NOT_ASSIGNED_TO_SERVICE` | `ASSIGN_RESOURCE_TO_SERVICE` | This staff member is not assigned to this service. Assign them. | ✅ (service+resource mode) |
| `SERVICE_AVAILABILITY_CONFIGURATION_MISSING` | — | Service's availability configuration is missing. | ⏳ defined, not yet emitted → layer 2 |
| `REQUESTED_LOCATION_NOT_OFFERED_BY_SERVICE` | `CHECK_SERVICE_LOCATIONS` | Requested location isn't offered by the service. | ⏳ defined, not yet emitted → layer 2 |
| `RESOURCE_NOT_AVAILABLE_AT_SERVICE_LOCATION` | `CHECK_WORK_LOCATIONS` | Assigned staff have hours, but none at a location the service offers. | ⏳ ALPHA, not yet emitted → **layer 2 Check A** |
| `RESOURCE_TYPE_RESOLUTION_FAILED` | — | Service's resource types couldn't be resolved. | ⏳ defined, not yet emitted |
| `NO_RESOURCE_AVAILABILITY_WINDOWS` | — | No availability windows in range. | ⏳ defined, not yet emitted → layer 2 |
| `DURATION_TOO_LONG_FOR_AVAILABLE_WINDOWS` | `REDUCE_DURATION_OR_BUFFER` | Service duration is longer than every free window. | ⏳ defined, not yet emitted → **layer 2 Check B** |
| `BUFFER_TIME_ELIMINATES_WINDOWS` | `REDUCE_DURATION_OR_BUFFER` | Buffer time eliminates all otherwise-available windows. | ⏳ defined, not yet emitted → layer 2 |
| `RESOURCE_NOT_IN_WORKING_HOURS` | `CHECK_STAFF_WORKING_HOURS` | Resource not within working hours in range (DEEP only). | ⏳ requires `deep` (unsupported) |
| `RESOURCE_BLOCKED` | `CHECK_BLOCKED_TIME` | Resource blocked by events/external calendars (DEEP only). | ⏳ requires `deep` (unsupported) |

> **"Emitted today?"** reflects the current engine, which implements the L1 setup checks only. Codes marked ⏳ are part of the contract but not yet produced — cover them with the manual checks below.

### Endpoint errors

| HTTP | `application_code` | Cause |
|------|-------------------|-------|
| 400 | `MISSING_ARGUMENTS` | Neither `serviceId` nor `resourceId` provided. |
| 400 | `INVALID_TIME_ZONE` | `timeZone` isn't a valid IANA zone. |
| 412 | `DIAGNOSTIC_DEPTH_NOT_SUPPORTED` | `deep: true` (not supported yet). |
| 404 | `SERVICE_NOT_FOUND` / `RESOURCE_NOT_FOUND` | Service / staff record missing. |
| 404 | `NO_IMPLEMENTERS_FOUND` / `MULTIPLE_IMPLEMENTERS_FOUND` | No / multiple availability providers configured. |
| 403 | `UNAUTHORIZED_OPERATION` | Caller lacks `bookings:availability:v2:time_slot:diagnose_availability`. |

---

## Step 2 — Manual configuration checks (UNDETERMINED cases)

Run these when Step 1 returns empty `reasons`. Each check targets a real misconfiguration the endpoint doesn't yet surface.

### Check A — Staff not serving the service's location

**Symptom:** Staff *are* assigned and *have* working hours, but their work locations don't overlap the service's offered locations. Result: no slots (future code `RESOURCE_NOT_AVAILABLE_AT_SERVICE_LOCATION` / action `CHECK_WORK_LOCATIONS`).

**Steps:**

1. **Get the service's offered locations.** Call Get Service (Services V2) and read `locations[]`. Note each `locationType` (`BUSINESS` with an `id`, `CUSTOM`, or `CUSTOMER`) — see [Create and Update Booking Services](create-and-update-booking-services.md).
2. **Get each assigned staff member's work locations.** Query staff members with the `RESOURCE_DETAILS` field set and read their work locations. (See [Bookings Staff Setup](bookings-staff-setup.md) for the staff query shape.)
3. **Intersect.** For each **business** location the service offers, confirm at least one assigned staff member lists that same location `id` among their work locations.
   - **No overlap at a location** ⇒ that location produces zero slots. Either add the location to a staff member's work locations, or remove the unserved location from the service.
   - `CUSTOMER`-type locations are chosen at booking time and don't need a staff work-location match; `CUSTOM` locations are service-specific.

> This is the general form of the "staff on a service that doesn't serve in the service location" bug: the assignment looks correct, but the location dimension doesn't line up.

### Check B — Working-hours gap on a multi-day / long service

**Symptom:** The service duration (or multi-day span) is longer than the continuous working-hours coverage. Classic case: a **3-full-day** service where staff working hours run from day 1 `00:00` to day 3 `23:59` — **1 minute short** of the full span, so the slot never forms. (Future code `DURATION_TOO_LONG_FOR_AVAILABLE_WINDOWS` / action `REDUCE_DURATION_OR_BUFFER`.)

**Steps:**

1. **Determine the required span.** From `resolvedContext.durationInMinutes` (Step 1) plus `bufferTimeInMinutes`, or from the course/multi-day definition. For a full-day multi-day service, the required span runs from the start of day 1 to the **end of the last day** — i.e. `00:00` of the day *after* the last day (exclusive), not `23:59`.
2. **Fetch the staff `WORKING_HOURS` events** covering the diagnosed window. Query Calendar Events V3 for `type: "WORKING_HOURS"` on the staff member's schedule (see [Bookings Staff Setup](bookings-staff-setup.md) → querying working hours).
3. **Verify continuous coverage** across the whole required span:
   - The union of working-hours intervals must cover **start → end with no gap**, including the **final minute** of the last day. An end of `23:59` leaves a 1-minute hole; it must reach `24:00` (i.e. `00:00` next day) for a full-day span.
   - Any gap between consecutive days (overnight) breaks a continuous multi-day slot.
4. **Fix:** extend the working-hours events to fully cover the span (end the last day at `00:00` of the next day for full-day services), **or** shorten the service duration/buffer to fit the real windows.

> **Off-by-one-minute is the trap.** Multi-day full-day slots use an *exclusive* end at midnight of the following day. `23:59` end times are the single most common cause of "the last day is missing."

### Other UNDETERMINED causes to rule out

- **No working-hours events in the diagnosed window** (`NO_RESOURCE_AVAILABILITY_WINDOWS`): staff have a schedule but no `WORKING_HOURS` events overlapping `[fromLocalDate, toLocalDate]`. Widen the window or add events.
- **Buffer eliminates windows** (`BUFFER_TIME_ELIMINATES_WINDOWS`): before/after buffers consume otherwise-free windows. Reduce buffer or lengthen working hours.
- **Requested location not offered** (`REQUESTED_LOCATION_NOT_OFFERED_BY_SERVICE`): you passed a `locations` filter that the service doesn't offer. Drop the filter or fix the location.
- **All slots blocked by policy, not setup:** the diagnose endpoint ignores policy. If setup looks correct, call `ListAvailabilityTimeSlots` and inspect `bookingPolicyViolations` (too-early / too-late) and `nonBookableReasons` (fully booked, waitlist-reserved).

---

## Recommended flow

1. Run **Step 1** in **service mode**. Fix any `reasons`, re-run until empty.
2. If a specific staff member is the concern, run **Step 1** in **service+resource mode** to check assignment + working hours in context.
3. On **UNDETERMINED**, run **Step 2 Check A** (locations) and **Check B** (working-hours coverage), then the remaining rule-outs.
4. Confirm the fix by calling `ListAvailabilityTimeSlots` for the service over the same window and verifying slots now appear.

---

## Gotchas

- **`hasAvailability: false` is not proof of a problem.** With empty `reasons` it means "no blocking cause detected." Always confirm with `ListAvailabilityTimeSlots`.
- **Feature toggle off looks like UNDETERMINED.** If Step 1 always returns empty `reasons` even for an obviously broken service (e.g. no staff assigned), the endpoint may be toggled off — rely on layer 2.
- **`deep: true` is unsupported** and returns `DIAGNOSTIC_DEPTH_NOT_SUPPORTED`. Working-hours-gap and blocked-time attribution must be done manually today.
- **Location types matter.** Only `BUSINESS` locations carry an `id` to intersect against staff work locations; `CUSTOM` is service-local and `CUSTOMER` is chosen at booking time.
- **Multi-day end boundary is exclusive at midnight.** Compare working-hours coverage against `00:00` of the day after the last day, not `23:59`.
- **Diagnose targets appointment services.** Course/class multi-day coverage is validated via the manual working-hours check.

## API Documentation References

- [Time Slots V2 — List Availability Time Slots](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots)
- [Services V2](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/introduction)
- [Staff Members](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/introduction)
- [Resources V2](https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/resources-v2/introduction)
- [Calendar Events V3](https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/introduction)
- [Booking Policies](https://dev.wix.com/docs/api-reference/business-solutions/bookings/policies/booking-policies/introduction)
- Related recipes: [Bookings Staff Setup](bookings-staff-setup.md) · [Create and Update Booking Services](create-and-update-booking-services.md) · [End-to-End Booking Flow](end-to-end-booking-flow.md)
