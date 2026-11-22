---
name: "How to Code Rentals"
description: The frontend read/booking contract for a Wix Rentals site — a delta on how-to-code-bookings.md. Covers filtering the catalog to rentals, the two-call hourly availability flow (start slots then end options), the consecutive-day walk for daily rentals, duration-based price preview, and the createBooking → ecom Cart V2 → checkout-or-place sequence with the rentals app id. Specifies the *how* (modules + exact calls + rentals-specific failure modes); which rentals to render and how the page looks come from the request.
---
**RECIPE**: How to Code a Wix Rentals Frontend (Services V2 duration ranges + ecom Cart V2 checkout)

> **⚠️ Read `how-to-code-bookings.md` first — this recipe is a DELTA on it, not a replacement.** Wix Rentals runs on the Wix Bookings APIs, so the client setup, the schema-driven booking form, the `createBooking → ecom Cart V2 → checkout-or-place` sequence, and the `postFlowUrl` HTTPS trap are **all identical** and are documented there. This file covers **only what differs for a rental**: finding rentals, duration-range availability, duration-based pricing, and the handful of rentals-specific errors.

> **⚠️ There is no `@wix/rentals` package, and that is not a gap.** Rentals is `@wix/bookings` with rentals-specific field values. If a run concludes "Wix Rentals has no headless surface" because npm has no `@wix/rentals`, that conclusion is wrong — build on `@wix/bookings`.
>
> **Rentals doc set** (four pages, where to go beyond this recipe): [About Wix Rentals](https://dev.wix.com/docs/api-reference/business-solutions/rentals/introduction.md) · [Rentals and the Bookings APIs](https://dev.wix.com/docs/api-reference/business-solutions/rentals/wix-rentals-and-the-bookings-apis.md) (concept → API map) · [About Rentals Availability](https://dev.wix.com/docs/api-reference/business-solutions/rentals/about-wix-rentals-availability.md) · [Sample Flows](https://dev.wix.com/docs/api-reference/business-solutions/rentals/sample-flows.md) (the booking sequences below, end to end).

> **⚠️ Reading rule — always append `.md?apiView=SDK` to every doc link below.** The bare/REST view shows `id`; the SDK view shows `_id`, and the SDK is what your frontend calls.

---

## Constants and modules (the delta)

**Constants** (e.g. `src/services/constants.ts`):
- **Wix Rentals app id** — `ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e`. Used **three times**: to filter the catalog to rentals, as the cart's `catalogReference.appId`, and to filter bookings reads (§Cancellation).

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
- **To grey out rather than hide** unavailable rentals, set `serviceFilters.includeUnavailable: true` — those come back with `available: false`.
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
- The service's **maximum duration caps the response**, so you don't need `maxLocalEndDate` — the cap defaults to `localStartDate` plus that maximum. What you actually get back also depends on availability: the options stop earlier if the resource isn't free that long, so the last end option is whichever comes first — the maximum duration, or the end of the free period.
- Every entry shares the requested `localStartDate` and differs only in **`localEndDate`** — that is the end-time picker.
- **`availableResources` is always empty on end options**, and `totalCapacity` is always `1`. Take the resource from **step 1**, not from here.
- **⚠️ `END_OPTIONS_NOT_SUPPORTED`** means you called this for a **daily** or a fixed-duration service. End options are hourly-only — branch on `unitType` before calling.

Docs: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slot-end-options.md?apiView=SDK>

---

## 3 · Daily availability — one call, then walk the days yourself

There is **no end-options call for daily rentals.** You list days and compute the valid end dates client-side.

**⚠️ `timeZone` must be the site's business timezone — see [the rentals availability docs](https://dev.wix.com/docs/api-reference/business-solutions/rentals/about-wix-rentals-availability.md#daily-availability) for why.** Don't use the visitor's browser timezone.

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

A daily rental is **one** booking spanning the whole range, created with `createBooking`. Set the boundaries to midnight-to-midnight: `startDate` = midnight on the first day, `endDate` = **midnight on the day after the last day**. A Monday–Wednesday inclusive rental ends at midnight on **Thursday**. **⚠️ Wix derives `allDay` itself — do not set it.**

Docs: <https://dev.wix.com/docs/api-reference/business-solutions/rentals/about-wix-rentals-availability.md>

### Overnight services (check-in and check-out times)

A daily service whose `schedule.availabilityConstraints.durationRange.dayOptions.timeBoundaries.type` is `OVERNIGHT` rents by the night, for example a vacation house:

- **Each slot is 1 night**, from `overnightTimes.checkInTime` to `overnightTimes.checkOutTime` on the next day. Walk the slots the same way; `minDurationInDays` and `maxDurationInDays` are numbers of nights.
- **The end date the customer picks is the check-out date**, the day after the last night. Picking only 1 date means 0 nights, so it isn't a valid stay.
- **Book from the start of the first slot to the end of the last slot:** `startDate` = the check-in time on the first night, `endDate` = the check-out time on the check-out date. For example, Monday 15:00 to Wednesday 11:00 for 2 nights. **⚠️ Never midnight:** an end that doesn't match the check-out time fails with `SLOT_NOT_AVAILABLE`.
- A night needs the resource free only from check-in to check-out, so a new stay can check in on the same day another stay checks out.

Docs: <https://dev.wix.com/docs/api-reference/business-solutions/rentals/about-wix-rentals-availability.md#overnight-availability> · <https://dev.wix.com/docs/api-reference/business-solutions/rentals/sample-flows.md#book-an-overnight-rental>

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

Hourly is prorated per minute (`minutes × base ÷ 60`); daily is `base × days` (nights, for an overnight service). Doc: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/pricing/pricing-api/preview-price.md?apiView=SDK>

**Pricing tiers and additional fees are already in the response. Never compute them yourself:**

- **Pricing tiers** (`payment.rateType: VARIED`): `calculatedPrice` already applies each tier's rate, by the rental's length or by its dates. The service's base rate is `payment.varied.defaultPrice`, not `payment.fixed.price`. Doc: <https://dev.wix.com/docs/api-reference/business-solutions/rentals/wix-rentals-and-the-bookings-apis.md#pricing-tiers>
- **Additional fees** (`payment.additionalFees`, for example a cleaning fee): `calculatedPrice` **excludes** fees. Show `priceInfo.calculatedPriceWithFees` as the total the customer pays; `priceInfo.totalAdditionalFees` is the sum of the fees, and the line item's `additionalFees` lists each fee with its `feeId`, `units`, and `amount`. These fields are returned only when at least 1 fee applies. Doc: <https://dev.wix.com/docs/api-reference/business-solutions/rentals/wix-rentals-and-the-bookings-apis.md#additional-fees>

---

## 5 · Book and check out

> **⚠️ LIVE BOOKING PRECONDITION — the site needs a premium plan and a configured payment method.** On a free site the visitor flow fails at the last step: `createBooking` returns **`PREMIUM_VALIDATION_FAILED`**, and `placeOrder` returns **`SITE_NOT_ACCEPTING_PAYMENTS`**. That's site provisioning, not a frontend bug — if a booking can't complete, the setup is incomplete, not the code.
>
> Two things make this misleading. **The same `createBooking` succeeds as an admin (`WIX_USER`)**, so it reads like a permissions or payload bug when it's neither — always test the visitor path. And **switching the service to offline / pay-in-person does not avoid it**: `placeOrder` still requires the site to be accepting payments. Record the precondition and surface it to the owner; don't try to code around it.

**Identical to `how-to-code-bookings.md` § "createBooking → cart → checkout"**, with four substitutions:

1. **`endDate` is the customer's chosen end**, not a duration added to the start — that is the whole point of a rental.
2. **`resource`** comes from the **start slot's** `availableResources` (§2 step 1 / §3). There is no ANY_RESOURCE staff fallback here; rentals are resource-driven.
3. **Map the slot's `location` to the booking's `location`** — read the id as `slot.location.id ?? slot.location._id`, and write it under `_id`.
4. **The cart's `catalogReference.appId` is the RENTALS app id**, not the Bookings one:

```js
const cart = await createCart({
  catalogItems: [{ quantity: 1, catalogReference: { catalogItemId: bookingId, appId: RENTALS_APP_ID } }],
  cart: { source: { channelType: 'WEB' } },
});
```

Everything downstream — `calculateCart`, the checkout-vs-`placeOrder` decision, `redirects.createRedirectSession` and the HTTPS `postFlowUrl` rule — is unchanged. Follow `how-to-code-bookings.md`.

**⚠️ One exception: do NOT call `getAnonymousActionToken` / `bookingsGetBookingAnonymously` for a rentals booking.** `how-to-code-bookings.md`'s confirmation-page step calls these client-side as the visitor. For rentals, `getAnonymousActionToken` returns `403` (the method requires the `Manage Bookings` scope, which the visitor doesn't have) — skip that whole step. Drive the confirmation page from what you already hold from `createBooking` / `placeOrder` / the redirect return instead; don't add a call to mint or read an anonymous token.

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
| Booking created at the wrong location, or `location` silently empty | Read only `.location._id` (undefined) | Read both `.location.id ?? .location._id` (§5) |
| Hunting for `WIX_APPS.rentals.*` or `seoTags.ItemType.RENTAL` | Neither exists | Use the **bookings** accessors — a rental detail page *is* a Bookings service page (§6) |
| `.image.url` fails `tsc`, or images render broken | `media.mainMedia.image` is a **string** holding a `wix:image://` URI | `media.getImageUrl(...)` from `@wix/sdk` (§6) |

---

## Out of scope

**Cancellation.** A logged-in member can cancel their own rental:

- A rental, hourly or daily, is a single booking. Cancel it with `cancelBooking` and its current `revision`.

**⚠️ Read the booking back with `queryExtendedBookings`, filtered on the rentals `appId`.** Without an `appId` (or `createdByAppId`) filter of your own, the query applies a default one that covers Bookings but **not** rentals, and returns **0** results — a rentals booking that exists looks like it doesn't. Naming `appId` in the filter suppresses that default:

```js
  filter: { appId: RENTALS_APP_ID },
```

Refunds are the eCommerce Orders API, not Bookings. Also out of scope, as in bookings: waitlists, deposit/payment breakdowns, and multi-item rental carts.

## Conclusion

- Rentals is **`@wix/bookings`** — there is no `@wix/rentals`, and its absence is not a missing capability.
- **Every catalog read filters on the rentals `appId`**, or a mixed site shows the wrong services.
- **Hourly** = two availability calls (start → `timeSlots`, then end options → **`endOptions`**, hourly-only, `location` required, `serviceId` positional). **Daily** = one call with `timeSlotsPerDay: 1`, then walk consecutive days client-side.
- **A daily rental is one booking:** midnight to midnight-after, never set `allDay`.
- **Price preview needs both local dates and the time zone**, or it silently returns a duration-blind price.
- Booking, cart, checkout and confirmation are the **bookings** flow, with the rentals app id on the cart's `catalogReference` — **except** the anonymous-token confirmation step, which rentals must skip entirely (§5).
- **The slot's location id must be read defensively** as `.location.id ?? .location._id` — the SDK type says `_id`, but the field stays `.id` on the wire.
- **SEO and images are the bookings ones too** — `WIX_APPS.bookings.servicePageMetadata` and `seoTags.ItemType.BOOKINGS_SERVICE`; there is no rentals-specific accessor to find.
