---
name: "Pricing Plans Bookings Integration"
description: Links Pricing Plans to Bookings services using the Benefit Programs API. Enables package deals and memberships that grant booking access.
---

# Technical Step-by-Step Instructions: Integrating Wix Pricing Plans with Bookings Services (Real-World, API-First)

## Description

Integrate Wix Pricing Plans with Wix Bookings services so customers can purchase packages or memberships that grant booking sessions.

---

## Prerequisites

### Required App Installations

Before starting the integration, ensure the following apps are installed on the site:

1. **Wix Bookings** - Usually pre-installed, but verify using site queries
2. **Pricing Plans** - Must be installed if not present
   - Install if you encounter 428 "App not installed" errors

## Overview

Integrating Pricing Plans with Bookings allows businesses to offer:

- **Packages**: Fixed session count (e.g., "10 sessions") that can be used within validity period
- **Memberships with session limits**: Sessions per billing cycle (e.g., "10 sessions a month")
- **Unlimited memberships**: Unlimited access during subscription period (shows as "Unlimited Sessions")

The integration requires coordination between three APIs:

1. **Pricing Plans API** - Creates the plan structure and pricing
2. **Benefit Programs API** - Creates the bridge between plans and services through program definitions, pool definitions, and benefit items
3. **Bookings API** - Services automatically support pricing plan payments

### IMPORTANT NOTES

- The integration requires using all three APIs in sequence - there's no direct connection between Pricing Plans and Bookings
- Service `payment.options.pricingPlan` automatically becomes `true` when benefit programs are properly connected
- The benefit program definition `externalId` must exactly match the pricing plan `id` for the connection to work
- **Minimum Duration Requirements**: Plans must have minimum 7-day validity periods - cannot create 1-day plans
- **Use benefit items for Bookings services**: Do not register a booking service by calling `pool-definition-items/add-items-to-benefit` directly. For Pricing Plans to Bookings setup, create the benefit item with the Benefit Programs Items API and the benefit's `itemSetId`.
- **Fail fast on mutating errors**: Do not catch a Benefit Programs write error and return overall success. If one write fails, stop, report the exact failed endpoint and the IDs that were already created, then resume idempotently after the issue is fixed.
- **Revision Number Management**: Some Benefit Programs updates use revision numbers that can conflict with concurrent operations

---

## Steps

### 1. Create the Pricing Plan

Create the pricing plan first using the Pricing Plans API. You can create either:

- **Package plans** using `singlePaymentForDuration` pricing model with `"type": "bookings-package"` in `clientData`
- **Membership plans** using `subscription` pricing model with `"type": "bookings-membership"` in `clientData`

- `validity.duration` must be minimum 7 days (`P7D` format)
- Cannot use `P1D` or shorter periods due to API validation
- For subscription plans, billing cycles have similar minimum requirements

Keep the returned `plan.id` for the next step.

### 2. Find or Create the Benefit Program Definition

Use the Benefit Programs API to find or create the program definition that links to your pricing plan. The `externalId` must exactly match the pricing plan `id` from step 1, and use `"@wix/pricing-plans"` as the namespace.

If creation returns "Entity already exists", query and reuse the existing program definition.

### 3. Create the Pool Definition and Bookings Benefit

Create one pool definition for the Bookings integration and include exactly one benefit in it:

- `namespace` must be `"@wix/pricing-plans"`.
- Use the Wix Bookings app definition ID as the benefit `providerAppId`.
- Generate a unique `benefitKey` and keep it for verification.
- For **packages with session limits**: set the benefit price and credit configuration for the desired session count.
- For **unlimited memberships**: omit credit limits according to the Pool Definitions API schema.
- Keep the returned benefit `itemSetId`; the next step uses it to attach the booking service.

If a revision conflict occurs, retrieve the current revision and retry.

### 4. Create Benefit Items for the Booking Services

Create the item that represents the booking service by using the Benefit Programs Items API, not the Pool Definition Items API.

Each Bookings service item must use:

- `namespace: "@wix/pricing-plans"`
- `providerAppId`: the Wix Bookings app definition ID
- `externalId`: the Bookings service ID
- `itemSetId`: the `itemSetId` from the benefit created in the pool definition
- `category`: an empty string unless the Items API documentation for Bookings explicitly requires a different value

Do not call `POST https://www.wixapis.com/benefit-programs/v1/pool-definition-items/add-items-to-benefit` for this setup. That endpoint registers existing pool definition items with a benefit and uses a partial-success response model; using it as the first Bookings attach step can return 403 errors and leave the setup half-finished.

When creating multiple service items, let the mutating request fail if any service item cannot be created. Do not wrap each write in `try/catch` and return `{ success: true }` with embedded per-item errors. If a call fails, report the failed endpoint, pricing plan ID, program definition ID, pool definition ID, and service ID so the operation can be resumed safely.

### 5. Verify Service Integration

Query the service to confirm integration is working. The service should now show `payment.options.pricingPlan: true` and the plan should appear in the booking UI as a payment option.

### Important Notes

- **Sequence matters**: Create pricing plan → find/create benefit program definition → create pool definition with a Bookings benefit → create benefit item for the service.
- **ID relationships**:
  - Pricing Plan `id` → Benefit Program Definition `externalId`
  - Program Definition `id` → Pool Definition `programDefinitionIds`
  - Pool Definition benefit `itemSetId` → Benefit Item `itemSetId`
  - Service `id` → Benefit Item `externalId`
- **Session behavior**:
  - With `creditAmount`: Users consume credits per session
  - Without `creditAmount`: Users get unlimited access during subscription
- **Namespace requirement**: Always use `"@wix/pricing-plans"` as namespace for pricing plan integrations
- **Service updates**: Services automatically update when benefit programs are connected - no manual service modification needed
- **Partial setup recovery**: If an earlier attempt created program definitions or pool definitions but failed on service items, reuse the existing definitions and create only the missing benefit items. Do not create duplicate pools for the same plan/service pair.

### Troubleshooting Common Issues

**"Plan not found" Error:**

- Verify `externalId` exactly matches pricing plan `id`
- Ensure pricing plan was created successfully before creating benefit program
- Check that the plan hasn't been deleted or modified

**"Entity already exists" Error:**

- Query existing benefit program definitions to check for duplicates
- Reuse existing programs instead of creating new ones

**Service doesn't show pricing plan option:**

- Check that the benefit item has the booking service ID as `externalId`
- Check that the benefit item uses the benefit's `itemSetId`
- Verify all entities (plan, program definition, pool definition, benefit item) were created successfully
- Confirm service query shows `payment.options.pricingPlan: true`

**403 from `pool-definition-items/add-items-to-benefit`:**

- Stop using that endpoint for this Bookings setup. It is not the first attach step for a booking service.
- Use the Benefit Programs Items API to create the benefit item with `itemSetId`, `providerAppId`, empty `category`, and the booking service ID as `externalId`.
- If the 403 happened after program or pool definitions were created, query those definitions and resume from the benefit item step instead of recreating them.
- Report the endpoint and IDs if the Items API also returns a permission error; do not hide the failure inside a successful tool result.

**Minimum Duration Validation Errors:**

- Ensure `validity.duration` is at least `P7D` (7 days)
- Adjust single-session plans to weekly validity instead of daily
- For subscription plans, use appropriate billing cycle minimums

## API Documentation References

- [Create Plan](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/create-plan) — `POST https://www.wixapis.com/pricing-plans/v3/plans`
- [Create Program Definition](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/program-definitions/create-program-definition) — `POST https://www.wixapis.com/_api/benefit-programs/v1/program-definitions`
- [Create Pool Definition](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pool-definitions/create-pool-definition)
- [Bulk Create Items](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/items/bulk-create-items)
- [Pricing Plans API](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/introduction)
- [Benefit Programs API](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/introduction)
- [Bookings Services API](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/introduction)
