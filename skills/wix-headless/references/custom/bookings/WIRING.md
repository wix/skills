---
name: custom-bookings-wiring
description: "Integration-mode wiring subagent for the bookings capability. Wires a services list + availability + a book action into a brought-in site — @wix/bookings reads client-side via @wix/sdk, and a redirect to Wix-hosted bookings checkout for the booking itself (mirrors the ecom checkout-redirect pattern). No server runtime required."
---

# Bookings — integration wiring

You wire the **bookings capability** (services list + availability + book) into a brought-in site (`frontend = "custom"`). Client-side `@wix/sdk` — CDN imports for `none`-build, bundled imports for `own`-build (same calls). Read `INSTRUCTIONS.md` § "The technical spine" + § "Wiring discipline" first.

> **Scope.** Beta does **services display + availability + redirect-to-Wix-hosted bookings checkout**. The hosted checkout owns payment, the seat-holding confirm, and the customer email — exactly the pieces a client-only site cannot do itself: `confirmBooking` requires the Manage Bookings scope (server-side elevation), and a bare client `createBooking` leaves the booking **`CREATED`, which holds no seat** (the class/slot stays bookable → overbooking). Do NOT ship a client-side `createBooking` as a complete flow. An on-site booking flow (calendar + form + elevated confirm, as in the astro vertical) needs the server runtime — **deferred**.

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

## Deferred (needs the server runtime — `@wix/astro`)

On-site booking flow (calendar + form + elevated `confirmBooking` seat-hold), manage/cancel via anonymous action tokens, and the native waitlist (v1, Manage Bookings scope) — all implemented in the astro vertical (`references/astro/bookings/`); out of scope for client-only integration.
