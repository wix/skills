---
name: "Get AI Campaign Suggestions for Google Ads"
description: "Reference for the Google Ads Suggestions API on a Wix site: AI/Google-generated inputs that help build effective campaigns — keyword themes (from a URL or autocomplete), geo-target options, low/recommended/high daily-budget tiers with estimated clicks, PMAX budget recommendations, text assets (headlines/descriptions), AI image assets (auto-uploaded to Wix Media), search themes, promotional incentive offers, and complete AI-generated campaign configurations from a campaign brief. Use when the user asks 'suggest keywords for my ads', 'what budget should I use', 'where should I target', 'generate ad copy/headlines', 'generate ad images', 'suggest a whole campaign', or when a create-campaign flow needs suggested values. REST base https://www.wixapis.com/google-ads/v1."
---
# RECIPE: Get AI Campaign Suggestions for Google Ads

The Suggestions API produces the values that make a campaign effective — keywords, locations, budgets, and creative assets — either from Google directly or from Wix's AI. It's the input layer for the create-campaign recipes; this file is the standalone reference for each endpoint and for the two that don't appear there (full campaign suggestions from a brief, and incentive offers).

Base URL: `https://www.wixapis.com/google-ads/v1`. `<AUTH>` is the `Authorization` header; body calls also need `Content-Type: application/json`. All suggestion endpoints are **read-only** — none create or spend anything, so run them freely.

> **Two conventions to carry into every answer (this is where they trip people up):**
> - **Budgets come back in micros.** Every `dailyBudget` / `budgetAmountMicros` / `recommendedBudgetAmountMicros` is in micros, where `1,000,000` micros = 1 unit of the account's currency (so `15000000` = $15.00/day). Always convert to currency units when presenting to a user, and pass micros back when creating a campaign.
> - **Geo suggestions return an `id`, not a usable target.** `geo-options` returns each location's `id` (e.g. `"1023191"`). To target it in a campaign you must wrap it as `geoTargetConstants/{id}` (e.g. `"geoTargetConstants/1023191"`) in `locations[].location.geoTargetConstant`. The raw `id` alone is not accepted.

**Which suggestion do you need?**

| Goal | Endpoint | Used by |
| --- | --- | --- |
| Keyword themes for a Smart campaign | `keyword-theme-suggestions` / `keyword-theme-options` | Smart campaigns |
| Geo targets | `geo-options` | Smart & PMAX |
| Daily budget tiers (Smart) | `budget-suggestions` | Smart campaigns |
| Budget recommendation (PMAX) | `budget-recommendation` | [PMAX](create-performance-max-campaign.md) |
| Headlines & descriptions (PMAX) | `text-asset-suggestions` | [PMAX](create-performance-max-campaign.md) |
| AI images (PMAX) | `image-asset-suggestions` | [PMAX](create-performance-max-campaign.md) |
| Search themes (PMAX Leads) | `search-theme-suggestions` | [PMAX](create-performance-max-campaign.md) |
| A full AI campaign config from a brief | `campaign-suggestions` | this recipe |
| Promotional credit offers | `incentives` | [account setup](install-and-create-account.md) |

For the campaign-building endpoints (keyword themes, geo, Smart budget, PMAX text/image/search-theme assets, PMAX budget recommendation), see the Quick Reference below — and the [Performance Max recipe](create-performance-max-campaign.md) for the PMAX asset/budget calls in context. Below are the two endpoints unique to this reference.

---

## Full AI campaign suggestions (from a campaign brief)

Generates one or more complete, ready-to-use campaign configurations — assets, keywords, and geo targets bundled into a `campaign` object you can pass almost directly to Create Campaign. Smart suggestions come from a previously created **campaign brief**; PMAX Leads suggestions come from the site's marketing settings and pages. Uses an LLM — responses can take up to **120 seconds**.

- `campaignBriefId` — required for `SMART` (the brief id you created earlier). PMAX Leads doesn't need one.
- `amount` — how many suggestions to generate (max 3).
- `campaignType` — `SMART` (default) or `PERFORMANCE_MAX_LEADS`.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaign-suggestions' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "campaignBriefId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890", "amount": 1, "campaignType": "SMART" }'
```

```json
{ "campaignSuggestions": [ {
  "campaignMessaging": "Reach local customers searching for fresh-baked goods",
  "campaign": {
    "name": "Sunrise Bakery – Smart Campaign",
    "campaignType": "SMART",
    "budget": { "amountMicros": "15000000" },
    "smartCampaign": {
      "businessName": "Sunrise Bakery",
      "url": "https://www.example.com",
      "languageCode": "en",
      "adGroups": [ { "ads": [ {
        "headlines": ["Fresh Baked Daily", "Order Custom Cakes"],
        "descriptions": ["Award-winning pastries made fresh every morning.", "Custom cakes for every occasion."]
      } ] } ]
    }
  }
} ] }
```

Present `campaignMessaging` and the config to the user, then use the `campaign` object as the basis for creating the campaign (add `accountId`, `status`, `budget`, and `locations` before Create). `costInMicrocents` in the response is the AI cost — absorbed by Wix, not charged to the caller. Errors: `MISSING_CAMPAIGN_BRIEF_ID` (Smart without a brief), `MAX_CAMPAIGNS_TO_SUGGEST_EXCEEDED` (`amount` > 3).

---

## Promotional incentive offers

Credit offers for **new** accounts, granted after a spend threshold. Only supported currencies return offers. This drives the optional incentive step of [account setup](install-and-create-account.md).

```bash
curl -X GET 'https://www.wixapis.com/google-ads/v1/incentives?currency=USD' -H 'Authorization: <AUTH>'
```

Returns `lowOffer` / `mediumOffer` / `highOffer`, each with `incentiveId`, `awardAmount`, and `requiredAmount`, plus a `consolidatedTermsAndConditionsUrl`. Pass the chosen `incentiveId` as `selectedIncentiveId` when creating the account.

---

## Quick reference — the create-flow suggestion endpoints

- **Keyword themes:** `POST /v1/keyword-theme-suggestions` with `{ suggestionInfo: { liveSiteUrl, languageCode, businessName? } }` → themes with `displayName`. Autocomplete: `GET /v1/keyword-theme-options?queryText=&languageCode=&countryCode=`.
- **Geo targets:** `GET /v1/geo-options?queryLocation=&languageCode=&countryCode=` → geo targets with `id` (→ `geoTargetConstants/{id}`). May include restricted countries (rejected at create).
- **Smart budget tiers:** `POST /v1/budget-suggestions` with `{ suggestionInfo: { liveSiteUrl, languageCode } }` → `low`/`recommended`/`high` with `dailyBudget` (micros) and estimated clicks.
- **PMAX budget:** `POST /v1/budget-recommendation` with `{ campaignType, assetGroupInfo:[{finalUrl,...}], currency, ... }` → `recommendedBudgetAmountMicros` + `budgetOptions`.
- **Text assets:** `POST /v1/text-asset-suggestions` (`suggestionInfo.landingPageUrl` + `textSuggestionInfo.languageCode` required).
- **Image assets:** `POST /v1/image-asset-suggestions` (`suggestionInfo.landingPageUrl` required; images auto-uploaded to Wix Media).
- **Search themes:** `POST /v1/search-theme-suggestions` (`textSuggestionInfo.languageCode` required).

## Error handling

| Symptom | Cause | Fix |
| --- | --- | --- |
| `INVALID_ARGUMENT` / `MISSING_CAMPAIGN_BRIEF_ID` | `SMART` campaign-suggestions without a brief | Create a campaign brief first, or request `PERFORMANCE_MAX_LEADS` |
| `INVALID_ARGUMENT` / `MAX_CAMPAIGNS_TO_SUGGEST_EXCEEDED` | `amount` > 3 | Request at most 3 |
| Slow response on campaign/asset/budget suggestions | LLM/Google calls (SLA up to 60–120s) | Wait; don't retry prematurely |
| Incentives returns no offers | Currency not supported | Proceed without an incentive |
| `INVALID_ARGUMENT` on text/image assets | `landingPageUrl`/`languageCode` missing | Provide the required fields |

## References

- [Suggestions Service introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/introduction)
- [Get Campaign Suggestions](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-campaign-suggestions)
- [Get Keyword Theme Suggestions](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-keyword-theme-suggestions)
- [Get Geo Options](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-geo-options)
- [Get Budget Suggestions](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-budget-suggestions)
- [Get Incentives](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-incentives)
