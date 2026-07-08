
# Wix Bookings Skill

> **Source files (in this skill):** the shared transport `references/shared/wix-client.js` and both bookings helpers from `references/bookings/`. All helpers import from `"./wix-client.js"`, so copy them into the same folder (e.g. `src/rest/`). Copy **both** for the full booking flow:
>
> | File | What it covers |
> |---|---|
> | `wix-bookings-services.js` | Service listing, slot availability, media URL helper |
> | `wix-bookings-checkout.js` | Create booking, hosted checkout, bookAndCheckout convenience |

Builds a real, client-only Wix Bookings front end. The browser talks to Wix directly over a
public `WIX_CLIENT_ID`. Never mock services or slots; never hand-build a `/checkout` URL —
always create the booking through the API and complete it via the eCom checkout + redirect-session.

This skill ships the single-service booking flow for **all service types**: browse services → pick a
service → pick an available slot → enter details → book → hosted checkout. Appointments and
classes/courses differ only in the availability call (`listAvailableSlots` vs `listEventTimeSlots`);
`listSlotsForService` routes by `service.type`, and `createBooking` handles either slot.

## When to use
- User wants a Wix Bookings appointment site or asks to "connect Wix Bookings".
- Replacing placeholder/mock services or fake calendars with live Wix data.
- Adding service listings, a slot picker, booking creation, or checkout over an existing
  Wix Bookings setup.

## Prerequisites
1. A Wix site with **Wix Bookings installed and at least one appointment service created**
   (this skill does NOT provision — it's read-only over services). Staff/resources and a
   booking policy should be configured so slots are bookable.
2. The site's public headless **`WIX_CLIENT_ID`**, provided in the handoff prompt (the Wix
   Business Manager surfaces a copyable prompt with the id filled in — see the router `SKILL.md`). Paste
   it into `src/rest/wix-client.js` in place of the placeholder. It is a buyer-facing credential
   (it only mints anonymous visitor tokens), **not** a secret, so hardcoding/committing it is fine.
3. The site must **accept payments** for paid services, and the deployed app domain must be
   allow-listed on the OAuth client for Wix-hosted checkout to return. These are **separate Wix
   setup flows the user completes later** — out of this skill's scope. If checkout return fails
   before that setup is done, that's expected; flag it and continue.

## The API (copy as-is; do not re-derive it)
This skill ships only the REST layer — no UI components. Build the booking UI however the
project wants; wire it to these two snippets. Copy them into the app (e.g. `src/api/`) and only
adjust import paths:
- `src/rest/wix-client.js` — visitor-token mint/refresh + transport. Set `WIX_CLIENT_ID` to the
  id from the prompt (replace the `<YOUR-CLIENT-ID>` placeholder). The visitor refresh token IS
  the booking visitor identity; it is persisted to localStorage. Do not re-mint anonymously per
  load.
- `src/rest/wix-bookings-services.js` — **Services & availability:**
  `queryServices`, `getService`, `countServices`, `listAvailableSlots`, `getAvailableSlot`,
  `mediaUrl` (resolve a service image to an absolute URL)
- `src/rest/wix-bookings-checkout.js` — **Booking & checkout:**
  `createBooking`, `checkoutBooking`, `bookAndCheckout`

The `Service`, `TimeSlot`, and `Booking` shapes are documented as JSDoc comments at the top of
each helper file. Read them before building the UI — they describe the key fields and link to
the full API reference for anything not shown.

## How to wire it (UI is the project's choice)
- **Service list** — `queryServices()` for the listing (visitor-visible services only). Render
  `name`, `tagLine`, the image via `mediaUrl(service.media?.items?.[0]?.image)`, and the price
  from `payment.fixed.price.formattedValue` (already includes the currency). Pass the returned
  `nextOffset` back as `offset` to load the next page. Books **all service types** —
  APPOINTMENT, CLASS, and COURSE (see the slot picker below).
- **Service detail** — `getService(serviceId)` keyed off the URL/route; returns null on miss —
  show a not-found state, never invent a service. Render `description`, price, and `locations`.
- **Slot picker** — use **`listSlotsForService(service, { fromLocalDate, toLocalDate, timeZone? })`**:
  it routes by `service.type` — APPOINTMENT → `listAvailableSlots` (staff working hours), CLASS/COURSE
  → `listEventTimeSlots` (scheduled sessions). Both return the same slot shape. (Call the specific
  function directly if you already know the type.) Dates are **local** wall-clock strings
  `"YYYY-MM-DDThh:mm:ss"` (no zone), interpreted in `timeZone` (defaults to the visitor's IANA zone).
  Only `bookable: true` slots come back. Render each `slot.localStartDate`/`localEndDate`; group by
  day for a calendar. Pass `nextCursor` back
  as `cursor` to page.
- **Booking form** — collect the buyer's `firstName`, `lastName`, `email`, `phone`. Keep it
  minimal; richer per-service form fields live in the service's `form.id` (see "Beyond the snippets").
- **Re-validate + book** — right before submitting, call
  `getAvailableSlot(serviceId, { localStartDate, localEndDate, timeZone? })` to confirm the slot
  is still open (and to pick up the staff resource). Then create + check out in one step:
  `window.location.href = (await bookAndCheckout(slot, { email, firstName, lastName, phone })).checkoutUrl;`
  Or split it: `const booking = await createBooking(slot, contact); const url = await checkoutBooking(booking.id);`
- **Confirmation / return** — after the buyer returns from hosted checkout, the order is placed
  and Wix Bookings confirms the booking automatically (status becomes `CONFIRMED`, or `PENDING`
  if the service needs manual approval). Show a confirmation screen on return.
- **Empty state** — if `countServices()` is 0, show an empty state telling the user to add a
  service in their Wix dashboard. Never invent services.

## Hard rules (do not violate)
- ✅ Book ONLY via `createBooking()` → `checkoutBooking()` (or `bookAndCheckout()`), then redirect
  to the returned `fullUrl`.
- ❌ Never hand-build a `/checkout`, booking, or calendar URL.
- ❌ Never mock services, time slots, or availability — render live Wix data or the empty state.
- ❌ Never invent reviews, ratings, staff, or testimonials. Empty review UI only.
- ✅ Set `WIX_CLIENT_ID` from the prompt's value (public client id — safe to hardcode).
- ✅ Send availability/booking dates as **local** `"YYYY-MM-DDThh:mm:ss"` strings plus a
  `timeZone` — do not send UTC `Z` timestamps to the slot APIs.
- ✅ Re-validate the slot with `getAvailableSlot()` before `createBooking()` — slots get taken.
- The client fails loudly on purpose: `createBooking`/`checkoutBooking` throw on an unbookable
  slot, a missing booking id, or a missing redirect URL. A green path means it's really bookable —
  don't swallow these.

## Beyond the snippets
The snippets cover appointments **and** classes/courses (the slot picker routes by `service.type`).
For anything beyond that, extend the client: add a new helper on `wixApiRequest`, looking up the
exact endpoint, method, and body in the **official Wix API reference** first (never guess):
- Official Wix API reference: https://dev.wix.com/docs/api-reference.md
- Single-service booking flow (the full picture): https://dev.wix.com/docs/api-reference/business-solutions/bookings/flow-single-service-booking.md
- **Courses — enrollment/capacity nuance:** a course is booked per-session like a class
  (`listEventTimeSlots` + `createBooking`), but whole-course capacity is computed from bookings —
  https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-reader-v2/query-extended-bookings.md
- **Service variants / participants** (duration- or person-based pricing):
  https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/service-options-and-variants/get-service-options-and-variants-by-service-id.md
- **Add-ons:** https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/list-add-on-groups-by-service-id.md
- **Custom booking form fields** (render `service.form.id`): Get Form Summary —
  https://dev.wix.com/docs/rest/crm/forms/form-schemas/get-form-summary.md

Keep the snippets as the default for everything they already do; reach for the API reference
only for the gap.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (same visitor identity across reloads)
- [ ] `queryServices()` renders live services; `countServices()` 0 → empty state (no mock services)
- [ ] `listAvailableSlots()` returns real bookable slots for a chosen service and date range
- [ ] Slot is re-validated with `getAvailableSlot()` immediately before booking
- [ ] `createBooking()` returns a booking with `status: "CREATED"` and a real id
- [ ] Checkout redirects via redirect-session `fullUrl` (no hand-built URL)
- [ ] On return from checkout the booking is confirmed (status `CONFIRMED`/`PENDING`)
- [ ] No mock services, slots, or availability anywhere
