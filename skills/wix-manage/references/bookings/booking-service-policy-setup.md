---
name: "Booking Service Policy Setup"
description: Sets up booking policies, cancellation rules, and waitlist configuration using the Booking Policies API (query, then PATCH the bookingPolicy entity with its revision). Covers cancellationPolicy, reschedulePolicy, booking-notice limits, waitlistPolicy, and participants limits — e.g. "customers can cancel up to 24 hours before".
---

# Technical Step-by-Step Instructions: Configuring Wix Bookings Service Policies (Real-World, API-First)

## Description

Below are the recommended steps to successfully configure booking, cancellation, and waitlist policies for Wix Bookings services. This recipe covers policy inheritance, service-specific overrides, and common policy configurations for different business models.

---

## Overview

Wix Bookings policy configuration allows businesses to set rules for:

- **Booking policies**: When customers can book, how far in advance, booking deadlines
- **Cancellation policies**: Cancellation deadlines, refund rules, fees
- **Waitlist policies**: When waitlists are enabled, capacity handling
- **Group booking policies**: Maximum participants per booking

Policies are **standalone entities** managed by the Booking Policies API (`/bookings/v1/booking-policies`), not fields nested on the service:

- Installing Wix Bookings creates a **"Default policy"** (`default: true`) that every new service references.
- Each service points at exactly one policy via its `bookingPolicy` field; many services can share a policy.
- To change rules site-wide, update the default policy. To give one service different rules, create a separate policy and reference it from that service.

### IMPORTANT NOTES

- A default policy exists on any site with Wix Bookings installed — **even before any service exists**. "Set a cancellation window" is always actionable by updating the default policy.
- Policy updates are PATCH-style: send only the sub-policies you want to change, plus the current `revision` (fetched via query/get) inside the `bookingPolicy` object.
- Policy options are the same across service types (APPOINTMENT, CLASS, COURSE).

---

## Steps

### 1. Find the Policy to Change

Query existing policies (`POST https://www.wixapis.com/bookings/v1/booking-policies/query`):

```json
{ "query": { "cursorPaging": { "limit": 100 } } }
```

For a site-wide change, pick the policy with `"default": true`. For a specific service, read the service first — its embedded `bookingPolicy.id` names the policy it uses. Save the policy's `id` and `revision`.

### 2. Update the Policy

`PATCH https://www.wixapis.com/bookings/v1/booking-policies/<POLICY_ID>` with the current `revision` inside the `bookingPolicy` object and only the sub-policies you're changing. Example — cancellations allowed up to 24 hours before the session:

```json
{
  "bookingPolicy": {
    "id": "<POLICY_ID>",
    "revision": "<CURRENT_REVISION>",
    "cancellationPolicy": {
      "enabled": true,
      "limitLatestCancellation": true,
      "latestCancellationInMinutes": 1440
    }
  }
}
```

**Field map (business rule → policy field):**

| Business rule | Sub-policy fields |
|---|---|
| Cancellation deadline | `cancellationPolicy.{enabled, limitLatestCancellation, latestCancellationInMinutes}` |
| Reschedule deadline | `reschedulePolicy.{enabled, limitLatestReschedule, latestRescheduleInMinutes}` |
| How far ahead customers can book | `limitEarlyBookingPolicy.{enabled, earliestBookingInMinutes}` |
| Booking notice / last-minute cutoff | `limitLateBookingPolicy.{enabled, latestBookingInMinutes}` |
| Booking after session start (courses/classes) | `bookAfterStartPolicy.enabled` |
| Waitlist | `waitlistPolicy.{enabled, capacity, reservationTimeInMinutes}` |
| Participants per booking | `participantsPolicy.{enabled, maxParticipantsPerBooking}` |

### 3. Per-Service Policies (Optional)

To give one service different rules, create a new policy (`POST https://www.wixapis.com/bookings/v1/booking-policies`) and point the service at it by updating the service's `bookingPolicy` reference (see [Update Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/update-service)).

### 4. Verify Policy Application

Read the service (`GET /bookings/v2/services/<SERVICE_ID>`) — the response embeds the full resolved `bookingPolicy`, so you can confirm the effective rules exactly as customers will experience them.

### IMPORTANT NOTES

- **Revision required**: Every policy update needs the current `revision` inside `bookingPolicy`; fetch it first, or the PATCH fails.
- **Partial updates**: Send only the sub-policies you're changing; the rest keep their values.
- **Enabled flags matter**: Each sub-policy has an `enabled` (and often a `limit*`) boolean — setting only the minutes value without enabling the limit has no effect.
- **Time calculations**: Policy deadlines are calculated from the booking's start time, in minutes (24 hours = 1440).

### Troubleshooting Common Issues

**Policies not applying:**

- Policies are separate entities — verify you PATCHed `/bookings/v1/booking-policies/<id>`, not fields on the service object (there is no `service.policy` field)
- Confirm the service actually references the policy you changed (`service.bookingPolicy.id`)
- Check the `revision` was current — a stale revision fails the update

**Waitlist not working:**

- Verify `waitlistPolicy.enabled` is `true` and `waitlistPolicy.capacity` is set
- Confirm the service has capacity configured (`defaultCapacity` for CLASS/COURSE)

**Cancellation policies not enforced:**

- Set all three fields together: `cancellationPolicy.enabled: true`, `limitLatestCancellation: true`, and `latestCancellationInMinutes` — the minutes value alone has no effect without the booleans

**Group booking limits not working:**

- Confirm `participantsPolicy.enabled` is `true` and `participantsPolicy.maxParticipantsPerBooking` is set
- Check that the booking UI respects the participant limit

## API Documentation References

- [Query Booking Policies](https://dev.wix.com/docs/api-reference/business-solutions/bookings/policies/booking-policies/query-booking-policies) — `POST https://www.wixapis.com/bookings/v1/booking-policies/query`
- [Update Booking Policy](https://dev.wix.com/docs/api-reference/business-solutions/bookings/policies/booking-policies/update-booking-policy) — `PATCH https://www.wixapis.com/bookings/v1/booking-policies/{bookingPolicy.id}`
- [Create Booking Policy](https://dev.wix.com/docs/api-reference/business-solutions/bookings/policies/booking-policies/create-booking-policy) — `POST https://www.wixapis.com/bookings/v1/booking-policies`
- [Bulk Create Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/bulk-create-services) — `POST https://www.wixapis.com/bookings/v2/bulk/services/create`
- [Update Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/update-service) — `PATCH https://www.wixapis.com/bookings/v2/services/<SERVICE_ID>`
- [Query Services](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services) — `POST https://www.wixapis.com/bookings/v2/services/query`
