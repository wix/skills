---
name: "Create and Update Pricing Plans"
description: Creates subscription and one-time payment plans using Plans API. Covers pricing models (recurring, one-time, free), trial periods, perks configuration, and plan visibility.
---
# Technical Step-by-Step Instructions: Creating or Updating a Wix Pricing Plans (Real-World, API-First)

## Description
Below are the recommended steps to successfully create or update a Wix Pricing Plans (or several at once) on Wix and attach a booking session to a pricing plan, with real-world troubleshooting and fixes for common API issues.

---

## Overview
Wix Pricing Plans includes Plans that allows Wix users to build a customized membership plan experiences and sell them to their customers. Pricing plans can also have bundled booking session as benefits.

- With Plans, a site owner can create different types of plans, such as, free, one-time or recurring subscriptions and memberships.
- With Benefits, a site owner can connect other wix apps like booking service to a pricing plan subscription or membership. Read the full list of pricing plan integration [here](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/introduction#integrations).

### IMPORTANT NOTES
- Always Prioritize Reading Full API Method Documentation: this overview article provides a general workflow. However, it repeatedly stresses the importance of reading the full documentation for each specific REST method you intend to use. This is critical for understanding detailed requirements.
- Pay close attention to all required fields, data types, enum values, and specific ID types (e.g., resourceId vs. id) as defined in the detailed schema of each API endpoint. The overview article serves as a guide but doesn't replace the need to consult these specifics.

---

## Steps
### 0. Read pricing plans API docs
Before proceeding to further steps I must read the following [documentation](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/introduction) on how to form request to pricing plans API.

### 1. Create a pricing plan
Create plans with the [Create Plan](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/create-plan) endpoint: `POST https://www.wixapis.com/pricing-plans/v3/plans`.

Prerequisites: the site must have the Wix Pricing Plans app installed, and a site currency must be
set — Create Plan returns `404 CURRENCY_MISSING` when the currency isn't set in site settings.

#### Required request fields

Send all of these on every create request. Two of them are easy to miss, so check them before
sending:

| Field | Notes |
| --- | --- |
| `plan.status` | Set to `"ACTIVE"`. **The generated Create Plan method schema does not list this field, but the server requires it.** Omitting it returns `400` with `plan.status: value is required` (`REQUIRED_FIELD`). The code examples on the Create Plan article all include it. |
| `plan.visibility` | `"PUBLIC"` or `"PRIVATE"`. |
| `plan.pricingVariants[].id` | **You must generate this GUID yourself — it is not server-assigned.** This is unusual for a create call, and it's the most common cause of a failed first attempt. Omitting it returns `400` with `plan.pricingVariants[0].id: is not a valid GUID` and `must not be empty`. Generate a fresh UUID per variant. |
| `plan.pricingVariants[].name` | Variant name, e.g. `"Monthly"` or the plan name for a single-variant plan. |
| `plan.pricingVariants[].billingTerms.startType` | `"ON_PURCHASE"` or `"CUSTOM"`. |
| `plan.pricingVariants[].billingTerms.endType` | `"UNTIL_CANCELLED"` or `"CYCLES_COMPLETED"`. With `CYCLES_COMPLETED`, also send `billingTerms.cyclesCompletedDetails.billingCycleCount`. |
| `plan.pricingVariants[].pricingStrategies[]` | Exactly one strategy. Use `flatRate.amount` as a decimal **string**, e.g. `"0"` or `"5.99"`. |

`pricingVariants` is currently limited to one variant per plan.

#### Minimal free plan

This is the complete minimal body for a free plan — copy it and change the names and the variant
GUID:

```javascript
async function() {
  return await wix.request({
    method: 'POST',
    url: 'https://www.wixapis.com/pricing-plans/v3/plans',
    body: {
      plan: {
        name: 'Free Tier',
        visibility: 'PUBLIC',
        status: 'ACTIVE',
        buyable: true,
        buyerCanCancel: true,
        pricingVariants: [
          {
            id: '7a3f1e2d-4b5c-6d7e-8f9a-0b1c2d3e4f5a', // generate a fresh GUID
            name: 'Free Tier',
            pricingStrategies: [{ flatRate: { amount: '0' } }],
            billingTerms: {
              startType: 'ON_PURCHASE',
              endType: 'UNTIL_CANCELLED'
            }
          }
        ]
      }
    }
  });
}
```

Do **not** add a `billingCycle` to a free plan: a free plan can't be recurring, and the server
rejects that combination with `400 FREE_PRICING_VARIANT_IS_NOT_RECURRING`.

#### Other plan types

Same required fields; only `billingTerms` and the `flatRate.amount` change.

| Plan type | `billingTerms` |
| --- | --- |
| Free, open-ended | Omit `billingCycle`; `endType: "UNTIL_CANCELLED"`. `flatRate.amount: "0"`. |
| One-time payment, fixed duration | `billingCycle` = the duration (e.g. `{ period: 'MONTH', count: 1 }`), `endType: "CYCLES_COMPLETED"`, `cyclesCompletedDetails.billingCycleCount: 1`. |
| Recurring, until cancelled | `billingCycle` = the recurrence (e.g. `{ period: 'MONTH', count: 1 }`), `endType: "UNTIL_CANCELLED"`. |

A `billingCycle` can't be shorter than 7 days, and total plan duration can't exceed 10 years
(`400 VALID_BILLING_CYCLE` / `400 VALID_PLAN_DURATION`).

Two more optional fields worth knowing:

- **Purchase caps.** In V3 these are `plan.purchaseLimits`, an array of
  `{ type, maxCount }`. `type` is one of `PER_MEMBER_LIFETIME`, `PER_MEMBER_ACTIVE`,
  `TOTAL_ACTIVE`, `TOTAL_SOLD`. To make a plan available only once per member, send
  `purchaseLimits: [{ type: 'PER_MEMBER_LIFETIME', maxCount: 1 }]`. Some Create Plan examples still
  use the V2-era `maxPurchasesPerBuyer` field; `purchaseLimits` is the V3 equivalent.
- **Free trials.** `pricingVariants[].freeTrialDays` only applies to recurring *paid* plans — using
  it on a free plan returns `400 FREE_TRIAL_IS_APPLICABLE`.

### 2. Attach integrating app entity to pricing plans

To attach integrating app entity, like bookings or blog to pricing plans read the [Benefit Programs](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/introduction) documentation and proceed to further steps.

#### 2.1. Find program definition

Use [Get Program Definition By External Id And Namespace](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/program-definitions/get-program-definition-by-external-id-and-namespace) endpoint to find the corresponding program definition of the plan. The call must have these query params:
- `externalId` must be equal to pricing plan id.
- `namespace` must be `@wix/pricing-plans`

Example the request in curl:
```bash
curl --request GET \
  "https://www.wixapis.com/benefit-programs/v1/program-definitions/by-namespace-and-external-id?externalId=00000000-0000-0000-0000-000000000001&namespace=@wix/pricing-plans" \
  -H 'Authorization: <AUTH>' \
  -H "Content-Type: application/json"
```

#### 2.2. Create a pool definition

Only one pool definition per integrating app must be created. The pool definition should be created using [create pool definition](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/pool-definitions/create-pool-definition) endpoint.

The request for this endpoint must adhere to these rules:
- `namespace` must be `@wix/pricing-plans`
-  only one benefit can be defined in the pool definition
- benefit benefitKey must be a random generated UUID
- benefit provider app id must be the integrating app def id. For the full list of wix app def ids read [this](https://dev.wix.com/docs/api-reference/articles/get-started/apps-created-by-wix) article.
- benefit price must be only 1 or 0. 0 - if you want the benefit to have unlimited credits and 1 - for the benefit to be limited.
- `creditConfiguration` must be empty if the benefit is unlimited

#### 2.3. Create benefit items

This step is needed to attach the integrating app entity to benefit program. This is done by using [bulk create items](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/items/bulk-create-items) endpoint.

Each item in the request for this endpoint must adhere to these rules:
- `namespace` must be `@wix/pricing-plans`
-  `category` must be empty string
- provider app id must be the integrating app def id. For the full list of wix app def ids read [this](https://dev.wix.com/docs/api-reference/articles/get-started/apps-created-by-wix) article.
- `itemSetId` must set to the created pool definition benefit item set id.
- `externalId` must be set to the integrating app entity id, example: booking service id or blog post id.

### 3. Stop offering a plan — archive it, don't delete it

When the user asks to archive, retire, or stop offering a plan, **archive** it so existing
subscribers and order history are preserved. Archiving is an Update Plan call — there is no
separate archive endpoint, and Delete Plan is not the same thing:

```bash
curl -X PATCH \
  'https://www.wixapis.com/pricing-plans/v3/plans/<PLAN_ID>' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "plan": { "id": "<PLAN_ID>", "revision": "<CURRENT_REVISION>", "archived": true } }'
```

Carry the plan's current `revision` or the update is rejected. `archived` is not listed in the
generated Plan object reference, so it cannot be found by reading the schema — reach for it
directly rather than searching for an archive method or falling back to Delete Plan.

## Pricing plans REST API Documentation Reference
- [Create plan](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/create-plan)
- [Get plan](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/get-plan)
- [Update plan](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/update-plan)
- [Query Plans](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/query-plans)
- [Pricing Plans Introduction](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/introduction)
