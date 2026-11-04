---
name: "Create and Update Pricing Plans"
description: "Creates, finds and changes Wix Pricing Plans with the Plans API. Covers pricing models (recurring, one-time, free), trial periods, perks and plan visibility; finding a plan by name and listing the plans a site sells; and renaming, repricing, hiding and archiving a plan."
---
# Technical Step-by-Step Instructions: Creating or Updating a Wix Pricing Plans (Real-World, API-First)

> These calls need the Wix Pricing Plans app on the site (`appDefId` `1522827f-c56c-a5c9-2ac9-00f9e6ae12d3`); a `428`, a `400` naming the app, or an empty result on a site that should have content means it is not there. [List Installed Apps](../app-installation/list-installed-apps.md) shows what the site has; [Install Wix Apps](../app-installation/install-wix-apps.md) adds it by that id.


## Description
Below are the steps to create, find and change Wix Pricing Plans, with real-world troubleshooting and fixes for common API issues. To give a plan's buyers booking sessions (packages, memberships, unlimited bookings), use [Pricing Plans Bookings Integration](pricing-plans-bookings-integration.md) instead.

---

## Overview
Wix Pricing Plans includes Plans that allows Wix users to build a customized membership plan experiences and sell them to their customers.

- With Plans, a site owner can create different types of plans, such as, free, one-time or recurring subscriptions and memberships.
- With Benefits, a site owner can connect other Wix apps, such as Wix Blog, to a pricing plan subscription or membership. Read the full list of pricing plan integration [here](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/introduction#integrations).

### IMPORTANT NOTES
- The steps below carry the request bodies for the common path. Open a linked method page only when the task needs a field that the step does not show.

---

## Steps
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

### 2. Attach integrating app entity to pricing plans (not Bookings)

This step is not the path for booking access: for Wix Bookings services, use [Pricing Plans Bookings Integration](pricing-plans-bookings-integration.md). To attach another integrating app's entity, such as a blog post, to pricing plans read the [Benefit Programs](https://dev.wix.com/docs/api-reference/business-solutions/benefit-programs/introduction) documentation and proceed to further steps.

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
- `externalId` must be set to the integrating app entity id, for example a blog post id.

### 3. Find a plan

Find plans with [Query Plans](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/query-plans): `POST https://www.wixapis.com/pricing-plans/v3/plans/query`. Every later step that changes a plan needs its `id` and current `revision` from this result.

**The plans the site sells** (archived plans are returned too unless you filter them out):

```bash
curl -X POST 'https://www.wixapis.com/pricing-plans/v3/plans/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "query": { "filter": { "archived": false }, "cursorPaging": { "limit": 100 } } }'
```

**One plan by name:**

```bash
curl -X POST 'https://www.wixapis.com/pricing-plans/v3/plans/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "query": { "filter": { "name": "Gold Membership", "archived": false } } }'
```

`name` matching is exact and case-sensitive: `"gold membership"` does not find `"Gold Membership"`. When the user's wording finds nothing, list the plans the site sells and match the name in code, ignoring case. Several plans fit: ask which one before changing anything.

The plans are in `plans[]`. The fields the next steps read:

| Field | What it holds |
| --- | --- |
| `id`, `revision` | Needed by every update |
| `name`, `visibility`, `archived` | `visibility` is `PUBLIC` or `PRIVATE` |
| `currency` | Currency of every amount in the plan |
| `pricingVariants[]` (every field) | Sent back exactly as returned when the price changes (step 4) |
| `pricingVariants[].pricingStrategies[0].flatRate.amount` | The price, as a decimal string (`"30"`) |

Results come oldest first, up to 100 per page. While `pagingMetadata.hasNext` is `true`, send `{ "query": { "cursorPaging": { "limit": 100, "cursor": "<pagingMetadata.cursors.next>" } } }`; the cursor keeps the first request's filter.

### 4. Change a plan

Change a plan with [Update Plan](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/update-plan): `PATCH https://www.wixapis.com/pricing-plans/v3/plans/<PLAN_ID>`.

A request that names the plan and the change ("raise Gold to $35 a month", "archive the Legacy plan") is already the user's confirmation, for this step and for step 5. Ask first when the plan or the new value is unclear, or when the currency or billing period the user names differs from the plan's `currency` or `billingCycle`; do not change `billingTerms` to match the user's wording.

Send the plan's `id`, its current `revision` and only the fields that change; top-level fields you leave out keep their values. A `revision` that is no longer current returns `409 INVALID_REVISION`: read the plan again and resend with the new `revision`.

**Rename a plan:**

```bash
curl -X PATCH 'https://www.wixapis.com/pricing-plans/v3/plans/<PLAN_ID>' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "plan": { "id": "<PLAN_ID>", "revision": "<CURRENT_REVISION>", "name": "Gold Membership Plus" } }'
```

The pricing variant keeps its own `name`; renaming the plan does not change it.

**Hide a plan from the site:** send `"visibility": "PRIVATE"`. The plan then no longer shows to site visitors and members, but it can still be bought. To stop selling it, archive it (step 5). Do not hide a plan with `buyable`: the field is deprecated, and `false` does not stop purchases. Keep `buyable: true` when you create a plan, as in step 1.

**Change the price:** `pricingVariants` replaces the plan's variants. Send each variant back exactly as Query Plans returned it — every field, including `freeTrialDays`, `fees` and `billingTerms.cyclesCompletedDetails` when they are present — and change only `pricingStrategies[0].flatRate.amount`. A field you leave out is lost: a variant with only `id` and `pricingStrategies` returns `400` (`billingTerms must not be empty`, `name must not be empty`), and one without `freeTrialDays` drops the free trial. In the example below, every value except the amount is copied from the query result.

```bash
curl -X PATCH 'https://www.wixapis.com/pricing-plans/v3/plans/<PLAN_ID>' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "plan": {
      "id": "<PLAN_ID>",
      "revision": "<CURRENT_REVISION>",
      "pricingVariants": [
        {
          "id": "<VARIANT_ID>",
          "name": "<VARIANT_NAME>",
          "freeTrialDays": 0,
          "fees": [],
          "billingTerms": {
            "billingCycle": { "period": "MONTH", "count": 1 },
            "startType": "ON_PURCHASE",
            "endType": "UNTIL_CANCELLED"
          },
          "pricingStrategies": [{ "flatRate": { "amount": "19" } }],
          "visible": true,
          "categoryIds": []
        }
      ]
    }
  }'
```

A new price applies to new purchases; existing subscribers keep the price they bought at ([Help Center: editing an existing plan](https://support.wix.com/en/article/pricing-plans-editing-an-existing-plan)). Tell the user so. When they want existing subscribers to renew at the new price too, give them the dashboard flow in [Changing the Price of a Subscription](https://support.wix.com/en/article/wix-pricing-plans-changing-a-price-of-a-subscription).

### 5. Stop offering a plan — archive it, don't delete it

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
