# Shipping Rates Service Plugin Reference

## Overview

The Shipping Rates SPI allows you to provide custom shipping options and calculate shipping costs based on order details, destination, weight, or any custom logic.

## Import

```typescript
import { shippingRates } from "@wix/ecom/service-plugins";
import { ChargeType } from "@wix/auto_sdk_ecom_shipping-rates";
```

## Handler

| Handler | Description |
| --- | --- |
| `getShippingRates` | Calculate and return available shipping options with costs |

## Example: International Shipping with Handling Fee

This example provides an international shipping option with an additional handling fee charge.

```typescript
import { shippingRates } from "@wix/ecom/service-plugins";
import { ChargeType } from "@wix/auto_sdk_ecom_shipping-rates";

shippingRates.provideHandlers({
  getShippingRates: async (payload) => {
    const { request, metadata } = payload;
    // Use the `request` and `metadata` received from Wix and
    // apply custom logic.
    return {
      // Return your response exactly as documented to integrate with Wix.
      // Return value example:
      shippingRates: [
        {
          code: "usps-international",
          title: "USPS - International",
          logistics: {
            deliveryTime: "2-5 days",
          },
          cost: {
            price: "15",
            currency: metadata.currency || "ILS",
            additionalCharges: [
              {
                price: "10",
                type: ChargeType.HANDLING_FEE,
                details: "Handling fee of $5 applied for fragile items.",
              },
            ],
          },
        },
      ],
    };
  },
});
```

## Response Structure

```typescript
{
  shippingRates: Array<{
    code: string;             // Unique identifier for this shipping option
    title: string;            // Display name shown to customer
    logistics: {
      deliveryTime: string;   // Estimated delivery time (e.g., "2-5 days")
    };
    cost: {
      price: string;          // Base shipping price as string
      currency: string;       // Currency code (e.g., "USD")
      additionalCharges?: Array<{
        price: string;        // Additional charge amount
        type: ChargeType;     // Type of charge (HANDLING_FEE, etc.)
        details?: string;     // Description of the charge
      }>;
    };
  }>;
}
```

## ChargeType Values

| Type | Description |
| --- | --- |
| `ChargeType.HANDLING_FEE` | Additional handling fee |

## Key Implementation Notes

1. **Price as string** - All price values must be strings, not numbers
2. **Currency from metadata** - Use `metadata.currency` to get the site's currency
3. **Multiple options** - You can return multiple shipping rate options for customer to choose
4. **Unique codes** - Each shipping option needs a unique `code` identifier
5. **Additional charges** - Use `additionalCharges` array for itemized extra costs like handling fees
