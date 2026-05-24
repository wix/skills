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

## Request and Response Schema

Before implementing, call `ReadFullDocsMethodSchema` with the docs URL below to get the full request/response types.

**MCP Tools to use:**
- `ReadFullDocsMethodSchema` - Full request/response schema with field names, types, and descriptions
- `ReadFullDocsArticle` - Full documentation with code examples (use if schema needs more context)

| Handler | Docs URL |
| --- | --- |
| `getValidationViolations` | https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/validations/validations-integration-service-plugin/get-validation-violations?apiView=SDK |

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

## Key Implementation Notes

1. **Return empty array when valid** - Return `{ violations: [] }` when no validation issues
2. **Use SDK enums** - Use `validations.Severity` and `validations.NameInOther` for proper values
3. **Clear messages** - Write descriptive `description` text that helps customers fix the issue
4. **ERROR vs WARNING** - Use ERROR to block checkout, WARNING to inform but allow proceeding
5. **Target specificity** - Use `other.name` for cart-wide validations, `lineItem._id` for item-specific issues
