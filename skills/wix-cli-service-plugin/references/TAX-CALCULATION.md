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
    const state = request.addresses?.[0]?.subdivision;
    const taxRate = STATE_TAX_RATES[state || ""] || 0;

    const lineItemTaxDetails =
      request.lineItems?.map((item) => {
        const amount = parseFloat(item.price || "0");
        const taxAmount = (amount * taxRate).toFixed(2);

        return {
          _id: item._id,
          taxBreakdown: [
            {
              taxName: "State Sales Tax",
              rate: String(taxRate),
              taxAmount: taxAmount,
            },
          ],
        };
      }) || [];

    return { lineItemTaxDetails };
  },
});
```

## Response Structure

```typescript
{
  lineItemTaxDetails: Array<{
    _id: string;                    // Line item ID
    taxBreakdown: Array<{
      taxName: string;              // Tax name (e.g., "State Sales Tax")
      rate: string;                 // Tax rate as decimal string (e.g., "0.0725" for 7.25%)
      taxAmount: string;            // Tax amount as string
    }>;
  }>;
}
```

## Key Implementation Notes

1. **Price as string** - `item.price` is a string, not an object — use it directly (e.g., `parseFloat(item.price || "0")`)
2. **Rate as decimal** - The `rate` field should be a decimal string (e.g., `"0.0725"` for 7.25%), not a percentage
3. **Line item matching** - Each `_id` in the response must match an item `_id` from the request
4. **Multiple tax breakdowns** - You can include multiple taxes per line item (state, local, etc.)
5. **Handle missing data** - Gracefully handle missing addresses or subdivision codes
