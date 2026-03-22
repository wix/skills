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
    }>;
    priceSummary?: {                    // Order price summary — all fields are MultiCurrencyPrice
      subtotal?: MultiCurrencyPrice;
      total?: MultiCurrencyPrice;
      discount?: MultiCurrencyPrice;
      tax?: MultiCurrencyPrice;
      shipping?: MultiCurrencyPrice;
    };
    billingInfo?: {                     // Billing address + contact
      address?: { country?: string; subdivision?: string; city?: string; postalCode?: string; };
      contactDetails?: { firstName?: string; lastName?: string; phone?: string; company?: string; };
    };
    shippingAddress?: {                 // Shipping address + contact (same shape as billingInfo)
      address?: { country?: string; subdivision?: string; city?: string; postalCode?: string; };
      contactDetails?: { firstName?: string; lastName?: string; phone?: string; company?: string; };
    };
    buyerDetails?: {                    // Buyer info
      email?: string;
      contactId?: string;
    };
    currency?: string;                  // Site currency (read-only)
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
