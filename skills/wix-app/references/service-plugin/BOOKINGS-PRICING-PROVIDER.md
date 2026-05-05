# Bookings Pricing Provider Service Plugin Reference

## Overview

The Bookings Pricing Provider SPI allows you to integrate a custom pricing service with Wix Bookings. This enables sophisticated varied pricing options including taxes, discounts, and custom pricing logic.

The pricing provider is called during booking creation to calculate custom prices. You can return either a numerical `calculatedPrice` or a textual `priceDescription`.

## Import

```typescript
import { pricingProvider } from '@wix/bookings/service-plugins';
```

## Handler

| Handler | Description |
| --- | --- |
| `calculatePrice` | Calculate custom price for a booking based on custom logic |

## Request and Response Schema

Before implementing, call `ReadFullDocsMethodSchema` with the docs URL below to get the full request/response types.

**MCP Tools to use:**
- `ReadFullDocsMethodSchema` - Full request/response schema with field names, types, and descriptions
- `ReadFullDocsArticle` - Full documentation with code examples (use if schema needs more context)

| Handler | Docs URL |
| --- | --- |
| `calculatePrice` | https://dev.wix.com/docs/api-reference/business-solutions/bookings/pricing/pricing-integration-service-plugin/calculate-price?apiView=SDK |

## Example: Regional Tax Calculation

This example applies a regional tax rate to the base booking price.

```typescript
import { pricingProvider } from '@wix/bookings/service-plugins';

interface TaxRates {
  [region: string]: number;
}

const taxRates: TaxRates = {
  'US-CA': 0.0725,
  'US-NY': 0.08875,
  'US-TX': 0.0625,
  'default': 0.05
};

function getTaxRate(location?: string): number {
  if (!location) return taxRates.default;
  return taxRates[location] || taxRates.default;
}

pricingProvider.provideHandlers({
  calculatePrice: async ({ request, metadata }) => {
    try {
      // Get base price from the booking
      const basePrice = request.booking?.price || 0;

      // Get location to determine tax rate
      const location = request.booking?.location;
      const taxRate = getTaxRate(location);

      // Calculate final price with tax
      const finalPrice = basePrice * (1 + taxRate);

      return {
        calculatedPrice: finalPrice
      };

      // Alternative: Return price description instead
      // return {
      //   priceDescription: `${finalPrice.toFixed(2)} USD (includes ${(taxRate * 100).toFixed(2)}% tax)`
      // };
    } catch (error) {
      // Fallback to base price on error
      return {
        calculatedPrice: request.booking?.price || 0
      };
    }
  },
});
```

## Key Implementation Notes

1. **Called AFTER booking creation** - The booking object already exists when this handler is called
2. **Return calculatedPrice OR priceDescription** - You can return either a number (`calculatedPrice`) or text (`priceDescription`), not both
3. **Preview Price API limitation** - If returning `calculatedPrice`, Preview Price API calls will fail
4. **No additional calculations** - If returning `priceDescription`, the site owner cannot perform additional price calculations
5. **Price displayed before payment** - The calculated price is shown to the customer before payment confirmation
6. **Handle errors gracefully** - Return a fallback price rather than throwing errors
