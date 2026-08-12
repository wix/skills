---
name: "Get AI Campaign Suggestions for Google Ads"
description: "Reference for the Google Ads Suggestions API on a Wix site: AI/Google-generated inputs that help build effective Performance Max (PMAX) campaigns — geo-target options, PMAX budget recommendations, text assets (headlines/descriptions), AI image assets (auto-uploaded to Wix Media), search themes, promotional incentive offers, and complete AI-generated PMAX Leads campaign configurations. Use when the user asks 'what budget should I use', 'where should I target', 'generate ad copy/headlines', 'generate ad images', 'suggest a whole campaign', or when a create-campaign flow needs suggested values. REST base https://www.wixapis.com/google-ads/v1."
---
# RECIPE: Get AI Campaign Suggestions for Google Ads

The Suggestions API produces the values that make a campaign effective — locations, budgets, and creative assets — either from Google directly or from Wix's AI. It's the input layer for the [Performance Max create recipe](create-performance-max-campaign.md); this file is the standalone reference for each endpoint and for the two that don't appear there (a full PMAX Leads campaign suggestion, and incentive offers).

Base URL: `https://www.wixapis.com/google-ads/v1`. `<AUTH>` is the `Authorization` header; body calls also need `Content-Type: application/json`. All suggestion endpoints are **read-only** — none create or spend anything, so run them freely.

> **Performance Max is the only supported campaign type for creation.** Smart campaign creation is no longer supported. Never propose, build, or mention a Smart campaign to the user — if someone asks for a Smart campaign, create a [Performance Max](create-performance-max-campaign.md) campaign instead. The keyword-theme and daily-budget-tier suggestion endpoints only fed Smart campaigns and are intentionally omitted here.

> **Two conventions to carry into every answer (this is where they trip people up):**
> - **Budgets come back in micros.** Every `dailyBudget` / `budgetAmountMicros` / `recommendedBudgetAmountMicros` is in micros, where `1,000,000` micros = 1 unit of the account's currency (so `15000000` = $15.00/day). Always convert to currency units when presenting to a user, and pass micros back when creating a campaign.
> - **Geo suggestions return an `id`, not a usable target.** `geo-options` returns matches under `googleSuggestion.geoTargetsSuggestions.geoTargets[]`, each with an `id` (e.g. `"1023191"`), a `displayName`, and a `countryCode`. To target a location in a campaign you must wrap the id as `geoTargetConstants/{id}` (e.g. `"geoTargetConstants/1023191"`) in `locations[].location.geoTargetConstant` — the raw `id` alone is not accepted. **Always resolve user-named locations through this endpoint; never guess or hardcode geo ids.** A whole-country query (e.g. `queryLocation=Israel`) can return a Google Ads internal error — retry with `countryCode`, and if it keeps failing resolve a specific city in that country instead.

**Which suggestion do you need?**

| Goal | Endpoint | Used by |
| --- | --- | --- |
| Geo targets | `geo-options` | [PMAX](create-performance-max-campaign.md) |
| Budget recommendation | `budget-recommendation` | [PMAX](create-performance-max-campaign.md) |
| Headlines & descriptions | `text-asset-suggestions` | [PMAX](create-performance-max-campaign.md) |
| AI images | `image-asset-suggestions` | [PMAX](create-performance-max-campaign.md) |
| Search themes | `search-theme-suggestions` | [PMAX Leads](create-performance-max-campaign.md) |
| A full AI campaign config | `campaign-suggestions` | this recipe |
| Promotional credit offers | `incentives` | [account setup](install-and-create-account.md) |

For the campaign-building endpoints (geo, text/image/search-theme assets, budget recommendation), see the Quick Reference below — and the [Performance Max recipe](create-performance-max-campaign.md) for the asset/budget calls in context. Below are the two endpoints unique to this reference.

---

## Full AI campaign suggestions

Generates one or more complete, ready-to-use **PMAX Leads** campaign configurations — assets and geo targets bundled into a `campaign` object you can pass almost directly to Create Campaign. Suggestions come from the site's marketing settings and pages. Uses an LLM — responses can take up to **120 seconds**.

- `amount` — how many suggestions to generate (max 3).
- `campaignType` — `PERFORMANCE_MAX_LEADS`.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaign-suggestions' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "amount": 1, "campaignType": "PERFORMANCE_MAX_LEADS" }'
```

```json
{ "campaignSuggestions": [ {
  "campaignMessaging": "Reach local customers searching for fresh-baked goods",
  "campaign": {
    "name": "Sunrise Bakery – Performance Max",
    "campaignType": "PERFORMANCE_MAX_LEADS",
    "budget": { "amountMicros": "15000000" },
    "performanceMaxCampaign": {
      "url": "https://www.example.com",
      "languages": [ { "languageCode": "en" } ],
      "assetGroups": [ { "assetGroupAssets": { "assets": [
        { "headlineAsset": { "text": "Fresh Baked Daily" }, "assetFieldType": "HEADLINE" },
        { "descriptionAsset": { "text": "Award-winning pastries made fresh every morning." }, "assetFieldType": "DESCRIPTION" }
      ] } } ]
    }
  }
} ] }
```

Present `campaignMessaging` and the config to the user, then use the `campaign` object as the basis for creating the campaign (add `accountId`, `status`, `budget`, `locations`, and any missing minimum assets before Create — see the [Performance Max recipe](create-performance-max-campaign.md)). `costInMicrocents` in the response is the AI cost — absorbed by Wix, not charged to the caller. Error: `MAX_CAMPAIGNS_TO_SUGGEST_EXCEEDED` (`amount` > 3).

---

## Promotional incentive offers

Credit offers for **new** accounts, granted after a spend threshold. Only supported currencies return offers. This drives the optional incentive step of [account setup](install-and-create-account.md).

```bash
curl -X GET 'https://www.wixapis.com/google-ads/v1/incentives?currency=USD' -H 'Authorization: <AUTH>'
```

Returns `lowOffer` / `mediumOffer` / `highOffer`, each with `incentiveId`, `awardAmount`, and `requiredAmount`, plus a `consolidatedTermsAndConditionsUrl`. Pass the chosen `incentiveId` as `selectedIncentiveId` when creating the account.

---

## Quick reference — the create-flow suggestion endpoints

- **Geo targets:** `GET /v1/geo-options?queryLocation=&languageCode=&countryCode=` → `googleSuggestion.geoTargetsSuggestions.geoTargets[]`, each with `id` (→ `geoTargetConstants/{id}`), `displayName`, and `countryCode`. Pass `countryCode` to bias results. May include restricted countries (rejected at create); a bare-country query can fail internally — fall back to a specific city.
- **Budget recommendation:** `POST /v1/budget-recommendation` with `{ campaignType, assetGroupInfo:[{finalUrl,...}], currency, ... }` → `recommendedBudgetAmountMicros` + `budgetOptions`.
- **Text assets:** `POST /v1/text-asset-suggestions` (`suggestionInfo.landingPageUrl` + `textSuggestionInfo.languageCode` required).
- **Image assets:** `POST /v1/image-asset-suggestions` (`suggestionInfo.landingPageUrl` required; images auto-uploaded to Wix Media).
- **Search themes:** `POST /v1/search-theme-suggestions` (`textSuggestionInfo.languageCode` required).

## Error handling

| Symptom | Cause | Fix |
| --- | --- | --- |
| `INVALID_ARGUMENT` / `MAX_CAMPAIGNS_TO_SUGGEST_EXCEEDED` | `amount` > 3 | Request at most 3 |
| Slow response on campaign/asset/budget suggestions | LLM/Google calls (SLA up to 60–120s) | Wait; don't retry prematurely |
| Incentives returns no offers | Currency not supported | Proceed without an incentive |
| `INVALID_ARGUMENT` on text/image assets | `landingPageUrl`/`languageCode` missing | Provide the required fields |
| Internal / `GOOGLE_ADS_API_ERROR` on `geo-options` | Whole-country query failing internally | Retry with `countryCode`; if it persists, query a specific city instead |

## References

- [Suggestions Service introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/introduction)
- [Get Campaign Suggestions](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-campaign-suggestions)
- [Get Geo Options](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-geo-options)
- [Get Incentives](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-incentives)
