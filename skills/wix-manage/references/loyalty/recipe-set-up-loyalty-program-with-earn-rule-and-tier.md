---
name: "Recipe: Set Up Loyalty Program with Earn Rule and Tier"
description: Activates the Wix Loyalty Program on a site, sets the program name, defines a conversion-rate earning rule that awards points per money spent on Stores orders, and creates a loyalty tier. Covers the required PATCH-before-activate sequence, the non-canonical `/_api/loyalty-earning-rules/v1/earning-rules` path, and the premium-plan requirement for tiers.
---

# Set Up Loyalty Program with Earn Rule and Tier

This recipe activates a Wix Loyalty Program, creates a custom earning rule that awards points based on Stores order totals, and creates a loyalty tier that customers reach at a configurable point threshold.

## Prerequisites

- A Wix site ID.
- **Wix Stores** must be installed (`appDefId`: `215238eb-22a5-4c36-9e7b-e7c08025e04e`) — required because the earning rule is triggered by `stores/OrderPaid` activities.
- **Wix Loyalty Program** must be installed (`appDefId`: `553c79f3-5625-4f38-b14b-ef7c0d1e87df`). If it isn't yet installed, install it first using the [Install Wix Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/install-wix-apps) recipe with the body:

  ```json
  {
    "tenant": { "tenantType": "SITE", "id": "<SITE_ID>" },
    "appInstance": { "appDefId": "553c79f3-5625-4f38-b14b-ef7c0d1e87df" }
  }
  ```

- To create tiers, the site must have a Wix premium plan (Wix Editor **Business** plan or Wix Studio **Plus** plan). On a free site the Tiers API will reject creation with `BASIC_TIERS_LIMIT_REACHED` — see Step 4.

## Required APIs

- **Loyalty Programs API**: [Update Loyalty Program](https://dev.wix.com/docs/api-reference/crm/loyalty-program/loyalty-program-management/program/update-loyalty-program), [Activate Loyalty Program](https://dev.wix.com/docs/api-reference/crm/loyalty-program/loyalty-program-management/program/activate-loyalty-program), [Get Loyalty Program](https://dev.wix.com/docs/api-reference/crm/loyalty-program/loyalty-program-management/program/get-loyalty-program)
- **Loyalty Earning Rules API**: [Create Loyalty Earning Rule](https://dev.wix.com/docs/api-reference/crm/loyalty-program/loyalty-program-management/earning-rules/create-loyalty-earning-rule)
- **Loyalty Tiers API**: [Create Tier](https://dev.wix.com/docs/api-reference/crm/loyalty-program/loyalty-program-management/tiers/create-tier)

---

## Step 1: Set the Program Name

Newly installed loyalty programs start in `DRAFT` status with no name. The Activate endpoint requires a program name to be set first — calling it on an unnamed program returns `400 validation failed` with `field=programName`. Update the program name (and optionally the points unit) before activating.

**Endpoint**: `PATCH https://www.wixapis.com/loyalty-programs/v1/program`

**Request Body**:

```json
{
  "loyaltyProgram": {
    "name": "Test Loyalty Program",
    "pointDefinition": {
      "customName": "Points"
    }
  }
}
```

**Response** (200):

```json
{
  "loyaltyProgram": {
    "name": "Test Loyalty Program",
    "pointDefinition": { "customName": "Points" },
    "status": "DRAFT",
    "createdDate": "2026-04-29T12:14:35.249Z",
    "updatedDate": "2026-04-29T12:14:35.249Z",
    "pointsExpiration": {
      "status": "DISABLED",
      "monthsOfInactivity": 3,
      "expiringPointsPercentage": 100
    },
    "premiumFeatures": {
      "loyaltyProgram": false,
      "tiers": false,
      "pointsExpiration": false
    }
  }
}
```

> The `premiumFeatures.tiers: false` flag indicates the site is on the basic plan and tier creation will be rejected (see Step 4).

---

## Step 2: Activate the Loyalty Program

Switch the program from `DRAFT` to `ACTIVE`. Customers can only earn or redeem points while the program is `ACTIVE`.

**Endpoint**: `POST https://www.wixapis.com/loyalty-programs/v1/program/activate`

**Request Body**: `{}`

**Response** (200):

```json
{
  "loyaltyProgram": {
    "name": "Test Loyalty Program",
    "pointDefinition": { "customName": "Points" },
    "status": "ACTIVE",
    "createdDate": "2026-04-29T12:14:35.249Z",
    "updatedDate": "2026-04-29T12:14:41.040Z",
    "pointsExpiration": {
      "status": "DISABLED",
      "monthsOfInactivity": 3,
      "expiringPointsPercentage": 100
    },
    "premiumFeatures": {
      "loyaltyProgram": false,
      "tiers": false,
      "pointsExpiration": false
    }
  }
}
```

---

## Step 3: Create the Earning Rule (10 points per $1 on Stores orders)

Create a non-automated earning rule using a `conversionRate` config (points per money amount). Use `fixedAmount` instead if you want a flat number of points per order regardless of total.

> **IMPORTANT — non-canonical path:** The documented URL `https://www.wixapis.com/loyalty-earning-rules/v1/earning-rules` returns **404 Not Found** for both POST and GET. The working path is prefixed with `/_api/`:
> `https://www.wixapis.com/_api/loyalty-earning-rules/v1/earning-rules`

**Endpoint**: `POST https://www.wixapis.com/_api/loyalty-earning-rules/v1/earning-rules`

**Request Body**:

```json
{
  "earningRule": {
    "sourceAppId": "553c79f3-5625-4f38-b14b-ef7c0d1e87df",
    "triggerAppId": "215238eb-22a5-4c36-9e7b-e7c08025e04e",
    "triggerActivityType": "stores/OrderPaid",
    "title": "10 points per $1 spent",
    "status": "ACTIVE",
    "conversionRate": {
      "configs": [{ "points": 10, "moneyAmount": 1 }]
    }
  }
}
```

Field notes:

- `sourceAppId` is always the Wix Loyalty Program app id (`553c79f3-5625-4f38-b14b-ef7c0d1e87df`).
- `triggerAppId` is the app whose activity grants the points. For Stores order-paid rules use `215238eb-22a5-4c36-9e7b-e7c08025e04e`.
- `triggerActivityType: "stores/OrderPaid"` fires when a Stores order is paid.
- Use `fixedAmount.configs[].points` for a flat-points rule, or `conversionRate.configs[].{points, moneyAmount}` for a per-spend rule. Don't send both.

**Response** (200):

```json
{
  "earningRule": {
    "id": "9bb918c0-4b58-4fee-ba95-8bfe32282cc7",
    "sourceAppId": "553c79f3-5625-4f38-b14b-ef7c0d1e87df",
    "triggerAppId": "215238eb-22a5-4c36-9e7b-e7c08025e04e",
    "triggerActivityType": "stores/OrderPaid",
    "title": "10 points per $1 spent",
    "conversionRate": { "configs": [{ "moneyAmount": 1, "points": 10 }] },
    "status": "ACTIVE",
    "revision": "1",
    "createdDate": "2026-04-29T12:15:06.274Z",
    "updatedDate": "2026-04-29T12:15:06.274Z",
    "metadata": { "canBeDeleted": true },
    "triggerFilters": []
  }
}
```

Persist the returned `id` and `revision` if you intend to update or delete the rule later — delete requires the current revision (see Error Handling).

---

## Step 4: Create a Loyalty Tier (e.g. Silver at 500 points)

**Endpoint**: `POST https://www.wixapis.com/loyalty-tiers/v1/tiers`

**Request Body**:

```json
{
  "tier": {
    "tierDefinition": {
      "name": "Silver",
      "description": "Silver tier members"
    },
    "requiredPoints": 500
  }
}
```

### Decision point — premium plan required

Tiers are a premium feature. The Get Loyalty Program response (Step 2) tells you whether the site can create tiers via `loyaltyProgram.premiumFeatures.tiers`:

- **If `premiumFeatures.tiers: true`** → the request returns 200 with the created tier object containing the assigned `id` and `revision`.
- **If `premiumFeatures.tiers: false`** → the request returns:

  ```
  428 Precondition Required
  { "message": "Tiers limit reached [0]",
    "details": { "applicationError": { "code": "BASIC_TIERS_LIMIT_REACHED" } } }
  ```

  The site owner must upgrade to a Wix Editor **Business** plan or Wix Studio **Plus** plan before tiers can be created. There is no API workaround for this. The rest of the loyalty program (program activation + earning rules) continues to function normally on the basic plan.

> Tier `tierDefinition.name` and `requiredPoints` must each be unique across the program — duplicates will be rejected even on premium sites.

---

## Step 5: Verify the Program State

Confirm the program is active.

**Endpoint**: `GET https://www.wixapis.com/loyalty-programs/v1/program`

**Response** (200):

```json
{
  "loyaltyProgram": {
    "name": "Test Loyalty Program",
    "pointDefinition": { "customName": "Points" },
    "status": "ACTIVE",
    "createdDate": "2026-04-29T12:14:35.249Z",
    "updatedDate": "2026-04-29T12:14:41.040Z",
    "pointsExpiration": {
      "status": "DISABLED",
      "monthsOfInactivity": 3,
      "expiringPointsPercentage": 100
    },
    "premiumFeatures": {
      "loyaltyProgram": false,
      "tiers": false,
      "pointsExpiration": false
    }
  }
}
```

Check that `loyaltyProgram.status === "ACTIVE"`. The earning rule's status is included in the create response (Step 3) — if you need to re-list rules later, use the `/_api/loyalty-earning-rules/v1/earning-rules` path (the non-`_api` path returns 404).

---

## Error Handling

### `400 validation failed` — `programName` required on Activate

```json
{
  "message": "validation failed",
  "details": {
    "validationError": {
      "fieldViolations": [
        {
          "field": "programName",
          "description": "Program name is required to set up an active program or change the program's status."
        }
      ]
    }
  }
}
```

**Cause:** Calling `POST /loyalty-programs/v1/program/activate` before the program has a name.
**Fix:** Run Step 1 (PATCH `/loyalty-programs/v1/program` with `loyaltyProgram.name`) first, then retry Activate.

### `404 Not Found` on Earning Rules endpoints

**Cause:** Using the documented path `https://www.wixapis.com/loyalty-earning-rules/v1/earning-rules`.
**Fix:** Prefix with `/_api/`: `https://www.wixapis.com/_api/loyalty-earning-rules/v1/earning-rules`.

### `428 Precondition Required` — `BASIC_TIERS_LIMIT_REACHED`

```json
{
  "message": "Tiers limit reached [0]",
  "details": { "applicationError": { "code": "BASIC_TIERS_LIMIT_REACHED" } }
}
```

**Cause:** Tier creation attempted on a site without a qualifying Wix premium plan (`premiumFeatures.tiers: false`).
**Fix:** Upgrade the site to Wix Editor Business or Wix Studio Plus. No API workaround.

### `409 Conflict` — `INVALID_REVISION` on delete/update

```json
{
  "message": "Outdated revision for entity id",
  "details": {
    "applicationError": {
      "code": "INVALID_REVISION",
      "data": { "revisionViolation": { "entityId": "..." } }
    }
  }
}
```

**Cause:** Calling `DELETE /_api/loyalty-earning-rules/v1/earning-rules/{id}` (or update) without the current `revision`.
**Fix:** Pass `revision` as a query parameter from the latest GET/create response, e.g.:
`DELETE https://www.wixapis.com/_api/loyalty-earning-rules/v1/earning-rules/{id}?revision=1`

### `403 Forbidden` — `PERMISSION_DENIED` on app uninstall

```json
{
  "message": "Insufficient Permissions",
  "details": { "applicationError": { "code": "PERMISSION_DENIED" } }
}
```

**Cause:** The Apps Installer Uninstall endpoint requires a logged-in Wix user or an API key admin identity. OAuth app contexts are not authorized to uninstall apps.
**Fix:** Use a Wix user session or an account-level API key, or have the site owner uninstall the app from the dashboard.
