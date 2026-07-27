---
name: "Create and Launch a Smart Campaign"
description: "Creates and launches a Google Ads Smart campaign for a Wix site — the simplest auto-managed campaign type, where Google handles bidding and delivery from keyword themes and geo targets. Covers getting AI keyword-theme, geo-target, and daily-budget suggestions, assembling the campaign (business name, landing page URL, language, budget in micros, targeted locations, keyword themes), creating it in DRAFT/PAUSED, and launching it to start serving ads. Use when the user wants to 'create a Google ad', 'run a Smart campaign', 'advertise my bakery on Google', 'promote my site on Google Search', or 'launch a simple Google Ads campaign'. Requires an existing Google Ads account. REST base https://www.wixapis.com/google-ads/v1."
---
# RECIPE: Create and Launch a Smart Campaign

A **Smart campaign** is the simplest Google Ads campaign type: you supply a business name, landing page URL, language, daily budget, target locations, and keyword themes — Google auto-manages bidding and ad delivery. This recipe gathers AI suggestions for the fuzzy inputs (keywords, geo, budget), assembles the campaign, creates it, and launches it.

Base URL: `https://www.wixapis.com/google-ads/v1`. `<AUTH>` is the `Authorization` header; body calls also need `Content-Type: application/json`.

> **Launching a campaign spends real money.** Show the user the assembled campaign — budget, locations, keyword themes — and get explicit approval **before** the Launch call in STEP 4. Creating in `PAUSED` (STEP 3) does not serve ads or spend; only Launch does.

**Prerequisite:** a Google Ads account must exist. If a call returns `ACCOUNT_NOT_FOUND`, run [Install Google Ads and Create an Account](install-and-create-account.md) first. You need the account's `id` (the Wix GUID) as `campaign.accountId`.

**Flow:** STEP 1 gather suggestions → STEP 2 settle budget → STEP 3 create (PAUSED) → **show & approve** → STEP 4 launch.

---

## STEP 1: Get keyword-theme and geo-target suggestions

These endpoints call Google directly and return the values you'll drop into the campaign. Base them on the site's live URL.

### Keyword themes

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/keyword-theme-suggestions' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "suggestionInfo": { "liveSiteUrl": "https://www.example.com", "languageCode": "en", "businessName": "Sunrise Bakery" } }'
```

```json
{ "googleSuggestion": { "keywordThemes": { "keywordThemes": [
  { "id": "theme-001", "displayName": "bakery" },
  { "id": "theme-002", "displayName": "fresh bread" },
  { "id": "theme-003", "displayName": "pastries near me" }
] } } }
```

Use each theme's `displayName` as a `freeFormKeywordTheme` in the campaign (Google best-effort maps free text to its internal keyword-theme constants). For interactive autocomplete instead, use `GET /v1/keyword-theme-options?queryText=bake&languageCode=en&countryCode=US`.

### Geo targets

```bash
curl -X GET 'https://www.wixapis.com/google-ads/v1/geo-options?queryLocation=New+York&languageCode=en&countryCode=US' -H 'Authorization: <AUTH>'
```

```json
{ "googleSuggestion": { "geoTargetsSuggestions": { "geoTargets": [
  { "id": "21167", "displayName": "New York, New York, United States", "countryCode": "US" },
  { "id": "1023191", "displayName": "New York, United States", "countryCode": "US" }
] } } }
```

Each geo target's `id` becomes `geoTargetConstants/{id}` in the campaign's `locations[].location.geoTargetConstant`. Results can include **restricted** countries — those are rejected at create time with `RESTRICTED_LOCATION`, so prefer the specific place the user named. To search several places at once, pass `queryLocations` with semicolon-separated names.

---

## STEP 2: Settle the daily budget

Budgets are in **micros**: `1,000,000` micros = 1 currency unit (so `15000000` = $15.00/day). Google caps monthly spend at ~30.4× the daily budget.

Get low/recommended/high tiers with estimated daily clicks:

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/budget-suggestions' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "suggestionInfo": { "liveSiteUrl": "https://www.example.com", "languageCode": "en" } }'
```

```json
{ "googleSuggestion": { "budget": {
  "low":         { "dailyBudget": "5000000",  "minEstimatedClicks": "3",  "maxEstimatedClicks": "8" },
  "recommended": { "dailyBudget": "15000000", "minEstimatedClicks": "12", "maxEstimatedClicks": "22" },
  "high":        { "dailyBudget": "30000000", "minEstimatedClicks": "25", "maxEstimatedClicks": "45" }
} } }
```

Present the tiers (converted to currency units and expected clicks) and let the user choose, or default to `recommended`. To validate a custom amount against account limits, call `GET /v1/campaign/daily-budget-boundaries` — it returns `minimumDailyBudget` / `maximumDailyBudget` in micros. A budget over the max fails create with `CAMPAIGN_DAILY_BUDGET_TOO_HIGH`.

---

## STEP 3: Create the campaign (in PAUSED)

Assemble everything into a `SMART` campaign. `status` is required — create in `PAUSED` (or `DRAFT`) so nothing serves until you launch. `smartCampaign` needs `businessName`, `url` (landing page), and `languageCode`; the campaign needs `budget.amountMicros`, at least one `locations` entry, and the keyword themes.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaigns' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{
    "campaign": {
      "accountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "campaignType": "SMART",
      "status": "PAUSED",
      "name": "Spring Bakery Promotion",
      "budget": { "amountMicros": "15000000" },
      "locations": [
        { "location": { "geoTargetConstant": "geoTargetConstants/1023191" }, "displayName": "New York, United States" }
      ],
      "smartCampaign": {
        "keywordThemes": [
          { "freeFormKeywordTheme": "bakery" },
          { "freeFormKeywordTheme": "fresh bread" }
        ],
        "businessName": "Sunrise Bakery",
        "url": "https://example.com",
        "languageCode": "en"
      }
    }
  }'
```

**Response** — save `campaign.id`:

```json
{
  "campaign": {
    "id": "c9d8e7f6-a5b4-3210-fedc-ba9876543210",
    "campaignType": "SMART",
    "status": "PAUSED",
    "name": "Spring Bakery Promotion",
    "budget": { "amountMicros": "15000000", "resourceName": "customers/1234567890/campaignBudgets/9876543210" },
    "reportingKey": "spring-bakery-promotion-2024-3-15-c9d8e7f6",
    "resourceName": "customers/1234567890/campaigns/9876543210"
  }
}
```

`status` is read-only and synced from Google. `resourceName` (`customers/…/campaigns/…`) is what performance analytics uses. `reportingKey` is the auto-generated `utm_campaign` value for conversion attribution.

**Now show the user the campaign** — name, daily budget in currency units, target locations, and keyword themes — and get explicit approval before launching.

Every site allows at most **5 live campaigns simultaneously**. If Launch later fails with `MAXIMUM_NUMBER_OF_CAMPAIGNS_REACHED`, pause another campaign first.

---

## STEP 4: Launch the campaign

After approval, launch it to start serving ads. Use **Launch** for a campaign's first activation (use Resume only to reactivate one that was previously live then paused — see [Manage Campaign Lifecycle](manage-campaign-lifecycle.md)).

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaigns/c9d8e7f6-a5b4-3210-fedc-ba9876543210/launch' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' -d '{}'
```

The response returns the campaign with `status: "LIVE"`. Ads begin serving; performance data (see [Query Campaign Performance Analytics](query-campaign-analytics.md)) is typically available within a few hours.

---

## Error handling

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ACCOUNT_NOT_FOUND` | No Google Ads account for the site | Run the [install-and-create-account](install-and-create-account.md) recipe first |
| `INVALID_ARGUMENT` / `RESTRICTED_LOCATION` | A targeted geo target is restricted | Remove it; pick the specific place the user named from Get Geo Options |
| `INVALID_ARGUMENT` / `CAMPAIGN_DAILY_BUDGET_TOO_HIGH` | Budget exceeds the account/currency max | Check `GET /v1/campaign/daily-budget-boundaries` and lower the amount |
| `INVALID_ARGUMENT` / `MISSING_URL` | No landing page URL for the campaign type | Provide `smartCampaign.url` |
| `INVALID_ARGUMENT` / `DUPLICATE_CAMPAIGN_NAME` | A campaign with that name exists on the account | Use a different `name` |
| `FAILED_PRECONDITION` / `MAXIMUM_NUMBER_OF_CAMPAIGNS_REACHED` | 5 live campaigns already | Pause one before launching |
| `FAILED_PRECONDITION` / `ACCOUNT_BLOCKED` / `ACCOUNT_NOT_ENABLED` | Account can't create/serve (billing, fraud, unpaid) | Surface to the user; resolve billing before retrying |
| `INVALID_ARGUMENT` / `GOOGLE_ADS_API_ERROR` | Unexpected Google Ads rejection | Surface the message; verify assets/settings and retry |

## References

- [Campaign Service introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/introduction)
- [Create Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/create-campaign)
- [Launch Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/launch-campaign)
- [Get Keyword Theme Suggestions](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-keyword-theme-suggestions)
- [Get Geo Options](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-geo-options)
- [Get Budget Suggestions](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-budget-suggestions)
