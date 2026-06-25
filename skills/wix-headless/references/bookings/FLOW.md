# Bookings — the booking flow (framework-agnostic logic)

The booking logic — the step model, the shared state, and the exact `@wix` SDK
sequence — is the **same on every frontend** (astro, react/vite, vue, plain HTML).
This file is that shared logic. The per-framework wiring layers on top:

- **astro** (`frontendBuild: wix`): `../astro/bookings/SERVICES_PAGES.md` (SSR read pages) + `../astro/bookings/COMPONENTS.md` (the client islands).
- **own / static** (`frontendBuild: own`/`none`): `../custom/bookings/WIRING.md`.

**Code examples are React** (`../astro/templates/bookings/*.tsx` + `bookingDriver.ts`).
React is directly usable on astro islands and on react/vite. **On any other
framework, translate the examples** — the SDK calls and payloads are identical;
only the UI idiom (`useState`/`useEffect` → a store / `onMounted` / signals) and
the client acquisition differ (see "Client identity" below).

The flow covers **appointments, classes, and courses**. APPOINTMENT and CLASS share
the same booking sequence; they differ only in the availability call (`availabilityTimeSlots`
vs `eventTimeSlots`, noted inline). **COURSE is different**: a course is enrolled as a
**whole series** — no availability calendar, no per-slot time — so it has its own detail
page (schedule + capacity + an Enroll action) and a `bookedEntity.schedule` create shape.
The course specifics are in **§10**; the rest of this file is the appointment/class flow.
**Add-ons are out of scope.**

---

## 1. The step model

A single customer journey, holding one shared selection. The catalog optionally
filters by **location** and **category**; the slots step optionally filters by
**staff**. All three auto-skip when there's nothing to choose (≤1 location, ≤1
category, ≤1 staff), so a plain single-location single-staff site sees the simple
five-step path:

```
0. Location   (optional) pick a location — only shown when the site has >1 locations → scopes the catalog + availability
1. Catalog    list bookable services (optionally filtered by location/category) → pick a service
2. Slots      availability calendar (optionally filtered by staff)               → pick a time slot
3. Details    the service's booking form (collect contact)                      → submit
4. Book       run the SDK sequence (§3)
5a. paid      → redirect to the Wix-hosted checkout → returns to the confirmation page
5b. free/offline → place the order → confirmation page
```

The location/category filters and the staff picker are covered in §§7–8.

**Courses take a shorter path** (§10): catalog → **course detail (schedule + capacity +
Enroll)** → Details (the same booking form) → Book. There is **no Slots step and no
calendar** — a course is enrolled as a whole series, not a picked time.

**The catalog is the entry point but optional** — a visitor can land directly on a
service page and start at the Slots step. Every step rehydrates from the URL (§2),
so deep links work.

Mapping the steps onto pages/routes is the **target framework's choice** — translate
the step model to whatever router the framework uses. The skill recommends the routes
`/services`, `/services/[slug]`, `/booking-confirmation` (advertised in
`../verticals/bookings.md`). On astro specifically, SSR the catalog + detail pages
for SEO and run slots + form + book in a `client:only` island.

## 2. Shared booking state

Steps 1–4 build up one selection (this is exactly `BookParams` + `SelectedSlot`
in `../astro/templates/bookings/bookingDriver.ts`):

- **`service`** — the chosen service object (the booking step reads `service.payment` + `service.bookingPolicy`; the slots step reads `service.staffMemberDetails.staffMembers` for the staff picker — §8).
- **`slot`** — `{ serviceType, serviceId, localStartDate, localEndDate, timezone, scheduleId?, eventId?, locationId?, locationType?, resource? }`. `resource = { _id, name }` is set only when a specific staff was chosen (§8); otherwise the driver emits the ANY_RESOURCE fallback. `locationId`/`locationType` come from the slot's own `location` (the booking books at that location).
- **`formSubmission`** — the booking-form values, **keyed by each field's `target`** (§4).

Hold it however the framework prefers (React state lifted to a coordinator, a
store, route loaders + a provider, query-params). **Two rules that bite:**

1. **Persist the selection before navigating.** When a step lives on its own
   route, write the selection into the shared state (or the URL) *before* moving
   on, and let the next step **rehydrate from the slug/URL** on direct load /
   refresh. A persistent provider that does not re-init on in-app navigation will
   otherwise show an empty next step.
2. **The slug is the carry-across key.** `serviceSlug` (the service's
   `mainSlug.name`) identifies the service across the slots + details steps;
   resolve the full service from it when state is lost.

## 3. The booking SDK sequence — `bookingDriver.ts`

The whole booking — `createBooking → createCart → calculateCart → checkout-or-place`
— is in **`../astro/templates/bookings/bookingDriver.ts`**, in plain `@wix` SDK
calls (no React, no UI). **Use it as-is** (it is framework-agnostic); the booking
step calls `book(params)` then branches on the result. Do not re-author the
sequence — the payload shapes are exact and easy to get subtly wrong.

```
book({ service, slot, formSubmission, timezone }) →
  createBooking(...)            // booking lands CREATED — the cart holds the seat
  createCart(...)               // one catalog item per bookingId, appId = BOOKING_APP_ID, channel WEB
  calculateCart(cartId)         // → { cart, summary }; totals on summary.priceSummary.total.amount
  isCheckoutRequired(...) ?
     → { CheckoutRequired, cartId }  // paid → navigateToCheckout(cartId, postFlowUrl) → Wix-hosted checkout
     : placeOrder(cartId) → { CheckoutSkipped, orderId }   // free / pay-in-person → confirmation
```

Key facts the driver encodes (do not deviate):
- **No `confirmBooking`** — `confirmBooking` is the classic Bookings server-side
  confirm step (it moves a booking from `CREATED` to `CONFIRMED`). Here the **ecom
  cart holds the seat** instead — `placeOrder` (free/offline) or the hosted checkout
  (paid) drives confirmation — so a client-only site completes the whole flow with no
  server elevation.
- **COURSE uses `bookedEntity.schedule`, not `slot`** — when `slot.serviceType === "COURSE"`
  the driver sends `bookedEntity: { schedule: { scheduleId, serviceId, location, timezone },
  tags: ["COURSE"] }` (the course's own `service.schedule._id`) — **no slot, no eventId, no
  resource selection**. Wix derives the booking's start/end from the schedule. The cart /
  checkout half is identical to appointments/classes. See §10.
- **ANY_RESOURCE fallback (staff)** — when no staff is chosen (the default, and on
  single-staff services), `createBooking` sends
  `resourceSelections:[{ resourceTypeId:"1cd44cf8-756f-41c3-bd90-3e2ffcaf1155", selectionMethod:"ANY_RESOURCE" }]`
  and Wix auto-assigns a bookable staff resource (appointment slots return
  `availableResources:[]` yet book fine this way). A specific staff choice sets
  `slot.resource` instead (§8).
- **Checkout decision** — `isCheckoutRequired`: if the service's booking policy charges
  a **cancellation fee** (`service.bookingPolicy.cancellationFeePolicy.enabled`) →
  checkout (a card must be on file); else total 0 → place; else `FULL_PAYMENT_OFFLINE`
  → place; else checkout.
- **Redirect shape** — paid bookings hand the cart to the Wix-hosted **ecom**
  checkout: `createRedirectSession({ ecomCheckout: { checkoutId: cartId }, callbacks:{ postFlowUrl } })`.

### Browse + availability (the read calls the steps make)

Mirror what the Bookings SDK does (`services.queryServices` is the raw SDK, not a component):

```js
// Catalog (list) — the filter MUST include appId; pass conditionalFields, then .find().
// Merge the optional category/location filters into the SAME filter object (§7):
services.queryServices({
  query: { filter: { appId: BOOKING_APP_ID /* , "category.id": { $eq: catId },
                       "locations.business.id": { $hasSome: [locId] } */ }, paging: { limit: 100 } },
  conditionalFields: ["STAFF_MEMBER_DETAILS"],
}).find();                                   // → result.items ; filter out s.hidden

// Single service by slug — the .eq() builder chain:
services.queryServices({ conditionalFields: ["STAFF_MEMBER_DETAILS"] })
  .eq("mainSlug.name", slug).eq("appId", BOOKING_APP_ID).limit(1).find();

// Availability (APPOINTMENT) — serviceId is a single GUID STRING. The staff (§8)
// and location filters are OPTIONAL params on the same call:
availabilityTimeSlots.listAvailabilityTimeSlots({
  serviceId, fromLocalDate, toLocalDate, timeZone, bookable: true, cursorPaging: { limit: 100 },
  // staff:    resourceTypes: [{ resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID, resourceIds: [staffResourceId] }],
  //           includeResourceTypeIds: [STAFF_MEMBER_RESOURCE_TYPE_ID],
  // location: locations: [{ _id: locationId, locationType: "BUSINESS" }],
});                                          // slots: result.timeSlots[] (localStartDate/localEndDate/scheduleId at top level)

// Availability (CLASS) — different namespace, PLURAL serviceIds; slots carry eventInfo.eventId, no scheduleId.
// CLASS filters staff + location via eventFilter instead:
eventTimeSlots.listEventTimeSlots({
  serviceIds: [serviceId], fromLocalDate, toLocalDate, timeZone, includeNonBookable: false,
  // eventFilter: { "resources.id": { $hasSome: [staffResourceId] }, "location.id": [locationId] },
});
```

`fromLocalDate`/`toLocalDate` are **local** date strings `YYYY-MM-DDThh:mm:ss`
(no `Z`) with an explicit `timeZone`.

## 4. The booking form — schema-driven (`@wix/forms`)

The booking form is a **`@wix/forms` form** attached to the service
(`service.form._id`, namespace `wix.bookings.v2.bookings`). Render it
**schema-driven** — read the field list and render an input per field type,
collecting each value with the **correct JS type**:

1. Fetch the form by `service.form._id` (`@wix/forms` `getForm`; server-side/elevated
   where the framework allows). **Read `form.formFields`** — the documented field array
   (the `inputOptions` shape). (`form.fields` is an internal runtime field; don't use it.)
2. For each field (`!hidden`, has a `target`), read: `field.target` (the submission
   key), `field.validation.required`, the label from `field.view.label` (a string, or
   a Ricos rich-content object — walk its nodes for text), and choice `field.view.options`
   (`[{ value, label }]`). Determine the **value type from `field.validation`**'s sub-key:
   - `validation.string` → `string`. Sub-render by `format` / options: `DATE`→date,
     `DATE_TIME`→datetime, `TIME`→time; has `options`→select (or radio); `EMAIL`→email,
     `PHONE`→tel; `identifier === "TEXT_AREA"`→textarea; else text input.
   - `validation.number` → **`number`** (parse the input; never submit a numeric string).
   - `validation.array` → **`string[]`** (checkbox-group / tags; toggle option `value`s).
   - `validation.boolean` (often the only marker is a boolean default) → `boolean` (checkbox).
   - `validation.predefined.format === "MULTILINE_ADDRESS"` → **nested object** (see below).
   - `validation.predefined.format === "WIX_FILE"` → **`WixFile[]`** (file/signature; see below).
   - DISPLAY fields (no `target` — e.g. a heading) render read-only / are skipped.
3. **The submission value TYPE is the contract.** `createBooking` validates it
   server-side and a wrong type rejects the *whole* booking (e.g. a number field sent
   as `"2"`, or an address sent as a string → rejected). Match the table above exactly.
4. **Multi-line address** → one nested object at the field's `target`, of **ISO codes**.
   The validator is strict: `country` must be a valid ISO-2 code (an enum) and
   `subdivision` a valid code **for that country** — free-text ("United States",
   "Texas") is **rejected**, which is why the Wix dashboard renders Country/Region as
   **dropdowns**. The sub-field set is **per-country** (US = address/city/region-dropdown/zip;
   most countries = address/city/postal; some use streetName/streetNumber). Render this
   faithfully with `addressData.ts` (baked from Wix's own per-country address templates):
   a **Country `<select>`** (`ADDRESS_COUNTRIES` + `Intl.DisplayNames` for names) →
   `addressSubFields(country)` gives the sub-fields to render, each a `<select>` when it
   has `options` (e.g. US states) else a text input. Changing country resets the object.
   See `../astro/templates/bookings/BookingForm.tsx` (`case "address"`).
   **Render address ONLY when the selected slot is a CUSTOMER location**
   (`slot.locationType === "CUSTOMER"`) — same as the native Wix booking form. The
   server requires address only for customer locations; for BUSINESS/other locations
   it accepts a booking with no address even though the schema marks it `required`, so
   showing it there is wrong. (The renderer filters it out for non-CUSTOMER slots.)
5. **File upload / signature** → `WixFile[]`. The `FileField` (in `BookingForm.tsx`)
   does the documented pure-SDK round-trip: `submissions.getMediaUploadUrl(formId,
   filename, mimeType)` → `PUT` the bytes to the returned URL → store
   `[{ fileId, displayName, fileType, url? }]` at the field's `target`. `formId` =
   `service.form._id`. `createBooking` accepts the resulting `WixFile[]`.
6. **Order fields by the form's layout, not the array.** Sort by `form.steps[].layout.large.items`
   (`row`, then `column`) — that's the order the merchant arranged in the dashboard.
   (`[slug].astro` does this after mapping.) Hidden / no-`target` fields are dropped.
7. Collect the values into an object **keyed by each field's `target`** — that is
   `formSubmission`. Pass it to `book()`. Include only filled fields; never send a
   value for a field you didn't render. Empty → omit (or `null`); keep `0` / `false`.

**Phone** (`PHONE_INPUT`) renders a **country-code dropdown + number input** via
`libphonenumber-js` (`PhoneField` in `BookingForm.tsx`), emitting an E.164 string
(`"+14155551234"`). **Inline validation** runs on blur from the schema's own rules
(`formValidation.ts`, built on `ajv` + `ajv-formats` + a libphonenumber phone check):
required / minLength / maxLength / pattern / format (email…) / min / max / minItems /
maxItems, shown per-field; the server still validates authoritatively on submit, so
this is a UX layer. **Files shipped with the renderer:** `BookingForm.tsx`,
`addressData.ts` (baked per-country address templates), `formValidation.ts`. **Deps
to install:** `libphonenumber-js ajv ajv-formats` (SETUP.md Step 4c bookings row).

**Do not** submit `contactDetails`, and **do not** hardcode field names — key by
`target`. Wix derives `contactDetails` (and `fullAddress`) from the contact-mapped
fields. The default booking form's targets are snake_case `first_name` / `last_name` /
`email` / `phone` (+ a `MULTILINE_ADDRESS` `address`). Reference example:
`../astro/templates/bookings/BookingForm.tsx` (renderer) and `services/[slug].astro`
(the `normalizeFormField` schema mapping).

## 5. The availability calendar (slots step)

**Group slots by day — don't render a flat list of every slot with time-only
labels** (the visitor can't tell which day a slot is on; that flat grid was the
original usability failure). The calendar **shape is your / the brand's choice** —
week, month, or N-day. The reference example uses a **week view** (a 7-day strip
with week navigation → the picked day's times); fetch availability for the visible
window (`fromLocalDate`/`toLocalDate` = that window's bounds), group by calendar
day, and offer a **"check next availability"** action that probes forward when the
window is empty. Reference example:
`../astro/templates/bookings/AvailabilityCalendar.tsx`.

## 6. Client identity (per framework)

The SDK calls are identical everywhere; only how you get the client differs:
- **astro** — SSR read pages use the ambient `@wix/essentials` client
  (`auth.elevate(services.queryServices)(...)`); browser islands call the `@wix`
  modules **ambiently** too (the `@wix/astro` visitor client, like the ecom
  `CartView` island) — no `createClient`/`OAuthStrategy`.
- **own / static** — acquire a visitor client once:
  `createClient({ modules, auth: OAuthStrategy({ clientId: appId }) })` and call
  the same functions on it. CDN imports for `none`, bundled for `own`.

## 7. Catalog filters — location & category (both auto-skip)

Both filter the **catalog query** and re-render the list. The cleanest
framework-agnostic shape is a re-query driven by a query param (`?locationId`,
`?category`) — links/SSR on a static catalog, or a store/router on a SPA. **Show
each filter only when there is more than one choice**, exactly as the SoT does.

**Location** (the SoT is location-first; here it auto-skips ≤1 location):
1. `services.queryLocations()` → `{ businessLocations: { locations: [{ _id, type, business: { name } }] }, customLocations: { exists }, customerLocations: { exists } }`.
2. Count = `businessLocations.locations.length + (customLocations.exists ? 1 : 0) + (customerLocations.exists ? 1 : 0)`. **Show the selector only when count > 1.**
3. The chosen location filters the catalog query:
   - a real business id → `filter["locations.business.id"] = { $hasSome: [id] }`;
   - the synthetic `"custom"` / `"customer"` → `filter["locations.type"] = { $hasSome: ["CUSTOM"|"CUSTOMER"] }` (the SoT's synthetic-id mapping).
4. **Scope availability to exactly ONE location — always, on a multi-location service.** `listAvailabilityTimeSlots` returns **one slot per location** per time ("if `locations` is not specified, returns time slots for all locations where the service is available"), so an unscoped call on a 2-location service shows every time **twice**. Pass a single-element filter: APPOINTMENT → `locations: [{ _id, locationType: "BUSINESS" }]`; CLASS → `eventFilter: { "location.id": [id] }`. (Staff does **not** multiply rows — one slot carries many `availableResources`; only location does.) The slots step builds its location list from **`queryLocations()`** (the site's real business locations, whose ids the availability engine recognizes) **intersected with the service's own location ids** — not from `service.locations` alone, whose entries can carry an id the availability engine doesn't recognize (scoping to it returns zero slots). A **location picker** defaults to the catalog-carried location (or the first) and scopes the call when there's a real location to scope to; when the site has no business locations the list is empty and the call stays unscoped (one location → no duplicates). The booked slot carries its own `location`, so the booking books at that location (the driver maps it).

**Category:**
1. `categoriesV2.queryCategories().find()` → `result.items: [{ _id, name }]`. **Non-fatal** — if it fails, render the catalog without the bar.
2. **Show the bar only when `items.length > 1`** (a fresh site has one default category).
3. The chosen category filters the catalog query: `filter["category.id"] = { $eq: categoryId }`. A service carries its category at `service.category._id`.

Reference example: `../astro/templates/bookings/services/index.astro` (both filters, link-driven, auto-skipping).

## 8. Staff / resource selection (auto-skips ≤1 staff)

A service carries its staff on the service object via the **`STAFF_MEMBER_DETAILS`
conditional field** (already requested in the catalog/detail query):
`service.staffMemberDetails.staffMembers: [{ staffMemberId, name }]`. The id used
for filtering and booking is **`staffMemberId`** — which, **despite the name, IS the
resource GUID** (it matches the service's `staffMemberIds` and the Staff Members API
`resourceId`). Below, `resourceId` is that value.

1. Show a "Any staff member / pick one" control above the calendar **only when
   there is more than one staff**.
2. Selecting a staff re-fetches availability filtered to that resource:
   - APPOINTMENT → `resourceTypes: [{ resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID, resourceIds: [resourceId] }]` (plus `includeResourceTypeIds: [STAFF_MEMBER_RESOURCE_TYPE_ID]`);
   - CLASS → `eventFilter: { "resources.id": { $hasSome: [resourceId] } }`.
3. When a slot is picked **with a specific staff selected**, set `slot.resource = { _id: resourceId, name }`. The driver books that resource. With **"any staff"**, leave `resource` unset — the driver emits the **ANY_RESOURCE fallback** and Wix auto-assigns a bookable resource (appointment slots can return `availableResources: []` yet book fine this way).

`STAFF_MEMBER_RESOURCE_TYPE_ID = "1cd44cf8-756f-41c3-bd90-3e2ffcaf1155"` (exported from `bookingDriver.ts`). Reference example: `../astro/templates/bookings/AvailabilityCalendar.tsx` (the staff `<select>` + the filtered fetch).

## 9. Out of scope

Waitlist, on-site manage/cancel, payment/deposit breakdown, multi-service / day-range,
and **course subscriptions** (multi-cycle payments) are out of scope. (Waitlist,
subscriptions, and manage/cancel have **no headless SoT** — neither the components nor
the vibe plugin implement join/cancel logic, only display-only policy flags — so they
are deliberately not built here.) Show bookable slots / open courses only; post-booking
self-service is handled by the Wix-hosted flow / member area.

## 10. Course enrollment (the COURSE service type)

A **course** is a fixed-date program of multiple sessions that customers book as a
**whole series** — not a per-session time. So the course path drops the Slots step and
the calendar: the detail page shows the **schedule + capacity + an Enroll action**, and
enrollment reuses the **same booking form and the same cart/checkout** as everything
else. The headless components SoT recognizes COURSE but does **not** make it bookable, so
this flow is built from the documented SDK/REST calls below (all verified live).

### What a course exposes (on the `service` object, from `queryServices`)
- `service.type === "COURSE"`; `service.schedule._id` (the course's schedule id — note
  **`_id`**, the SDK convention; REST returns `schedule.id`);
- `service.schedule.firstSessionStart` / `service.schedule.lastSessionEnd` (the run dates);
- `service.defaultCapacity` (max participants for the whole course);
- `service.bookingPolicy.bookAfterStartPolicy.enabled` (may a customer still join after the
  first session?).

### Reading the sessions + capacity + staff + location — ONE call
Courses do **not** use Time Slots V2 (`listEventTimeSlots`/`listAvailabilityTimeSlots`
return nothing for a COURSE). The session events live in **Calendar Events V3**, on the
course's schedule — exactly what the native Wix course page reads. Use `@wix/calendar`:

```js
import { events as calendarEvents } from "@wix/calendar";
// astro SSR: wrap in auth.elevate(...). Own/static: call on the visitor client
// (the native public course page reads this as a visitor — see WIRING.md).
const res = await calendarEvents.queryEvents({
  filter: { scheduleId: service.schedule._id },   // NOT service.schedule.id
  cursorPaging: { limit: 100 },
});
// res.events[] — one per session. Each carries:
//   start/end          → { localDate, utcDate, timeZone }  ⚠️ the SDK gives utcDate as a
//                         Date OBJECT (REST returns a string) — normalize with
//                         new Date(d).toISOString() before comparing/sorting/serializing,
//                         or your "upcoming" filter silently drops every session.
//   totalCapacity / remainingCapacity → the course's "available spots" (course-level;
//                         each session carries the same numbers). This is how the native
//                         page shows spots — NOT Query Extended Bookings (which needs
//                         elevation). isFull = remainingCapacity <= 0.
//   resources[]        → staff/instructor; filter to the staff resource type
//                         "1cd44cf8-756f-41c3-bd90-3e2ffcaf1155" and read .name.
//   location           → { type, name? }; BUSINESS → "In person", CUSTOMER → "Your location".
//   status             → skip "CANCELLED".
```

Keep the upcoming (`end >= now`) events, sort by start, and present them as an
**Upcoming sessions** list (time · duration · instructor) — **paginate** (e.g. 7 per page,
Prev/Next) rather than capping, like the native page. Show **Available spots: R of T** and
the **location**. (Query Extended Bookings — `extendedBookings.queryExtendedBookings`
filtered by `bookedEntity.schedule.scheduleId` — is the docs' capacity method but needs
elevation and isn't what the native page uses; prefer the events approach above.)

### Enrolling
Reuse the **same booking form** (§4) and the **same `book()` sequence** (§3). Build a
selection with `serviceType: "COURSE"`, `serviceId: service._id`, `scheduleId:
service.schedule._id`, the business `timezone`, and `localStartDate/localEndDate` =
firstSessionStart/lastSessionEnd (display only). `bookingDriver.ts` then sends
`bookedEntity.schedule.scheduleId` (§3) → `createBooking` returns `CREATED` → cart →
`placeOrder` (free) or hosted checkout (paid). Verified: a free course reaches `CONFIRMED`.

Gate the Enroll action: hide it when the course `isFull`, or when it has already started
(`now > firstSessionStart`) and `bookAfterStart` is false, or when there are no sessions.
A wrong-shape or full-course `createBooking` rejects server-side — catch and show a
friendly message (the capacity check is a UX nicety; the server is authoritative).

### Per-framework
- **astro** — the detail page (SSR) runs `queryEvents` under `auth.elevate` and passes the
  sessions/capacity/staff/location into a `client:only` island (`CourseEnrollFlow.tsx`,
  which renders the schedule + paginated sessions + Enroll → `BookingForm`).
- **own / static** — call `queryEvents` on the visitor client (the native public page does;
  if your visitor context can't read it, fall back to `service.defaultCapacity` text and
  let `createBooking` enforce capacity). See `../custom/bookings/WIRING.md`.

Reference example: `../astro/templates/bookings/{CourseEnrollFlow.tsx, services/[slug].astro}`.
