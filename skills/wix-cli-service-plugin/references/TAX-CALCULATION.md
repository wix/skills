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

## Request Structure

The `calculateTax` handler receives a `request` object with the following fields:

```typescript
{
  currency: string;                     // 3-letter ISO currency code
  addresses: Array<{                    // 1-3 addresses referenced by line items via addressIndex
    country?: string;                   // ISO-3166 alpha-2 country code
    subdivision?: string;               // State/province code (e.g., "US-CA")
    city?: string;
    postalCode?: string;
    addressLine1?: string;
    addressLine2?: string;
  }>;
  lineItems: Array<{
    _id: string;                        // Line item ID
    itemName?: string;                  // Item display name
    quantity: number;                   // Quantity
    price: string;                      // Unit price as decimal STRING (e.g., "25.00"), NOT an object
    itemCode?: string;                  // SKU / item code
    taxGroupId?: string;                // Tax group for this item
    taxIncludedInPrice?: boolean;       // Whether price already includes tax
    addressIndex?: {                    // Which address applies to this item
      singleAddress?: number;           // Index into addresses array (common case)
      multipleAddresses?: {             // For multi-address orders
        origin?: number;                // Origin address index
        destination?: number;           // Destination address index
      };
    };
    taxRegionId?: string;               // Tax region ID
  }>;
}
```

## Example: State-Based Tax Calculation

This example calculates tax based on each line item's shipping destination state.

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
    const addresses = request.addresses || [];

    const lineItemTaxDetails = (request.lineItems || []).map((item) => {
      // Each line item references its address via addressIndex
      const addrIdx =
        item.addressIndex?.singleAddress ??
        item.addressIndex?.multipleAddresses?.destination ??
        0;
      const state = addresses[addrIdx]?.subdivision || "";
      const taxRate = STATE_TAX_RATES[state] || 0;

      const price = parseFloat(item.price || "0");
      const taxAmount = (price * taxRate).toFixed(4);

      return {
        _id: item._id,
        taxBreakdown:
          taxRate > 0
            ? [
                {
                  jurisdiction: state,
                  jurisdictionType:
                    taxCalculationProvider.JurisdictionType.STATE,
                  taxName: `${state} State Sales Tax`,
                  taxType: "Sales Tax",
                  rate: taxRate.toFixed(4),
                  taxableAmount: price.toFixed(4),
                  taxAmount,
                  nonTaxableAmount: "0.0000",
                },
              ]
            : [],
        taxSummary: {
          fullPrice: price.toFixed(4),
          taxAmount,
          taxableAmount: (taxRate > 0 ? price : 0).toFixed(4),
        },
      };
    });

    let totalTax = 0;
    let totalAmount = 0;
    let totalTaxableAmount = 0;
    for (const detail of lineItemTaxDetails) {
      for (const tb of detail.taxBreakdown) {
        totalTax += parseFloat(tb.taxAmount);
        totalTaxableAmount += parseFloat(tb.taxableAmount);
      }
      totalAmount += parseFloat(detail.taxSummary.fullPrice);
    }

    return {
      currency: request.currency,
      lineItemTaxDetails,
      taxSummary: {
        totalAmount: totalAmount.toFixed(4),
        totalTax: totalTax.toFixed(4),
        totalTaxableAmount: totalTaxableAmount.toFixed(4),
      },
    };
  },
});
```

## Response Structure

```typescript
{
  currency: string;                   // Must match request.currency
  taxSummary?: {
    totalAmount: string;              // Total amount for all items
    totalTax: string;                 // Total tax for all items
    totalTaxableAmount: string;       // Total taxable amount
    totalTaxIncludedInPrice?: string; // Total tax included in price
  };
  lineItemTaxDetails: Array<{
    _id: string;                      // Line item ID
    taxBreakdown: Array<{
      jurisdiction: string;           // Jurisdiction name (e.g., "CA")
      jurisdictionType: JurisdictionType; // COUNTRY, STATE, COUNTY, CITY, SPECIAL
      taxName: string;                // Tax name (e.g., "CA State Sales Tax")
      taxType: string;                // Tax type (e.g., "Sales Tax")
      rate: string;                   // Tax rate as decimal string (e.g., "0.0725" for 7.25%)
      taxableAmount: string;          // Taxable amount
      taxAmount: string;              // Tax amount
      nonTaxableAmount: string;       // Non-taxable amount
    }>;
    taxSummary: {
      fullPrice: string;              // Total price for this line item
      taxAmount: string;              // Total tax for this line item
      taxableAmount: string;          // Total taxable amount
    };
  }>;
}
```

## Key Implementation Notes

1. **Address resolution via `addressIndex`** - Each line item has an `addressIndex` field pointing to its address in `request.addresses`. Use `item.addressIndex.singleAddress` (common case) or `item.addressIndex.multipleAddresses.destination` (multi-address orders) to look up the correct address
2. **Price as string** - `item.price` is a string, not an object — use it directly (e.g., `parseFloat(item.price || "0")`)
3. **Rate as decimal** - The `rate` field should be a decimal string (e.g., `"0.0725"` for 7.25%), not a percentage
4. **Line item matching** - Each `_id` in the response must match an item `_id` from the request
5. **Multiple tax breakdowns** - You can include multiple taxes per line item (state, local, etc.)
6. **Handle missing data** - Gracefully handle missing addresses, addressIndex, or subdivision codes
