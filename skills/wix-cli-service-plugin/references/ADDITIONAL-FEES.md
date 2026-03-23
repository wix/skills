# Additional Fees Service Plugin Reference

## Overview

The Additional Fees SPI allows you to add custom fees to orders during checkout, such as handling fees, rush delivery charges, or global order fees.

## Import

```typescript
import { additionalFees } from '@wix/ecom/service-plugins';
```

## Handler

| Handler | Description |
| --- | --- |
| `calculateAdditionalFees` | Calculate and return additional fees to apply to the order |

## Request Structure

The `calculateAdditionalFees` handler receives `{ request, metadata }`. Key fields on `request`:

```typescript
{
  lineItems: Array<{
    _id: string;                     // Line item GUID
    quantity: number;                // Quantity of item
    productName: string;             // Item name
    price: string;                   // Price for a single item as a STRING (e.g., "25.00"), NOT an object
    catalogReference?: {
      catalogItemId: string;         // Item GUID within its catalog
      appId: string;                 // Catalog app GUID
      options?: Record<string, any>; // Additional item details
    };
    physicalProperties?: {
      weight: number;                // Item weight
      sku: string;                   // Stock-keeping unit
      shippable: boolean;            // Whether item is shippable
    };
    depositAmount?: string;             // Partial payment for deposit items
    modifierGroups?: Array<{          // Modifier groups added to the item
      _id?: string;                   // Modifier group ID
      name?: { original?: string; translated?: string; };  // Group name (TranslatableString)
      modifiers?: Array<{             // List of modifiers
        _id?: string;                 // Modifier ID
        quantity?: number;            // Modifier quantity
        label?: { original?: string; translated?: string; };  // Display label
        details?: { original?: string; translated?: string; }; // Additional details
        price?: string;              // Modifier price as decimal string
      }>;
    }>;
  }>;
  shippingAddress?: {                // Shipping address (if provided)
    country?: string;                 // ISO-3166 alpha-2 country code
    subdivision?: string;            // State/province code
    city?: string;
    postalCode?: string;
    addressLine1?: string;           // Main address line (street name and number)
    addressLine2?: string;           // Additional address info (apt, suite, floor)
    streetAddress?: {                // Structured street address
      number?: string;               // Street number
      name?: string;                 // Street name
    };
    location?: {                     // Geocode coordinates
      latitude?: number;
      longitude?: number;
    };
    countryFullname?: string;        // Country full name (read-only)
    subdivisionFullname?: string;    // Subdivision full name (read-only)
  };
  buyerDetails?: {                   // Buyer contact info
    contactDetails?: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      company?: string;
      email?: string;
      vatId?: {                      // Tax info (Brazil only)
        _id?: string;                // Customer's tax ID
        type?: string;               // "UNSPECIFIED" | "CPF" | "CNPJ"
      };
    };
  };
  subtotal: string;                  // Pre-calculated total: sum of (price × quantity) for all line items, as a STRING
  appliedDiscounts?: Array<{            // Discounts already applied
    coupon?: { _id?: string; code?: string; name?: string; amount?: string; };
    merchantDiscount?: { amount?: string; };  // Discount amount as decimal string
    discountRule?: { _id?: string; name?: { original?: string; }; };
    discountType?: string;                    // "GLOBAL" | "SPECIFIC_ITEMS" | "SHIPPING"
    lineItemIds?: string[];                   // Line items this discount applies to
  }>;
  shippingInfo?: {                      // Shipping carrier selection
    selectedCarrierServiceOption?: {
      code?: string;                    // Carrier option ID (e.g., "usps_std_overnight")
      title?: string;                   // Option display name (read-only)
      logistics?: {                     // Delivery logistics (read-only)
        deliveryTime?: string;          // Expected delivery time
        instructions?: string;          // Delivery instructions
        pickupDetails?: {               // Pickup details (if applicable)
          address?: { ... };            // Pickup address (same Address shape)
          pickupMethod?: string;        // "STORE_PICKUP" | "PICKUP_POINT"
        };
      };
      cost?: {                          // Shipping costs (read-only)
        price?: string;                 // Shipping price
        totalDiscount?: string;         // Total shipping discount
      };
      otherCharges?: Array<{            // Other charges
        type?: string;                  // "HANDLING_FEE" | "INSURANCE"
        details?: string;               // Charge details
        cost?: { price?: string; totalDiscount?: string; };
      }>;
    };
  };
  purchaseFlowId?: string;             // Persistent ID correlating cart/checkout/order
  businessLocationId?: string;       // Business location ID associated with the items
  extendedFields?: {                    // Extended field data
    namespaces?: Record<string, Record<string, any>>;
  };
}
```

## Example: Global Additional Fee from Database Configuration

This example queries a CMS collection to retrieve a configurable global fee that applies to all orders.

```typescript
import { additionalFees } from '@wix/ecom/service-plugins';
import { auth } from '@wix/essentials';
import { items } from '@wix/data';

interface GlobalFeeConfig {
  _id: string;
  feeAmount: number;
  isEnabled: boolean;
}

additionalFees.provideHandlers({
  calculateAdditionalFees: async ({ request, metadata }) => {
    try {
      // Query the global additional fee configuration (elevated permissions required)
      const elevatedQuery = auth.elevate(items.query);
      const configResult = await elevatedQuery('global-additional-fee-config')
        .limit(1)
        .find();

      // If no configuration found or fee is disabled, return empty fees
      if (!configResult.items.length) {
        return {
          additionalFees: [],
          currency: metadata.currency || 'USD'
        };
      }

      const config = configResult.items[0] as GlobalFeeConfig;

      // Check if the fee is enabled and has a valid amount
      if (!config.isEnabled || !config.feeAmount || config.feeAmount <= 0) {
        return {
          additionalFees: [],
          currency: metadata.currency || 'USD'
        };
      }

      // Ensure currency matches site currency
      const responseCurrency = metadata.currency || 'USD';

      // Convert fee amount to string as required by Wix API
      const feeAmountString = config.feeAmount.toString();

      // Create the global additional fee
      const globalFee = {
        code: 'global-additional-fee',
        name: 'Global Additional Fee',
        translatedName: 'Global Additional Fee',
        price: feeAmountString,
        taxDetails: {
          taxable: true
        }
        // No lineItemIds specified - applies to entire cart
      };

      return {
        additionalFees: [globalFee],
        currency: responseCurrency
      };

    } catch (error) {
      return {
        additionalFees: [],
        currency: metadata.currency || 'USD'
      };
    }
  },
});
```

## Response Structure

The `calculateAdditionalFees` handler must return:

```typescript
{
  additionalFees: Array<{
    code: string;           // Unique identifier for the fee
    name: string;           // Display name
    translatedName?: string; // Optional translated name
    price: string;          // Fee amount as string
    taxDetails?: {
      taxable: boolean;     // Whether fee is taxable
      taxGroupId?: string;  // Tax group ID for the fee
    };
    lineItemIds?: string[]; // Optional: specific items (omit for cart-wide)
  }>;
  currency: string;         // Currency code (e.g., "USD")
}
```

## Key Implementation Notes

1. **Elevate permissions for API calls** - Use `auth.elevate` from `@wix/essentials` when calling Wix APIs from service plugins
2. **Return empty array when no fees apply** - Always return `{ additionalFees: [], currency: "..." }` when conditions aren't met
3. **Price must be a string** - Convert numeric amounts to strings
4. **Handle errors gracefully** - Return empty fees on error rather than throwing
5. **Omit lineItemIds for cart-wide fees** - Only specify when fee applies to specific items
