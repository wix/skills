---
name: "Diagnose Bookings Availability Issues"
description: "Diagnoses why an appointment-based Wix Bookings service has no bookable time slots or why customers can't book it. First rules out service-level blockers the availability endpoint can't see — the service being hidden from the site or having online booking turned off — then runs the DiagnoseAvailability endpoint for ordered, machine-readable staff/setup reasons, with a manual fallback for booking-policy and capacity causes. Use when a service shows no availability or customers can't book or find it."
---
# Diagnose Bookings Availability Issues

> ## ⚠️ Output rule (read first)
> You are talking to a **site owner**, not a developer. Use everything below — the endpoint, JSON, reason codes, `suggestedAction` values, field names — **only to run the diagnosis**. Your **reply to the user must be plain language**: the cause in everyday words plus the fix, and an offer to help.
>
> **Never put any of these in your reply:** endpoint paths or curl, JSON, reason-code names (e.g. `RESOURCE_NOT_AVAILABLE_AT_SERVICE_LOCATION`), `suggestedAction` enums, or field names. Translate them. See [Presenting the diagnosis](#presenting-the-diagnosis-to-the-user).
>
> ✅ "Your staff don't have working hours at the location this service is offered at, so there's nothing to book. Want me to add hours there?"
> ❌ "`DiagnoseAvailability` returned `RESOURCE_NOT_AVAILABLE_AT_SERVICE_LOCATION` / `CHECK_WORK_LOCATIONS`."

## When to use

A site owner reports that an **appointment-based** service has **no bookable time slots**, or that **customers can't book (or can't even find) the service**. This recipe finds the cause.

Diagnosis runs in order — **cheapest, most common blockers first:**

0. **Rule out service-level blockers.** Before touching availability, confirm the service is actually **visible** and **open to online booking**. A service that's hidden from the site, or has online booking turned off, can't be booked no matter how much staff availability exists — and `DiagnoseAvailability` does **not** check either. This is the single most common reason a customer "can't book" a service. See [Step 0](#step-0--rule-out-service-level-blockers-visibility--online-booking).
1. **Call `DiagnoseAvailability`.** It returns ordered, machine-readable reason codes — each with a suggested owner action — for staff/resource setup and configuration problems. Fix what it reports and re-check.
2. **Fall back to `ListAvailabilityTimeSlots`** only when the endpoint is inconclusive. The endpoint detects setup/configuration problems; it does **not** evaluate booking policy or remaining capacity, so those are checked here.

> ### ⚠️ Don't skip Step 0
> If the owner's complaint is "customers can't book / can't see this service" (as opposed to "the calendar is empty"), **Step 0 is very likely the answer.** Jumping straight to `DiagnoseAvailability` / `ListAvailabilityTimeSlots` on a hidden service will surface a real-but-irrelevant availability or policy detail (e.g. "too late to book") and give the owner the **wrong** diagnosis. Always confirm visibility and online booking first.

> **Scope:** appointment-based services.

---

## Prerequisites

- **Wix Bookings app installed** (App ID: `13d21c63-b5ec-5912-8397-c3a5ddb27a97`).

> **Note:** If Bookings APIs return errors, the app may not be installed. Use [List Installed Apps](../app-installation/list-installed-apps.md) to verify and [Install Wix Apps](../app-installation/install-wix-apps.md) to install it.

- Typically the `serviceId` (optionally with a staff member's `resourceId` to scope to one provider). A `resourceId` on its own is also supported for the staff editor, where no service is in context — see [Which inputs to pass](#which-inputs-to-pass-prefer-a-service).

- **Authorization:** the caller needs the `bookings:availability:v2:time_slot:diagnose_availability` permission. A plain site/owner token can come back **403 (empty body)** if that permission isn't granted to the caller — that's an auth problem, not "no cause found." Ensure the calling context carries the permission before treating a 403 as inconclusive.

---

## Step 0 — Rule out service-level blockers (visibility & online booking)

Two service settings block booking **entirely**, regardless of staff availability, and are invisible to `DiagnoseAvailability` and `ListAvailabilityTimeSlots`. Check them **first** with a single read of the service.

- **Endpoint:** `GET https://www.wixapis.com/_api/bookings/v2/services/{serviceId}`

Inspect two fields on the returned `service`:

| Field | Blocking value | What it means (the "Visible on your site and app" toggle is `hidden` inverted) |
|-------|----------------|------------------|
| `hidden` | `true` | The service is **hidden from the site and app**. Customers can't see or book it. In the dashboard this is the **"Visible on your site and app"** toggle turned **off**. |
| `onlineBooking.enabled` | `false` | **Online booking is turned off** for this service. It may be visible, but customers can't book it online (staff can still book it manually). |

- If **`hidden: true`** → that's the cause. Stop here; don't run the availability diagnosis. Fix: make the service visible (offer to flip the toggle for them).
- If **`onlineBooking.enabled: false`** → that's the cause (for "can't book online"). Fix: turn online booking on.
- If both are fine (`hidden: false`, `onlineBooking.enabled: true`) → proceed to Step 1.

> **Why this comes first:** a hidden service can still have staff, working hours, and internally-generated time slots — so the availability endpoint and `ListAvailabilityTimeSlots` will happily report on those slots (including policy details like "too late to book"). None of that is the real reason the customer can't book. Confirming visibility first prevents a confidently-wrong answer.

---

## Step 1 — Run the diagnosis

`DiagnoseAvailability` is a read-only custom action that explains **why availability is empty** rather than returning slots.

- **Endpoint:** `POST https://www.wixapis.com/_api/service-availability/v2/time-slots/diagnose`
- **Maturity:** ALPHA, behind the `diagnoseAvailabilityEndpoint` feature toggle (deployed and available in production). If it returns **no reasons** for a service you'd expect to be broken, treat the result as inconclusive and go to Step 2.
- **`hasAvailability`** is set `true` only on the **service paths**, when the availability-window check confirms real availability — and for `serviceId`-only, only when the service needs a single staff resource type. It is **never** asserted `true` for `serviceId`+`resourceId` (one resource can't confirm the whole service) or for resource-only. So `hasAvailability: false` with an empty `reasons` array means **inconclusive** ("no blocking cause found"), not necessarily "no availability."

### Which inputs to pass (prefer a service)

**Prefer passing `serviceId`** — on its own, or together with a `resourceId` to scope to one provider. `resourceId` alone is a valid mode (it serves the staff editor, where there is no service context) but is shallower; use it when a service genuinely isn't available.

The service is what makes the diagnosis deep. Only the service paths run the L2 availability-window check — it needs the service configuration (duration, buffer, offered locations, resource types) to actually verify the resource has real windows in the range and at the right locations. That L2 check is what produces `NO_RESOURCE_AVAILABILITY_WINDOWS`, `RESOURCE_NOT_AVAILABLE_AT_SERVICE_LOCATION`, and `REQUESTED_LOCATION_NOT_OFFERED_BY_SERVICE`.

| Inputs | Diagnoses | Depth | `hasAvailability` |
|--------|-----------|-------|-------------------|
| `serviceId` + `resourceId` *(preferred)* | Why a specific provider has no slots for the service | L1 setup + L2 window/location | never asserted `true` |
| `serviceId` only | Whole-service availability across assigned staff/locations | L1 setup + L2 window/location | `true` only if the service needs a single staff resource type |
| `resourceId` only | Staff-editor check, no service context | L1 setup + missing/empty working-hours check (no window/location; `deep` not allowed) | never asserted `true` |

**Resource-only is a valid mode, but lighter.** It exists for contexts where there is no service — e.g. the **staff editor**, diagnosing a staff member on their own. It catches a **missing or empty** working-hours schedule (`RESOURCE_HAS_NO_WORKING_HOURS`), but with no service configuration it can't run the availability-window or location checks, can't resolve locations, and can't use `deep`. So problems that only surface against a service — no windows despite having hours, a location mismatch, duration/buffer — are caught only when a `serviceId` is supplied.

- Owner reports a **service** has no availability → pass `serviceId`.
- Concern is a **specific provider**, and you have (or can find) a service → pass `serviceId` + `resourceId` (use a service they're assigned to) for the fullest diagnosis.
- **Only a `resourceId` is available** (e.g. from the staff editor, with no service in context) → use resource-only; it flags missing/empty working hours, but treat an inconclusive result with care — it can't check windows, locations, or run `deep`. When you can, re-run with a service the resource is assigned to.

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
| `resourceId` | Staff member / resource to diagnose. Pair it with `serviceId` (see [Which inputs to pass](#which-inputs-to-pass-prefer-a-service)). Resource-only (no `serviceId`) runs a lighter check — missing/empty working hours only, no window/location/`deep` — and can miss service-dependent problems. |
| `fromLocalDate` | `YYYY-MM-DDThh:mm:ss` (ISO-8601). Optional; defaults to now. |
| `toLocalDate` | Optional; defaults to `fromLocalDate` + 90 days. |
| `timeZone` | IANA tz (e.g. `America/New_York`). Defaults to the site's time zone. |
| `locations` | Locations to diagnose. Empty ⇒ all locations the service offers. |
| `deep` | Optional (default `false`). Set `true` **with a `serviceId`** to refine a "no availability windows" result into *why* — outside working hours vs. blocked/busy time. Extra sampling call; only acts when no windows exist; rejected on the resource-only path (`MISSING_ARGUMENTS`). See [Deep mode](#deep-mode). |

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

### Reason codes → owner fix (agent-internal — never shown to the user)

> This table is for **your** interpretation only. Map the returned code to the plain-language cause and fix, then write the reply in everyday words — the code names and `suggestedAction` values must not appear in your response. See [Presenting the diagnosis](#presenting-the-diagnosis-to-the-user).

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
| `RESOURCE_NOT_IN_WORKING_HOURS` | `CHECK_STAFF_WORKING_HOURS` | The resource works, but not during the empty range — it's outside their working hours. **Reported only with `deep: true`.** Fix: adjust/extend working hours. |
| `RESOURCE_BLOCKED` | `CHECK_BLOCKED_TIME` | The resource is within working hours but blocked by existing bookings, calendar events, or an external calendar. **Reported only with `deep: true`.** Fix: free up the blocked time. |

### Endpoint errors

| HTTP | `application_code` | Cause |
|------|-------------------|-------|
| 400 | `MISSING_ARGUMENTS` | Neither `serviceId` nor `resourceId` provided; or `deep: true` sent without a `serviceId`. |
| 400 | `INVALID_TIME_ZONE` | `timeZone` isn't a valid IANA zone. |
| 400 | `INVALID_SERVICE_IDS_PROVIDED` | The `serviceId` doesn't resolve to a service on the site. In practice a well-formed-but-nonexistent `serviceId` (not only a malformed one) currently surfaces here rather than as a 404 — re-check the ID. |
| 404 | `SERVICE_NOT_FOUND` / `RESOURCE_NOT_FOUND` | Service / staff record missing. (A missing `serviceId` may instead surface as the 400 `INVALID_SERVICE_IDS_PROVIDED` above.) |
| 404 | `NO_IMPLEMENTERS_FOUND` / `MULTIPLE_IMPLEMENTERS_FOUND` | No / multiple availability providers configured. |
| 403 | `UNAUTHORIZED_OPERATION` | Caller lacks `bookings:availability:v2:time_slot:diagnose_availability`. |

### Deep mode

`deep: true` (with a `serviceId`) refines a **no-availability-windows** result — it tells you *why* there are no windows: the staff are **outside their working hours** for that range (`RESOURCE_NOT_IN_WORKING_HOURS`) vs. within hours but **blocked/busy** (`RESOURCE_BLOCKED`, e.g. existing bookings or an external calendar).

- **When to use:** the standard call returns `NO_RESOURCE_AVAILABILITY_WINDOWS` and you want to tell the owner whether to *add hours* or *free up blocked time*.
- **How it works:** it samples a handful of slots across the range and makes one availability check, then attributes the cause. It runs **only when no windows exist** — it does nothing when availability is already present.
- **Constraints:** requires a `serviceId` (resource-only + `deep` → `MISSING_ARGUMENTS`); it's a best-effort refinement and silently falls back to the generic `NO_RESOURCE_AVAILABILITY_WINDOWS` cause if the sampling is inconclusive.

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
- If the result is inconclusive (empty `reasons`), say only that you **couldn't find a blocking problem**, and describe what you'll check next (policy/capacity, or re-run against a service for a resource-only check). **Do not state or imply that anything is set up correctly** — an empty `reasons` array means "no blocker detected," *not* "working hours / locations / setup are present." In particular, on the resource-only path never say the staff "have working hours set"; the check doesn't verify that. Don't imply the service is fine.

**Plain-language phrasing per cause:**

| Cause | Say something like |
|-------|--------------------|
| Service is hidden from the site (`hidden: true`) | "This service is currently hidden from your site and app, so customers can't see or book it. Want me to make it visible?" |
| Online booking turned off (`onlineBooking.enabled: false`) | "Online booking is turned off for this service, so customers can't book it themselves online (you can still book it for them manually). Want me to turn online booking on?" |
| No staff/resources on the service | "This service doesn't have any staff assigned yet, so there's nothing to book. Want me to help you add someone?" |
| Provider isn't on the service | "That staff member isn't assigned to this service, so their times don't show. I can add them to it." |
| Provider has no working hours | "The staff for this service don't have any working hours set, so there are no times to offer. Let's set their hours." |
| Provider works only at other locations | "Your staff have working hours, but not at the location(s) this service is offered at. We can either add hours at one of the service's locations, or offer the service where they already work." |
| No working-hours windows in range | "None of the staff for this service have working hours in the dates you're checking. Let's add or extend their hours — or try a different date range." |
| Outside working hours (deep) | "For those dates, your staff simply aren't scheduled to work, so there's nothing to offer. Let's add working hours in that period." |
| Within hours but blocked/busy (deep) | "Your staff are scheduled to work then, but that time is already taken up — by existing bookings or events on their calendar. Freeing some of it up will open slots." |
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
| Service hidden from the site/app | Step 0 — `service.hidden: true` | Make the service visible ("Visible on your site and app" toggle). |
| Online booking turned off | Step 0 — `service.onlineBooking.enabled: false` | Turn online booking on for the service. |
| No staff/resources on the service | `NO_ASSIGNED_STAFF_OR_RESOURCES` | Assign staff/resources. |
| Provider isn't on the service | `RESOURCE_NOT_ASSIGNED_TO_SERVICE` | Assign the provider. |
| Provider has no working hours | `RESOURCE_HAS_NO_WORKING_HOURS` | Configure working hours. |
| Provider works only at other locations | `RESOURCE_NOT_AVAILABLE_AT_SERVICE_LOCATION` | Align staff work locations with the service's offered locations. |
| No working-hours windows in range | `NO_RESOURCE_AVAILABILITY_WINDOWS` | Add working hours / widen the range. |
| No windows — outside working hours (deep) | `RESOURCE_NOT_IN_WORKING_HOURS` (`deep: true`) | Add or extend working hours in the range. |
| No windows — within hours but blocked/busy (deep) | `RESOURCE_BLOCKED` (`deep: true`) | Free up blocked time / check the external calendar. |
| Service too long / buffer too large for the windows | `DURATION_TOO_LONG_FOR_AVAILABLE_WINDOWS`, `BUFFER_TIME_ELIMINATES_WINDOWS` | Shorten duration/buffer or lengthen hours. |
| Requested location not offered | `REQUESTED_LOCATION_NOT_OFFERED_BY_SERVICE` | Fix the location filter or the service's locations. |
| Slots exist but aren't bookable (fully booked, too early/late, online booking off) | Step 2 — `ListAvailabilityTimeSlots` `nonBookableReasons` / `bookingPolicyViolations` | Adjust capacity or booking policy. |

---

## Gotchas

- **A hidden service is the classic wrong-diagnosis trap.** `hidden: true` (or `onlineBooking.enabled: false`) blocks booking entirely, but a hidden service can still have staff and internally-generated slots — so `DiagnoseAvailability` and `ListAvailabilityTimeSlots` will report on those slots and their policy details (e.g. "too late to book"), none of which is the real reason. **Always run Step 0 first**, especially when the complaint is "customers can't book / can't see this service."
- **`hasAvailability: false` + empty `reasons` ≠ a confirmed problem.** It means "no blocking cause detected." Always confirm with `ListAvailabilityTimeSlots`.
- **The endpoint is ALPHA and feature-toggled.** If it returns nothing for an obviously broken service, the `diagnoseAvailabilityEndpoint` toggle may be off — fall back to Step 2.
- **A 403 is an auth problem, not a diagnosis.** The action needs the `bookings:availability:v2:time_slot:diagnose_availability` permission; a caller without it gets a 403 with an empty body. Don't read that as "no cause found" — confirm the caller has the permission (see [Prerequisites](#prerequisites)).
- **`deep: true` needs a `serviceId`** (resource-only + `deep` → `MISSING_ARGUMENTS`) and only refines a "no windows" result — it does nothing when windows already exist.
- **The endpoint ignores booking policy and capacity** — those are Step 2.
- **Resource-only diagnosis is lighter.** Passing `resourceId` without `serviceId` catches missing/empty working hours but skips the window, location, and deep checks, so it can return "inconclusive" for service-dependent problems. Valid when there's no service context (e.g. the staff editor); otherwise pair the resource with a service.
- **Appointment-based services only.**

## API Documentation References

- [Time Slots V2 — List Availability Time Slots](https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots)
- [Services V2](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/introduction)
- [Staff Members](https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-members/introduction)
- [Booking Policies](https://dev.wix.com/docs/api-reference/business-solutions/bookings/policies/booking-policies/introduction)
- Related recipes: [Bookings Staff Setup](bookings-staff-setup.md) · [Create and Update Booking Services](create-and-update-booking-services.md) · [End-to-End Booking Flow](end-to-end-booking-flow.md)
