# Bookings Pricing Provider Service Plugin Reference

## ⚠️ Requires manual sign-up before it's live

Unlike every other SPI in this skill, this integration isn't self-serve. Before Wix will ever call your handler on a real site, email `bookings-integration@wix.com` with subject "Bookings Pricing Integration" and include: your business type, a few words about your business/market, the URL of the site hosting your app, and your app ID. Wix reviews the request and replies by email. **Implement and build the plugin, but tell the user this sign-up step is required and still pending** — don't present the feature as live just because the code compiles and builds.

## Overview

The Bookings Pricing Provider lets your app calculate custom prices for bookings — regional tax, discounts for specific customer types, or any combination — instead of Wix's standard per-variant pricing. Once installed, your plugin becomes the **sole source of price** for the service: Wix does not hand you a pre-computed subtotal to adjust, so if you need a base price, derive or store it yourself (e.g. read it from the service via `@wix/bookings`, or from your own config).

Wix calls your handler only *after* a booking already exists (`booking._id` is set) — this SPI cannot be used in advance to preview a price list. There is only one handler; there's no separate "preview" handler.

**FQDN**: `wix.bookings.pricing.v1.pricing_provider`

## Request and Response Schema

Before implementing, call `ReadFullDocsMethodSchema` on the docs URL to get the full request/response types. Note: the public docs page for this SPI still describes an older REST/webhook-only integration and does not yet reflect the `provideHandlers` SDK wrapper below — trust what `wix generate` actually scaffolds and the installed `@wix/auto_sdk_bookings_pricing-provider` types over the doc's prose/code samples, but its **field descriptions** (e.g. `booking.contactDetails.fullAddress.subdivision`) and the sign-up requirement above are still accurate.

| Handler | Docs URL |
| --- | --- |
| `calculatePrice` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/pricing/pricing-integration-service-plugin/calculate-price |

Your handler receives `{ request: { booking }, metadata }`, where `booking` is the full [booking object](https://dev.wix.com/docs/rest/business-solutions/bookings/bookings/bookings-writer-v2/booking-object) — pull whatever you need from it (e.g. `booking.contactDetails.fullAddress.subdivision` for regional tax, `booking.totalParticipants` / `booking.participantsChoices` for participant count). Return **either**:

- `{ calculatedPrice: <number> }` — a numeric price. The site owner's dashboard can perform further calculations on top of it, but calling the Preview Price API on a booking priced this way fails.
- `{ priceDescription: <string> }` — a textual price description — lets Preview Price succeed, but Wix cannot do further numeric calculations on it.

Decide which shape to return before you write the handler; you can't mix both per request.

## Example: Regional Tax From Contact Address

```typescript
import { pricingProvider } from "@wix/bookings/service-plugins";

const TAX_RATE_BY_SUBDIVISION: Record<string, number> = {
  CA: 0.0725,
  NY: 0.08,
};

const BASE_PRICE_PER_PARTICIPANT = 100; // wire this to your real per-service price

pricingProvider.provideHandlers({
  calculatePrice: async (payload) => {
    const { booking } = payload.request;
    if (!booking) {
      return { calculatedPrice: 0 };
    }

    const participants =
      booking.totalParticipants ??
      (booking.participantsChoices?.serviceChoices ?? []).reduce(
        (sum, choice) => sum + (choice.numberOfParticipants ?? 0),
        0
      ) ??
      1;

    const subdivision = booking.contactDetails?.fullAddress?.subdivision;
    const taxRate = subdivision ? TAX_RATE_BY_SUBDIVISION[subdivision] ?? 0 : 0;

    return { calculatedPrice: BASE_PRICE_PER_PARTICIPANT * participants * (1 + taxRate) };
  },
});
```

## Key Implementation Notes

1. **Sign-up is mandatory and manual** — see the warning above; there is no self-serve activation flow.
2. **You own pricing entirely** — the request doesn't carry a merchant-configured base price; compute or look one up yourself.
3. **Only called after booking creation** — you cannot use this SPI to display prices in advance of a booking existing.
4. **Pick one response shape** — a numeric `calculatedPrice` (lets the dashboard add further calculations, but breaks Preview Price) or a `priceDescription` (the reverse). Decide once, per your app's use case.
5. **Confirm with the user before promising this feature** — since activation depends on an out-of-band email approval, tell the user this step is required rather than assuming the integration is live once code is deployed.
