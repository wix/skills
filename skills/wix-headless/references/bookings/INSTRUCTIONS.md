---
name: bookings-implementer
description: "Implements the Wix Bookings vertical — services catalog (with optional location + category filters), a service detail page with a week-calendar availability picker (with optional staff selection), a schema-driven booking form, and confirmation, for appointments and classes. The booking runs client-side via the @wix SDK (ecom Cart V2 — no confirmBooking). Scopes: seed, components, pages. Extends references/shared/IMPLEMENTER.md."
---

# Bookings Implementer

Extends `references/shared/IMPLEMENTER.md`. Read that file first for phase routing, REST auth + doc lookups, the `.wix/seeded.json` read pattern, the return contract, style conventions, and common failure modes.

## The logic lives in one place

The booking **logic** — the step model, the shared selection state, the exact
`@wix` SDK sequence, and the schema-driven form — is framework-agnostic and lives
in **`./FLOW.md`**. Read it first. The astro guides below are the astro *wiring* of
that logic; the code examples under `<SKILL_ROOT>/references/astro/templates/bookings/`
are React (the astro islands use them directly). For an own/static build, the wiring guide is
`../custom/bookings/WIRING.md` (same logic, client-side `@wix/sdk`).

## Scope routing

| Scope | Phase | Reference |
|-------|-------|-----------|
| `seed` | Seed — create services (and staff) via the Wix Bookings REST API | `./SERVICES_DATA.md` |
| `components` | Components — the client islands (week calendar, schema-driven form, the flow coordinator) | `./FLOW.md` + `../astro/bookings/COMPONENTS.md` |
| `pages` | Pages — `/services` listing, `/services/[slug]` detail, `/booking-confirmation`, + nav/home links | `./FLOW.md` + `../astro/bookings/SERVICES_PAGES.md` |

## Templates — read and adapt (don't invent)

Canonical examples live at `<SKILL_ROOT>/references/astro/templates/bookings/`.
Your `components` and `pages` scopes **read these and adapt them** — adapt brand
copy, headings, and styling; keep the SDK calls, payload shapes, and the data
flow (re-authoring the SDK wiring from scratch is the main source of API-shape bugs).

Components (`components` scope — TSX only, no CSS):
- `<SKILL_ROOT>/references/astro/templates/bookings/AvailabilityCalendar.tsx` — the week calendar (week strip → the day's slots; APPOINTMENT via `availabilityTimeSlots`, CLASS via `eventTimeSlots`).
- `<SKILL_ROOT>/references/astro/templates/bookings/BookingForm.tsx` — the schema-driven form (renders the `@wix/forms` field list, keys values by `target`) that drives `bookingDriver.book()`.
- `<SKILL_ROOT>/references/astro/templates/bookings/ServiceBookingFlow.tsx` — the coordinator island (holds the selected slot; calendar → form → redirect).

Pages (`pages` scope):
- `<SKILL_ROOT>/references/astro/templates/bookings/ServiceCard.astro`
- `<SKILL_ROOT>/references/astro/templates/bookings/services/index.astro`, `<SKILL_ROOT>/references/astro/templates/bookings/services/[slug].astro`
- `<SKILL_ROOT>/references/astro/templates/bookings/booking-confirmation.astro`

### Pre-copied by the orchestrator (do NOT write these yourself)
Mechanical, brand-agnostic — the orchestrator copies them before dispatch (BUILD-astro.md § build wave). Rely on them at the listed paths:
- `src/components/bookingDriver.ts` ← `<SKILL_ROOT>/references/astro/templates/bookings/bookingDriver.ts` — the booking SDK sequence (`book()`, `navigateToCheckout()`). The islands import it; never re-author it.
- `src/components/SeoTags.astro` ← `<SKILL_ROOT>/references/astro/templates/bookings/SeoTags.astro` — renders `service.seoData.tags`; imported by `services/[slug].astro`.
- `src/styles/components-bookings.css` ← `<SKILL_ROOT>/references/astro/templates/bookings/components-bookings.css` — the flow's component classes.

If a pre-copied file is missing at runtime, that's an orchestrator-side bug — return `status: "partial"` with `errors: [{code: "UTILITY_TEMPLATE_NOT_PRECOPIED", path: "<missing>"}]`; do not author your own version.

## Pre-return file-existence assertion (pages scope)

Before returning `status: "complete"` from `pages`, verify on disk:
- `src/pages/services/index.astro`
- `src/pages/services/[slug].astro`
- `src/pages/booking-confirmation.astro`

If any declared file is missing, return `status: "partial"` with `errors: [{ code: "PHASE4_FILE_MISSING", path: "<expected path>" }]`.

## Dependencies (Setup installs these — see SETUP.md)

`@wix/bookings @wix/essentials @wix/forms @wix/redirects @wix/auto_sdk_ecom_cart-v-2`.
`@wix/forms` renders the booking-form schema; `@wix/redirects` + `@wix/auto_sdk_ecom_cart-v-2` run the cart/checkout sequence.

## CSS ownership — bookings pack

Bookings-specific CSS lives in `src/styles/components-bookings.css` (pre-copied — see above), NOT in `global.css`. Classes the pack owns: `.service-card*`, `.service-grid`, `.availability-*`, `.time-slot*`, `.booking-*`. If `global.css` ships a partial rule for any of these, flag it (`{code:"GLOBAL_CSS_LEAK", class:"<name>"}`) and override in `components-bookings.css`.

## Bookings-specific failure modes

| Wrong | Right |
|-------|-------|
| Stop after `createBooking` returns | `createBooking` leaves the booking **`CREATED`**. The seat is held by the **ecom Cart V2**: continue `createCart → calculateCart → isCheckoutRequired ? hosted-checkout redirect : placeOrder`. The whole sequence is in `bookingDriver.ts` — use it. |
| Hardcode `selectedPaymentOption: "ONLINE"` on `createBooking` | **Derive** it from the service: `online && !inPerson → "ONLINE"`, `!online && inPerson → "OFFLINE"`, else `"ONLINE"`. A free / pay-in-person service is the only kind that reaches `placeOrder`, and booking it `ONLINE` makes the cart reject it with **`INSUFFICIENT_INVENTORY`** (`available_quantity: 0`). `bookingDriver.ts` derives this for you (don't pass `selectedPaymentOption` to `book()`). |
| Pass `contactDetails` to `createBooking` | Pass **`formSubmission`**, keyed by each field's **`target`** (default booking form: snake_case `first_name`/`last_name`/`email`/`phone`). `contactDetails` is what Wix derives back onto the response. |
| Hardcode the booking-form fields | Render the form **schema-driven**: read `service.form._id`'s fields via `@wix/forms`, render by `componentType`, key values by `target` (same renderer as `../astro/forms/CONTACT_FORM.md`). |
| Render every form field as a text input (default unknown types to `TEXT_INPUT`) | Render **only** fields with a recognized string `componentType` (`TEXT_INPUT`/`PHONE_INPUT`/`DROPDOWN`). **Skip complex, object-valued fields** (e.g. the default booking form's multi-line `ADDRESS`) — sending a string for them fails `createBooking` with **"must be object"**. Only `first_name`/`last_name`/`email` are enforced, so skipping optional complex fields is safe. |
| Call `queryServices` without an `appId` filter | Always include `appId` (`13d21c63-…`) in the filter. List: `queryServices({ query:{ filter:{ appId }, paging }, conditionalFields:["STAFF_MEMBER_DETAILS"] }).find()`. Single: the `.eq("mainSlug.name", slug).eq("appId", …).limit(1).find()` builder chain. |
| Build `createClient({ auth: OAuthStrategy({ clientId: import.meta.env.* }) })` in `.astro` SSR | The `*_WIX_CLIENT_ID` env var is client-only → `undefined` at server render → 500. SSR reads use the ambient `@wix/essentials`: `auth.elevate(services.queryServices)(...)`. |
| Build an `OAuthStrategy` client inside an astro browser island | Astro islands call the `@wix` modules **ambiently** (the `@wix/astro` visitor client, like the ecom `CartView`) — no `createClient`. (Own/static builds DO use `OAuthStrategy` — `../custom/bookings/WIRING.md`.) |
| Pass UTC ISO strings to `listAvailabilityTimeSlots` | Use **local** date strings `YYYY-MM-DDThh:mm:ss` (no `Z`) + a separate `timeZone`. |
| `availability.queryAvailability` / `import { availability }` | APPOINTMENT → `availabilityTimeSlots.listAvailabilityTimeSlots({ serviceId: <string> })`; CLASS → `eventTimeSlots.listEventTimeSlots({ serviceIds: [<string>] })`. The `availability` namespace does not exist. |
| Read slot time from `timeSlot.slot.startDate` | Slot fields are at the **top level**: `localStartDate`, `localEndDate`, `scheduleId` (APPOINTMENT). CLASS slots carry `eventInfo.eventId` and have **no** `scheduleId`. |
| Dump every slot in one flat, time-only grid | **Group slots by day** — a flat time-only grid hides which day a slot is on. The calendar shape (week / month / N-day) is your choice; the example uses a week strip → the picked day's times. |
| Read the staff id from `staffMember._id` / `.resourceId` on `staffMemberDetails.staffMembers` | The field is **`staffMemberId`** (on `service.staffMemberDetails.staffMembers[]`) — despite the name it IS the resource GUID (matches the service's `staffMemberIds`). Filter availability: APPOINTMENT `resourceTypes:[{ resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID, resourceIds:[staffMemberId] }]`; CLASS `eventFilter:{ "resources.id": { $hasSome:[staffMemberId] } }`. Record the choice as `slot.resource = { _id: staffMemberId, name }`; leave it unset for "any staff" (ANY_RESOURCE fallback). Show the picker only when >1 staff. |
| Always show the location selector / staff picker / category bar | **Auto-skip** each when there's nothing to choose: location count ≤1 (`businessLocations.length + custom?.exists + customer?.exists`), staff ≤1, categories ≤1. Single-location single-staff sites see the simple flow. |
| Filter the catalog by a synthetic location id, or hardcode the location filter | Real business id → `filter["locations.business.id"] = { $hasSome:[id] }`; synthetic `"custom"`/`"customer"` → `filter["locations.type"] = { $hasSome:["CUSTOM"|"CUSTOMER"] }`. Carry the choice to the detail page so availability is scoped too. |
| Call `listAvailabilityTimeSlots` **without** a `locations` filter on a multi-location service | It returns **one slot per location** per time → every time appears **N×** (duplicated rows). **Always scope availability to one business location** (`locations: [{ _id, locationType:"BUSINESS" }]`; CLASS: `eventFilter:{ "location.id":[id] }`). Build the calendar's location list from **`queryLocations()`** (the site's real business locations) intersected with the service's location ids — NOT from `service.locations` alone (its entries can carry an id the availability engine doesn't recognize → scoping to it returns 0 slots even though the service has availability). Default to the carried/first, picker when >1; no business locations → unscoped. Staff does **not** cause duplicates — one slot carries many `availableResources`; only location multiplies rows. |
| Let a `queryCategories` failure break the catalog | Categories are **non-fatal** — wrap in try/catch and render the catalog without the bar. Category filter: `filter["category.id"] = { $eq: categoryId }`; a service's category is `service.category._id`. |
| Read service slug from `service.slug` / name from `service.info.name` | V2 is flat: slug `service.mainSlug.name` (fallback `supportedSlugs[0].name`), `service.name`, `service.description`, `service.tagLine`; duration `service.schedule.availabilityConstraints.sessionDurations[0]`; price `service.payment.fixed.price.value` (string); media `service.media.mainMedia.image.url`. |
| Use `service.id` / `result.booking.id` | Entity ids are `_id` (underscore): `service._id`, `booking._id`. |
| Mount the calendar/form without `client:only="react"` | Availability + booking are timezone/session-specific — always `client:only="react"`. SSR only the read pages (catalog/detail) for SEO. |
| Omit try/catch on the booking | `createBooking` can reject (e.g. a slot taken between fetch and submit, or strict phone validation). Catch and surface a friendly message; don't crash. |
| Ship a payment/deposit breakdown, multi-service stacking, waitlist, or on-site manage/cancel | Out of scope. **Waitlist and manage/cancel have no headless SoT** (the components + vibe plugin expose only display-only policy flags — no join/cancel logic) — do not invent them on the REST/anonymous-token layer. Post-booking self-service is handled by the Wix-hosted flow / member area. |
