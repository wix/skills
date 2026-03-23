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

## Request Structure

The `getShippingRates` handler receives `{ request, metadata }`. Key fields on `request`:

```typescript
{
  lineItems: Array<{                    // Products being shipped (ProductItem type)
    name?: string;                      // Product name
    quantity?: number;                  // Quantity
    price?: string;                     // Unit price as decimal string
    totalPrice?: string;                // Total price (price × quantity)
    totalPriceBeforeDiscount?: string;  // Total before discounts
    priceBeforeDiscount?: string;       // Unit price before discount
    catalogReference?: {
      catalogItemId: string;            // Item GUID within its catalog
      appId: string;                    // Catalog app GUID
      options?: Record<string, any>;
    };
    physicalProperties?: {
      weight?: number;                  // Item weight
      sku?: string;                     // Stock-keeping unit
      shippable?: boolean;              // Whether item is shippable
    };
    deliveryDestinationIndex?: number;  // Destination index in shipping addresses list
    deliveryOriginIndex?: number;       // Origin index in from addresses list
    taxIncludedInPrice?: boolean;       // Whether tax is included in line item price
  }>;
  shippingDestination?: {               // Where items are being shipped
    country?: string;                   // ISO-3166 alpha-2 country code
    subdivision?: string;               // State/province code
    city?: string;
    postalCode?: string;
    addressLine1?: string;
    addressLine2?: string;
    streetAddress?: {
      number?: string;
      name?: string;
    };
  };
  shippingOrigin?: { ... };             // Where items ship from (same Address shape)
  buyerContactDetails?: {               // Buyer contact info (FullAddressContactDetails)
    firstName?: string;
    lastName?: string;
    phone?: string;
    company?: string;
    email?: string;
    vatId?: {                           // Tax info (Brazil only)
      _id?: string;                     // Customer's tax ID
      type?: string;                    // "UNSPECIFIED" | "CPF" | "CNPJ"
    };
  };
  weightUnit?: string;                  // Weight unit: "KG", "LB"
  purchaseFlowId?: string;             // Persistent ID correlating cart/checkout/order
  deliveryPreferences?: {              // Delivery preferences
    preferredCode?: string;            // Preferred delivery code (shippingOptionId)
  };
  externalReferences?: Array<{         // External resource references for integration/tracking
    appId?: string;                    // App ID associated with the purchase flow
    resourceId?: string;               // External resource ID (e.g., Pay Link ID)
  }>;
  extendedFields?: {                   // Extended field data
    namespaces?: Record<string, Record<string, any>>;
  };
}
```

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
      deliveryTime?: string;  // Estimated delivery time (e.g., "2-5 days")
      instructions?: string;  // Delivery instructions
      pickupDetails?: {       // Pickup details (return only for pickup orders)
        address?: { ... };    // Pickup address (same Address shape)
        pickupMethod?: string; // "STORE_PICKUP" | "PICKUP_POINT"
      };
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
