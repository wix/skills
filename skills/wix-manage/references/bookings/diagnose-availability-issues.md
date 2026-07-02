---
name: "Diagnose Bookings Availability Issues"
description: "Diagnoses why an appointment-based Wix Bookings service has no bookable time slots. Runs the DiagnoseAvailability endpoint for ordered, machine-readable reasons — each with a suggested owner action — and interprets them, with a manual fallback for causes the endpoint doesn't evaluate. Use when a service shows no availability or customers can't book."
---
# Diagnose Bookings Availability Issues

## When to use

A site owner reports that an **appointment-based** service has **no bookable time slots** — the calendar shows nothing available, or customers can't book. This recipe finds the cause.

Diagnosis is **endpoint-first**:

1. **Call `DiagnoseAvailability`.** It returns ordered, machine-readable reason codes — each with a suggested owner action — for setup/configuration problems. Fix what it reports and re-check.
2. **Fall back to `ListAvailabilityTimeSlots`** only when the endpoint is inconclusive. The endpoint detects setup/configuration problems; it does **not** evaluate booking policy or remaining capacity, so those are checked here.

> **Scope:** appointment-based services.

---

## Prerequisites

- **Wix Bookings app installed** (App ID: `13d21c63-b5ec-5912-8397-c3a5ddb27a97`).

> **Note:** If Bookings APIs return errors, the app may not be installed. Use [List Installed Apps](../app-installation/list-installed-apps.md) to verify and [Install Wix Apps](../app-installation/install-wix-apps.md) to install it.

- You need the `serviceId`, and (optionally) a staff member's `resourceId` to scope the check to one provider.

---

## Step 1 — Run the diagnosis

`DiagnoseAvailability` is a read-only custom action that explains **why availability is empty** rather than returning slots.

- **Endpoint:** `POST https://www.wixapis.com/_api/service-availability/v2/time-slots/diagnose`
- **Maturity:** ALPHA, behind a feature toggle. Its checks roll out progressively — if it returns **no reasons** for a service that clearly has none, treat the result as inconclusive and go to Step 2.
- **`hasAvailability` is not set to `true` yet** — the endpoint detects *problems*; it does not positively confirm availability. So `hasAvailability: false` with an empty `reasons` array means **"no blocking cause found"**, not "no availability."

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

| Field | Notes |
|-------|-------|
| `serviceId` | Service to diagnose. Provide this or `resourceId`. |
| `resourceId` | Staff member / resource to diagnose. Provide this or `serviceId`. Provide **both** to check a specific provider in the context of a specific service. |
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
    { "code": "RESOURCE_NOT_AVAILABLE_AT_SERVICE_LOCATION", "suggestedAction": "CHECK_WORK_LOCATIONS" }
  ],
  "resolvedContext": {
    "serviceId": "<SERVICE_ID>",
    "resolvedLocations": [ { "id": "...", "name": "...", "locationType": "BUSINESS" } ],
    "durationInMinutes": 60,
    "bufferTimeInMinutes": 0,
    "fromLocalDate": "2026-07-01T00:00:00",
    "toLocalDate": "2026-09-29T00:00:00",
    "timeZone": "..."
  }
}
```

- `reasons` are ordered **most-specific first**. Fix the first, then re-run.
- `resolvedContext` echoes the inputs actually used (resolved locations, duration, buffer, window, time zone) — use it to confirm you diagnosed what you meant to.
- Empty `reasons` ⇒ **inconclusive** → go to **Step 2**.

### Reason codes → owner fix

> These codes and `suggestedAction` values are for **your** interpretation — do not show them to the user. Translate the result into plain language (see [Presenting the diagnosis](#presenting-the-diagnosis-to-the-user)).

| `code` | `suggestedAction` | Meaning & fix |
|--------|-------------------|---------------|
| `NO_ASSIGNED_STAFF_OR_RESOURCES` | `ASSIGN_STAFF_OR_RESOURCES` | No staff/resources assigned to the service. Assign at least one. |
| `RESOURCE_NOT_ASSIGNED_TO_SERVICE` | `ASSIGN_RESOURCE_TO_SERVICE` | The given resource isn't assigned to the service. Assign it, or diagnose a resource that is. |
| `RESOURCE_HAS_NO_WORKING_HOURS` | `CHECK_STAFF_WORKING_HOURS` | The staff member has no working-hours schedule. Configure working hours — see [Bookings Staff Setup](bookings-staff-setup.md). |
| `RESOURCE_NOT_AVAILABLE_AT_SERVICE_LOCATION` | `CHECK_WORK_LOCATIONS` | Assigned resources have availability windows, but none at a location the service offers. Add working hours at an offered location, offer the service where the staff works, or assign a provider who works at the offered location. |
| `NO_RESOURCE_AVAILABILITY_WINDOWS` | `CHECK_STAFF_WORKING_HOURS` | No availability windows exist anywhere in the diagnosed range. Add working hours, or widen the range. |
| `REQUESTED_LOCATION_NOT_OFFERED_BY_SERVICE` | `CHECK_SERVICE_LOCATIONS` | A requested `locations` filter isn't offered by the service. Drop the filter or fix the service's locations. |
| `DURATION_TOO_LONG_FOR_AVAILABLE_WINDOWS` | `REDUCE_DURATION_OR_BUFFER` | The service is longer than every free window. Shorten it or lengthen working hours. |
| `BUFFER_TIME_ELIMINATES_WINDOWS` | `REDUCE_DURATION_OR_BUFFER` | Buffer time consumes all otherwise-free windows. Reduce the buffer or lengthen working hours. |
| `SERVICE_AVAILABILITY_CONFIGURATION_MISSING` | — | The service's availability configuration is missing. |
| `RESOURCE_TYPE_RESOLUTION_FAILED` | — | The service's resource types couldn't be resolved. |
| `RESOURCE_NOT_IN_WORKING_HOURS` | `CHECK_STAFF_WORKING_HOURS` | Resource not within working hours in range. **`deep`-only — not yet supported.** |
| `RESOURCE_BLOCKED` | `CHECK_BLOCKED_TIME` | Resource blocked by events / external calendars. **`deep`-only — not yet supported.** |

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

## Step 2 — Fallback when the endpoint is inconclusive

Empty `reasons` + still no bookable slots usually means the cause is one the endpoint **doesn't evaluate**: booking policy or remaining capacity. Call `ListAvailabilityTimeSlots` for the same service and window, and inspect the returned slots:

- **`nonBookableReasons`** — `noRemainingCapacity`, `violatesBookingPolicy`, `reservedForWaitingList`, `eventCancelled`.
- **`bookingPolicyViolations`** — `tooEarlyToBook`, `tooLateToBook`, `bookOnlineDisabled`.

If **no slots come back at all**, re-check the inputs: the diagnosed window isn't entirely in the past, and any `locations` filter is actually offered by the service.

See [End-to-End Booking Flow](end-to-end-booking-flow.md) for the `ListAvailabilityTimeSlots` request shape.

---

## Presenting the diagnosis to the user

The diagnosis is part of a conversation with a site owner. Reply in plain, friendly language:

- **Don't expose the internals** — no reason codes, `suggestedAction` enums, raw JSON, endpoint names, or field paths.
- **Lead with the cause in plain English**, then give the concrete fix as the next step. One or two short sentences is usually enough.
- **Use the owner's own terms** — "your service", "your staff", "the dates you're looking at", real location names from `resolvedLocations`.
- **Offer to help with the fix** rather than only stating it.
- If the result is inconclusive, say you couldn't find a setup problem and describe what you'll check next (policy/capacity) — don't imply the service is fine.

**Plain-language phrasing per cause:**

| Cause | Say something like |
|-------|--------------------|
| No staff/resources on the service | "This service doesn't have any staff assigned yet, so there's nothing to book. Want me to help you add someone?" |
| Provider isn't on the service | "That staff member isn't assigned to this service, so their times don't show. I can add them to it." |
| Provider has no working hours | "The staff for this service don't have any working hours set, so there are no times to offer. Let's set their hours." |
| Provider works only at other locations | "Your staff have working hours, but not at the location(s) this service is offered at. We can either add hours at one of the service's locations, or offer the service where they already work." |
| No working-hours windows in range | "None of the staff for this service have working hours in the dates you're checking. Let's add or extend their hours — or try a different date range." |
| Service too long / buffer too large | "The service is longer than any open gap in your staff's schedule (the duration plus buffer doesn't fit). Shortening it a bit, or widening working hours, would open up slots." |
| Requested location not offered | "This service isn't offered at the location you picked. Want me to add that location to the service, or check a different one?" |
| Slots exist but aren't bookable (Step 2) | "There are times available, but customers can't book them right now — [e.g. they're fully booked / it's too early or late to book per your policy]. Here's how to adjust that." |

**Example conversational reply** (for a location-mismatch result):

> I looked into why no times are showing for **[service name]**. Your staff do have working hours, but none of them are at the locations this service is offered at (**Jerusalem2** and **Holon**) — so there's nothing available to book.
>
> To fix it you can either add working hours for a staff member at Jerusalem2 or Holon, or offer the service at the location where your staff already work. Want me to set that up?

---

## Common causes (quick reference)

Popular reasons a service shows no availability, and where each surfaces:

| Situation | Where it surfaces | Fix |
|-----------|-------------------|-----|
| No staff/resources on the service | `NO_ASSIGNED_STAFF_OR_RESOURCES` | Assign staff/resources. |
| Provider isn't on the service | `RESOURCE_NOT_ASSIGNED_TO_SERVICE` | Assign the provider. |
| Provider has no working hours | `RESOURCE_HAS_NO_WORKING_HOURS` | Configure working hours. |
| Provider works only at other locations | `RESOURCE_NOT_AVAILABLE_AT_SERVICE_LOCATION` | Align staff work locations with the service's offered locations. |
| No working-hours windows in range | `NO_RESOURCE_AVAILABILITY_WINDOWS` | Add working hours / widen the range. |
| Service too long / buffer too large for the windows | `DURATION_TOO_LONG_FOR_AVAILABLE_WINDOWS`, `BUFFER_TIME_ELIMINATES_WINDOWS` | Shorten duration/buffer or lengthen hours. |
| Requested location not offered | `REQUESTED_LOCATION_NOT_OFFERED_BY_SERVICE` | Fix the location filter or the service's locations. |
| Slots exist but aren't bookable (fully booked, too early/late, online booking off) | Step 2 — `ListAvailabilityTimeSlots` `nonBookableReasons` / `bookingPolicyViolations` | Adjust capacity or booking policy. |

---

## Gotchas

- **`hasAvailability: false` + empty `reasons` ≠ a confirmed problem.** It means "no blocking cause detected." Always confirm with `ListAvailabilityTimeSlots`.
- **The endpoint's checks roll out progressively (ALPHA).** If it returns nothing for an obviously broken service, it may be toggled off or the relevant check isn't live yet — use Step 2.
- **`deep: true` is unsupported** and returns `DIAGNOSTIC_DEPTH_NOT_SUPPORTED`.
- **The endpoint ignores booking policy and capacity** — those are Step 2.
- **Appointment-based services only.**

## API Documentation References

- [Time Slots V2 — List Availability Time Slots](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots)
- [Services V2](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/introduction)
- [Staff Members](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/introduction)
- [Booking Policies](https://dev.wix.com/docs/api-reference/business-solutions/bookings/policies/booking-policies/introduction)
- Related recipes: [Bookings Staff Setup](bookings-staff-setup.md) · [Create and Update Booking Services](create-and-update-booking-services.md) · [End-to-End Booking Flow](end-to-end-booking-flow.md)
