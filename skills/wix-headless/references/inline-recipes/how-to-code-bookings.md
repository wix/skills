---
name: "How to Code Bookings"
description: The frontend read/booking contract for a Wix Bookings (Services V2) site — which SDK modules to import, how to list services, fetch appointment vs class availability, render the schema-driven booking form, and run the createBooking → ecom Cart V2 → checkout-or-place sequence. Specifies the *how* (modules + exact calls + the failure modes the docs omit); which services to render and how the page looks come from the request.
---
**RECIPE**: How to Code a Wix Bookings Frontend (Services V2 + ecom Cart V2 checkout)

A concise contract for writing the **frontend code** of a Bookings site: listing services, picking an availability slot, collecting the booking form, and completing the booking. **This recipe is the *how* (which modules, which calls, which fields), not the *what*** — which services to show, how the page looks, and the framework are decided by the request you're fulfilling.

> **This recipe is for CODING the booking flow, not for seeding it.** It assumes a Services V2 backend already exists (services with a category, staff resources, durations/prices, and — for classes — scheduled sessions). It says nothing about creating services — only how to read and book them from frontend code.

> **⚠️ Reading rule — always append `.md?apiView=SDK` to every doc link below.** The Wix docs render two views of the same page. The **bare / REST view shows `id`**; the **`?apiView=SDK` view shows `_id`** — and the SDK is what your frontend calls. Reading the REST view by mistake is the most common source of the `service.id`-is-`undefined` bug. If a field name surprises you, you're probably reading the REST view — re-open it with `?apiView=SDK`. Discover any shape not pinned here with `SearchWixSDKDocumentation`, not by guessing a URL.

---

## The modules and the client (read this first)

**Constants** (a frontend file, e.g. `src/services/constants.ts`):
- **Wix Bookings app id** (the cart's `catalogReference.appId`): `13d21c63-b5ec-5912-8397-c3a5ddb27a97`
- **Staff-member resource type id** (the ANY_RESOURCE fallback + staff filtering): `1cd44cf8-756f-41c3-bd90-3e2ffcaf1155`

**⚠️ CRITICAL: there is NO `availability` namespace.** `import { availability }` / `availability.queryAvailability` does not exist and fails. Appointment availability is `availabilityTimeSlots.listAvailabilityTimeSlots`; class availability is `eventTimeSlots.listEventTimeSlots` — two different namespaces. Import only:

| Need | Package | Module |
|---|---|---|
| Services (list, query by slug) | `@wix/bookings` | `services` |
| Appointment availability | `@wix/bookings` | `availabilityTimeSlots` |
| Class availability | `@wix/bookings` | `eventTimeSlots` |
| Categories (optional filter) | `@wix/bookings` | `categoriesV2` |
| Locations (optional filter) | `@wix/bookings` | `services` (`queryLocations`) |
| Create the booking | `@wix/bookings` | `bookings` (`createBooking`) |
| Cart that holds the seat (add / calc / place) | `@wix/auto_sdk_ecom_cart-v-2` | `createCart`, `calculateCart`, `placeOrder` |
| Redirect to hosted checkout | `@wix/redirects` | `redirects` |
| Booking-form schema | `@wix/forms` | `forms` (`getFormSummary`) |

**Never** use `confirmBooking` (see *Creating the booking*) — the ecom cart confirms the seat here, not a server-side confirm.

**Auth / client — framework split:**
- **Astro (Wix-managed):** authentication is ambient. Call the modules directly from server components / backend routes and from browser islands (the `@wix/astro` visitor client) — **no `createClient`, no `OAuthStrategy`, no `clientId`.** Nothing here needs elevation (the reads below all run as the visitor); a public-env `clientId` read in `.astro` SSR is `undefined` at server render → 500, so don't build an `OAuthStrategy` client there.
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client and reuse it:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { services, availabilityTimeSlots, eventTimeSlots, categoriesV2, bookings } from '@wix/bookings';
  import { createCart, calculateCart, placeOrder } from '@wix/auto_sdk_ecom_cart-v-2';
  import { redirects } from '@wix/redirects';
  import { forms } from '@wix/forms';

  const client = createClient({
    modules: { services, availabilityTimeSlots, eventTimeSlots, categoriesV2, bookings, createCart, calculateCart, placeOrder, redirects, forms },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  ```
  The `clientId` is public, not a secret. A mis-wired public env var inlines as `undefined` and 400s every call.

---

## The shapes you read (field cheat-sheet)

V2 service objects are **flat**. The exact paths the frontend reads, and the plausible-wrong sibling each is mistaken for:

```jsonc
// services.queryServices(...).find()  →  result.items[]   (filter out s.hidden)
service = {
  _id,                                              // links · cart catalogItemId base   (NOT .id → undefined)
  name, description, tagLine,
  type,                                             // "APPOINTMENT" | "CLASS"
  hidden,                                           // skip hidden services
  mainSlug: { name },                               // the URL slug   (NOT service.slug; fallback supportedSlugs[0].name)
  schedule: { id, availabilityConstraints: { sessionDurations: [60] } },  // duration = sessionDurations[0] (minutes)
  payment: { fixed: { price: { value, currency } } },                     // value is a STRING; currency is the site's
  media: { mainMedia: { image } },                  // image is a "wix:image://…" string — resolve via media.getImageUrl()
  category: { _id },                                // the service's category
  form: { _id },                                    // the booking form (fetch via @wix/forms)
  bookingPolicy: { cancellationFeePolicy: { enabled } },  // drives the checkout-vs-place decision
  staffMemberDetails: { staffMembers: [{ staffMemberId, name }] },  // STAFF_MEMBER_DETAILS conditional field
}

// availabilityTimeSlots.listAvailabilityTimeSlots(...)  →  result.timeSlots[]   (APPOINTMENT)
apptSlot = { localStartDate, localEndDate, scheduleId, location, availableResources }  // fields at TOP level (NOT slot.startDate); availableResources may be []
//   availableResources[] = { resources: [{ _id, name }] }   // NESTED; each resource id is _id NOT id — this is what you read to label/group a slot by its staff/instructor

// eventTimeSlots.listEventTimeSlots(...)  →  result.timeSlots[]   (CLASS)
classSlot = { localStartDate, localEndDate, eventInfo: { eventId } }  // carries eventId; NO scheduleId
```

**⚠️ CRITICAL: entity ids are `_id`, NOT `id`.** `service._id`, `booking._id`. `service.id` is `undefined` in SDK code. This includes the **resource objects nested under a slot** — `slot.availableResources[].resources[]._id` (NOT `.id`); reading `.id` there silently yields `undefined`, so grouping/labeling/filtering slots by staff or instructor breaks with no error (an image-led class site rendering blank instructor names/photos is the tell). **`staffMemberDetails.staffMembers[].staffMemberId`** is the exception — despite the name it **IS the resource GUID** (it matches the seed's staff `resourceId`), and it's the value you filter availability and book by.

---

## The booking features (build the ones the site needs)

Each section is a **self-contained feature** — implement only the ones the site uses; the only ordering is *within* the flow (pick a slot → collect the form → book). The minimal path is: list services → pick a slot → submit the form → book.

### Listing services (and the `_id` rule)

Always filter by `appId`, request `STAFF_MEMBER_DETAILS`, and call `.find()`:

```js
// Catalog (list):
const { items } = await services
  .queryServices({ conditionalFields: ['STAFF_MEMBER_DETAILS'] })
  .eq('appId', BOOKING_APP_ID).limit(100).find();   // filter out items where s.hidden

// Single service by slug — the same .eq() builder chain:
const { items: [service] } = await services
  .queryServices({ conditionalFields: ['STAFF_MEMBER_DETAILS'] })
  .eq('mainSlug.name', slug).eq('appId', BOOKING_APP_ID).limit(1).find();
```
Doc: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md?apiView=SDK>

- **⚠️ `queryServices` is a fluent builder — its only argument is `QueryServicesOptions` (`conditionalFields`, etc.), NOT a `{ query: { filter, paging } }` object.** Apply the `appId` filter and paging as `.eq(...)` / `.limit(...)` chain calls, then `.find()`. The `{query:{filter,paging}}` form is the REST body shape; it does **not** type-check against the SDK (`'query' does not exist in type 'QueryServicesOptions'`) — if the SDK reference page shows an object-param form, trust the installed builder, not that doc example.

- **`appId` filter is required** — omitting it returns services from other apps / nothing useful.
- **Read V2 flat fields** (cheat-sheet): slug `mainSlug.name` (**not** `service.slug`), `name`/`description`/`tagLine`, duration `schedule.availabilityConstraints.sessionDurations[0]`, price `payment.fixed.price.value` (a **string**). A missing service usually means it wasn't seeded **with a category** (the visibility invariant), not a query bug.

### Filtering — location & category (both auto-skip)

Both filter the **catalog query** and re-render. **Show each filter only when there is more than one choice.**

- **Category:** `categoriesV2.queryCategories().find()` → `result.items[{ _id, name }]`. **Non-fatal** — wrap in try/catch and render without the bar if it fails. Show the bar only when `items.length > 1` (the seed creates at least one category, so a single-category site shows no bar). Filter: `filter['category.id'] = { $eq: categoryId }`; a service's category is `service.category._id`.
- **Location:** `services.queryLocations()` → `{ businessLocations, customLocations: { exists }, customerLocations: { exists } }`. Show the selector only when the total count > 1. A real business id → `filter['locations.business.id'] = { $hasSome: [id] }`; the synthetic `"custom"`/`"customer"` → `filter['locations.type'] = { $hasSome: ['CUSTOM'|'CUSTOMER'] }`. Carry the chosen location to the slots step so availability is scoped too (next section).

### Availability (the slots step) — appointment vs class

**⚠️ CRITICAL: APPOINTMENT and CLASS use different namespaces, and the slot fields are at the TOP level.**

```js
// APPOINTMENT — serviceId is a single GUID STRING:
const { timeSlots } = await availabilityTimeSlots.listAvailabilityTimeSlots({
  serviceId, fromLocalDate, toLocalDate, timeZone, bookable: true, cursorPaging: { limit: 100 },
  // staff (optional):    resourceTypes: [{ resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID, resourceIds: [staffMemberId] }],
  //                      includeResourceTypeIds: [STAFF_MEMBER_RESOURCE_TYPE_ID],
  // one business location: locations: [{ _id: locationId, locationType: 'BUSINESS' }],
});                                          // slots: result.timeSlots[] — localStartDate/localEndDate/scheduleId at TOP level

// CLASS — different namespace, PLURAL serviceIds; slots carry eventInfo.eventId, NO scheduleId:
const { timeSlots } = await eventTimeSlots.listEventTimeSlots({
  serviceIds: [serviceId], fromLocalDate, toLocalDate, timeZone, includeNonBookable: false,
  // staff/location (optional): eventFilter: { 'resources.id': { $hasSome: [staffMemberId] }, 'location.id': [locationId] },
});
```
Docs: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md?apiView=SDK> · <https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-event-time-slots.md?apiView=SDK>

- **`fromLocalDate`/`toLocalDate` are LOCAL strings `YYYY-MM-DDThh:mm:ss` (no `Z`)** plus a separate `timeZone`. Passing UTC ISO strings with `Z` returns the wrong window.
- **Slot fields are top-level** — read `timeSlot.localStartDate` / `.localEndDate` / `.scheduleId`, NOT `timeSlot.slot.startDate`. CLASS slots carry `eventInfo.eventId` and have **no** `scheduleId`.
- **⚠️ Scope availability to exactly ONE business location on a multi-location service.** Unscoped, `listAvailabilityTimeSlots` returns **one slot per location** per time → every time appears N× (duplicated rows). Build the location list from `queryLocations()` intersected with the service's location ids (a `service.locations` id alone can be one the availability engine doesn't recognize → 0 slots). Staff does **not** multiply rows — one slot carries many `availableResources`.
- **Staff picker auto-skips ≤1 staff** (`service.staffMemberDetails.staffMembers`). Filter by `staffMemberId` (the resource GUID). When a slot is picked with a specific staff, record `resource = { _id: staffMemberId, name }`; with "any staff", leave it unset (the booking emits the ANY_RESOURCE fallback below).
- **Group slots by day** — don't render a flat time-only grid (the visitor can't tell which day a slot is on). Week / month / N-day is your choice.

### The booking form — schema-driven (`@wix/forms`)

The booking form is a `@wix/forms` form attached to the service at `service.form._id`. Render it **schema-driven** — never hardcode field names.

**⚠️ CRITICAL: use `getFormSummary`, NOT `getForm`.** `getForm` returns the full nested schema (`form.formFields[].inputOptions.stringOptions.componentType…`), and hand-parsing that deep shape is the #1 source of a **silently empty form** — when your guess at the nested path is wrong, the parse yields zero fields and the form renders no inputs (→ empty `formSubmission` → `createBooking` 400 `first_name must have required property`) or hangs on a "loading" state. Use the **flat** summary instead:

```js
const { formSummary } = await forms.getFormSummary(service.form._id);
// formSummary.fields[] = { target, label, type, options?, deleted, _id }   ← FLAT, no nesting
const fields = (formSummary?.fields ?? [])
  .filter(f => !f.deleted)
  .filter(f => f.type && ['STRING', 'EMAIL', 'PHONE', 'NUMBER', 'URL'].includes(f.type));  // simple text-like only (`f.type` is optional on the summary field — guard it or strict build errors)
```
Doc: <https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form-summary.md?apiView=SDK> · bookings↔forms: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/wix-forms-integration.md?apiView=SDK>

- **`target` is the submission key** (top-level on each field — no `inputOptions` digging). `type` is a clean enum: render `EMAIL`→`type=email`, `PHONE`→`type=tel`, `NUMBER`→`type=number`, else text; a field with `options[]`→a `<select>`.
- Each input **writes straight into one values object keyed by `target`** (`{ [target]: value }`). **That object IS the `formSubmission`** — pass it directly to `createBooking`. Do **not** rebuild a second object by looping the schema at submit time.

**⚠️ CRITICAL: render the contact-basics fallback whenever the parsed list is EMPTY — not only on a thrown error.** A successful `getFormSummary` that yields zero usable fields (all filtered out, or an unexpected shape) must still produce a working form. Default to `first_name` / `last_name` / `email` (the booking enforces exactly these) so the form always renders and submits:
```js
const formFields = fields.length ? fields : [
  { target: 'first_name', label: 'First Name', type: 'STRING' },
  { target: 'last_name',  label: 'Last Name',  type: 'STRING' },
  { target: 'email',      label: 'Email',      type: 'EMAIL'  },
];
```
**Never gate the form's render on a loading flag that can't resolve** (e.g. showing "Loading form…" while `formFields.length === 0`) — with the fallback above the list is never empty, so render directly.

**⚠️ Skip complex, object-valued field types** — `MULTILINE_ADDRESS`, `OBJECT`, `ARRAY`, `WIX_FILE`, `SIGNATURE`, `PAYMENT`, `DATE`/`TIME` (the filter above already keeps only the simple text-like types). Rendering one as a text input sends a string where the API wants an object and `createBooking` rejects it with **"must be object"**. Only the contact basics are enforced, so dropping optional complex fields is safe.

### Creating the booking — the createBooking → ecom Cart V2 sequence

This is one feature with a fixed sequence. **Use it as-is — the payload shapes are exact and easy to get subtly wrong.** APPOINTMENT and CLASS share the same sequence; they differ only in the slot fields.

```
createBooking(...)          // booking lands CREATED — the cart holds the seat (no confirmBooking)
createCart(...)             // one catalogItem per bookingId, appId = BOOKING_APP_ID, channelType WEB
calculateCart(cartId)       // → { cart, summary }; totals on summary.priceSummary.total.amount
isCheckoutRequired ?  redirect to hosted checkout (paid)  :  placeOrder(cartId) (free / pay-in-person)
```

**1 · createBooking.** Doc: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md?apiView=SDK>

```js
const created = await bookings.createBooking({
  selectedPaymentOption,                 // derive from service.payment.options — see below
  totalParticipants: 1,
  bookedEntity: {
    slot: {
      serviceId,
      scheduleId: slot.scheduleId ?? undefined, // APPOINTMENT only — the SELECTED SLOT's own scheduleId, NOT service.schedule.id (the availability slot types it `string | null`; `?? undefined` to satisfy the `string | undefined` param under strict)
      eventId: slot.eventInfo?.eventId,   // CLASS only (Wix derives startDate/endDate/resource/location from it)
      startDate: slot.localStartDate,     // local "YYYY-MM-DDThh:mm:ss"
      endDate:   slot.localEndDate,
      timezone,
      // specific staff: resource: { _id: staffMemberId, name }
      // any staff:      resourceSelections: [{ resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID, selectionMethod: 'ANY_RESOURCE' }]
      location: { locationType: 'OWNER_BUSINESS' },   // map BUSINESS→OWNER_BUSINESS, CUSTOMER→CUSTOM
    },
  },
}, { formSubmission });                   // the form values keyed by `target`
const bookingId = created.booking._id;
```

- **⚠️ `scheduleId` MUST come from the SELECTED SLOT (`slot.scheduleId`), not from the service.** The APPOINTMENT slot carries its own top-level `scheduleId` (cheat-sheet) — carry it from the slots step into the booking. The service object *also* has a `schedule.id` (you read it for duration), but it is a **different value**: sending `service.schedule.id` (or an empty `scheduleId` prop) makes `createBooking` 400 with `VALIDATION_FAILURE: "…startDate, endDate, location.locationType, resource.id, and scheduleId must be set"`. (CLASS sends `slot.eventInfo.eventId` instead — no `scheduleId`.)
- **⚠️ Pass `formSubmission`, NOT `contactDetails`.** `contactDetails` is what Wix derives back onto the response; sending it instead of `formSubmission` drops the visitor's input.
- **⚠️ `formSubmission` is the object your inputs wrote to (values keyed by `target`) — send it DIRECTLY; do NOT rebuild it by iterating the parsed form-field schema.** If you re-derive the submission by looping over the schema array and your render falls back to a hardcoded field list when the schema parse comes back empty, the rebuild loop reads the empty schema and sends an **empty body** → `createBooking` 400s with `INVALID_ARGUMENT: "first_name must have required property 'first_name'…"` even though the form looked filled. Keep the typed-values object (`{ [target]: value }`) as the single source and pass that.
- **⚠️ ANY_RESOURCE fallback (staff).** With no specific staff chosen, send `resourceSelections: [{ resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID, selectionMethod: 'ANY_RESOURCE' }]` and Wix auto-assigns a bookable resource — appointment slots can return `availableResources: []` yet book fine this way. A specific choice sends `resource: { _id, name }` instead.
- **⚠️ Derive `selectedPaymentOption` from the service — do NOT hardcode `"ONLINE"`.** `online && !inPerson → "ONLINE"`; `!online && inPerson → "OFFLINE"`; else `"ONLINE"`. A **free / pay-in-person** service booked `ONLINE` makes the cart reject it with **`INSUFFICIENT_INVENTORY`** (`available_quantity: 0`).
- **`locationType` on the booking slot is `OWNER_BUSINESS`** (the booking endpoint's enum), NOT `BUSINESS` (which is the *services* endpoint's enum). Map the slot's `BUSINESS`→`OWNER_BUSINESS`, `CUSTOMER`→`CUSTOM`.
- **Wrap in try/catch** — `createBooking` can reject (slot taken between fetch and submit, strict phone validation below). Surface a friendly message; don't crash.
- **⚠️ CRITICAL: the auto-provisioned form's `phone` field requires full E.164 format (a leading `+` and country code) — a plain local number is REJECTED.** The default booking form (`getFormSummary` on a fresh service) always includes a `PHONE`-type field, but `createBooking` format-validates it strictly: submitting a local-style number (e.g. `"555-123-4567"`, no country code) 400s with `INVALID_ARGUMENT: "phone must match format 'phone', phone Phone number has incorrect country code"` — verified live. A number with a country code (e.g. `"+529511234567"`) is accepted. Only `first_name`/`last_name`/`email` are actually enforced (per the contact-basics fallback above), so pick one: render an international phone input that always submits `+<countrycode>…`, or drop the `phone` field from the rendered form the same way complex field types are skipped (below) if you don't need it.

**2 · Cart holds the seat → checkout or place.**

```js
const cart = await createCart({
  catalogItems: [{ quantity: 1, catalogReference: { catalogItemId: bookingId, appId: BOOKING_APP_ID } }],
  cart: { source: { channelType: 'WEB' } },
});
if (!cart._id) throw new Error('cart creation failed');   // Cart V2 types `_id` as `string | undefined`; narrow once so the strict build accepts it downstream
const cartId = cart._id;
const { cart: calc, summary } = await calculateCart(cartId);   // totals are NOT stored on the Cart V2 entity

// checkout required? cancellation-fee policy → yes; total 0 → no; FULL_PAYMENT_OFFLINE → no; else yes
if (checkoutRequired) {
  const { redirectSession } = await redirects.createRedirectSession({
    ecomCheckout: { checkoutId: cartId },          // the cartId IS the checkoutId here
    callbacks: { postFlowUrl: `${origin}/booking-confirmation` },
  });
  window.location.href = redirectSession.fullUrl;  // Wix-hosted checkout
} else {
  const order = await placeOrder(cartId);          // free / pay-in-person → confirmation
}
```

- **⚠️ No `confirmBooking`.** The classic server-side confirm step is not used — the **ecom Cart V2** holds the seat: `placeOrder` (free/offline) or the hosted checkout (paid) drives confirmation, so a client-only site completes the whole flow with no server elevation.
- **⚠️ CRITICAL: `origin` in `postFlowUrl` MUST be the `https://` published host — from `window.location.origin`, NEVER `new URL(request.url).origin`.** The Headless redirect allowlist registers the `https://` host and treats `http://<same host>` as a different, unlisted origin; a `http://` `postFlowUrl` makes the return ("Continue Browsing") **403** with *"… isn't listed as an allowed redirect domain."* Server-derived `new URL(request.url).origin` is `http://` behind Wix's proxy → pass `window.location.origin` from the client, or force `https`. Doc: <https://dev.wix.com/docs/go-headless/getting-started/setup/manage-urls/add-allowed-redirect-domains>.
- **⚠️ CRITICAL: the confirmation page must reflect REAL status — do NOT hardcode `?status=success` in `postFlowUrl`, and do NOT default the page to success.** The buyer lands on `postFlowUrl` whether they completed payment **or** clicked "Continue Browsing" to abandon the hosted checkout. A confirmation page that reads `status ?? 'success'` (or trusts a `?status=success` you baked into the URL) renders "confirmed" for an **unpaid, abandoned** booking. Drive the confirmation from the actual order/booking — look up the booking (it's `CREATED` after `createBooking`; payment is a separate state) or the order — and don't present an unconfirmed booking as confirmed. For the free/offline branch, `placeOrder` having returned an `orderId` is a real success signal; for the paid branch, returning from the redirect is **not**.
- **⚠️ Read the booking back as the anonymous visitor — `getBooking` is a manage-scope read that `403`s the visitor (same axis as the events `ticketDefinitions` trap; do NOT `auth.elevate`).** The visitor-public path is a two-step token handoff, both exports on `@wix/bookings` — use these exact calls, don't hunt the installed `.d.ts` for them:
  1. **At booking time** (right after `createBooking` returns `booking._id`) mint a one-shot read token: `const { token } = await bookings.getAnonymousActionToken(bookingId)` — **`bookingId` is a POSITIONAL string arg, not `{ bookingId }`** (the object form fails `tsc`). Append the token to your `postFlowUrl` (e.g. `?bookingId=…&token=…`).
  2. **On the confirmation page** read it back: `const { booking } = await bookings.bookingsGetBookingAnonymously(token)` — the response is **wrapped** (`{ booking }`). Drive the UI off **`booking.status`** (`CREATED` = seat held / payment pending; `CONFIRMED`/`PENDING` = done) and the time off **`booking.bookedEntity.slot.startDate`**.
- The cart's `catalogReference.catalogItemId` is the **`booking._id`** and `appId` is the **Bookings app id** (a booking id is automatically valid as an ecom catalog item).

### Rendering & mounting

- **Price**: `service.payment.fixed.price.value` (string) + `.currency` (the site's stored currency — format from it, don't assume USD).
- **Image**: `service.media.mainMedia.image` is a **string**, not an object (the installed type is `image?: string`, so `.image.url` fails `tsc`) — but its value is a Wix media URI like `wix:image://v1/…`, **not** an absolute URL (`.startsWith("https://")` is `false`). Putting it straight into `<img src>` ships broken images. Resolve it first: `import { media } from "@wix/sdk"`, then `media.getImageUrl(service.media.mainMedia.image).url` → `https://static.wixstatic.com/media/…`. Guard for services with no image.
- **Mount slots + form + book in a `client:only="react"` island** (Astro) — availability is timezone/session-specific. SSR only the read pages (catalog/detail) for SEO.

### SEO on item pages (Astro, Wix-managed)

A **service detail** page is a Wix **item page**: its `<title>`/description/OG/canonical come from what the owner sets in the dashboard. On the Astro (Wix-managed) frontend, wire it per the canonical guide — **[Add SEO Support to Item Pages](https://dev.wix.com/docs/go-headless/wix-managed-headless/seo/add-seo-support-to-item-pages.md)** — which covers the three steps: export `wixMetadata` (registers the route → sitemap + dashboard SEO editor), call `loadSEOTagsServiceConfig(...)`, and render `<SEO.Tags>` (from `@wix/seo`; deps + `@wix/essentials ≥ 1.0.10` are in the guide's "Before you begin").

For a service page use:
- **`wixMetadata`** from `WIX_APPS.bookings.servicePageMetadata` — referenced **directly** in the export (module scope). Route param `slug` → `identifiers.slug`.
- **`itemType`**: `seoTags.ItemType.BOOKINGS_SERVICE`.

Run `loadSEOTagsServiceConfig` in the same `Promise.all` as the service read, with `.catch(() => null)`, so a SEO hiccup falls back to the layout's default title instead of failing the page. Optional: render a `Service` schema.org JSON-LD `<script>` from the fetched service (see the guide's structured-data step).

### Out of scope
Waitlist, on-site manage/cancel, payment/deposit breakdown, multi-service packages, and COURSE bookings. Waitlist and manage/cancel have **no headless source of truth** — don't invent them on the anonymous-token layer; post-booking self-service is the Wix-hosted flow / member area.

---

## Conclusion
A correct Services V2 booking frontend:
- imports **`services` / `availabilityTimeSlots` / `eventTimeSlots` / `bookings`** from `@wix/bookings`, plus **Cart V2** (`@wix/auto_sdk_ecom_cart-v-2`), `@wix/redirects`, and `@wix/forms` — and never the nonexistent `availability` namespace or `confirmBooking`;
- uses **`service._id`** (never `service.id`) and reads the **flat V2 fields** (`mainSlug.name`, `payment.fixed.price.value`, `schedule.availabilityConstraints.sessionDurations[0]`);
- fetches availability per type (**`availabilityTimeSlots`** for APPOINTMENT, **`eventTimeSlots`** for CLASS) with **local date strings**, reads slot fields at the **top level**, and scopes to one location to avoid duplicate rows;
- renders the booking form **schema-driven via `getFormSummary`** (the flat `formSummary.fields[].target`, never `getForm`/`formFields`), **falls back to `first_name`/`last_name`/`email` whenever the parsed list is empty** (so the form never renders blank or hangs), keys values by `target`, skips complex field types, and passes that object as **`formSubmission`** (not `contactDetails`);
- runs **createBooking → createCart → calculateCart → checkout-or-place**, deriving `selectedPaymentOption` from the service (free/offline → `OFFLINE`, else `ONLINE` — the wrong choice rejects the cart with `INSUFFICIENT_INVENTORY`) and using the **ANY_RESOURCE** fallback when no staff is chosen.
