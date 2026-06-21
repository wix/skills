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

The flow covers **appointments and classes**. APPOINTMENT and CLASS share the
same booking sequence; they differ only in the availability call (`availabilityTimeSlots`
vs `eventTimeSlots`, noted inline). **Courses and add-ons are out of scope.**

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
**schema-driven** — read the field list and render inputs by field type — the
**same renderer the forms vertical uses** (`../astro/forms/CONTACT_FORM.md`):

1. Fetch the form by `service.form._id` (`@wix/forms` `getForm`; server-side/elevated
   where the framework allows). Read `form.formFields`.
2. Keep `fieldType === "INPUT" && !hidden` **and** a recognized string
   `componentType` (`TEXT_INPUT` / `PHONE_INPUT` / `DROPDOWN`). For each, take
   `inputOptions.target`, `inputOptions.required`, `inputOptions.stringOptions.componentType`,
   and the label from `inputOptions.stringOptions.{textInputOptions|dropdownOptions|phoneInputOptions}.label`.
   **Skip complex, object-valued fields** — e.g. a multi-line `ADDRESS` — they carry
   no string `componentType`; rendering them as a text input sends a string and
   `createBooking` rejects it with **"must be object"**. The booking enforces only
   the contact basics (`first_name`/`last_name`/`email`), so omitting an optional
   complex field is safe (do **not** default unknown field types to a text input).
3. Render generic inputs by `componentType`: `TEXT_INPUT` → text input,
   `DROPDOWN` → select, `PHONE_INPUT` → `type=tel`; treat `identifier === "TEXT_AREA"`
   (or `target` containing `message`) as a textarea (its `componentType` is still `TEXT_INPUT`).
4. Collect the values into an object **keyed by each field's `target`** — that is
   `formSubmission`. Pass it to `book()`. Only include fields the visitor filled;
   never send a value for a field you didn't render.

**Do not** submit `contactDetails`, and **do not** hardcode field names — key by
`target`. The default booking form's targets are snake_case `first_name` /
`last_name` / `email` / `phone`. Reference example: `../astro/templates/bookings/BookingForm.tsx`.

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

Waitlist, on-site manage/cancel, payment/deposit breakdown, and multi-service /
day-range are out of scope. (Waitlist and manage/cancel have **no headless SoT** —
neither the components nor the vibe plugin implement join/cancel logic, only
display-only policy flags — so they are deliberately not built here.) Show
bookable slots only; post-booking self-service is handled by the Wix-hosted flow /
member area.
