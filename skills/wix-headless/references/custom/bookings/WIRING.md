---
name: custom-bookings-wiring
description: "Integration-mode wiring subagent for the bookings capability. Wires a services list + availability + a schema-driven booking form into a brought-in site, then books via the ecom Cart V2 sequence (createBooking → cart → placeOrder / hosted-checkout redirect). Client-side @wix/sdk; no server runtime, no confirmBooking."
---

# Bookings — integration wiring (own / static)

You wire the **bookings capability** into a brought-in site (`frontend = "custom"`).
Client-side `@wix/sdk` — CDN imports for `none`-build, bundled for `own`-build
(same calls). Read `INSTRUCTIONS.md` § "The technical spine" + § "Wiring discipline".

> **The logic is shared.** The step model, the booking SDK sequence, the
> schema-driven form, and the gotchas are in `../../bookings/FLOW.md` — read it
> first. The astro vertical's React examples
> (`../../astro/templates/bookings/*` incl. `bookingDriver.ts`) are the reference
> implementation; here you run the **same SDK calls** through an `OAuthStrategy`
> visitor client (adapt the React idiom to whatever framework the site uses).

> **Scope (same as the astro vertical — the astro/own distinction collapses).**
> Services display + a week-calendar availability picker + a schema-driven booking
> form + the **ecom Cart V2 booking sequence**, all client-side under the visitor
> identity (no server elevation): `createBooking` (→ `CREATED`) → `createCart` →
> `calculateCart` → `isCheckoutRequired ? ecomCheckout redirect : placeOrder`.
> **No `confirmBooking`** — the cart holds the seat, so a client-only site
> completes the whole flow.

## Inputs (inlined in your prompt)
- **`appId`** — `OAuthStrategy` `clientId`.
- **Seeded services** — read your `bookings` slice from `.wix/seeded.json`.
- The site's CSS token names (style additively from them).

## The client (acquire once)
```js
import { createClient, OAuthStrategy } from "https://esm.sh/@wix/sdk@1"; // bundled for own-build
import { services, availabilityTimeSlots, eventTimeSlots, bookings, categoriesV2 } from "https://esm.sh/@wix/bookings@1";
import { forms } from "https://esm.sh/@wix/forms@1";
import * as cartV2 from "https://esm.sh/@wix/auto_sdk_ecom_cart-v-2@1";
import { redirects } from "https://esm.sh/@wix/redirects@1";

const wix = createClient({
  modules: { services, availabilityTimeSlots, eventTimeSlots, bookings, categoriesV2, forms, redirects, ...cartV2 },
  auth: OAuthStrategy({ clientId: "REPLACE_WITH_APP_ID" }),
});
```
(`categoriesV2` + `services.queryLocations` power the optional catalog filters; drop them if you don't surface filters.)

## Render services
```js
// The filter MUST include appId; pass conditionalFields, then .find().
const BOOKING_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
const { items } = await wix.services.queryServices({
  query: { filter: { appId: BOOKING_APP_ID }, paging: { limit: 100 } },
  conditionalFields: ["STAFF_MEMBER_DETAILS"],
}).find();
const visible = items.filter((s) => !s.hidden);
// name s.name · tagline s.tagLine · slug s.mainSlug?.name ·
// duration s.schedule?.availabilityConstraints?.sessionDurations?.[0] ·
// price s.payment?.fixed?.price ({ value, currency } — value is a string) ·
// staff s.staffMemberDetails?.staffMembers ([{ staffMemberId, name }] — staffMemberId IS the resource id).
```

## Optional catalog filters — location & category
Both auto-skip when there's nothing to choose (see `../../bookings/FLOW.md` §7).
Merge the chosen filter into the **same** `queryServices` filter and re-query.
```js
// Locations — show the selector only when count > 1.
const loc = await wix.services.queryLocations();
const businessLocations = loc.businessLocations?.locations ?? []; // [{ _id, type, business: { name } }]
const count = businessLocations.length + (loc.customLocations?.exists ? 1 : 0) + (loc.customerLocations?.exists ? 1 : 0);
// Categories — non-fatal; show the bar only when > 1.
const cats = (await wix.categoriesV2.queryCategories().find()).items ?? []; // [{ _id, name }]

// Merge into the services filter:
const filter = { appId: BOOKING_APP_ID };
if (categoryId) filter["category.id"] = { $eq: categoryId };
if (locationId === "custom") filter["locations.type"] = { $hasSome: ["CUSTOM"] };
else if (locationId === "customer") filter["locations.type"] = { $hasSome: ["CUSTOMER"] };
else if (locationId) filter["locations.business.id"] = { $hasSome: [locationId] };
// → wix.services.queryServices({ query: { filter, paging: { limit: 100 } }, conditionalFields: ["STAFF_MEMBER_DETAILS"] }).find()
// Carry locationId/locationType into the availability call so slots are scoped to it.
```

## Availability (week calendar)
Render a **week calendar** (day strip → the day's times), not a flat grid — see
`../../bookings/FLOW.md` § 5. `fromLocalDate`/`toLocalDate` are **local** strings
(`YYYY-MM-DDThh:mm:ss`, no `Z`) + a `timeZone`.

> **Multi-location: scope to ONE business location.** Unscoped,
> `listAvailabilityTimeSlots` returns **one slot per location** per time → duplicate
> rows. Source the location list from **`queryLocations()`** (the site's real business
> locations, whose ids the availability engine recognizes) intersected with the
> service's own location ids — NOT from `service.locations` alone (its entries can
> carry an id the engine doesn't recognize → scoping returns 0 slots). Default to the
> carried/first and pass the single-location filter below; with no business locations,
> leave it unscoped. (Staff does NOT multiply rows — only location does.) See FLOW.md §7.
```js
// APPOINTMENT — serviceId is a single GUID STRING. Staff (§8) OPTIONAL; location ALWAYS when >1:
const a = await wix.availabilityTimeSlots.listAvailabilityTimeSlots({
  serviceId, fromLocalDate, toLocalDate, timeZone, bookable: true, cursorPaging: { limit: 100 },
  // staff:    resourceTypes: [{ resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID, resourceIds: [resourceId] }], includeResourceTypeIds: [STAFF_MEMBER_RESOURCE_TYPE_ID],
  // location: locations: [{ _id: locationId, locationType: "BUSINESS" }],
});
// slots a.timeSlots[] — localStartDate/localEndDate/scheduleId at the TOP level.
// CLASS — different namespace, PLURAL serviceIds; slots carry eventInfo.eventId, no scheduleId.
// CLASS filters staff + location via eventFilter:
const c = await wix.eventTimeSlots.listEventTimeSlots({
  serviceIds: [serviceId], fromLocalDate, toLocalDate, timeZone, includeNonBookable: false,
  // eventFilter: { "resources.id": { $hasSome: [resourceId] }, "location.id": [locationId] },
});
```

## Optional staff selection
The staff list is on the service (`s.staffMemberDetails.staffMembers` → `[{ staffMemberId, name }]`;
`staffMemberId` IS the resource id despite the name). Show a picker only when >1 staff.
Filtering uses that `staffMemberId` (the `resourceId`/`resourceIds` above).
When a specific staff is chosen, set `slot.resource = { _id: staffMemberId, name }` on the
slot you pass to `createBooking` (the booking books that resource); leave it unset for
"any staff" → the **ANY_RESOURCE fallback** already in the booking snippet below.

## Booking form — schema-driven
The booking form is a `@wix/forms` form on the service (`service.form._id`). Read
its schema and render fields by `componentType`, collecting values keyed by
`target` (`../../bookings/FLOW.md` § 4):
```js
const { form } = await wix.forms.getForm(service.form._id);
const RENDERABLE = ["TEXT_INPUT", "PHONE_INPUT", "DROPDOWN"];
const fields = (form.formFields ?? []).filter(
  (f) => f.fieldType === "INPUT" && !f.hidden &&
         RENDERABLE.includes(f.inputOptions?.stringOptions?.componentType),
);
// render each by f.inputOptions.stringOptions.componentType; collect values by f.inputOptions.target.
// SKIP complex object-valued fields (e.g. multi-line ADDRESS, no string componentType) —
// sending a string for them fails createBooking with "must be object". Only
// first_name/last_name/email are enforced, so skipping optional complex fields is safe.
```

## Book — the ecom Cart V2 sequence
Mirror `../../astro/templates/bookings/bookingDriver.ts` (the exact payloads).
Run the same sequence through `wix.*`; the cart holds the seat, so no elevation.
```js
const BOOKING_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
const STAFF_MEMBER_RESOURCE_TYPE_ID = "1cd44cf8-756f-41c3-bd90-3e2ffcaf1155";

// Build the slot. APPOINTMENT carries scheduleId; CLASS carries eventId (Wix
// derives the rest). No staff chosen → the ANY_RESOURCE fallback.
// When a specific staff was chosen, use `resource: { _id: resourceId, name }`
// INSTEAD of `resourceSelections` (drop the ANY_RESOURCE fallback for that slot).
const slot =
  slotType === "CLASS"
    ? { serviceId, eventId, timezone }
    : {
        serviceId, scheduleId, startDate, endDate, timezone,
        resourceSelections: [{ resourceTypeId: STAFF_MEMBER_RESOURCE_TYPE_ID, selectionMethod: "ANY_RESOURCE" }],
        location: { locationType: "OWNER_BUSINESS" },
      };

// selectedPaymentOption must match the service: online-only → ONLINE,
// in-person-only → OFFLINE, else ONLINE. DERIVE it — do not hardcode ONLINE: a
// free / pay-in-person service booked ONLINE is rejected by the cart with
// INSUFFICIENT_INVENTORY (it's the only service kind that reaches placeOrder).
const o = service.payment?.options;
const selectedPaymentOption =
  o?.online && !o?.inPerson ? "ONLINE" : !o?.online && o?.inPerson ? "OFFLINE" : "ONLINE";

// 1. createBooking → CREATED. Arg 1 is the BOOKING object (slot nested under
//    bookedEntity); formSubmission/sendSmsReminder go in the options arg.
const { booking } = await wix.bookings.createBooking(
  { selectedPaymentOption, totalParticipants: 1, bookedEntity: { slot } },
  { formSubmission, sendSmsReminder: true }, // formSubmission keyed by each field's `target`
);
// 2. createCart — one catalog item per booking._id, catalogReference.appId = BOOKING_APP_ID, channel WEB.
const cart = await wix.createCart({ catalogItems: [{ quantity: 1, catalogReference: { catalogItemId: booking._id, appId: BOOKING_APP_ID } }], cart: { source: { channelType: "WEB" } } });
// 3. calculateCart → { cart, summary }, then compute the checkout decision.
const { cart: calc, summary } = await wix.calculateCart(cart._id);
const checkoutRequired =
  service.bookingPolicy?.cancellationFeePolicy?.enabled
    ? true
    : Number(summary?.priceSummary?.total?.amount ?? 0) === 0
      ? false
      : calc?.lineItems?.[0]?.paymentConfig?.paymentOption !== "FULL_PAYMENT_OFFLINE";
// 4. paid → redirect (ecomCheckout.checkoutId = cartId) ; free/offline → placeOrder.
if (checkoutRequired) {
  const { redirectSession } = await wix.redirects.createRedirectSession({ ecomCheckout: { checkoutId: cart._id }, callbacks: { postFlowUrl: window.location.href } });
  window.location.href = redirectSession.fullUrl;
} else {
  await wix.placeOrder(cart._id); // booked — no redirect
}
```

> Confirm the `@wix/auto_sdk_ecom_cart-v-2` function registration shape on a
> CDN/own client at wiring time; the payloads above match the astro `bookingDriver.ts`.

## Out of scope
Waitlist and on-site manage/cancel — out of scope (same as the astro vertical;
neither has a headless SoT — display-only policy flags only, no join/cancel logic).
Show bookable slots only; post-booking self-service is handled by the Wix-hosted
flow / member area.
