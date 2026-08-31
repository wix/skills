---
name: "How to Code Rentals"
description: The frontend read/booking contract for a Wix Rentals site — a delta on how-to-code-bookings.md. Covers filtering the catalog to rentals, the two-call hourly availability flow (start slots then end options), the consecutive-day walk for daily rentals, duration-based price preview, and the createBooking → ecom Cart V2 → checkout-or-place sequence with the rentals app id. Specifies the *how* (modules + exact calls + rentals-specific failure modes); which rentals to render and how the page looks come from the request.
---
**RECIPE**: How to Code a Wix Rentals Frontend (Services V2 duration ranges + ecom Cart V2 checkout)

> **⚠️ Read `how-to-code-bookings.md` first — this recipe is a DELTA on it, not a replacement.** Wix Rentals runs on the Wix Bookings APIs, so the client setup, the schema-driven booking form, the `createBooking → ecom Cart V2 → checkout-or-place` sequence, the `postFlowUrl` HTTPS trap, and the anonymous read-back on the confirmation page are **all identical** and are documented there. This file covers **only what differs for a rental**: finding rentals, duration-range availability, duration-based pricing, and the handful of rentals-specific errors.

> **⚠️ There is no `@wix/rentals` package, and that is not a gap.** Rentals is `@wix/bookings` with rentals-specific field values. If a run concludes "Wix Rentals has no headless surface" because npm has no `@wix/rentals`, that conclusion is wrong — build on `@wix/bookings`.
>
> **Rentals doc set** (four pages, where to go beyond this recipe): [About Wix Rentals](https://dev.wix.com/docs/api-reference/business-solutions/rentals/introduction.md) · [Rentals and the Bookings APIs](https://dev.wix.com/docs/api-reference/business-solutions/rentals/wix-rentals-and-the-bookings-apis.md) (concept → API map) · [About Rentals Availability](https://dev.wix.com/docs/api-reference/business-solutions/rentals/about-wix-rentals-availability.md) · [Sample Flows](https://dev.wix.com/docs/api-reference/business-solutions/rentals/sample-flows.md) (the booking sequences below, end to end).

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
    localEndDate:   '2026-09-08T00:00:00',   // exclusive — start of the day AFTER the window
    timeZone: 'America/New_York',
  },
});
```

- Each entry in `results` carries the full `service` plus an **`available`** flag. With a window set and `exactMatch` left unset, a service comes back when it has **at least one** bookable slot anywhere in the window.
- **End the window at `00:00:00` of the day *after* the range you want, not at `23:59:59`.** The end boundary is exclusive, so a 23:59:59 end silently drops the last minute of the final day. This matches the daily-booking convention in §3, where a rental's `endDate` is midnight of the day after the last rented day.
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

---

## 2 · Hourly availability — two calls, start then end

A fixed-duration service has one slot list. A rental has **two steps**: the customer picks a start, then picks how long.

**Step 1 — start times.**

```js
const { timeSlots } = await availabilityTimeSlots.listAvailabilityTimeSlots({
  serviceId,
  timeZone,
  fromLocalDate: '2026-09-01T00:00:00',
  toLocalDate:   '2026-09-02T00:00:00',   // exclusive — start of the next day, not 23:59
  includeResourceTypeIds: [resourceTypeId],   // the service's primaryResourceType
  bookable: true,
});
```

**⚠️ Pass `includeResourceTypeIds` with the service's `primaryResourceType`, or the slots come back with no resource to book.** Each slot then carries its bookable resource in `availableResources` — carry that forward, `createBooking` needs it.

**Step 2 — end times for the chosen start.**

```js
const { endOptions } = await availabilityTimeSlots.listAvailabilityTimeSlotEndOptions(
  serviceId,                                   // ⚠️ POSITIONAL first argument, not part of the options object
  { localStartDate: selected.localStartDate, timeZone, location: selected.location },
);
```

- **⚠️ The response field is `endOptions`, NOT `timeSlots`.** `listAvailabilityTimeSlots` returns `timeSlots`; this call returns `endOptions`. Destructuring `timeSlots` here yields `undefined` and **no error** — the end-time picker just renders empty, which is indistinguishable from "no availability". If your length picker is mysteriously blank, check this first.
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
  timeSlotsPerDay: 1,
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
  numberOfParticipants: 1,          // always 1 for a rental — see below
  localStartDate: '2026-09-01T09:00:00',
  localEndDate:   '2026-09-01T14:00:00',
  timeZone,                         // required whenever the local dates are sent
}]);
// priceInfo.calculatedPrice
```

**⚠️ `numberOfParticipants` is required and is always `1` for a rental.** Omitting it, or sending `0`, fails with `NUMBER_OF_PARTICIPANTS_NOT_FOUND`. A rental isn't a class: one booking takes one resource, so participant count never drives the price — the duration does. The room's stated capacity ("seats 8") is a resource **attribute** for display, not a participant count. Same reasoning as `defaultCapacity: 1` on the service (`setup-rentals.md` STEP 4).

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

Everything downstream — `calculateCart`, the checkout-vs-`placeOrder` decision, `redirects.createRedirectSession` and the HTTPS `postFlowUrl` rule — is unchanged. Follow `how-to-code-bookings.md`.

**⚠️ Don't use the anonymous read-back on the confirmation page.** `how-to-code-bookings.md` mints a token with `getAnonymousActionToken` after `createBooking`; that method's scope is **Manage Bookings**, so a visitor gets 403 and it returns `BOOKING_NOT_FOUND` for rentals bookings. Drive the confirmation page from what you already hold, and never render "confirmed" off the redirect return alone.

---

## 6 · SEO on item pages, and images

**⚠️ There is no `WIX_APPS.rentals.*` and no `seoTags.ItemType.RENTAL`** — a rental detail page is a **Bookings service** item page, so it uses the **bookings** accessors:

- **`wixMetadata`** from `WIX_APPS.bookings.servicePageMetadata` — referenced **directly** in the export (module scope). Route param `slug` → `identifiers.slug`.
- **`itemType`**: `seoTags.ItemType.BOOKINGS_SERVICE`.

Everything else about the three-step item-page SEO wiring (`wixMetadata` export → `loadSEOTagsServiceConfig(...)` → `<SEO.Tags>`, and running the config load in the same `Promise.all` with `.catch(() => null)`) is identical to `how-to-code-bookings.md` § "SEO on item pages".

**Images** are the same trap too: `service.media.mainMedia.image` is a **string** holding a `wix:image://v1/…` URI, **not** an absolute URL. Resolve with `media.getImageUrl(...)` from `@wix/sdk` before putting it in `<img src>`, and guard items with no image.

**Mount the slot picker, length picker and book action in a client-only island** (Astro) — availability is timezone- and session-specific. SSR only the catalog and detail reads, for SEO.

---

## Rentals-specific failure modes

| Error | Cause | Handling |
|---|---|---|
| Empty length picker, no error | Destructured `timeSlots` from end options instead of **`endOptions`** | Rename the destructure (§2) |
| `END_OPTIONS_NOT_SUPPORTED` | End options called for a daily or fixed-duration service | Branch on `durationRange.unitType` before calling |
| `INVALID_DURATION_PROVIDED` | Chosen length falls outside the service's range | The response carries the allowed range — show it and return the customer to the picker |
| `SLOT_NOT_AVAILABLE` | The slot was taken between selection and booking | Return to the slot picker and refresh availability |
| Empty availability, no error | The service's resource type has **no resources** | A seed bug, not a frontend one — see `setup-rentals.md` STEP 2 |
| Rentals mixed with appointments | A catalog read without the `appId` filter | Add `appId` to `query.filter` (§1) |
| `NUMBER_OF_PARTICIPANTS_NOT_FOUND` | `numberOfParticipants` missing or `0` on the price preview | Send `1` — always 1 for a rental (§4) |
| Price differs from what was shown | Price preview sent without `localStartDate`/`localEndDate`/`timeZone` | Send all three (§4) |
| `403`, then `BOOKING_NOT_FOUND` when elevated | `getAnonymousActionToken` — it needs the Manage Bookings scope and doesn't work for rentals | Don't use the anonymous read-back (§5) |
| Hunting for `WIX_APPS.rentals.*` or `seoTags.ItemType.RENTAL` | Neither exists | Use the **bookings** accessors — a rental detail page *is* a Bookings service page (§6) |
| `.image.url` fails `tsc`, or images render broken | `media.mainMedia.image` is a **string** holding a `wix:image://` URI | `media.getImageUrl(...)` from `@wix/sdk` (§6) |

---

## Out of scope

**Cancellation and post-booking self-service.** The docs describe cancel flows, but they need admin-scope reads the anonymous visitor doesn't have — the same axis as the bookings recipe's waitlist/manage-cancel exclusion. Two rentals-specific notes if a run does build them server-side:

- A **single** rental (hourly, or daily on a 24/7 resource) cancels with `cancelBooking` and its current `revision`.
- A **multi-day group** (daily on a working-hours resource) cancels with `cancelMultiServiceBooking` and the **`multiServiceBookingInfo.id` you persisted at creation** (§3) — it is *not* readable back off the individual bookings afterwards. A site that builds the working-hours daily flow without storing that id has no way to cancel the group.

Refunds are the eCommerce Orders API, not Bookings. Also out of scope, as in bookings: waitlists, deposit/payment breakdowns, and multi-item rental carts.

## Conclusion

- Rentals is **`@wix/bookings`** — there is no `@wix/rentals`, and its absence is not a missing capability.
- **Every catalog read filters on the rentals `appId`**, or a mixed site shows the wrong services.
- **Hourly** = two availability calls (start → `timeSlots`, then end options → **`endOptions`**, hourly-only, `location` required, `serviceId` positional). **Daily** = one call with `timeSlotsPerDay: 1`, then walk consecutive days client-side.
- **Daily storage follows the resource:** 24/7 → one booking (midnight to midnight-after, never set `allDay`); working hours → a sequential multi-service group whose id you must persist yourself.
- **Price preview needs both local dates and the time zone**, or it silently returns a duration-blind price.
- Booking, cart, checkout and confirmation are the **bookings** flow, with the rentals app id on the cart's `catalogReference`.
- **SEO and images are the bookings ones too** — `WIX_APPS.bookings.servicePageMetadata` and `seoTags.ItemType.BOOKINGS_SERVICE`; there is no rentals-specific accessor to find.
