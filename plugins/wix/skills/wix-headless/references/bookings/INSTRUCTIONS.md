---
name: bookings-implementer
description: "Implements Wix Bookings vertical — services catalog, service detail with availability calendar and booking flow, and booking confirmation. Scopes: seed, components, pages. Extends references/shared/IMPLEMENTER.md."
---

# Bookings Implementer

Extends `references/shared/IMPLEMENTER.md`. Read that file first for phase routing, REST auth + doc lookups, site.json read pattern, return contract, style conventions, and common failure modes.

## Scope routing

| Scope | Phase | Reference |
|-------|-------|-----------|
| `seed` | Seed (service creation via Wix Bookings REST API) | `./SERVICES_DATA.md` |
| `components` | Components (ServiceCard.astro, AvailabilityCalendar.tsx, BookingForm.tsx) | `../astro/bookings/COMPONENTS.md` |
| `pages` | Pages (`/services` listing, `/services/[slug]` detail, `/booking-confirmation`) | `../astro/bookings/SERVICES_PAGES.md` |

## Files this vertical creates / contributes

See `<SKILL_ROOT>/references/verticals/bookings.md` frontmatter.

## Pre-return file-existence assertion (pages scope)

Before returning `status: "complete"` from the `pages` scope, verify all three route files exist on disk:
- `src/pages/services/index.astro`
- `src/pages/services/[slug].astro`
- `src/pages/booking-confirmation.astro`

If any declared file is missing, return `status: "partial"` with `errors: [{ code: "PHASE4_FILE_MISSING", path: "<expected path>" }]` rather than claiming success.

## Templates

The component CSS template is pre-copied by the orchestrator before Phase 3 dispatch. Do NOT write it yourself — write only `.tsx` islands and `.astro` files.

- CSS: `<SKILL_ROOT>/references/astro/templates/bookings/components-bookings.css` — pre-copied to `src/styles/components-bookings.css` by the orchestrator's Step 4.5 pre-batch. Confirmed absent in many failures when the agent tried to write it; always assume it is already on disk.

There are no other canonical templates for bookings — write all component and page files from scratch following the spec in `../astro/bookings/COMPONENTS.md` and `../astro/bookings/SERVICES_PAGES.md`.

## CSS ownership — bookings pack

Bookings-specific component CSS lives in `src/styles/components-bookings.css` (pre-copied by the orchestrator from the skill template — see above), NOT in the designer's `global.css`. Classes the pack owns:

- `.service-card`, `.service-card-image`, `.service-card-meta`, `.service-card-price` — the service card itself, including image containment, price badge, and duration tag.
- `.service-grid` — the layout that lists service cards on `/services`. Include `display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--spacing-xl);` plus View-Transitions opacity fade.
- `.availability-calendar` — the date-picker shell wrapping the calendar widget.
- `.time-slot`, `.time-slot--available`, `.time-slot--selected`, `.time-slot--unavailable` — individual slot buttons rendered below the date picker.
- `.booking-form` — the booking form revealed after a slot is selected.

If `global.css` ships a partial rule for any class above, flag it in your return JSON's `errors` array (`{code: "GLOBAL_CSS_LEAK", class: "<name>"}`) and override with the complete rule in `components-bookings.css`.

## Bookings-specific failure modes

| Wrong | Right |
|-------|-------|
| Use Services V1 API endpoint (`/bookings/v1/catalog/services`) | Services V2 is at `POST https://www.wixapis.com/_api/bookings/v2/services`. V1 has a different (nested `info.*`) payload shape. |
| Nest service fields under `info` (`info.name`, `info.description`) | V2 uses flat fields: `name`, `description`, `tagLine` at the top level of the `service` object. |
| Use `payment.fixed.price.amount` | V2 uses `payment.fixed.price.value` (a string like `"75.00"`). `amount` is the V1 field name. |
| Omit `defaultCapacity` when creating a service | Required in V2. Set to `1` for APPOINTMENT; use participant count for CLASS. |
| Omit `onlineBooking` when creating a service | Required in V2. At minimum `{ "enabled": true }`. |
| Omit `sessionDurations` for an APPOINTMENT service | Required for APPOINTMENT: `schedule.availabilityConstraints.sessionDurations: [<minutes as int>]`. Do NOT specify for CLASS. |
| Use `availability.queryAvailability` or `availability` SDK namespace | Correct SDK namespace is `availabilityTimeSlots` (Time Slots V2). For appointments: `availabilityTimeSlots.listAvailabilityTimeSlots()`. For classes: `availabilityTimeSlots.listEventTimeSlots()`. The `availability` namespace does not exist in `@wix/bookings`. |
| Pass UTC ISO strings to `listAvailabilityTimeSlots` | The method expects **local date strings** in `YYYY-MM-DDTHH:mm:ss` format (no `Z`), with a separate `timeZone` parameter. |
| Read service slug from `service.slug` | V2 response puts slug at `service.mainSlug.name`. Fall back to `service.supportedSlugs[0].name`, then `service.id`. |
| Use builder-chain on `queryServices` (`queryServices().eq(...).find()`) | `@wix/bookings` `services.queryServices` takes a plain object: `queryServices({ query: { filter: { "mainSlug.name": slug } } })`. No builder chain, no `.find()`. Result is `result.items`. |
| Read service name from `service.info.name` | V2 uses flat `service.name` (not `service.info.name`). Same for `description` and `tagLine`. |
| Read duration from `service.schedule.sessions.duration` | V2 puts duration at `service.schedule.availabilityConstraints.sessionDurations[0]` (array of ints). |
| Read media URL from `service.info.images[0].url` | V2 media: `service.media.mainMedia.image.url`. |
| Use `import { availability } from '@wix/bookings'` | Use `import { availabilityTimeSlots } from '@wix/bookings'`. |
| Call `availability.queryAvailability` server-side on every render | Availability is real-time and session-specific — always call from the client-side React island, NOT from `.astro` frontmatter SSR. |
| Create a booking without `totalParticipants` | `createBooking` requires `totalParticipants: 1` (or `participantsChoices`). |
| Read booking ID from `result.booking.id` | The booking ID field is `result.booking._id` (underscore prefix). |
| Redirect to `/thank-you` (ecom route) after booking | Redirect to `/booking-confirmation?bookingId=<_id>`. The ecom thank-you page is unrelated to bookings. |
| Call `getBooking` from SSR in a headless OAuthStrategy project | `auth.elevate` is NOT available with `OAuthStrategy` in headless projects — it's a Wix-hosted Velo/Blocks API only. In headless SSR, pass booking details (bookingId, startDate, service name) as URL query params during the client-side redirect after `createBooking` succeeds. Do not re-fetch from the confirmation page. |
| Mount `AvailabilityCalendar` without `client:only="react"` | Calendar must be fully client-side — SSR renders before timezone is known and breaks slot display. Always use `client:only="react"`. |
| Omit try/catch on `createBooking` | Booking creation can fail with 409 (slot taken) between slot fetch and submit. Catch and surface a friendly message; do not crash the page. |
| Use `service.id` to pass the service ID | The Wix SDK uses `_id` (with underscore) for all entity IDs. The service's ID is `service._id`. Using `service.id` will be `undefined`. |
| Read `resource._id` from `listAvailabilityTimeSlots` response | `availableResources` is EMPTY by default in list results. Omit `resource` from `createBooking` — Wix auto-assigns a resource during confirmation. |
| Use `timeSlot.slot.startDate` to read slot time | Time slot fields are at the TOP LEVEL: `timeSlot.localStartDate`, `timeSlot.localEndDate`, `timeSlot.scheduleId`. There is no nested `slot` property on the list response object. |
| Pass `hidden: true` services to the listing | Always filter with `{ hidden: false }` in your `queryServices` filter to exclude hidden services from the public listing. |
| Use `../../../` for imports in `[slug].astro` | `src/pages/services/[slug].astro` is two directories deep inside `src/`. Import Layout and components with `../../layouts/Layout.astro` and `../../components/…` — not three `../` which would escape `src/`. |
