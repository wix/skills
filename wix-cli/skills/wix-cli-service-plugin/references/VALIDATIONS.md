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

## Key Implementation Notes

1. **Return empty array when valid** - Return `{ violations: [] }` when no validation issues
2. **Use SDK enums** - Use `validations.Severity` and `validations.NameInOther` for proper values
3. **Clear messages** - Write descriptive `description` text that helps customers fix the issue
4. **ERROR vs WARNING** - Use ERROR to block checkout, WARNING to inform but allow proceeding
5. **Target specificity** - Use `other.name` for cart-wide validations, `lineItem._id` for item-specific issues
