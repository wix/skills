# Validations Service Plugin Reference

## Overview

The Validations SPI allows you to add custom validation rules to the checkout process. You can validate cart contents, order totals, quantities, or any business logic requirement.

## Import

```typescript
import { validations } from "@wix/ecom/service-plugins";
```

## Handler

| Handler | Description |
| --- | --- |
| `getValidationViolations` | Evaluate order and return any validation violations |

## Request Structure

The `getValidationViolations` handler receives `{ request, metadata }`. Key fields on `request`:

```typescript
// MultiCurrencyPrice — used for price, priceSummary fields
type MultiCurrencyPrice = {
  amount?: string;                    // Decimal string (e.g., "25.00")
  convertedAmount?: string;           // Converted amount (read-only)
  formattedAmount?: string;           // Formatted with currency symbol (read-only)
  formattedConvertedAmount?: string;  // Formatted converted (read-only)
};

{
  sourceInfo?: {
    source?: string;                    // "OTHER" | "CART" | "CHECKOUT" — where validation was triggered
    purchaseFlowId?: string;            // Persistent ID correlating cart/checkout/order
  };
  validationInfo?: {
    lineItems?: Array<{
      _id?: string;                     // Line item ID
      quantity?: number;                // Quantity
      catalogReference?: {
        catalogItemId: string;
        appId: string;
        options?: Record<string, any>;
      };
      productName?: {                   // NOTE: object, NOT a string
        original?: string;              // Original product name
        translated?: string;            // Translated product name
      };
      price?: MultiCurrencyPrice;       // NOTE: object, NOT a string — use .amount for decimal value
      physicalProperties?: {
        weight?: number;
        sku?: string;
        shippable?: boolean;
      };
      itemType?: {                      // Item type classification
        preset?: string;                // "UNRECOGNISED" | "PHYSICAL" | "DIGITAL" | "GIFT_CARD" | "SERVICE"
        custom?: string;                // Custom item type (when presets don't fit)
      };
      subscriptionOptionInfo?: {        // Subscription option info (for recurring items)
        subscriptionSettings?: {
          frequency?: string;           // "UNDEFINED" | "DAY" | "WEEK" | "MONTH" | "YEAR"
          interval?: number;            // Recurring interval (default: 1)
          autoRenewal?: boolean;        // Whether subscription auto-renews
          billingCycles?: number;       // Number of billing cycles (if not auto-renewal)
          enableCustomerCancellation?: boolean;
          freeTrialPeriod?: { frequency?: string; interval?: number; };
        };
        title?: { original?: string; translated?: string; };
        description?: { original?: string; translated?: string; };
      };
      pricesBreakdown?: {               // Price breakdown for this line item
        totalPriceAfterTax?: MultiCurrencyPrice;
        totalPriceBeforeTax?: MultiCurrencyPrice;
        taxDetails?: {
          taxableAmount?: MultiCurrencyPrice;
          totalTax?: MultiCurrencyPrice;
          isTaxIncluded?: boolean;
          taxBreakdown?: Array<{
            jurisdiction?: string;
            nonTaxableAmount?: MultiCurrencyPrice;
            rate?: string;
            taxAmount?: MultiCurrencyPrice;
            taxableAmount?: MultiCurrencyPrice;
            taxType?: string;
            taxName?: string;
            jurisdictionType?: string;  // "UNDEFINED" | "COUNTRY" | "STATE" | "COUNTY" | "CITY" | "SPECIAL"
          }>;
        };
        totalDiscount?: MultiCurrencyPrice;
        price?: MultiCurrencyPrice;
        priceBeforeDiscounts?: MultiCurrencyPrice;
        lineItemPrice?: MultiCurrencyPrice;
        fullPrice?: MultiCurrencyPrice;
      };
    }>;
    priceSummary?: {                    // Order price summary — all fields are MultiCurrencyPrice
      subtotal?: MultiCurrencyPrice;
      total?: MultiCurrencyPrice;
      discount?: MultiCurrencyPrice;
      tax?: MultiCurrencyPrice;
      shipping?: MultiCurrencyPrice;
      additionalFees?: MultiCurrencyPrice;  // Total additional fees before tax
    };
    billingInfo?: {                     // Billing address + contact (AddressWithContact)
      address?: {
        country?: string; subdivision?: string; city?: string; postalCode?: string;
        addressLine1?: string; addressLine2?: string;
        streetAddress?: { number?: string; name?: string; };
        location?: { latitude?: number; longitude?: number; };
        countryFullname?: string;       // Read-only
        subdivisionFullname?: string;   // Read-only
      };
      contactDetails?: {
        firstName?: string; lastName?: string; phone?: string; company?: string;
        vatId?: { _id?: string; type?: string; }; // "UNSPECIFIED" | "CPF" | "CNPJ"
      };
    };
    shippingAddress?: {                 // Shipping address + contact (same AddressWithContact shape)
      address?: {
        country?: string; subdivision?: string; city?: string; postalCode?: string;
        addressLine1?: string; addressLine2?: string;
        streetAddress?: { number?: string; name?: string; };
        location?: { latitude?: number; longitude?: number; };
        countryFullname?: string;       // Read-only
        subdivisionFullname?: string;   // Read-only
      };
      contactDetails?: {
        firstName?: string; lastName?: string; phone?: string; company?: string;
        vatId?: { _id?: string; type?: string; }; // "UNSPECIFIED" | "CPF" | "CNPJ"
      };
    };
    buyerDetails?: {                    // Buyer info
      email?: string;
      contactId?: string;
    };
    currency?: string;                  // Site currency (read-only)
    conversionCurrency?: string;        // Customer's selected display currency (read-only)
    paymentCurrency?: string;           // Currency used for payment (read-only)
    shippingInfo?: {                    // Shipping information
      selectedCarrierServiceOption?: {
        code?: string;                  // Shipping option code
        title?: string;                 // Option display name
        cost?: {                        // Shipping costs
          totalPriceAfterTax?: MultiCurrencyPrice;
          totalPriceBeforeTax?: MultiCurrencyPrice;
          taxDetails?: { taxableAmount?: MultiCurrencyPrice; totalTax?: MultiCurrencyPrice; isTaxIncluded?: boolean; };
          totalDiscount?: MultiCurrencyPrice;
          price?: MultiCurrencyPrice;
        };
        deliveryAllocations?: Array<{   // Delivery carrier/region allocations
          deliveryCarrier?: { appId?: string; code?: string; };
          deliveryRegion?: { _id?: string; name?: string; };
          applicableLineItems?: { lineItemIds?: string[]; };
        }>;
        partial?: boolean;              // Whether delivery is partial
        deliveryTimeSlot?: { from?: Date; to?: Date; };
      };
    };
    customFields?: {                    // Custom checkout fields
      fields?: Array<{
        value?: any;                    // Field value
        title?: string;                 // Field title
        translatedTitle?: string;       // Translated field title
      }>;
    };
    appliedDiscounts?: Array<{          // Applied discounts
      coupon?: { _id?: string; code?: string; name?: string; amount?: string; };
      merchantDiscount?: { amount?: string; };
      discountRule?: { _id?: string; name?: { original?: string; translated?: string; }; amount?: string; };
      discountType?: string;            // "GLOBAL" | "SPECIFIC_ITEMS" | "SHIPPING"
      lineItemIds?: string[];
    }>;
    externalReference?: {               // External app/resource reference
      appId?: string;                   // App ID
      resourceId?: string;              // External resource ID
    };
    giftCard?: {                        // Applied gift card details
      _id?: string;                     // Gift card ID (deprecated)
      obfuscatedCode?: string;          // Obfuscated card code
      amount?: MultiCurrencyPrice;      // Gift card value
      appId?: string;                   // Gift card provider app ID
    };
    weightUnit?: string;                // "UNSPECIFIED_WEIGHT_UNIT" | "KG" | "LB"
  };
  extendedFields?: {                    // Extended field data at request level
    namespaces?: Record<string, Record<string, any>>;
  };
}
```

## Example: Minimum Quantity Validation

This example validates that the order meets a minimum item quantity requirement.

```typescript
import { validations } from "@wix/ecom/service-plugins";

validations.provideHandlers({
  getValidationViolations: async (payload) => {
    const { request, metadata } = payload;
    // Use the `request` and `metadata` received from Wix and
    // apply custom logic.
    return {
      // Return your response exactly as documented to integrate with Wix.
      // Return value example:
      violations: [
        {
          description: "You must purchase at least 100 items.",
          severity: validations.Severity.WARNING,
          target: {
            other: {
              name: validations.NameInOther.OTHER_DEFAULT,
            },
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
  violations: Array<{
    description: string;                    // Message shown to customer
    severity: validations.Severity;         // ERROR or WARNING
    target: {
      other: {
        name: validations.NameInOther;      // Target type
      };
    } | {
      lineItem: {
        _id: string;                        // Specific line item ID
        name?: validations.NameInLineItem;  // LINE_ITEM_DEFAULT
      };
    };
  }>;
}
```

## Severity Levels

| Severity | Description |
| --- | --- |
| `validations.Severity.ERROR` | Blocks checkout - customer cannot proceed |
| `validations.Severity.WARNING` | Shows warning but allows checkout to continue |

## Target Types

| Target | Description |
| --- | --- |
| `validations.NameInOther.OTHER_DEFAULT` | General cart/order level validation |
| `lineItem._id` | Validation targeting a specific item |
| `validations.NameInLineItem.LINE_ITEM_DEFAULT` | Default line item target name |

## Key Implementation Notes

1. **Return empty array when valid** - Return `{ violations: [] }` when no validation issues
2. **Use SDK enums** - Use `validations.Severity` and `validations.NameInOther` for proper values
3. **Clear messages** - Write descriptive `description` text that helps customers fix the issue
4. **ERROR vs WARNING** - Use ERROR to block checkout, WARNING to inform but allow proceeding
5. **Target specificity** - Use `other.name` for cart-wide validations, `lineItem._id` for item-specific issues
6. **priceSummary fields are objects** - `priceSummary.total`, `.subtotal`, etc. are `MultiCurrencyPrice` objects — use `.amount` to get the decimal string (e.g., `priceSummary.total?.amount`)
