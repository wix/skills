# Discount Triggers Service Plugin Reference

## Overview

The Custom Triggers SPI allows you to define custom conditions that can trigger discounts in the Wix eCommerce system. You can create time-based triggers, product-based triggers, or any custom logic.

## Import

```typescript
import { customTriggers } from "@wix/ecom/service-plugins";
```

## Handlers

| Handler | Description |
| --- | --- |
| `getEligibleTriggers` | Evaluate current conditions and return which triggers are active |
| `listTriggers` | Return the list of all available custom triggers |

## Example: Happy Hour and Digital Products Triggers

This example defines two custom triggers: a time-based "Happy Hour" trigger and a product-type-based "Digital Sale" trigger.

```typescript
import { customTriggers } from "@wix/ecom/service-plugins";

customTriggers.provideHandlers({
  getEligibleTriggers: async (payload) => {
    const { request, metadata } = payload;
    // Use the `request` and `metadata` received from Wix and
    // apply custom logic.
    return {
      // Return your response exactly as documented to integrate with Wix.
      // Return value example:
      eligibleTriggers: [
        {
          customTriggerId: "my-happy-hour-trigger",
          identifier: "123",
        },
        {
          customTriggerId: "my-digital-sale-trigger",
          identifier: "234",
        },
      ],
    };
  },
  listTriggers: async (payload) => {
    const { request, metadata } = payload;
    // Use the `request` and `metadata` received from Wix and
    // apply custom logic.
    return {
      // Return your response exactly as documented to integrate with Wix.
      // Return value example:
      customTriggers: [
        {
          _id: "my-happy-hour-trigger",
          name: "Happy Hour 16:00-18:00",
        },
        {
          _id: "my-digital-sale-trigger",
          name: "Digital products discount",
        },
      ],
    };
  },
});
```

## Response Structure

### getEligibleTriggers Response

```typescript
{
  eligibleTriggers: Array<{
    customTriggerId: string;  // ID matching one from listTriggers
    identifier: string;       // Unique identifier for this trigger instance
  }>;
}
```

### listTriggers Response

```typescript
{
  customTriggers: Array<{
    _id: string;    // Unique trigger ID
    name: string;   // Display name shown in Wix dashboard
  }>;
}
```

## Key Implementation Notes

1. **Trigger IDs must match** - The `customTriggerId` in `getEligibleTriggers` must match an `_id` from `listTriggers`
2. **Both handlers required** - You must implement both `getEligibleTriggers` and `listTriggers`
3. **Dynamic eligibility** - `getEligibleTriggers` is called during checkout to determine which triggers are currently active
4. **Static list** - `listTriggers` provides the master list of all possible triggers for configuration in the Wix dashboard
