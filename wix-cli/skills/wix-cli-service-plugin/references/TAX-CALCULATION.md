# Tax Calculation Service Plugin Reference

## Overview

The Tax Calculation SPI allows you to implement custom tax calculation logic based on order details, shipping destination, product types, or any business-specific tax rules.

## Import

```typescript
import { taxCalculationProvider } from "@wix/ecom/service-plugins";
```

## Handler

| Handler | Description |
| --- | --- |
| `calculateTax` | Calculate and return tax amounts for line items |

## Example: State-Based Tax Calculation

This example calculates tax based on the shipping destination state.

```typescript
import { taxCalculationProvider } from "@wix/ecom/service-plugins";

const STATE_TAX_RATES: Record<string, number> = {
  CA: 0.0725,
  NY: 0.08,
  TX: 0.0625,
  // Add more states as needed
};

taxCalculationProvider.provideHandlers({
  calculateTax: async ({ request }) => {
    const state = request.shippingAddress?.subdivision;
    const taxRate = STATE_TAX_RATES[state || ""] || 0;

    const lineItemTaxes =
      request.lineItems?.map((item) => {
        const amount = parseFloat(item.price?.amount || "0");
        const taxAmount = (amount * taxRate).toFixed(2);

        return {
          lineItemId: item._id,
          taxBreakdown: [
            {
              name: "State Sales Tax",
              rate: String(taxRate * 100),
              amount: {
                amount: taxAmount,
                currency: request.currency || "USD",
              },
            },
          ],
        };
      }) || [];

    return { lineItemTaxes };
  },
});
```

## Response Structure

```typescript
{
  lineItemTaxes: Array<{
    lineItemId: string;           // ID of the line item
    taxBreakdown: Array<{
      name: string;               // Tax name (e.g., "State Sales Tax")
      rate: string;               // Tax rate as string (e.g., "7.25")
      amount: {
        amount: string;           // Tax amount as string
        currency: string;         // Currency code (e.g., "USD")
      };
    }>;
  }>;
}
```

## Key Implementation Notes

1. **Price as string** - All amount values must be strings, not numbers
2. **Rate as percentage** - The `rate` field should be the percentage value (e.g., "7.25" for 7.25%)
3. **Line item matching** - Each `lineItemId` must match an item from the request
4. **Multiple tax breakdowns** - You can include multiple taxes per line item (state, local, etc.)
5. **Handle missing data** - Gracefully handle missing addresses or subdivision codes
