# Discount Triggers Service Plugin Reference

## Overview

The Custom Triggers SPI allows you to define custom conditions that can trigger discounts in the Wix eCommerce system. You can create time-based triggers, product-based triggers, or any custom logic.

## Handlers

| Handler | Description |
| --- | --- |
| `getEligibleTriggers` | Evaluate current conditions and return which triggers are active |
| `listTriggers` | Return the list of all available custom triggers |

## Request and Response Schema

Before implementing, call `ReadFullDocsMethodSchema` on each docs URL to get the full request/response types.

| Handler | Docs URL |
| --- | --- |
| `getEligibleTriggers` | https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/discounts/custom-discount-triggers-integration-service-plugin/get-eligible-triggers?apiView=SDK |
| `listTriggers` | https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/extensions/discounts/custom-discount-triggers-integration-service-plugin/list-triggers?apiView=SDK |

## ⚠️ `identifier` must be echoed from the request, never invented

`getEligibleTriggers` receives `request.triggers[]`, each with a `customTrigger._id` and an `identifier` Wix generated for that occurrence. Your response's `eligibleTriggers[i].identifier` **must be the exact same value** from the matching `request.triggers[i].identifier` — it's how Wix correlates your answer back to the discount rule that asked. A hardcoded or self-invented `identifier` never matches, so the discount silently never applies — confirmed live: the discount rule stays wired up and no error is raised, it just never fires.

## Example: Happy Hour and Digital Products Triggers

This example defines two custom triggers: a time-based "Happy Hour" trigger and a product-type-based "Digital Sale" trigger.

```typescript
import { customTriggers } from "@wix/ecom/service-plugins";

customTriggers.provideHandlers({
  getEligibleTriggers: async (payload) => {
    const { request, metadata } = payload;
    // request.triggers tells you which trigger occurrences Wix is asking about —
    // filter to the ones you recognize and echo back their `identifier` exactly.
    const eligibleTriggers = (request.triggers ?? [])
      .filter((t) => t.customTrigger?._id === "my-happy-hour-trigger" /* + your eligibility check */)
      .map((t) => ({
        customTriggerId: "my-happy-hour-trigger",
        identifier: t.identifier,
      }));

    return { eligibleTriggers };
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

## Singular Constraint

`ECOM_DISCOUNTS_TRIGGER` is **singular** — only one component of this type is allowed per app. Do not scaffold or include two Discount Triggers service plugins in the same app.

## Key Implementation Notes

1. **Trigger IDs must match** - The `customTriggerId` in `getEligibleTriggers` must match an `_id` from `listTriggers`
2. **Both handlers required** - You must implement both `getEligibleTriggers` and `listTriggers`
3. **Dynamic eligibility** - `getEligibleTriggers` is called during checkout to determine which triggers are currently active
4. **Static list** - `listTriggers` provides the master list of all possible triggers for configuration in the Wix dashboard
5. **Manual step required, every time** — this plugin only supplies *eligibility*. It has no visible effect until the merchant creates an Automatic Discount that uses your trigger. Tell the user this step is required; don't imply the discount is live just because the plugin is installed. Confirmed live, click-by-click in the dashboard:
   1. Go to **Catalog** (left sidebar) → **Discounts** → **Automatic Discounts**.
   2. Click **Create Discount**.
   3. Pick a discount type (e.g. **Standard discount**) and click **Continue**.
   4. Under **Offer** → **"Are there any requirements?"**, check **Custom requirement**.
   5. A dropdown appears next to it — click it and select your trigger by the `name` your `listTriggers` handler returned for it (e.g. "Happy Hour 16:00-18:00"). It only shows up here once your app is installed and `listTriggers` includes it — there's no dashboard flow to type in an arbitrary trigger ID.
   6. Fill in the discount's offer/eligibility/dates as normal, then click **Save**.

   Note: the dialog's own **"Create New"** button under that dropdown only offers Wix's *built-in* requirement templates (email domain, first purchase, order count, etc.) — it does not create a new app-linked custom trigger. Your trigger must already be coming back from `listTriggers` to appear in the dropdown at all.
