---
name: "Pricing Plans Bookings Integration"
description: Links Pricing Plans to Bookings services using the Benefit Programs API. Enables package deals and memberships that grant booking access.
---

# Technical Step-by-Step Instructions: Integrating Wix Pricing Plans with Bookings Services (Real-World, API-First)

## Description

Below are the recommended steps to successfully integrate Wix Pricing Plans with Wix Bookings services, enabling customers to purchase packages and memberships for booking sessions. This recipe covers the complete workflow including the required Benefit Programs integration.

---

## Prerequisites

### Required App Installations

Before starting the integration, ensure the following apps are installed on the site:

1. **Wix Bookings** - Usually pre-installed, but verify using site queries
2. **Pricing Plans** - Must be installed if not present
   - Install if you encounter 428 "App not installed" errors

### App Installation Process

If you receive app-related errors, install the missing app using the Apps Installer API.

**Steps:**

1. Identify the required app through error messages or API documentation
2. Use the Apps Installer API to install the missing app
3. Verify installation before proceeding

**For detailed app installation procedures, refer to:**

- [Apps Installer API Documentation](https://dev.wix.com/docs/api-reference/business-management/app-installation/install-app)
- Business setup recipes for app installation workflows
- API error messages which typically indicate the required app and installation steps

## Overview

Integrating Pricing Plans with Bookings allows businesses to offer:

- **Packages**: Fixed session count (e.g., "10 sessions") that can be used within validity period
- **Memberships with session limits**: Sessions per billing cycle (e.g., "10 sessions a month")
- **Unlimited memberships**: Unlimited access during subscription period (shows as "Unlimited Sessions")

The integration requires coordination between three APIs:

1. **Pricing Plans API (V3)** - Creates the plan structure and pricing
2. **Benefit Programs API** - Creates the bridge between the plan and the booking service, and enrolls individual members
3. **Bookings API** - Services automatically support pricing plan payments once wired up

### IMPORTANT NOTES

- The integration requires using all three APIs in sequence - there's no direct connection between Pricing Plans and Bookings
- This is a complex integration that requires careful error handling and state management
- **Revision Number Management**: The Benefit Programs API uses revision numbers on `Update*` calls that can conflict with concurrent operations

---

## Steps

### 1. Create the Pricing Plan

Create the pricing plan using the [Plans V3 API](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/create-plan) — `POST https://www.wixapis.com/pricing-plans/v3/plans`.

> **Note:** Older Pricing Plans material (Velo `wix-pricing-plans-backend`, and the deprecated Plans V2 REST API) describes plans using `pricing.singlePaymentForDuration`, `validity.duration`, and a `clientData` object. Those fields belong to the **deprecated** Plans API, not Plans V3. The V3 request body below is `plan.pricingVariants[]`, each with `pricingStrategies[].flatRate.amount` and `billingTerms`, not `singlePaymentForDuration`/`validity`. Sending V2-shaped fields to the V3 endpoint fails validation.

- **Package plans** (fixed session count, e.g. "10 sessions valid for 30 days"): create a one-time plan — set `billingTerms.endType` to `CYCLES_COMPLETED` with `cyclesCompletedDetails.billingCycleCount: 1`, and set `billingTerms.billingCycle` to the desired validity period (e.g. `{"period": "MONTH", "count": 1}`).
- **Membership plans** (recurring, e.g. "10 sessions a month"): create a recurring plan — set `billingTerms.endType` to `UNTIL_CANCELLED` (or `CYCLES_COMPLETED` with more than 1 cycle), with `billingTerms.billingCycle` as the recurrence period.
- The session count/credit limit itself isn't set on the plan — it's configured later in the pool definition's `details.benefits[].price` / `details.creditConfiguration` (see step 3).

Keep the returned `plan.id` for the next step.

### 2. Create a Program Definition

Use the Benefit Programs API to create a program definition. Call [Create Program Definition](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/program-definitions/create-program-definition) — `POST https://www.wixapis.com/_api/benefit-programs/v1/program-definitions` — with:
- `namespace`: a namespace you control for this integration (1–20 characters). Pick something specific to your app/site (e.g. `bookings_pricing_plans`) — this is **your own** namespace, not a fixed platform constant.
- `externalId`: set this to the pricing plan's `id` from step 1, so you can look the program definition back up by plan ID later via [Get Program Definition By External Id And Namespace](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/program-definitions/get-program-definition-by-external-id-and-namespace).
- `displayName`: a human-readable name for the program.

Save the returned `programDefinition.id`.

**Error Handling Note**: If you receive "Entity already exists" errors, the program definition may already exist from a previous attempt. Query existing program definitions first (or look it up by `externalId`/`namespace`) and handle the error gracefully.

### 3. Create a Pool Definition and register the booking service as a redeemable item

There is no single "benefit definition" call that takes a `serviceId` and `creditAmount` directly — linking a service requires 2 separate API calls:

**3a. Create the pool definition** with the credit/session configuration.

Call [Create Pool Definition](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pool-definitions/create-pool-definition) — `POST https://www.wixapis.com/_api/benefit-programs/v1/pool-definitions` — with:
- `programDefinitionIds`: `[<programDefinition.id from step 2>]`
- `namespace`: the same namespace used in step 2
- `details.benefits`: an array with 1 entry per bookable service you want this plan to cover. Each entry needs a unique `benefitKey` (any string you choose), `providerAppId` set to the Wix Bookings app ID (`13d21c63-b5ec-5912-8397-c3a5ddb27a97`), and `price` — the number of credits 1 redemption (1 session) costs (usually `1`).
- `details.creditConfiguration.amount`: for **packages**, the total session count for the plan's validity period (e.g. `10`). For **unlimited memberships**, omit `creditConfiguration` (or use a very high effective amount) — unlimited access isn't a "no credit configuration" flag on the benefit itself.

The response includes each benefit's `itemSetId` — save it for the next step.

**3b. Register the booking service as an item under that benefit.**

Call [Bulk Create Items](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/items/bulk-create-items) — `POST https://www.wixapis.com/benefit-programs/v1/bulk/items/create` — with 1 entry per service:
- `externalId`: the Bookings service's `id`
- `itemSetId`: the benefit's `itemSetId` from step 3a
- `providerAppId`: `13d21c63-b5ec-5912-8397-c3a5ddb27a97` (Wix Bookings)
- `namespace`: the same namespace used above

### 4. Enroll the buying member (provision their program)

Creating the program/pool *definitions* above only builds the template — it does **not** grant any member access by itself, and it does **not** by itself flip anything on the Bookings service. A live pool is created per member when their plan purchase is fulfilled.

Call [Provision Program](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/programs/provision-program) — `POST https://www.wixapis.com/benefit-programs/v1/programs/provision` — with:
- `poolDefinitionReference.programDefinitionId` (or `poolDefinitionId`): the ID from step 2/3a
- `beneficiary.identityType: "MEMBER"` and `beneficiary.memberId`: the buyer's site member ID
- `namespace`: the same namespace used above

This is normally triggered from your Pricing Plans order webhook/event handler (e.g. on order paid), not from a one-time setup script — do this once per purchase, not once per plan.

### 5. Verify the integration

- Call [Query Pools](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pools/introduction) filtered by the member's `beneficiary.memberId` and `namespace` to confirm they have an `ACTIVE` pool with balance.
- Call [Get Eligible Benefits](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pools/get-eligible-benefits) or [Check Benefit Eligibility](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pools/check-benefit-eligibility) with the service's `id` as `itemReference.externalId` and `providerAppId` `13d21c63-b5ec-5912-8397-c3a5ddb27a97` to confirm the member can redeem a session against that service.
- To actually charge a session against the plan (what the dashboard Booking Calendar does when redeeming a plan on a member's behalf), call [Redeem Benefit](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pools/redeem-benefit) with the `poolId`, `itemReference`, and `benefitKey` — this deducts 1 credit from the pool's balance. You're still responsible for confirming the booking (e.g. `Confirm Or Decline Booking` with `paymentStatus: EXEMPT`) after redeeming.

> **Known gap:** none of the above wires a "pay with my plan" option into the customer-facing online booking/checkout flow automatically — the public [Create Booking](https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking) API's `selectedPaymentOption` only supports `ONLINE`/`OFFLINE`, and the documented [Single-Service Booking flow](https://dev.wix.com/docs/api-reference/business-solutions/bookings/flow-single-service-booking) always routes paid bookings through eCommerce checkout (card payment) with no step that checks plan eligibility first. If you need "pay with plan" support in a custom booking UI, check eligibility yourself (this step) and redeem + confirm directly instead of creating an eCommerce checkout for members with an eligible plan.

### Troubleshooting Common Issues

**"App not installed" Error (428):**

- Install Pricing Plans app using Apps Installer API
- Verify installation before proceeding with plan creation

**"Entity already exists" Error:**

- Query existing benefit program/pool definitions to check for duplicates
- Consider updating existing programs instead of creating new ones
- Implement proper error handling for idempotent operations

**Member isn't eligible / has no pool:**

- Confirm step 4 (Provision Program) actually ran for this member — creating the definitions in steps 2–3 alone grants nothing
- Query Pools filtered by the member to confirm an `ACTIVE` pool exists with balance > 0

**Credits not working correctly:**

- For packages: ensure `details.creditConfiguration.amount` on the pool definition matches the intended session count
- Verify the service was registered as an item under the correct benefit's `itemSetId` (step 3b)

**Revision Number Conflicts:**

- `Update*` calls (e.g. Update Pool Definition) require the current `revision` — fetch it fresh and retry on conflict

## API Documentation References

- [Create Plan (V3)](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/create-plan) — `POST https://www.wixapis.com/pricing-plans/v3/plans`
- [Create Program Definition](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/program-definitions/create-program-definition) — `POST https://www.wixapis.com/_api/benefit-programs/v1/program-definitions`
- [Create Pool Definition](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pool-definitions/create-pool-definition) — `POST https://www.wixapis.com/_api/benefit-programs/v1/pool-definitions`
- [Bulk Create Items](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/items/bulk-create-items) — `POST https://www.wixapis.com/benefit-programs/v1/bulk/items/create`
- [Provision Program](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/programs/provision-program) — `POST https://www.wixapis.com/benefit-programs/v1/programs/provision`
- [Get Eligible Benefits](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pools/get-eligible-benefits) — `POST https://www.wixapis.com/benefit-programs/v1/pools/eligible-pools`
- [Redeem Benefit](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pools/redeem-benefit) — `POST https://www.wixapis.com/benefit-programs/v1/benefits/redeem`
- [Pricing Plans API](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/introduction)
- [Benefit Programs API](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/introduction)
- [Bookings Services API](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/introduction)
- [Apps Installer API](https://dev.wix.com/docs/api-reference/business-management/app-installation/install-app)
