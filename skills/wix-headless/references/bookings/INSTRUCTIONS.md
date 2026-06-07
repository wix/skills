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
| `components` | Components: `ServiceCard.astro`, `AvailabilityCalendar.tsx`, `BookingForm.tsx`, `ServiceBookingFlow.tsx`, `ManageBooking.tsx` (`SeoTags.astro` is pre-copied — see Templates) | `../astro/bookings/COMPONENTS.md` |
| `pages` | Pages: `/services` listing, `/services/[slug]` detail, `/booking-confirmation`, `/manage-booking` | `../astro/bookings/SERVICES_PAGES.md` |

## Files this vertical creates / contributes

See `<SKILL_ROOT>/references/verticals/bookings.md` frontmatter.

## Pre-return file-existence assertion (pages scope)

Before returning `status: "complete"` from the `pages` scope, verify all route files exist on disk:
- `src/pages/services/index.astro`
- `src/pages/services/[slug].astro`
- `src/pages/booking-confirmation.astro`
- `src/pages/manage-booking.astro`

If any declared file is missing, return `status: "partial"` with `errors: [{ code: "PHASE4_FILE_MISSING", path: "<expected path>" }]` rather than claiming success.

## Templates

Canonical templates live at `<SKILL_ROOT>/references/astro/templates/bookings/`. Your `components` and `pages` scopes **read these and adapt them — don't invent markup or SDK wiring** (the booking/confirm/availability/waitlist wiring is subtle and was verified against a live site; re-authoring from scratch is a common source of API-shape bugs). Adapt brand copy, headings, and styling; keep the SDK calls and the data flow.

Components (`components` scope — `.tsx`/`.astro`, no CSS):
- `…/templates/bookings/ServiceCard.astro`
- `…/templates/bookings/AvailabilityCalendar.tsx` — branches on `serviceType` (APPOINTMENT → `availabilityTimeSlots`, CLASS → `eventTimeSlots`); capacity + instructor + full→waitlist
- `…/templates/bookings/BookingForm.tsx` — `createBooking` → `/api/confirm-booking`; party size; waitlist on full
- `…/templates/bookings/ServiceBookingFlow.tsx` — coordinator (threads `serviceType`)
- `…/templates/bookings/ManageBooking.tsx` — cancel via anonymous token (used by `manage-booking.astro`)

Pages (`pages` scope):
- `…/templates/bookings/services/index.astro`, `…/services/[slug].astro`
- `…/templates/bookings/booking-confirmation.astro`, `…/manage-booking.astro`

### Pre-copied by the orchestrator (do NOT write these yourself)
These are mechanical (no brand content) — the orchestrator copies them before dispatch (BUILD-astro.md § Step 4.5). Just rely on them at the listed paths:
- `src/styles/components-bookings.css` ← `…/templates/bookings/components-bookings.css`
- `src/components/SeoTags.astro` ← `…/templates/bookings/SeoTags.astro` (renders `service.seoData.tags`; imported by `services/[slug].astro`)
- `src/pages/api/confirm-booking.ts` ← `…/templates/bookings/api/confirm-booking.ts` (elevated `confirmBooking` — holds the seat)
- `src/pages/api/waitlist.ts` ← `…/templates/bookings/api/waitlist.ts` (elevated native v1 waitlist register)

If a pre-copied file is missing at runtime, that's an orchestrator-side bug — return `status: "partial"` with `errors: [{code: "UTILITY_TEMPLATE_NOT_PRECOPIED", path: "<missing>"}]`; do not author your own version.

## CSS ownership — bookings pack

Bookings-specific component CSS lives in `src/styles/components-bookings.css` (pre-copied by the orchestrator from the skill template — see above), NOT in the designer's `global.css`. Classes the pack owns:

- `.service-card`, `.service-card-image`, `.service-card-meta`, `.service-card-price` — the service card itself, including image containment, price badge, and duration tag.
- `.service-grid` — the layout that lists service cards on `/services`. Include `display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: var(--spacing-xl);` plus View-Transitions opacity fade.
- `.availability-calendar` — the date-picker shell wrapping the calendar widget.
- `.time-slot`, `.time-slot--available`, `.time-slot--selected`, `.time-slot--full` (full CLASS session → waitlist), plus the `.time-slot-time` / `.time-slot-capacity` spans inside each slot button.
- `.booking-form` (+ `.booking-form-note`) — the booking/waitlist form revealed after a slot is selected.
- `.manage-booking`, `.manage-booking-summary`, `.manage-booking-status`, `.manage-booking-note`, `.manage-booking-link` — the `/manage-booking` view/cancel UI.

If `global.css` ships a partial rule for any class above, flag it in your return JSON's `errors` array (`{code: "GLOBAL_CSS_LEAK", class: "<name>"}`) and override with the complete rule in `components-bookings.css`.

## Bookings-specific failure modes

| Wrong | Right |
|-------|-------|
| Treat `createBooking` as the whole booking — stop after it returns | `createBooking` leaves the booking **`CREATED`**, which **does not hold a seat or block availability** (per the [lifecycle docs](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/introduction): only `CONFIRMED` blocks availability). Without a follow-up **`confirmBooking`**, the class overbooks and capacity never drops. After createBooking returns `CREATED`, call `bookings.confirmBooking(bookingId, revision, { paymentStatus: "NOT_PAID", flowControlSettings: { checkAvailabilityValidation: true } })`. `confirmBooking` needs Manage Bookings → run it **server-side, elevated** (`auth.elevate`), not from the visitor client. |
| Build the waitlist on `createBooking` (expecting a `WAITING_LIST` status) | `createBooking` has **no** waitlist option (verified: only `participantNotification`/`sendSmsReminder`); a full session returns `SESSION_CAPACITY_EXCEEDED`. The native waitlist is the **legacy v1** API `POST /bookings/v1/waitlist/register` (there is no v2/v3 waitlist). It needs the **v1-encoded session id** as `waitingResource` (surfaced in the `SESSION_CAPACITY_EXCEEDED` message: *"…on session `<id>`"*) **+ a Wix `contactId`** (resolve via Contacts API by email, create if missing), and the **Manage Bookings** scope → server-side elevated. Class/EVENT only. |
| Call the v1 waitlist (or any Manage-Bookings REST) with `auth.elevate(async () => fetchWithAuth(...))` | `auth.elevate()` only grants permissions for a real **SDK function** (it reads the method's required-permission metadata); a plain closure isn't one, so it runs **un-elevated (visitor)** and 403s. For raw REST with no SDK wrapper, elevate the authenticated fetch itself: `const ef = auth.elevate(httpClient.fetchWithAuth); await ef(url, init)`. (For calls that *do* have an SDK method — `confirmBooking`, `getAnonymousActionToken` — elevate the method directly.) |
| Pass the v3 `eventId` as the waitlist `waitingResource` | The v1 waitlist can't decode a v3 GUID (`"id … cannot be decoded"`). Use the **v1-encoded session id** (e.g. `2mmoW0vw…`) from the `SESSION_CAPACITY_EXCEEDED` message. |
| Use Services V1 API endpoint (`/bookings/v1/catalog/services`) | Services V2 is at `POST https://www.wixapis.com/_api/bookings/v2/services`. V1 has a different (nested `info.*`) payload shape. |
| Nest service fields under `info` (`info.name`, `info.description`) | V2 uses flat fields: `name`, `description`, `tagLine` at the top level of the `service` object. |
| Use `payment.fixed.price.amount` | V2 uses `payment.fixed.price.value` (a string like `"75.00"`). `amount` is the V1 field name. |
| Omit `defaultCapacity` when creating a service | Required in V2. Set to `1` for APPOINTMENT; use participant count for CLASS. |
| Omit `onlineBooking` when creating a service | Required in V2. At minimum `{ "enabled": true }`. |
| Omit `sessionDurations` for an APPOINTMENT service | Required for APPOINTMENT: `schedule.availabilityConstraints.sessionDurations: [<minutes as int>]`. Do NOT specify for CLASS. |
| Use `availability.queryAvailability` or `availability` SDK namespace | Branch by service type: APPOINTMENT → `availabilityTimeSlots.listAvailabilityTimeSlots()`; CLASS → **`eventTimeSlots.listEventTimeSlots()`** (a **different namespace** — `eventTimeSlots`, not `availabilityTimeSlots` — with plural `serviceIds` + `includeNonBookable`). The `availability` namespace does not exist in `@wix/bookings`. |
| Pass UTC ISO strings to `listAvailabilityTimeSlots` | The method expects **local date strings** in `YYYY-MM-DDTHH:mm:ss` format (no `Z`), with a separate `timeZone` parameter. |
| Read service slug from `service.slug` | V2 response puts slug at `service.mainSlug.name`. Fall back to `service.supportedSlugs[0].name`, then `service.id`. |
| Call `queryServices({ query: { filter, paging } })` (object form) | In `@wix/bookings` the object form returns **0 items with no error**. Use the **query builder**: `await services.queryServices().limit(100).find()` → `result.items`. For a slug, fetch the (small) catalog and match `mainSlug.name` in JS, or `.eq("mainSlug.name", slug).find()`. |
| Build a `createClient`/`OAuthStrategy` in `.astro` SSR frontmatter keyed off `import.meta.env.*_WIX_CLIENT_ID` | The `*_WIX_CLIENT_ID` env vars are client-only in `@wix/astro` and `undefined` at server render → `createClient` throws → HTTP 500 (only in the deployed runtime; dev has `.env.local`). SSR reads use `@wix/essentials` `auth.elevate(services.queryServices)()…` — the same ambient pattern as the CMS pages. |
| Read the client ID in a browser island via `import.meta.env.*_WIX_CLIENT_ID` | Client islands import `{ WIX_CLIENT_ID } from "astro:env/client"`. `import.meta.env` is `undefined` in the browser bundle → `OAuthStrategy` sends an empty `client_id` → `oauth2/token` `400`. The var name is `WIX_CLIENT_ID` (no `PUBLIC_`). |
| Read service name from `service.info.name` | V2 uses flat `service.name` (not `service.info.name`). Same for `description` and `tagLine`. |
| Read duration from `service.schedule.sessions.duration` | V2 puts duration at `service.schedule.availabilityConstraints.sessionDurations[0]` (array of ints). |
| Read media URL from `service.info.images[0].url` | V2 media: `service.media.mainMedia.image.url`. |
| Use `import { availability } from '@wix/bookings'` | Use `import { availabilityTimeSlots } from '@wix/bookings'`. |
| Call `availability.queryAvailability` server-side on every render | Availability is real-time and session-specific — always call from the client-side React island, NOT from `.astro` frontmatter SSR. |
| Create a booking without `totalParticipants` | `createBooking` requires `totalParticipants: 1` (or `participantsChoices`). |
| Read booking ID from `result.booking.id` | The booking ID field is `result.booking._id` (underscore prefix). |
| Redirect to `/thank-you` (ecom route) after booking | Redirect to `/booking-confirmation?bookingId=<_id>`. The ecom thank-you page is unrelated to bookings. |
| Re-fetch the booking with `getBooking` from the confirmation page | Don't. Pass booking details (bookingId, startDate, service name) as URL query params during the client-side redirect after `createBooking` succeeds, and render from those. (A server re-fetch of someone else's booking is out of scope.) NB: this is **not** because `auth.elevate` is unavailable — see next row. |
| Assume `@wix/essentials` `auth.elevate` doesn't work in headless | It does. **Two different `elevate`s:** `@wix/essentials` `auth.elevate(fn)` works in `@wix/astro` SSR (it's how the listing/detail/CMS pages read data) — use it. What's unavailable is the **`wixClient.auth.elevate`** instance method on a hand-built `createClient({auth: OAuthStrategy})` (a Velo/Blocks API). Don't conflate them. |
| Mount `AvailabilityCalendar` without `client:only="react"` | Calendar must be fully client-side — SSR renders before timezone is known and breaks slot display. Always use `client:only="react"`. |
| Omit try/catch on `createBooking` | Booking creation can fail with 409 (slot taken) between slot fetch and submit. Catch and surface a friendly message; do not crash the page. |
| Use `service.id` to pass the service ID | The Wix SDK uses `_id` (with underscore) for all entity IDs. The service's ID is `service._id`. Using `service.id` will be `undefined`. |
| Read `resource._id` from `listAvailabilityTimeSlots` response | `availableResources` is EMPTY by default in list results. Omit `resource` from `createBooking` — Wix auto-assigns a resource during confirmation. |
| Use `timeSlot.slot.startDate` to read slot time | Slot fields are at the TOP LEVEL — there is no nested `slot` on the list response. APPOINTMENT slots: `timeSlot.localStartDate`, `timeSlot.localEndDate`, `timeSlot.scheduleId`. |
| Treat CLASS (event) slots like APPOINTMENT slots — guard clicks on `scheduleId`, book with `{scheduleId, startDate}` | CLASS event slots carry their session id at **`timeSlot.eventInfo.eventId`** and have **no `scheduleId`** (and no top-level `startDate`). Guarding the slot-click on `scheduleId` drops every CLASS click; the appointment-shaped `createBooking` payload doesn't apply. For CLASS: guard on `eventId`, and book with `bookedEntity.slot = { serviceId, eventId }` (Wix derives start/end/timezone/resource/location from the event). Keep `{ scheduleId, startDate, endDate, timezone, location }` for APPOINTMENT only. |
| Pass `hidden: true` services to the listing | Always filter with `{ hidden: false }` in your `queryServices` filter to exclude hidden services from the public listing. |
| Use `../../../` for imports in `[slug].astro` | `src/pages/services/[slug].astro` is two directories deep inside `src/`. Import Layout and components with `../../layouts/Layout.astro` and `../../components/…` — not three `../` which would escape `src/`. |
