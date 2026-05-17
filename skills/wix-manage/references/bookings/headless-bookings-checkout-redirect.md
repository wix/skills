---
name: "Headless Bookings Checkout Redirect"
description: Send a customer from a Wix Headless site to the Wix-managed Bookings checkout via redirects.createRedirectSession({ bookingsCheckout }). Covers the two failure modes that produce the generic "There was an issue with booking this service" empty-state page — a missing Wix Pricing Plans app (hard runtime dependency of the bookings-form widget) and a malformed slotAvailability payload — and how to avoid both.
---

# Technical Step-by-Step Instructions: Headless Bookings Checkout Redirect

## Description

Wix Headless sites typically delegate the final booking step (collect customer details, accept terms, confirm) to the Wix-managed `/__bookings/booking-form` page by calling `redirects.createRedirectSession({ bookingsCheckout: { slotAvailability, timezone } })`. This redirect is the canonical, lowest-friction way to convert a slot pick into a confirmed booking without rebuilding the checkout UI.

Two undocumented requirements cause this flow to fail with the same opaque message — **"There was an issue with booking this service. Please contact us or check out our other services."** — even when the slot, service, and headless config look correct. This recipe captures both, and the exact `slotAvailability` shape `createRedirectSession` requires.

## Prerequisites

- **Wix Bookings** installed on the site (`appDefId: 13d21c63-b5ec-5912-8397-c3a5ddb27a97`).
- **Wix Pricing Plans** installed on the site (`appDefId: 1522827f-c56c-a5c9-2ac9-00f9e6ae12d3`). **See the Pricing Plans Dependency section below — this is required even if you never sell a pricing plan.**
- At least one APPOINTMENT service with `payment.options.online: true` (the booking-form widget rejects services that only offer `inPerson` payment).
- A real business location attached to each service (not the placeholder UUID `123e4567-e89b-12d3-a456-426614174000` that test scripts sometimes copy from RFC 4122 examples).
- An allowed-redirect-domain configured in Headless Settings for your `postFlowUrl`.

## The "no-pp" Empty-State Failure Mode

When the Wix booking-form widget loads, it unconditionally calls:

```js
session.wixClient.bookings.getPricingPlansApi()
// → internally: getPublicAPI("1522827f-c56c-a5c9-2ac9-00f9e6ae12d3")
```

If the Pricing Plans app is not installed on the site, `getPublicAPI` throws with `The app does not exist on site.` The widget catches this as a generic "service catalog invalid" error and renders the empty-state translation key `app.empty-state-page.no-pp.title`, which displays:

> There was an issue with booking this service.
> Please contact us or check out our other services.

The error is silent from the integrator's side: `redirects.createRedirectSession` succeeds, the 303 redirect lands on the Wix-managed booking-form page, network responses are 200, no JS exception propagates. The widget swallows its own exception and reports nothing structured to the parent context.

### Pricing Plans Dependency

`POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install` for Wix Bookings auto-installs exactly one dependency — Wix Calendar (`482f413c-67ec-4700-acb3-d64d742e7751`). Pricing Plans is **not** in the declared dependency graph for Bookings, even though the bookings-form widget hard-requires it at runtime.

Any script that REST-installs Bookings without also installing Pricing Plans will produce a booking flow that breaks at the very last step, in production, with the message above. Verified on a fresh blank Wix site:

```js
// Install Bookings
const r = await wix.request({
  scope: "account",
  method: "POST",
  url: "https://www.wixapis.com/apps-installer-service/v1/app-instance/install",
  body: {
    tenant: { tenantType: "SITE", id: SITE_ID },
    appInstance: { appDefId: "13d21c63-b5ec-5912-8397-c3a5ddb27a97", enabled: true },
  },
});
// r.dependenciesInstallation === [{ appDefId: "482f413c-…" /* Wix Calendar */ }]
// Pricing Plans is NOT here.
```

### Fix

After installing Bookings, install Pricing Plans on the same site:

```js
await wix.request({
  scope: "account",
  method: "POST",
  url: "https://www.wixapis.com/apps-installer-service/v1/app-instance/install",
  body: {
    tenant: { tenantType: "SITE", id: SITE_ID },
    appInstance: { appDefId: "1522827f-c56c-a5c9-2ac9-00f9e6ae12d3", enabled: true },
  },
});
```

No pricing plans need to be created — the app's mere presence satisfies the widget's `getPublicAPI` call.

> **Note:** If you ever see "There was an issue with booking this service" with no other signal, this is almost certainly the cause. Confirm by opening the Wix-managed booking-form URL in a browser with DevTools open — the console will show: `Error: getPublicAPI() of 1522827f-c56c-a5c9-2ac9-00f9e6ae12d3 failed. The app does not exist on site.`

## The slotAvailability Shape

`bookingsCheckout.slotAvailability` is forwarded into URL query parameters (`bookings_serviceId`, `bookings_resourceId`, `bookings_locationId`, `bookings_startDate`, `bookings_endDate`, `bookings_timezone`) consumed by the booking-form widget. A minimal hand-rolled shape silently drops fields that the widget then can't resolve, also producing the "no-pp" empty-state.

The reliable pattern is to **pass through the full availability entry from `availabilityCalendar.queryAvailability`** without re-shaping it:

```js
import { availabilityCalendar } from "@wix/bookings";
import { redirects } from "@wix/redirects";

// Get availability — entries have the full SlotAvailability shape.
const { availabilityEntries } = await availabilityCalendar.queryAvailability(
  {
    filter: {
      serviceId: [serviceId],
      startDate, // ISO UTC
      endDate,   // ISO UTC
    },
  },
  { timezone: "Europe/London" },
);

const selectedEntry = availabilityEntries.find(/* user pick */);

// Forward the entry unmodified.
const redirect = await redirects.createRedirectSession({
  bookingsCheckout: {
    slotAvailability: selectedEntry, // full entry, not a hand-rolled subset
    timezone: "Europe/London",
  },
  callbacks: { postFlowUrl: "https://your-site.com/booking-thanks" },
});

// Redirect (303 from a backend, or window.location.href = redirect.redirectSession.fullUrl from the browser)
```

The entry returned by `queryAvailability` contains:

```jsonc
{
  "slot": {
    "serviceId": "…",
    "scheduleId": "…",
    "startDate": "2026-05-19T10:00:00.000+01:00", // RFC 3339 with offset
    "endDate":   "2026-05-19T10:30:00.000+01:00",
    "timezone":  "Europe/London",
    "resource":  { "_id": "…", "name": "HONE Barber" }, // _id REQUIRED for the redirect URL
    "location":  { "_id": "…", "name": "Location 1", "locationType": "OWNER_BUSINESS" }
  },
  "bookable": true
}
```

### What goes wrong if you hand-roll the shape

A common mistake — observed in real headless integrations — is to construct `slotAvailability` from `availabilityTimeSlots.listAvailabilityTimeSlots` (Time Slots v2) and project it into a custom struct. v2 time-slots return `localStartDate`/`localEndDate` (local-naive) and `availableResources: []` (nested under a different field), not the v1 `SlotAvailability` shape `createRedirectSession` expects. Appending a literal `Z` to a London-local string and dropping `resource._id` / `location._id` produces a redirect URL with `bookings_resourceId=` and `bookings_locationId=` empty. The widget can't resolve the slot to any service, falls through to the same `no-pp` empty-state.

**Use `availabilityCalendar.queryAvailability` (v1) for headless bookings checkout.** Despite v1 being marked `@deprecated` in favor of v2 time slots, there is no v2-aware `bookingsCheckout` yet — `createRedirectSession` still requires the v1 `SlotAvailability` shape. A clean v1 flow is simpler than a v2-listing + v1-checkout hybrid.

## Service Payment Configuration

The booking-form widget rejects services with `payment.options.online: false` (e.g. `inPerson`-only or `NO_FEE`-only). It maps `paymentOptions` to a legacy `offeredAs` field via the rule:

```
offeredAs = [
  ...(paymentOptions.wixPaidPlan ? ['PRICING_PLAN'] : []),
  ...((paymentOptions.online || paymentOptions.inPerson) ? ['ONE_TIME'] : []),
]
```

…and then bails when `offeredAs.length === 0`. For services where the merchant collects in person at the shop, set **both** options to `true`:

```js
await wix.request({
  scope: "site",
  method: "PATCH",
  url: `https://www.wixapis.com/bookings/v2/services/${serviceId}`,
  body: {
    service: {
      id: serviceId,
      revision: currentRevision,
      payment: {
        rateType: "FIXED",
        fixed: { price: { value: "25", currency: "GBP" } },
        options: { online: true, inPerson: true, deposit: false, pricingPlan: false },
      },
    },
  },
});
```

Customers see both payment choices at checkout and can pick "Pay in person".

## End-to-End Checklist

When wiring a Headless Bookings checkout for the first time, verify all of the following before testing:

1. **Apps installed:** Wix Bookings (`13d21c63-…`) + Wix Calendar (`482f413c-…`, auto-installed) + **Wix Pricing Plans (`1522827f-…`, install manually)**.
2. **Services configured:** `payment.options.online: true`, `onlineBooking.enabled: true`, real business location id (not the placeholder `123e4567-…`), staff member assigned.
3. **Redirect data:** call `availabilityCalendar.queryAvailability` and pass the entire `availabilityEntries[i]` to `redirects.createRedirectSession({ bookingsCheckout: { slotAvailability, timezone } })` without re-shaping.
4. **Allowed redirect domain:** `postFlowUrl` domain is added under Headless Settings → Allowed Redirect Domains.
5. **Smoke-test the rendered page**, not just the redirect creation. Click a slot in a real browser (or with Playwright). A 200 from `createRedirectSession` does NOT prove the booking-form widget will render — the widget can fail silently downstream, and "There was an issue…" is the only customer-visible signal.

## Diagnostics

If a customer reports the "There was an issue with booking this service" message:

1. **Inspect the redirect URL** that comes back from `createRedirectSession`. All of these query params must be non-empty:
   - `bookings_serviceId`
   - `bookings_resourceId`
   - `bookings_locationId`
   - `bookings_startDate` / `bookings_endDate` (RFC 3339 with offset, e.g. `2026-05-19T10:00:00.000+01:00`)

   If any is empty, the slot payload is malformed — re-check that you're passing the full `availabilityCalendar.queryAvailability` entry through, not a custom struct.

2. **Open the booking-form URL in a browser with DevTools open.** If the console shows `Error: getPublicAPI() of 1522827f-c56c-a5c9-2ac9-00f9e6ae12d3 failed. The app does not exist on site.`, Pricing Plans is missing — install it.

3. **Verify Pricing Plans is installed** via `GET https://www.wixapis.com/apps-installer-service/v1/app-instances` and check for `appDefId: 1522827f-c56c-a5c9-2ac9-00f9e6ae12d3` in the response.

## References

- Create Redirect Session: <https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session>
- Query Availability (V1): <https://dev.wix.com/docs/api-reference/business-solutions/bookings/availability-calendar/query-availability>
- Install App: <https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/install-app>
- Bookings Services V2 — Update Service: <https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/update-service>
