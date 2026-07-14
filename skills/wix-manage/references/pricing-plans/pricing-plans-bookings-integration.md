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

1. **Pricing Plans API** - Creates the plan structure and pricing
2. **Benefit Programs API** - Creates the bridge between plans and services
3. **Bookings API** - Services automatically support pricing plan payments

### IMPORTANT NOTES

- The integration requires using all three APIs in sequence - there's no direct connection between Pricing Plans and Bookings
- This is a complex integration that requires careful error handling and state management
- Service `payment.options.pricingPlan` automatically becomes `true` when benefit programs are properly connected
- The benefit program `externalId` must exactly match the pricing plan `id` for the connection to work
- **Minimum Duration Requirements**: Plans must have minimum 7-day validity periods - cannot create 1-day plans
- **Revision Number Management**: The Benefit Programs API uses revision numbers that can conflict with concurrent operations

---

## Steps

### 1. Create the Pricing Plan

Create the pricing plan first using the Pricing Plans API. You can create either:

- **Package plans** using `singlePaymentForDuration` pricing model with `"type": "bookings-package"` in `clientData`
- **Membership plans** using `subscription` pricing model with `"type": "bookings-membership"` in `clientData`

**Important Validation Requirements:**

- `validity.duration` must be minimum 7 days (`P7D` format)
- Cannot use `P1D` or shorter periods due to API validation
- For subscription plans, billing cycles have similar minimum requirements

Keep the returned `plan.id` for the next step.

### 2. Create Benefit Program Definition

Use the Benefit Programs API to create the program definition that links to your pricing plan. The `externalId` must exactly match the pricing plan `id` from step 1, and use `"@wix/pricing-plans"` as the namespace.

**Error Handling Note**: If you receive "Entity already exists" errors, the program definition may already exist from a previous attempt. Query existing programs first or handle the error gracefully.

### 3. Create Benefit Definition for Bookings Service

Create the benefit definition that connects the program to your specific booking service:

- For **packages with session limits**: Include `creditAmount` set to the desired session count
- For **unlimited memberships**: Omit the `creditAmount` field entirely
- Always use the correct `serviceId` from your bookings service and `"@wix/pricing-plans"` namespace

**Revision Number Handling**: The Benefit Programs API requires revision numbers. If operations fail due to revision conflicts, retrieve the current revision number and retry.

### 4. Verify Service Integration

Query the service to confirm integration is working. The service should now show `payment.options.pricingPlan: true` and the plan should appear in the booking UI as a payment option.

### IMPORTANT NOTES

- **Sequence matters**: Create pricing plan → benefit program definition → benefit definition. Wrong order will cause "Plan not found" errors
- **Complex State Management**: This integration involves multiple APIs with different revision systems and error handling patterns
- **ID relationships**:
  - Pricing Plan `id` → Benefit Program Definition `externalId`
  - Service `id` → Benefit Definition `serviceId`
  - Program Definition `id` → Benefit Definition `programDefinitionId`
- **Session behavior**:
  - With `creditAmount`: Users consume credits per session
  - Without `creditAmount`: Users get unlimited access during subscription
- **Namespace requirement**: Always use `"@wix/pricing-plans"` as namespace for pricing plan integrations
- **Service updates**: Services automatically update when benefit programs are connected - no manual service modification needed

### Troubleshooting Common Issues

**"App not installed" Error (428):**

- Install Pricing Plans app using Apps Installer API
- Verify installation before proceeding with plan creation

**"Plan not found" Error:**

- Verify `externalId` exactly matches pricing plan `id`
- Ensure pricing plan was created successfully before creating benefit program
- Check that the plan hasn't been deleted or modified

**"Entity already exists" Error:**

- Query existing benefit program definitions to check for duplicates
- Consider updating existing programs instead of creating new ones
- Implement proper error handling for idempotent operations

**Service doesn't show pricing plan option:**

- Check that benefit definition has correct `serviceId`
- Verify all three entities (plan, program definition, benefit definition) were created successfully
- Confirm service query shows `payment.options.pricingPlan: true`

**Credits not working correctly:**

- For packages: Ensure `creditAmount` is set to desired session count
- For unlimited: Ensure `creditAmount` is omitted entirely
- Verify the benefit definition is properly linked to the correct program definition

**Minimum Duration Validation Errors:**

- Ensure `validity.duration` is at least `P7D` (7 days)
- Adjust single-session plans to weekly validity instead of daily
- For subscription plans, use appropriate billing cycle minimums

**Revision Number Conflicts:**

- Implement retry logic with fresh revision number retrieval
- Handle concurrent operations gracefully
- Consider queuing operations if dealing with high-frequency updates

### Known Limitation: Selecting a Specific Credit Pool for an Existing Booking

There is **no public API path** to programmatically pay/rebook a specific booking from a chosen pricing-plan credit pool (e.g. moving a session from bonus credits onto a customer's subscription credits) — the equivalent of the "Redeem session from" plan picker in the Wix Owner mobile app. This was confirmed by schema inspection and live testing (not a docs-only gap); every plausible path fails or is a dead end:

- **`Booking.selectedPaymentOption = "MEMBERSHIP"`** only records the customer's payment *choice*. It does not itself charge a plan credit — `Booking.paymentStatus` is documented as "Automatically updated when using eCommerce checkout APIs," meaning the actual charge still requires the same booking→checkout→order flow used for `ONLINE` payments.
- **eCom `createCheckout`/`updateCheckout`**: `checkoutInfo.buyerInfo.memberId` is a **read-only** field, populated from the caller's authenticated visitor/member session — it cannot be set in the request body. In an API-key or backoffice context there is no visitor session, so `buyerInfo` stays empty regardless of what you send. `membershipOptions.selectedMemberships` (which references a plan/membership `id` + `lineItemIds`) is accepted and clears `MEMBERSHIP_NOT_SELECTED_FOR_ITEMS`, but **Create Order then fails with `428 CHECKOUT_INVALID_MEMBERSHIP`** because the checkout has no associated member identity to validate the membership against.
- **Benefit Programs `Redeem Benefit`** (`POST /v1/benefits/redeem`) will correctly move credit out of a chosen pool — its own description says "Calling this method records redemption of the benefit and adjusts the pool's associated balance. **You still need to handle providing the beneficiary with the item.**" It has no `orderId`/`bookingId` field, so nothing links the redemption back to the booking: `Booking.paymentStatus` stays `UNDEFINED`, and cancelling the booking will not automatically refund the credit. `Balances` → `Revert Balance Change` is documented only as reverting "a transaction created by calling Change Balance" — **not** a `Redeem Benefit` redemption — so there's no confirmed, dedicated revert for a redemption; the closest manual workaround on cancellation is calling `Change Balance` with `type: "ADJUST"` to add the same amount back to the pool yourself.
- **Order Transactions `Add Payments`** (`POST /v1/payments/orders/{orderId}/add-payment`) only accepts `regularPaymentDetails` or `giftcardPaymentDetails` in its `payments[]` — there's no membership-payment variant, so you can't manually record a synthetic "paid via plan X" transaction on the order after redeeming a benefit either.

**Bottom line**: automating "rebook this session onto a specific plan/pool" for a backoffice/API-key integration isn't currently possible end-to-end. The closest working primitive is `Redeem Benefit` plus a manual `Change Balance` adjustment as a compensating reversal, but it requires the integrator to build and maintain their own linkage between the benefit-programs transaction and the booking — there is no built-in reconciliation. If a user needs this, tell them plainly that today it requires the manual "Redeem session from" flow in the Wix Owner app; don't attempt the checkout/membershipOptions path and report it as working, since it will look successful up to `createCheckout` and only fail at `createOrder`.

## API Documentation References

- [Create Plan](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/create-plan) — `POST https://www.wixapis.com/pricing-plans/v3/plans`
- [Create Program Definition](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/program-definitions/create-program-definition) — `POST https://www.wixapis.com/_api/benefit-programs/v1/program-definitions`
- [Pricing Plans API](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/introduction)
- [Benefit Programs API](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/introduction)
- [Bookings Services API](https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/introduction)
- [Apps Installer API](https://dev.wix.com/docs/api-reference/business-management/app-installation/install-app)
