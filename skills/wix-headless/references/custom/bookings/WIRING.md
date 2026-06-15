---
name: custom-bookings-wiring
description: "Integration-mode wiring subagent for the bookings capability. Wires services + availability into a brought-in site; use Wix-hosted checkout for client-only sites, or the on-site create+confirm flow when an @wix/astro server runtime is available."
---

# Bookings — integration wiring

You wire the **bookings capability** (services list + availability + book) into a brought-in site (`frontend = "custom"`). For client-only sites, use client-side `@wix/sdk` — CDN imports for `none`-build, bundled imports for `own`-build (same calls). For `@wix/astro` projects with a server runtime, use the on-site flow below for create + confirm. Read `INSTRUCTIONS.md` § "The technical spine" + § "Wiring discipline" first.

> **Scope.** For **client-only** sites, wire **services display + availability + redirect-to-Wix-hosted bookings checkout**. The hosted checkout owns payment, the seat-holding confirm, and the customer email — exactly the pieces a client-only site cannot do itself: `confirmBooking` requires the Manage Bookings scope (server-side elevation), and a bare client `createBooking` leaves the booking **`CREATED`, which holds no seat** (the class/slot stays bookable → overbooking). Do NOT ship a client-side `createBooking` as a complete flow. When the project has an `@wix/astro` server runtime, use the **On-site booking flow** below instead: server routes can create + confirm while the existing UI stays intact.

## Inputs (inlined in your prompt)

- **`appId`** — `OAuthStrategy` `clientId`.
- **Seeded services** — read your `bookings` slice from `.wix/seeded.json` (`services[{id, slug, name, type, durationMinutes, price, currency}]`).
- The site's CSS token names (style additively from them).

## Render services (wire an existing region, or inject a section)

```html
<script type="module">
  import { createClient, OAuthStrategy } from "https://esm.sh/@wix/sdk@1";
  import { services } from "https://esm.sh/@wix/bookings@1";

  const wix = createClient({ modules: { services }, auth: OAuthStrategy({ clientId: "REPLACE_WITH_APP_ID" }) });

  // Query BUILDER + .find() — the { query: {...} } object form returns 0 items silently.
  const { items } = await wix.services.queryServices().limit(100).find();
  const visible = items.filter((s) => !s.hidden);
  // Bind into the existing markup: name s.name, tagline s.tagLine, slug s.mainSlug?.name,
  // duration s.schedule?.availabilityConstraints?.sessionDurations?.[0] (APPOINTMENT),
  // price s.payment?.fixed?.price ({ value, currency } — value is a string; format from
  // the returned currency, the site business locale wins over what was seeded).
</script>
```

## Availability (per selected service)

```js
import { availabilityTimeSlots, eventTimeSlots } from "https://esm.sh/@wix/bookings@1";
// register the module(s) in createClient({ modules: { ... } })

// APPOINTMENT — serviceId is a single GUID STRING (NOT an array):
const a = await wix.availabilityTimeSlots.listAvailabilityTimeSlots({
  serviceId, fromLocalDate, toLocalDate, timeZone, bookable: true, cursorPaging: { limit: 50 },
});
// slots: a.timeSlots[] — localStartDate/localEndDate/scheduleId at the TOP level.

// CLASS — different namespace, PLURAL serviceIds; slots carry eventInfo.eventId, no scheduleId:
const c = await wix.eventTimeSlots.listEventTimeSlots({
  serviceIds: [serviceId], fromLocalDate, toLocalDate, timeZone, includeNonBookable: false,
});
```

`fromLocalDate`/`toLocalDate` are **local** date strings (`YYYY-MM-DDThh:mm:ss`, no `Z`) with an explicit `timeZone`.

## Book — redirect to Wix-hosted bookings checkout

Same pattern as the ecom guide's hosted checkout: create a redirect session for the chosen slot and send the visitor to Wix.

```js
import { redirects } from "https://esm.sh/@wix/redirects@1"; // register in modules

const { redirectSession } = await wix.redirects.createRedirectSession({
  bookingsCheckout: {
    slotAvailability: {
      slot: {
        serviceId: slot.serviceId,
        scheduleId: slot.scheduleId,        // APPOINTMENT slots
        startDate: slot.localStartDate,
        endDate: slot.localEndDate,
        timezone: timeZone,
      },
    },
    timezone: timeZone,
  },
  callbacks: { postFlowUrl: window.location.href }, // return to the brought-in site after checkout
});
window.location.href = redirectSession.fullUrl;
```

The hosted flow collects contact details, takes payment when the service is paid, **confirms the booking (holds the seat)**, and sends the customer email — none of which the client site has to implement.

> **CLASS sessions:** the verified `slotAvailability.slot` shape above is the APPOINTMENT one. For a CLASS service, slots come from `eventTimeSlots` with `eventInfo.eventId` and no `scheduleId` — verify the class slot→redirect mapping against the redirects SDK docs at wiring time before wiring a CLASS service; don't guess the shape.

## On-site booking flow (server runtime — `@wix/astro`)

When the project **has** a server runtime (any `@wix/astro` project, however it was set up), wire the full on-site flow instead of the hosted-checkout redirect. The complete component implementation lives in the astro vertical (`references/astro/bookings/`); when the site's existing UI must stay intact (a brought-in design you should not rewrite), the minimal verified wiring is two server routes the existing front-end fetches:

1. **Render only real availability — replace the mock's displayed data, not just its submit.** A brought-in design's date/time pickers are mocks: hardcoded times, seeded "taken" flags, day lists pinned to the date the design was generated. Add `GET /api/availability` — elevated (`@wix/essentials` `auth.elevate`) `availabilityTimeSlots.listAvailabilityTimeSlots` over the next ~14 days, grouped into `{ days: { "YYYY-MM-DD": ["HH:mm", …] } }` — and drive the picker **only** from it, so everything selectable is actually bookable. Re-validate the exact slot server-side at submit time (it can be taken between fetch and submit; return a friendly "slot taken" rather than booking a different time).

2. **Create + confirm server-side** (`POST /api/book`): elevated `bookings.createBooking` → `bookings.confirmBooking(bookingId, revision, { paymentStatus: "NOT_PAID", flowControlSettings: { checkAvailabilityValidation: true } })`. `CREATED` holds no seat — without the confirm, nothing reaches the dashboard and capacity never drops. In the slot, pass `resource: { _id: service.staffMemberIds[0] }` and `location: { locationType: "OWNER_BUSINESS" }` explicitly — on a minimally-provisioned site the omit-resource auto-assign fails with "Resource settings conflict" (see `../../bookings/INSTRUCTIONS.md`).

3. **Send the whole form via `formSubmission` — not `contactDetails`.** Mapping only name/phone into `contactDetails` silently drops every other field the design collects. Pass `formSubmission` on `createBooking`, keyed by the booking form's field `target`s (Form Schemas *Get Form Summary*: `GET /form-schema-service/v4/forms/{service.form.id}/summary`; the default form's targets: `first_name`, `last_name`, `email`, `phone`, `address`, `add_your_message`). Bookings derives the booking's contact from it **and** stores the submission on the booking, dashboard-visible. Fold custom design fields (child's name, age, topic, notes) into `add_your_message` as labeled lines.
   - **Audit the form's `required` flags against what the design can actually guarantee — for every field, not just the obvious one.** The default booking form requires `first_name`, `last_name`, `email`, **and** `address`. A brought-in design typically can't guarantee them: no email input → `email` fails; a single "full name" input → one-word names have **no `last_name`** (fails at booking time, in production, for real visitors); no address input → `address`. Clone the default form (`POST /form-schema-service/v4/forms/00000000-0000-0000-0000-000000000000/clone`), PATCH the clone's **`fields[]`** setting `validation.required: false` on every field the design can't guarantee, with `mask.paths: ["fields"]` (the legacy `formFields[]` shape is rejected with a misleading `fieldType cannot be provided…` error), then point the service at the clone (PATCH the service with `form.id` + current `revision`). In the submission, **omit** empty optional fields rather than sending `""`.
   - **Phone must be international.** The form validates country codes — normalize local input before submitting (e.g. IL `05X-XXXXXXX` → `+9725XXXXXXXX`).

4. **Handle the confirm revision race.** With `formSubmission`, Bookings processes the submission/contact **asynchronously after create** and bumps the booking's revision — so `confirmBooking` with the create-time revision can fail with `INVALID_REVISION` ("Outdated revision for entity id: …", the entity being the booking itself). Do **not** re-create (that orphans `CREATED` bookings): loop the confirm — on `INVALID_REVISION`, re-read the booking's current `revision` (query `POST /_api/bookings-service/v2/bookings/query` filtered by id, via `auth.elevate(httpClient.fetchWithAuth)`) and confirm again, a few attempts with small backoff.

Still out of scope for this custom wiring recipe: manage/cancel via anonymous action tokens and the native waitlist (v1, Manage Bookings scope) — implemented in the astro vertical.
