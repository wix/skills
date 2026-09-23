# Bookings Validation Service Plugin Reference

## Overview

The Bookings Validation SPI lets you implement custom validation logic for booking operations. When a customer creates, cancels, or reschedules a booking (single-service or multi-service), Wix calls the handler matching that operation before it executes. Return `valid: true` to allow the operation or `valid: false` to block it with a customer-facing message.

Implement only the handlers for the validation targets you actually support — you don't need all six.

## Handlers

| Handler | Validation target | On error/timeout |
| --- | --- | --- |
| `validateBeforeCreate` | `CREATE` | Blocked (fail-closed) |
| `validateBeforeCancel` | `CANCEL` | Blocked (fail-closed) |
| `validateBeforeReschedule` | `RESCHEDULE` | Continues (fail-open) |
| `validateBeforeCreateMultiService` | `CREATE_MULTI_SERVICE` | Blocked (fail-closed) |
| `validateBeforeCancelMultiService` | `CANCEL_MULTI_SERVICE` | Blocked (fail-closed) |
| `validateBeforeRescheduleMultiService` | `RESCHEDULE_MULTI_SERVICE` | Continues (fail-open) |

## Request and Response Schema

Before implementing, call `ReadFullDocsMethodSchema` on each docs URL to get the full request/response types.

| Handler | Docs URL |
| --- | --- |
| `validateBeforeCreate` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/validate-before-create?apiView=SDK |
| `validateBeforeCancel` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/validate-before-cancel?apiView=SDK |
| `validateBeforeReschedule` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/validate-before-reschedule?apiView=SDK |
| `validateBeforeCreateMultiService` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/validate-before-create-multi-service?apiView=SDK |
| `validateBeforeCancelMultiService` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/validate-before-cancel-multi-service?apiView=SDK |
| `validateBeforeRescheduleMultiService` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-validation-service-plugin/validate-before-reschedule-multi-service?apiView=SDK |

**Correlation differs by handler — this is easy to get wrong, and doing so fails `tsc`, not just at runtime:**

| Handler(s) | Item shape | Max items | Result correlates by |
| --- | --- | --- | --- |
| `validateBeforeCreate`, `validateBeforeCreateMultiService` | `{ itemIndex, booking }` | 40 | `itemIndex` |
| `validateBeforeCancel`, `validateBeforeReschedule`, and their multi-service equivalents | `{ booking }` — **no `itemIndex` field at all** | 8 | `bookingId` (from `booking._id`) |

Only the create family carries `itemIndex`; cancel and reschedule items don't have one, so their results key on the booking's own ID instead. The single-service response field is `results`; the multi-service response field is `singleServiceBookingResults` — same per-item shape either way. Omitting an item's result treats it as valid. `contactDetails` and resource `name`/`email` fields are redacted before reaching your handler.

## Example: Membership Limit and Cancellation Fee

This example enforces a pricing-plan booking limit on create, and blocks late cancellations.

```typescript
import { bookingsValidation } from "@wix/bookings/service-plugins";
import { auth } from "@wix/essentials";
import { orders } from "@wix/pricing-plans";

bookingsValidation.provideHandlers({
  validateBeforeCreate: async (payload) => {
    const { request } = payload;

    const results = await Promise.all(
      request.items.map(async (item) => {
        const memberId = item.booking?.contactDetails?.contactId;
        if (!memberId) {
          return { itemIndex: item.itemIndex, result: { valid: true } };
        }

        const elevatedListOrders = auth.elevate(orders.listOrders);
        const { orders: activeOrders } = await elevatedListOrders({
          filter: { buyerId: memberId, status: ["ACTIVE"] },
        });

        if ((activeOrders ?? []).length === 0) {
          return {
            itemIndex: item.itemIndex,
            result: {
              valid: false,
              invalidReason: {
                message: "An active membership is required to book this service.",
                fieldViolations: [
                  { field: "booking.contactDetails", description: "No active membership found.", code: "PLAN_EXPIRED" },
                ],
              },
            },
          };
        }

        return { itemIndex: item.itemIndex, result: { valid: true } };
      })
    );

    return { results };
  },

  validateBeforeCancel: async (payload) => {
    const { request } = payload;

    // Cancel items carry no itemIndex — correlate results by the booking's own _id.
    const results = request.items.map((item) => {
      const bookingId = item.booking?._id;
      const startDate = item.booking?.bookedEntity?.slot?.startDate;
      const hoursUntilStart = startDate
        ? (new Date(startDate).getTime() - Date.now()) / (1000 * 60 * 60)
        : Infinity;

      if (hoursUntilStart < 24) {
        return {
          bookingId,
          result: {
            valid: false,
            invalidReason: { message: "Cancellations within 24 hours of the appointment aren't allowed." },
          },
        };
      }

      return { bookingId, result: { valid: true } };
    });

    return { results };
  },
});
```

## Manual Setup Required

None — confirmed live via the real Cancel Booking API: a cancellation under 24h was correctly blocked with a structured `428 VALIDATION_FAILED`, and one over 24h correctly succeeded. Wix calls this plugin automatically on the relevant booking operations once the app is installed and released.

## Key Implementation Notes

1. **Bulk requests, per-item results** — return a result for every item you received (keyed by `itemIndex` on create, by `bookingId` on cancel/reschedule — see the correlation table above); a missing entry is treated as valid, not rejected.
2. **Respond fast** — `validateBeforeCreate`, `validateBeforeCancel`, and their multi-service equivalents fail-closed (block the operation) on error or timeout; `validateBeforeReschedule` and its multi-service equivalent fail-open (allow it).
3. **Multiple providers run concurrently** — if other apps also register validators for the same target, any single rejection blocks the operation.
4. **Write customer-facing messages** — `invalidReason.message` and `fieldViolations[].description` are shown to the customer; keep them clear and free of internal jargon. `fieldViolations[].code` is for your own programmatic handling, not display.
5. **Elevate permissions** — use `auth.elevate` when querying Wix APIs (e.g., pricing plan orders) from the handler.
