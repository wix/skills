# Availability Time Slots Configuration Service Plugin Reference

## Overview

The Availability Time Slots Configuration SPI lets you customize how Wix calculates available time slots for booking services: duration, split interval, buffer time, locations, and required/available resources. Wix calls your `listAvailabilityTimeSlotConfigurations` handler whenever a customer views available times or books a service. [Resources](https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/resources-v2/introduction) must already exist before time slot calculation runs.

## ⚠️ `resourceTypeId` is not a placeholder you can invent

`resourceTypes[].resourceTypeId` must be a real resource type ID or Wix rejects every availability query for the service — confirmed live: a made-up GUID here 500s `List Availability Time Slots` and fails booking creation with `FAILED_VALIDATING_AVAILABILITY`, for every service on the site, not just the one you're configuring. If the service is staffed (the common case), use the universal Wix Bookings staff-member resource type ID, which is the same across every site — it is not something you provision or look up per site:

```typescript
const STAFF_MEMBER_RESOURCE_TYPE_ID = '1cd44cf8-756f-41c3-bd90-3e2ffcaf1155';
```

For a non-staff resource (a room, piece of equipment, etc.), get the real ID from [Get Resource](https://dev.wix.com/docs/api-reference/business-solutions/bookings/resources/resources-v2/get-resource) (`resource.typeId`) — never fabricate one.

## ⚠️ `resourceTypes[].resourceIds` — populate it, don't leave it implicit

`resourceIds` ("IDs of resources available for booking within this resource type... may be a subset of all resources in the type") tells Wix *which* resources of that type are valid for this specific service. Omitting it (relying on `resourceTypeId` alone) was part of the same live 500 chain above — once `resourceTypeId` and `scheduleId` were both fixed, availability queries still failed until `resourceIds` was populated too. Get the service's actual assigned staff from [Get Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/get-service)'s `service.staffMemberIds`.

## ⚠️ `scheduleId` is required — omitting it also 500s

The response schema requires `scheduleId` (confirmed live: leaving it out 500s the same as a bad `resourceTypeId`), but it's easy to miss since it's not mentioned in the request/response summary above. Fetch it from the service itself — [Get Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/get-service)'s `service.schedule._id` (REST docs call this field `id`; the SDK's `Service.schedule` type names it `_id`):

```typescript
import { auth } from "@wix/essentials";
import { services } from "@wix/bookings";

const elevatedGetService = auth.elevate(services.getService);
const service = await elevatedGetService(serviceId);
const scheduleId = service.schedule?._id;
```

## ⚠️ `locations[]._id` is required when `locationType` is `BUSINESS`

The schema notes `_id` is "returned only for business locations" — read that as *required whenever `locationType: BUSINESS`*, not optional. Omitting it was the third and last piece of the same live 500 chain. Get the service's actual configured locations from [Get Service](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/get-service)'s `service.locations[]` (each has its own `_id`) rather than hardcoding a bare `{ locationType: "BUSINESS" }`.

## Manual Setup Required

None for activation — Wix calls this plugin automatically once installed and released. But get all three fields above right, or every availability query for every service on the site fails with a bare 500, not just a validation error on the one service you're configuring.

## Request and Response Schema

Before implementing, call `ReadFullDocsMethodSchema` on the docs URL to get the full request/response types.

| Handler | Docs URL |
| --- | --- |
| `listAvailabilityTimeSlotConfigurations` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/availability-time-slots-configuration-service-plugin/list-availability-time-slot-configurations?apiView=SDK |

The request's `services` array (up to 100 entries) lists each service to configure, with the customer's `customerChoices` (selected duration variant and/or add-ons) — the same service GUID can appear more than once with different choices. Your response's `configurations` array must contain exactly one configuration per requested entry, **in the same order**, with `resourceTypes`, `locations`, and `scheduleId` fully populated.

For services with a bookable duration **range** (the customer picks how long to book), return `durationUnit` (`HOUR` or `DAY`) with `minDuration`/`maxDuration` instead of a fixed `duration`; for hourly ranges also return `duration.defaultInMinutes` as the minimum.

## Example: Duration From Add-Ons, Single Resource Type

```typescript
import { availabilityTimeSlotsConfiguration } from "@wix/bookings/service-plugins";
import { auth } from "@wix/essentials";
import { services } from "@wix/bookings";

// Universal Wix Bookings staff-member resource type ID — same on every site, not per-site data.
const STAFF_MEMBER_RESOURCE_TYPE_ID = "1cd44cf8-756f-41c3-bd90-3e2ffcaf1155";

availabilityTimeSlotsConfiguration.provideHandlers({
  listAvailabilityTimeSlotConfigurations: async (payload) => {
    const { request } = payload;
    const { services: requestedServices } = request;

    // scheduleId is required in the response but isn't in the request — fetch it per service.
    const elevatedGetService = auth.elevate(services.getService);
    const serviceById = new Map(
      await Promise.all(
        requestedServices.map(async ({ serviceId }) =>
          [serviceId, serviceId ? await elevatedGetService(serviceId) : undefined] as const
        )
      )
    );

    const configurations = requestedServices.map(({ serviceId, customerChoices }) => {
      const baseDuration = 60;
      const addOnMinutes = (customerChoices?.addOnIds ?? []).length * 15;
      const service = serviceById.get(serviceId);

      return {
        serviceId,
        resourceTypes: [
          {
            resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID,
            resourceIds: service?.staffMemberIds ?? [],
            numberOfResourcesRequired: 1,
          },
        ],
        locations: (service?.locations ?? []).map((location) => ({
          _id: location._id,
          locationType: availabilityTimeSlotsConfiguration.LocationType.BUSINESS,
        })),
        splitIntervalInMinutes: baseDuration + addOnMinutes,
        duration: { defaultInMinutes: baseDuration + addOnMinutes },
        bufferTimeInMinutes: 10,
        scheduleId: service?.schedule?._id,
      };
    });

    return { configurations };
  },
});
```

## Key Implementation Notes

1. **One configuration per requested entry, same order** — the response array must line up positionally with the request's `services`, even when the same service GUID repeats with different `customerChoices`.
2. **Prefer `addOnIds` over `durationInMinutes`** in the request — when both are present they must agree, so let Wix Bookings compute total duration from add-ons rather than passing a duration you'd have to keep in sync.
3. **`splitIntervalInMinutes` vs `duration`** — when the split interval matches the service duration, `splitIntervalInMinutes` is `duration.defaultInMinutes + bufferTimeInMinutes`.
4. **Duration ranges** — use `durationUnit` for services where the customer picks the length of the booking; leave `duration` empty for `DAY`-unit ranges.
5. **Called on the hot path** — this handler runs on every availability query, so keep it fast.
