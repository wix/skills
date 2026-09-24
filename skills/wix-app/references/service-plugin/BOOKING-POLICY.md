# Booking Policy Service Plugin Reference

## Overview

The Booking Policy SPI lets you provide dynamic booking policies instead of a service's single static policy. Wix calls your `listBookingPolicies` handler whenever it needs to know how early/late a service can be booked or whether online booking is allowed — for example, when a customer loads the booking calendar or books a service. Your implementation can return a different policy for the same service based on your own criteria (e.g., customer type, time of year).

## Request and Response Schema

Before implementing, call `ReadFullDocsMethodSchema` on the docs URL to get the full request/response types.

| Handler | Docs URL |
| --- | --- |
| `listBookingPolicies` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/policies/booking-policy-service-plugin/list-booking-policies?apiView=SDK |

The request's `serviceIds` array has 1–8 service GUIDs. Your response's `bookingPolicies` array must contain exactly one policy per requested service, **in the same order** — all fields are required unless the schema marks them optional.

## Example: Different Early-Booking Windows by Service Category

```typescript
import { bookingPolicy } from "@wix/bookings/service-plugins";
import { auth } from "@wix/essentials";
import { services } from "@wix/bookings";

bookingPolicy.provideHandlers({
  listBookingPolicies: async (payload) => {
    const { request } = payload;
    const { serviceIds } = request;

    // queryServices is a fluent query builder, not a request-object call — it returns { items }, not { services }.
    const elevatedQueryServices = auth.elevate(services.queryServices);
    const { items: matchedServices } = await elevatedQueryServices().in('_id', serviceIds).find();
    const serviceById = new Map((matchedServices ?? []).map((s) => [s._id, s]));

    const bookingPolicies = serviceIds.map((serviceId) => {
      const isPremium = serviceById.get(serviceId)?.category?.name === "Premium";

      return {
        serviceId,
        limitEarlyBooking: {
          enabled: true,
          earliestBookingInMinutes: isPremium ? 20160 : 10080, // 14 vs 7 days
        },
        limitLateBooking: {
          enabled: true,
          latestBookingInMinutes: 1440, // 1 day
        },
        onlineBooking: { enabled: true },
      };
    });

    return { bookingPolicies };
  },
});
```

## Manual Setup Required

None. Confirmed the overall availability/policy pipeline this plugin feeds into is live and enforcing real constraints (a dashboard booking attempt was correctly rejected for being outside staff working hours) — this SPI's own specific early/late-booking window differentiation wasn't isolated independently of that pipeline, but no dashboard configuration is needed beyond having the app installed and released.

## Key Implementation Notes

1. **One policy per service, same order** — the response array must line up positionally with the request's `serviceIds`; don't omit or reorder entries.
2. **All fields required unless marked optional** — return `limitEarlyBooking`, `limitLateBooking`, and `onlineBooking` fully populated rather than partially.
3. **Called on the hot path** — this handler runs whenever availability is queried or a booking is made, so keep it fast and avoid unnecessary external calls.
4. **Elevate permissions** — use `auth.elevate` when querying Wix APIs (e.g., service details) from the handler.
