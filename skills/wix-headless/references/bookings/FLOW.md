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

The flow is **appointment booking**. CLASS sign-up reuses the same sequence with
an event-slot branch (noted inline) and is a fast-follow, not v1. **Location and
staff selection are likewise a fast-follow (a separate PR); add-ons are out of
scope.** v1 threads a single service selection — the shared state below holds no
location / staff / add-on choice yet.

---

## 1. The step model

A single customer journey, five steps, holding one shared selection:

```
1. Catalog    list bookable services                         → pick a service
2. Slots      week calendar of availability for that service → pick a time slot
3. Details    the service's booking form (collect contact)   → submit
4. Book       run the SDK sequence (§3)
5a. paid      → redirect to the Wix-hosted checkout → returns to the confirmation page
5b. free/offline → place the order → confirmation page
```

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

- **`service`** — the chosen service object (the booking step reads `service.payment` + `service.bookingPolicy`).
- **`slot`** — `{ serviceType, serviceId, localStartDate, localEndDate, timezone, scheduleId?, eventId?, locationId?, locationType? }`.
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
- **ANY_RESOURCE fallback (staff)** — v1 has **no staff picker**, so `createBooking`
  always sends `resourceSelections:[{ resourceTypeId:"1cd44cf8-…", selectionMethod:"ANY_RESOURCE" }]`
  and Wix auto-assigns a bookable staff resource (appointment slots return
  `availableResources:[]` yet book fine this way). (Explicit staff selection is a
  fast-follow.)
- **Checkout decision** — `isCheckoutRequired`: if the service's booking policy charges
  a **cancellation fee** (`service.bookingPolicy.cancellationFeePolicy.enabled`) →
  checkout (a card must be on file); else total 0 → place; else `FULL_PAYMENT_OFFLINE`
  → place; else checkout.
- **Redirect shape** — paid bookings hand the cart to the Wix-hosted **ecom**
  checkout: `createRedirectSession({ ecomCheckout: { checkoutId: cartId }, callbacks:{ postFlowUrl } })`.

### Browse + availability (the read calls the steps make)

Mirror what the Bookings SDK does (`services.queryServices` is the raw SDK, not a component):

```js
// Catalog (list) — the filter MUST include appId; pass conditionalFields, then .find():
services.queryServices({
  query: { filter: { appId: BOOKING_APP_ID }, paging: { limit: 100 } },
  conditionalFields: ["STAFF_MEMBER_DETAILS"],
}).find();                                   // → result.items ; filter out s.hidden

// Single service by slug — the .eq() builder chain:
services.queryServices({ conditionalFields: ["STAFF_MEMBER_DETAILS"] })
  .eq("mainSlug.name", slug).eq("appId", BOOKING_APP_ID).limit(1).find();

// Availability (APPOINTMENT) — serviceId is a single GUID STRING:
availabilityTimeSlots.listAvailabilityTimeSlots({
  serviceId, fromLocalDate, toLocalDate, timeZone, bookable: true, cursorPaging: { limit: 100 },
});                                          // slots: result.timeSlots[] (localStartDate/localEndDate/scheduleId at top level)

// Availability (CLASS) — different namespace, PLURAL serviceIds; slots carry eventInfo.eventId, no scheduleId:
eventTimeSlots.listEventTimeSlots({ serviceIds: [serviceId], fromLocalDate, toLocalDate, timeZone, includeNonBookable: false });
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

## 5. The day-calendar (slots step)

Show a **week calendar**, not a flat list of every slot: a 7-day strip with
week navigation → the picked day's times. A flat grid with time-only labels
leaves the visitor unable to tell which day a slot is on. Fetch availability for
the visible window (`fromLocalDate`/`toLocalDate` = the week bounds), group slots
by calendar day, and offer a **"check next availability"** action that probes
forward when a week is empty. Reference example:
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

## 7. Out of v1

Waitlist, on-site manage/cancel, location selector, staff filter, payment
breakdown, and CLASS sign-up are out of v1. Show bookable slots only;
post-booking self-service is handled by the Wix-hosted flow / member area.
