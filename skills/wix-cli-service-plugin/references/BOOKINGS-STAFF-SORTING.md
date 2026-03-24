# Bookings Staff Sorting Provider Service Plugin Reference

## Overview

The Staff Sorting Provider SPI allows you to implement custom staff assignment algorithms for Wix Bookings. When a booking slot has multiple available staff members, Wix calls your plugin to determine the priority order for staff assignment.

**FQDN**: `wix.interfaces.resources.sorting.v1.staff_sorting_provider`

## Import

```typescript
import { staffSorting } from "@wix/bookings/service-plugins";
```

## Handler

| Handler | Description |
| --- | --- |
| `sortStaffMembers` | Sort available staff members by priority for a given booking slot |

## Request and Response Schema

Before implementing, call `ReadFullDocsMethodSchema` with the docs URL below to get the full request/response types.

**MCP Tools to use:**
- `ReadFullDocsMethodSchema` - Full request/response schema with field names, types, and descriptions
- `ReadFullDocsArticle` - Full documentation with code examples (use if schema needs more context)

| Handler | Docs URL |
| --- | --- |
| `sortStaffMembers` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/staff-members/staff-sorting-service-plugin/sort-staff-members?apiView=SDK |

**Important constraints:**
- You must return the **exact same IDs** from `availableResourceIds`, reordered by priority
- Do not add or remove any IDs
- If your response is invalid, Wix falls back to random assignment

## Performance Requirements

- **Hard limit**: Response must be returned within **5 seconds**
- **Recommended**: Keep response time under **500ms** for optimal user experience

## Example: Workload Balancing

This example sorts staff members to balance workload by prioritizing those with fewer recent bookings.

```typescript
import { staffSorting } from "@wix/bookings/service-plugins";
import { auth } from "@wix/essentials";
import { bookings } from "@wix/bookings";

staffSorting.provideHandlers({
  sortStaffMembers: async (payload) => {
    const { request } = payload;
    const { availableResourceIds, slot } = request;

    // Query recent bookings for each available staff member
    const elevatedQuery = auth.elevate(bookings.queryBookings);
    const recentBookings = await elevatedQuery()
      .eq("resource.id", availableResourceIds)
      .ge("start.timestamp", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .find();

    // Count bookings per staff member
    const bookingCounts = new Map<string, number>();
    for (const id of availableResourceIds) {
      bookingCounts.set(id, 0);
    }
    for (const booking of recentBookings.items) {
      const resourceId = booking.resource?.id;
      if (resourceId && bookingCounts.has(resourceId)) {
        bookingCounts.set(resourceId, (bookingCounts.get(resourceId) ?? 0) + 1);
      }
    }

    // Sort by fewest bookings first (balance workload)
    const sorted = [...availableResourceIds].sort(
      (a, b) => (bookingCounts.get(a) ?? 0) - (bookingCounts.get(b) ?? 0)
    );

    return {
      staff: sorted.map((resourceId) => ({ resourceId })),
    };
  },
});
```

## Extension Registration

Register the staff sorting provider using the `bookingsStaffSortingProvider()` builder. This builder requires additional fields beyond the standard ones:

```typescript
import { extensions } from "@wix/astro/builders";

export const staffSorting = extensions.bookingsStaffSortingProvider({
  id: "{{GENERATE_UUID}}",
  name: "Workload Balanced Staff Assignment",
  source: "./backend/service-plugins/bookings-staff-sorting/workload-balancer/plugin.ts",
  methodName: "Workload Balancer",
  methodDescription: "Assigns staff members based on their recent booking count to balance workload evenly",
});
```

### Additional Builder Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `methodName` | string | Yes | Display name for the sorting method |
| `methodDescription` | string | Yes | Description of the sorting algorithm |
| `dashboardPluginId` | string | No | Optional dashboard plugin ID for configuration UI |

## Key Implementation Notes

1. **Return all IDs** - You must return every ID from `availableResourceIds`, just reordered
2. **Performance matters** - Keep logic fast; the booking flow waits for your response
3. **Elevate permissions** - Use `auth.elevate` when querying Wix APIs from the handler
4. **Deterministic sorting** - Use a tiebreaker (e.g., resource ID) when priorities are equal
5. **Graceful degradation** - If your external data source is unavailable, return the original order rather than failing
