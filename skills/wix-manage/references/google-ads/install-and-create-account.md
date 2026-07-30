---
name: "Install Google Ads and Create an Account"
description: "One-time setup for running Google paid ads on a Wix site: install the Wix Google Ads app, then create the Google Ads account that every campaign, suggestion, and analytics call depends on. Covers checking whether an account already exists, choosing a currency, optionally attaching a promotional incentive (credit offer), linking a Google Merchant Center account, and deleting an account. Use when the user wants to 'set up Google Ads', 'connect Google Ads', 'start advertising on Google', 'create a Google Ads account', or hits an ACCOUNT_NOT_FOUND / app-not-installed error before creating a campaign. Google Ads REST API, base https://www.wixapis.com/google-ads/v1."
---
# RECIPE: Install Google Ads and Create an Account

Setting up Google Ads on a Wix site is a **strict two-step prerequisite** for everything else in this area: (1) install the Wix Google Ads app, then (2) create the Google Ads account. Campaigns, suggestions, analytics, and billing all fail with `ACCOUNT_NOT_FOUND` (or an app-not-installed error) until both are done. This is a one-time setup per site.

Base URL for all endpoints: `https://www.wixapis.com/google-ads/v1`. The `<AUTH>` placeholder is shorthand for the `Authorization` header; body-bearing calls also need `Content-Type: application/json`.

> **This flow creates a billable advertising account.** Creating the account and launching campaigns spends the site owner's real money. Confirm intent with the user before calling **Create Account**, and surface the chosen currency.

---

## STEP 0: Check whether an account already exists (do this first)

Before installing or creating anything, check for an existing account. **Get Account For Current Site** returns an empty response (not an error) when none exists, so it's the safe probe.

```bash
curl -X GET 'https://www.wixapis.com/google-ads/v1/accounts/current-site' -H 'Authorization: <AUTH>'
```

- **`account` present** → setup is already done. Skip to whatever the user actually wants (create a campaign, view analytics, etc.). Do **not** create a second account — Create Account returns `ACCOUNT_ALREADY_EXISTS`.
- **Empty response `{}`** → no account yet. Continue to STEP 1.

Example response for an existing account:

```json
{
  "account": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "googleAccountId": "123-456-7890",
    "currency": "USD",
    "accountStatus": "ACTIVE",
    "currentBudget": { "value": "50.00", "currency": "USD" },
    "spentBudget": { "value": "12.50", "currency": "USD" },
    "paymentStatus": { "status": "PAID" }
  }
}
```

`account.id` is the Wix-internal GUID used as `campaign.accountId` when creating campaigns. `googleAccountId` is the underlying Google Ads customer ID (display only). `currentBudget` is remaining ad credit — a **negative** value means outstanding debt not yet charged.

---

## STEP 1: Install the Wix Google Ads app

Idempotent — safe to call even if already installed (no effect). Required before Create Account.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/install-if-not-installed' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' -d '{}'
```

Returns `{}`. Always run this before the first Create Account on a site.

---

## STEP 2 (optional): Offer a promotional incentive

New accounts in supported currencies can attach an **incentive** — a promotional credit granted after the account spends a threshold. Skip this step for unsupported currencies (the call returns no offers).

```bash
curl -X GET 'https://www.wixapis.com/google-ads/v1/incentives?currency=USD' -H 'Authorization: <AUTH>'
```

Returns up to three tiers (`lowOffer`, `mediumOffer`, `highOffer`), each with an `incentiveId`, an `awardAmount` (credit granted), and a `requiredAmount` (spend needed to unlock it), plus a `consolidatedTermsAndConditionsUrl`. Present the tiers to the user and let them pick; carry the chosen `incentiveId` into STEP 3 as `selectedIncentiveId`. The incentive is recorded now and applied automatically once the account's budget is assigned — there is no separate apply call in this flow.

---

## STEP 3: Create the Google Ads account

Requires `currency` (ISO-4217, e.g. `USD`). Pass `selectedIncentiveId` if the user picked one in STEP 2. **Confirm with the user before this call** — it provisions a billable account.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/accounts' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{
    "currency": "USD",
    "selectedIncentiveId": "incentive-promo-2024-usd-500"
  }'
```

**Response** — save `account.id` for campaign creation:

```json
{
  "account": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "googleAccountId": "123-456-7890",
    "currency": "USD",
    "accountStatus": "ACTIVE",
    "paymentStatus": { "status": "PENDING_SUBSCRIPTION" },
    "selectedIncentiveId": "incentive-promo-2024-usd-500"
  }
}
```

The currency choice is durable and drives budget minimums/maximums and manager-account selection — settle it with the user before creating. A currency Google doesn't natively support (only USD, EUR, GBP, JPY are native) still works; the account reports `budgetInSupportedCurrency` as the converted amount.

---

## Managing an existing account

### Link a Google Merchant Center account (for Shopping / retail PMAX)

`UpdateAccount` is a partial update — send only the fields you're changing. Merchant Center linking is needed before a retail Performance Max campaign can serve product ads.

```bash
curl -X PATCH 'https://www.wixapis.com/google-ads/v1/accounts/a1b2c3d4-e5f6-7890-abcd-ef1234567890' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "account": { "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890", "merchantCenterAccountId": "9876543210" } }'
```

The response's `merchantCenterAccountLinkStatus.status` starts at `PENDING` — the Merchant Center account owner must approve the link before it becomes `ENABLED`.

### View conversion actions

Conversion actions (Purchase, Page View, etc.) are what campaigns optimize toward. To inspect them:

```bash
curl -X GET 'https://www.wixapis.com/google-ads/v1/accounts/current-site/conversion-actions' -H 'Authorization: <AUTH>'
```

### Delete the account

`DeleteAccount` unlinks and removes the account. This is destructive and cannot be undone — **always confirm with the user first**, and prefer pausing campaigns over deleting the whole account when the user just wants to stop spending.

```bash
curl -X DELETE 'https://www.wixapis.com/google-ads/v1/accounts/a1b2c3d4-e5f6-7890-abcd-ef1234567890' -H 'Authorization: <AUTH>'
```

Returns `{}`. Errors with `ACCOUNT_NOT_FOUND` if no account exists.

---

## Error handling

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ALREADY_EXISTS` / `ACCOUNT_ALREADY_EXISTS` on Create Account | An account is already linked to this site | Don't create another — use Get Account For Current Site and continue with the existing `account.id` |
| `INTERNAL` / `CREATION_BLOCKED` on Create Account | Account creation is temporarily disabled platform-wide | Not a caller error; surface it and retry later |
| `ACCOUNT_NOT_FOUND` on any campaign/analytics/billing call | Setup wasn't completed (no account) | Run this recipe: install the app, then Create Account |
| App-not-installed error before Create Account | STEP 1 was skipped | Call Install (STEP 1); it's idempotent |
| Get Incentives returns no offers | Currency not supported for incentives | Proceed to Create Account without `selectedIncentiveId` |
| `NOT_FOUND` / `ACCOUNT_NOT_FOUND` on Delete Account | No account exists for the site | Nothing to delete; confirm with Get Account For Current Site |

## References

- [Google Ads APIs introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/introduction)
- [App Installer Service](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-ads-app-installer-v1/introduction)
- [Account Service](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-account-v1/introduction)
- [Create Account](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-account-v1/create-account)
- [Get Account For Current Site](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-account-v1/get-account-for-current-site)
- [Get Incentives](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-incentives)
