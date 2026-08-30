---
name: "How to Code Rentals"
description: The frontend read/booking contract for a Wix Rentals site — a delta on how-to-code-bookings.md. Covers filtering the catalog to rentals, the two-call hourly availability flow (start slots then end options), the consecutive-day walk for daily rentals, duration-based price preview, and the createBooking → ecom Cart V2 → checkout-or-place sequence with the rentals app id. Specifies the *how* (modules + exact calls + rentals-specific failure modes); which rentals to render and how the page looks come from the request.
---
**RECIPE**: How to Code a Wix Rentals Frontend (Services V2 duration ranges + ecom Cart V2 checkout)

> **⚠️ Read `how-to-code-bookings.md` first — this recipe is a DELTA on it, not a replacement.** Wix Rentals runs on the Wix Bookings APIs, so the client setup, the schema-driven booking form, the `createBooking → ecom Cart V2 → checkout-or-place` sequence, the `postFlowUrl` HTTPS trap, and the anonymous read-back on the confirmation page are **all identical** and are documented there. This file covers **only what differs for a rental**: finding rentals, duration-range availability, duration-based pricing, and the handful of rentals-specific errors.

> **⚠️ There is no `@wix/rentals` package, and that is not a gap.** Rentals is `@wix/bookings` with rentals-specific field values. If a run concludes "Wix Rentals has no headless surface" because npm has no `@wix/rentals`, that conclusion is wrong — build on `@wix/bookings`. Reference: <https://dev.wix.com/docs/api-reference/business-solutions/rentals/introduction.md>

> **⚠️ Reading rule — always append `.md?apiView=SDK` to every doc link below.** The bare/REST view shows `id`; the SDK view shows `_id`, and the SDK is what your frontend calls.

---

## Constants and modules (the delta)

**Constants** (e.g. `src/services/constants.ts`):
- **Wix Rentals app id** — `ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e`. Used **twice**: to filter the catalog to rentals, and as the cart's `catalogReference.appId`.

**Modules** — all on `@wix/bookings`, alongside the ones `how-to-code-bookings.md` already lists:

| Need | Package | Module |
|---|---|---|
| Rental catalog with availability/attribute filters | `@wix/bookings` | `catalogSearch` (`queryServicesByFilters`) |
| Start times for a rental | `@wix/bookings` | `availabilityTimeSlots` (`listAvailabilityTimeSlots`) |
| End times for an **hourly** rental | `@wix/bookings` | `availabilityTimeSlots` (`listAvailabilityTimeSlotEndOptions`) |
| Duration-based price before booking | `@wix/bookings` | `pricing` (`previewPrice`) |
| Create the booking / cart / redirect | *(unchanged)* | see `how-to-code-bookings.md` |

---

## 1 · Find the rentals

**⚠️ CRITICAL: always filter by the rentals app id.** Rentals share every API with Bookings. On a site that has both, an unfiltered `queryServices` returns haircuts next to meeting rooms. Every catalog read must carry `appId = ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e`.

`catalogSearch.queryServicesByFilters` is the right entry point for a rental catalog: it filters **and** resolves availability in one call.

```js
const { results, pagingMetadata } = await catalogSearch.queryServicesByFilters({
  query: {
    filter: { appId: RENTALS_APP_ID },
    sort: [{ fieldName: 'name', order: 'ASC' }],
    cursorPaging: { limit: 20 },
  },
  serviceFilters: {
    localStartDate: '2026-09-01T00:00:00',   // omit the window entirely to skip the availability check
    localEndDate:   '2026-09-07T23:59:59',
    timeZone: 'America/New_York',
  },
});
```

- Each entry in `results` carries the full `service` plus an **`available`** flag. With a window set and `exactMatch` left unset, a service comes back when it has **at least one** bookable slot anywhere in the window.
- **To grey out rather than hide** fully-booked rentals, set `serviceFilters.includeUnavailable: true` — those come back with `available: false`.
- **Paginate** by passing `pagingMetadata.cursors.next` back **unchanged** as `query.cursorPaging.cursor`, until `next` is absent.
- **Location and attribute filters** live in `serviceFilters` too — `locationIds`, `resourceTypes`, and `attributes`. Within one attribute, values are **match-any**; across different attributes, **match-all**.
- With **no** date range, no availability check runs and everything returns `available: true`.

Doc: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/catalog-search/query-services-by-filters.md?apiView=SDK>

**Read the range off the service** to drive the UI — it tells you which of the two flows below applies:

```js
const range = service.schedule?.availabilityConstraints?.durationRange;
const isDaily = range?.unitType === 'DAY';
const min = isDaily ? range.dayOptions.minDurationInDays    : range.hourOptions.minDurationInMinutes;
const max = isDaily ? range.dayOptions.maxDurationInDays    : range.hourOptions.maxDurationInMinutes;
```

A service whose `durationRange` is absent is **not** a rental — it's a fixed-duration service; render it with the bookings flow instead.

---

## 2 · Hourly availability — two calls, start then end

A fixed-duration service has one slot list. A rental has **two steps**: the customer picks a start, then picks how long.

**Step 1 — start times.**

```js
const { timeSlots } = await availabilityTimeSlots.listAvailabilityTimeSlots({
  serviceId,
  timeZone,
  fromLocalDate: '2026-09-01T00:00:00',
  toLocalDate:   '2026-09-01T23:59:00',
  includeResourceTypeIds: [resourceTypeId],   // the service's primaryResourceType
  bookable: true,
});
```

**⚠️ Pass `includeResourceTypeIds` with the service's `primaryResourceType`, or the slots come back with no resource to book.** Each slot then carries its bookable resource in `availableResources` — carry that forward, `createBooking` needs it.

**Step 2 — end times for the chosen start.**

```js
const { timeSlots: endOptions } = await availabilityTimeSlots.listAvailabilityTimeSlotEndOptions(
  serviceId,                                   // ⚠️ POSITIONAL first argument, not part of the options object
  { localStartDate: selected.localStartDate, timeZone, location: selected.location },
);
```

- **`location` is REQUIRED** — pass the selected slot's own `location` straight through. Omitting it fails the call.
- The service's **maximum duration caps the response**, so you don't need `maxLocalEndDate`.
- Every entry shares the requested `localStartDate` and differs only in **`localEndDate`** — that is the end-time picker.
- **`availableResources` is always empty on end options**, and `totalCapacity` is always `1`. Take the resource from **step 1**, not from here.
- **⚠️ `END_OPTIONS_NOT_SUPPORTED`** means you called this for a **daily** or a fixed-duration service. End options are hourly-only — branch on `unitType` before calling.

Docs: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slot-end-options.md?apiView=SDK>

---

## 3 · Daily availability — one call, then walk the days yourself

There is **no end-options call for daily rentals.** You list days and compute the valid end dates client-side.

```js
const { timeSlots } = await availabilityTimeSlots.listAvailabilityTimeSlots({
  serviceId, timeZone,
  fromLocalDate, toLocalDate,
  timeSlotsPerDay: 1,                          // ⚠️ one slot per day — this is what makes it a day list
  includeResourceTypeIds: [resourceTypeId],
  bookable: true,
});
```

After the customer picks a start date, **iterate forward through the returned list and stop at the first gap, or when you hit the service's `maxDurationInDays`.** Those are the selectable end dates. A naive "start + max days" range will offer dates across a gap and then fail at booking time.

**How a daily rental is stored depends on the resource's working hours — and it changes which call you make:**

| Resource | Stored as | Booking call |
|---|---|---|
| **24/7** (no working-hours schedule) — the `setup-rentals.md` default | **one** booking spanning the whole range | `createBooking` |
| **Has working hours** | a **linked group**, one booking per working day (2–8) | `createMultiServiceBooking` with `multiServiceBookingType: 'SEQUENTIAL_BOOKINGS'` |

For the **24/7** case, set the boundaries to midnight-to-midnight: `startDate` = midnight on the first day, `endDate` = **midnight on the day after the last day**. A Monday–Wednesday inclusive rental ends at midnight on **Thursday**. **⚠️ Wix derives `allDay` itself — do not set it.**

For the **working-hours** case, build one booking per day with that day's own working-period start and end (e.g. 09:00 → 18:00), and send them together. The group is created **all or nothing**: any unavailable or non-consecutive day fails the whole call. **Save `multiServiceBookingInfo.id` from the response in your own records** — you need it to cancel the group later, and `multiServiceBookingInfo` is **not** exposed on the bookings you read back afterwards.

Docs: <https://dev.wix.com/docs/api-reference/business-solutions/rentals/about-wix-rentals-availability.md> · <https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-multi-service-booking.md?apiView=SDK>

---

## 4 · Price preview (duration-based)

A rental's price depends on its length, so show the total before booking.

```js
const { priceInfo } = await pricing.previewPrice([{
  serviceId,
  resourceId,                       // required for appointment-based services
  localStartDate: '2026-09-01T09:00:00',
  localEndDate:   '2026-09-01T14:00:00',
  timeZone,                         // required whenever the local dates are sent
}]);
// priceInfo.calculatedPrice
```

**⚠️ Omitting `localStartDate` / `localEndDate` / `timeZone` does not error — it silently falls back to participant-based pricing** and returns a flat rate that ignores the duration. The customer then sees one price and is charged another. Always send all three.

Hourly is prorated per minute (`minutes × base ÷ 60`); daily is `base × days`. Doc: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/pricing/pricing-api/preview-price.md?apiView=SDK>

---

## 5 · Book and check out

**Identical to `how-to-code-bookings.md` § "createBooking → cart → checkout"**, with three substitutions:

1. **`endDate` is the customer's chosen end**, not a duration added to the start — that is the whole point of a rental.
2. **`resource`** comes from the **start slot's** `availableResources` (§2 step 1 / §3). There is no ANY_RESOURCE staff fallback here; rentals are resource-driven.
3. **The cart's `catalogReference.appId` is the RENTALS app id**, not the Bookings one:

```js
const cart = await createCart({
  catalogItems: [{ quantity: 1, catalogReference: { catalogItemId: bookingId, appId: RENTALS_APP_ID } }],
  cart: { source: { channelType: 'WEB' } },
});
```

Everything downstream — `calculateCart`, the checkout-vs-`placeOrder` decision, `redirects.createRedirectSession`, the HTTPS `postFlowUrl` rule, and reading the booking back anonymously on the confirmation page — is unchanged. Follow `how-to-code-bookings.md`.

---

## Rentals-specific failure modes

| Error | Cause | Handling |
|---|---|---|
| `END_OPTIONS_NOT_SUPPORTED` | End options called for a daily or fixed-duration service | Branch on `durationRange.unitType` before calling |
| `INVALID_DURATION_PROVIDED` | Chosen length falls outside the service's range | The response carries the allowed range — show it and return the customer to the picker |
| `SLOT_NOT_AVAILABLE` | The slot was taken between selection and booking | Return to the slot picker and refresh availability |
| Empty availability, no error | The service's resource type has **no resources** | A seed bug, not a frontend one — see `setup-rentals.md` STEP 2 |
| Rentals mixed with appointments | A catalog read without the `appId` filter | Add `appId` to `query.filter` (§1) |
| Price differs from what was shown | Price preview sent without `localStartDate`/`localEndDate`/`timeZone` | Send all three (§4) |

---

## Conclusion

- Rentals is **`@wix/bookings`** — there is no `@wix/rentals`, and its absence is not a missing capability.
- **Every catalog read filters on the rentals `appId`**, or a mixed site shows the wrong services.
- **Hourly** = two availability calls (start, then end options, hourly-only, `location` required, `serviceId` positional). **Daily** = one call with `timeSlotsPerDay: 1`, then walk consecutive days client-side.
- **Daily storage follows the resource:** 24/7 → one booking (midnight to midnight-after, never set `allDay`); working hours → a sequential multi-service group whose id you must persist yourself.
- **Price preview needs both local dates and the time zone**, or it silently returns a duration-blind price.
- Booking, cart, checkout and confirmation are the **bookings** flow, with the rentals app id on the cart's `catalogReference`.
