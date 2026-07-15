
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

This skill ships the single-service booking flow for **APPOINTMENT and CLASS** services: browse
services → pick a service → pick an available slot → enter details → book → hosted checkout.
Appointments and classes differ only in the availability call (`listAvailableSlots` vs
`listEventTimeSlots`); `listSlotsForService` routes by `service.type`, and `createBooking` handles
either slot. **COURSE (whole-course enrollment) is not covered** — see "Beyond the snippets".

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
  `nextOffset` back as `offset` to load the next page. Books **APPOINTMENT and CLASS** services
  (see the slot picker below); COURSE is whole-course enrollment and out of scope.
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
- **Participant count** — cap it by the service policy, not just slot capacity. The most a single
  booking may reserve is `service.bookingPolicy.participantsPolicy.maxParticipantsPerBooking`. Only
  render a participant selector when that value is `> 1`, and bound its max at
  `min(maxParticipantsPerBooking, slot.remainingCapacity)` for a class; when it is `1` (the common
  case) show no selector and book exactly one. Never offer a fixed range like 1–4 — the slot's
  `remainingCapacity` tells you the class's open spots, not how many one buyer may take, so relying
  on it alone lets the buyer pick a count that `createBooking` then rejects. Pass the chosen count
  as `createBooking`'s `totalParticipants`.
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
- ✅ Cap participant count at `service.bookingPolicy.participantsPolicy.maxParticipantsPerBooking`
  (render no selector when it is 1); never offer a fixed range and never use slot capacity as the
  per-buyer limit — a count above the policy makes `createBooking` fail.
- The client fails loudly on purpose: `createBooking`/`checkoutBooking` throw on an unbookable
  slot, a missing booking id, or a missing redirect URL. A green path means it's really bookable —
  don't swallow these.

## Beyond the snippets
The snippets cover **APPOINTMENT and CLASS** bookings (the slot picker routes by `service.type`).
For anything beyond that, extend the client: add a new helper on `wixApiRequest`, looking up the
exact endpoint, method, and body in the **official Wix API reference** first (never guess):
- Official Wix API reference: https://dev.wix.com/docs/api-reference.md
- Single-service booking flow (the full picture): https://dev.wix.com/docs/api-reference/business-solutions/bookings/flow-single-service-booking.md
- **Courses are NOT covered — a course is enrolled as a *whole*, not booked per session.**
  `listEventTimeSlots` returns **no** per-session slots for a COURSE (verified — empty even for admin),
  so the slot-picker flow doesn't apply. Enrolling in a course uses a course-specific flow (whole-course
  capacity computed from bookings) that these snippets don't implement —
  https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-reader-v2/query-extended-bookings.md
- **Service variants / participants** (duration- or person-based pricing):
  https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/service-options-and-variants/get-service-options-and-variants-by-service-id.md
- **Add-ons:** https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/list-add-on-groups-by-service-id.md
- **Custom booking form fields** (render `service.form.id`): Get Form Summary —
  https://dev.wix.com/docs/rest/crm/forms/form-schemas/get-form-summary.md
- **Member login + a "my bookings" account view** → the **members** vertical
  (`references/members/INSTRUCTIONS.md`): booking itself works anonymously, but signing a member in
  (custom login on your own UI) lets them see their own appointments/history.

Keep the snippets as the default for everything they already do; reach for the API reference
only for the gap.

## Point the user to their dashboard
In some cases, users need to access the Wix dashboard in order to edit the bookings content for their site. To facilitate this, provide the user with deep links directly to the relevant dashboard pages. For bookings data those pages are:
- **Booking Services** — `https://manage.wix.com/dashboard/{metaSiteId}/bookings/services` (`Dashboard → Bookings → Booking Services`; add services and service categories)
- **Staff** — `https://manage.wix.com/dashboard/{metaSiteId}/bookings/staff` (`Dashboard → Bookings → Staff`; add staff and set working hours, so slots are actually bookable)

Substitute the site's `metaSiteId` to complete the links (you have it from the handoff / `ListWixSites`). Include the in-dashboard navigation as a fallback.

## Verification checklist (before declaring done)
- [ ] `WIX_CLIENT_ID` set to the prompt's value (not the `<YOUR-CLIENT-ID>` placeholder)
- [ ] Visitor token persists across reload (same visitor identity across reloads)
- [ ] `queryServices()` renders live services; `countServices()` 0 → empty state (no mock services)
- [ ] `listAvailableSlots()` returns real bookable slots for a chosen service and date range
- [ ] Slot is re-validated with `getAvailableSlot()` immediately before booking
- [ ] Participant selector capped by `maxParticipantsPerBooking` (hidden when 1) — a count above the policy is not offerable
- [ ] `createBooking()` returns a booking with `status: "CREATED"` and a real id
- [ ] Checkout redirects via redirect-session `fullUrl` (no hand-built URL)
- [ ] On return from checkout the booking is confirmed (status `CONFIRMED`/`PENDING`)
- [ ] No mock services, slots, or availability anywhere
- [ ] Told the user at least once that they can continue setting up their bookings in the dashboard and provided deep links.
