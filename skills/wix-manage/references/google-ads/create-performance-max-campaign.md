---
name: "Create and Launch a Performance Max Campaign"
description: "Creates and launches a Google Ads Performance Max (PMAX) campaign for a Wix site — a goal-based campaign that runs across all Google channels (Search, Display, YouTube, Gmail, Discover, Maps) from an asset group of headlines, descriptions, images, and (for PMAX Leads) search-theme signals. Covers generating AI text and image assets, generating search themes, getting a Google budget recommendation, assembling the asset group with the required minimum assets, choosing PERFORMANCE_MAX vs PERFORMANCE_MAX_LEADS (leads: phone/form goals, negative keywords, 28-day learning) vs retail/Shopping (Merchant Center feed), creating in PAUSED, and launching. Use for 'create a Performance Max campaign', 'PMAX', 'run ads across all of Google', 'lead-gen Google campaign', or 'Google Shopping ads'. Requires an existing Google Ads account. REST base https://www.wixapis.com/google-ads/v1."
---
# RECIPE: Create and Launch a Performance Max Campaign

A **Performance Max (PMAX)** campaign runs across every Google channel from a single **asset group** — a bundle of headlines, descriptions, images, and (optionally) videos that Google mixes into ads. There are three flavors, set by `campaignType`:

- **`PERFORMANCE_MAX`** — general multi-channel campaign.
- **`PERFORMANCE_MAX_LEADS`** — lead-gen variant (phone/form conversions, search-theme signals, negative keywords, a ~28-day learning phase). **Requires** at least one asset group with headlines, descriptions, and images; assets are validated synchronously, so bad assets fail the create call immediately.
- **Retail / Shopping** — a `PERFORMANCE_MAX` campaign linked to a Google Merchant Center feed (set `merchantCenterAccountId` on the account first — see [install-and-create-account](install-and-create-account.md) — and use `feedLabel`). Retail campaigns don't require a hand-built asset group.

Base URL: `https://www.wixapis.com/google-ads/v1`. `<AUTH>` is the `Authorization` header; body calls also need `Content-Type: application/json`. The bidding strategy is server-enforced to `MAXIMIZE_CONVERSIONS` — never set it yourself.

> **Launching spends real money.** Present the assembled asset group and budget and get explicit approval before the Launch call (STEP 5). Create in `PAUSED` first — nothing serves until Launch.

**Prerequisite:** a Google Ads account (`ACCOUNT_NOT_FOUND` → run [install-and-create-account](install-and-create-account.md)). You need `account.id` as `campaign.accountId`.

**Flow:** STEP 1 text assets → STEP 2 image assets → STEP 3 (leads) search themes → STEP 4 budget recommendation → assemble & create PAUSED → **show & approve** → STEP 5 launch.

---

## STEP 1: Generate text assets (headlines & descriptions)

`suggestionInfo.landingPageUrl` and `textSuggestionInfo.languageCode` are both required. Response may take up to 60s.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/text-asset-suggestions' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{
    "suggestionInfo": { "landingPageUrl": "https://www.example.com", "assetTypes": ["HEADLINE", "DESCRIPTION"] },
    "textSuggestionInfo": { "languageCode": "en" }
  }'
```

```json
{ "assetSuggestions": [
  { "assetType": "HEADLINE", "headlineAsset": { "text": "Fresh Baked Every Morning" } },
  { "assetType": "HEADLINE", "headlineAsset": { "text": "Award-Winning Pastries" } },
  { "assetType": "DESCRIPTION", "descriptionAsset": { "text": "Visit us for artisan breads, custom cakes, and more." } }
] }
```

## STEP 2: Generate image assets

Images are generated with AI and **automatically uploaded to the site's Wix Media Manager** — the returned `url` is a `static.wixstatic.com` link you can use directly in the asset group. `suggestionInfo.landingPageUrl` is required.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/image-asset-suggestions' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "suggestionInfo": { "landingPageUrl": "https://www.example.com", "assetTypes": ["MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE"] } }'
```

```json
{ "assetSuggestions": [
  { "assetType": "MARKETING_IMAGE", "imageAsset": { "name": "storefront-banner", "url": "https://static.wixstatic.com/media/abc123.jpg" } },
  { "assetType": "SQUARE_MARKETING_IMAGE", "imageAsset": { "name": "product-square", "url": "https://static.wixstatic.com/media/def456.jpg" } }
] }
```

## STEP 3 (PMAX Leads only): Generate search themes

Search themes are the targeting signals for a leads campaign's asset group. `textSuggestionInfo.languageCode` is required.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/search-theme-suggestions' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "landingPageUrl": "https://www.example.com", "textSuggestionInfo": { "languageCode": "en" } }'
```

```json
{ "searchThemes": ["artisan bakery", "custom birthday cakes", "fresh bread delivery", "gluten free pastries", "wedding cake shop"] }
```

Each string becomes a `{ "searchTheme": { "text": "…" } }` signal in the asset group (max 25).

## STEP 4: Get a budget recommendation

PMAX uses **Generate Budget Recommendation** (not the Smart-campaign budget-suggestions endpoint). `campaignType`, `assetGroupInfo` (with a `finalUrl`), and `currency` are required.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/budget-recommendation' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{
    "campaignType": "PERFORMANCE_MAX",
    "assetGroupInfo": [ {
      "finalUrl": "https://www.example.com",
      "headlines": ["Fresh Baked Every Morning", "Award-Winning Pastries"],
      "descriptions": ["Artisan breads and custom cakes baked fresh daily."]
    } ],
    "currency": "USD",
    "countryCodes": ["US"],
    "languageCodes": ["en"]
  }'
```

```json
{ "budgetRecommendation": {
  "recommendedBudgetAmountMicros": "15000000",
  "budgetOptions": [
    { "budgetAmountMicros": "8000000",  "impact": { "potentialMetrics": { "impressions": 1200, "clicks": 35, "conversions": 2 } } },
    { "budgetAmountMicros": "15000000", "impact": { "potentialMetrics": { "impressions": 2800, "clicks": 78, "conversions": 5 } } }
  ]
} }
```

Use `recommendedBudgetAmountMicros` as `budget.amountMicros`, or present the `budgetOptions` with their projected impact and let the user pick. `budgetRecommendation` is absent when Google has too little data — fall back to a manual budget within `GET /v1/campaign/daily-budget-boundaries`.

---

## Assemble & create the campaign (in PAUSED)

An **asset group** lives at `performanceMaxCampaign.assetGroups[]`. Its creative assets go under `assetGroupAssets.assets[]` — each asset sets **exactly one** payload field plus its `assetFieldType`. For a PMAX Leads asset group, meet Google's minimums or the create call fails with `NOT_ENOUGH_ASSETS`:

| Asset | Payload field | `assetFieldType` | Count | Max chars |
| --- | --- | --- | --- | --- |
| Short headline | `headlineAsset.text` | `HEADLINE` | 3–15 | 30 |
| Long headline | `longHeadlineAsset.text` | `LONG_HEADLINE` | exactly 1 | 90 |
| Description | `descriptionAsset.text` | `DESCRIPTION` | 2–4 | 90 |
| Business name | `businessNameAsset.text` | `BUSINESS_NAME` | exactly 1 | 25 |
| Landscape image (1.91:1) | `imageAsset.{name,url}` | `MARKETING_IMAGE` | ≥1 | — |
| Square image (1:1) | `imageAsset.{name,url}` | `SQUARE_MARKETING_IMAGE` | ≥1 | — |
| Logo (1:1) | `imageAsset.{name,url}` | `LOGO` | ≥1 | — |
| CTA button | `callToActionSelectionAsset.callToAction` | `CALL_TO_ACTION_SELECTION` | optional | `LEARN_MORE` \| `SHOP_NOW` \| `SIGN_UP` \| `CONTACT_US` |
| YouTube video | `youtubeVideoAsset.{title,id}` | `YOUTUBE_VIDEO` | optional (1–5) | 11-char video id |

Image `url` must be a Wix Media Manager URL (`static.wixstatic.com`) — the STEP 2 generated images already are; for other images, upload via the Media Manager first (see [Upload Media to Wix](../media/upload-media-to-wix.md)). Search themes go under `assetGroupSignals.signals[]` (PMAX Leads).

**Create a PMAX Leads campaign** (status required; create `PAUSED`):

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaigns' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{
    "campaign": {
      "accountId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "campaignType": "PERFORMANCE_MAX_LEADS",
      "status": "PAUSED",
      "name": "Summer Lead-Gen PMAX",
      "budget": { "amountMicros": "15000000" },
      "locations": [
        { "location": { "geoTargetConstant": "geoTargetConstants/1023191" }, "displayName": "New York, United States" }
      ],
      "performanceMaxCampaign": {
        "url": "https://www.example.com",
        "languages": [ { "languageCode": "en" } ],
        "assetGroups": [ {
          "assetGroupAssets": { "assets": [
            { "headlineAsset":     { "text": "Fresh Baked Every Morning" }, "assetFieldType": "HEADLINE" },
            { "headlineAsset":     { "text": "Award-Winning Pastries" },    "assetFieldType": "HEADLINE" },
            { "headlineAsset":     { "text": "Order Custom Cakes Today" },  "assetFieldType": "HEADLINE" },
            { "longHeadlineAsset": { "text": "Artisan breads and custom cakes baked fresh every morning" }, "assetFieldType": "LONG_HEADLINE" },
            { "descriptionAsset":  { "text": "Award-winning pastries made fresh daily." }, "assetFieldType": "DESCRIPTION" },
            { "descriptionAsset":  { "text": "Custom cakes for every occasion. Order online." }, "assetFieldType": "DESCRIPTION" },
            { "businessNameAsset": { "text": "Sunrise Bakery" }, "assetFieldType": "BUSINESS_NAME" },
            { "imageAsset": { "name": "storefront-banner", "url": "https://static.wixstatic.com/media/abc123.jpg" }, "assetFieldType": "MARKETING_IMAGE" },
            { "imageAsset": { "name": "product-square",    "url": "https://static.wixstatic.com/media/def456.jpg" }, "assetFieldType": "SQUARE_MARKETING_IMAGE" },
            { "callToActionSelectionAsset": { "callToAction": "SHOP_NOW" }, "assetFieldType": "CALL_TO_ACTION_SELECTION" }
          ] },
          "assetGroupSignals": { "signals": [
            { "searchTheme": { "text": "artisan bakery" } },
            { "searchTheme": { "text": "custom birthday cakes" } }
          ] }
        } ]
      }
    }
  }'
```

For a **general `PERFORMANCE_MAX`** campaign, use `campaignType: "PERFORMANCE_MAX"` (the `assetGroupSignals` are Leads-only). For **retail/Shopping**, link a Merchant Center account on the account first and set `performanceMaxCampaign.feedLabel`; a retail campaign can serve from the product feed without a hand-built asset group.

Save the returned `campaign.id` and `resourceName`. `status` is read-only and syncs from Google — a PMAX Leads campaign shows `LEARNING` for ~28 days after launch.

**Now show the user the asset group** (headlines, descriptions, images) and the daily budget, and get explicit approval.

---

## STEP 5: Launch the campaign

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/campaigns/{campaignId}/launch' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' -d '{}'
```

Returns the campaign with an updated `status`. Ads begin serving across Google channels; see [Query Campaign Performance Analytics](query-campaign-analytics.md) — PMAX Leads supports per-asset metrics.

---

## Error handling

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ACCOUNT_NOT_FOUND` | No Google Ads account | Run [install-and-create-account](install-and-create-account.md) |
| `INVALID_ARGUMENT` / `NOT_ENOUGH_ASSETS` | Asset group below minimums | Add assets to meet the per-type counts in the table |
| `INVALID_ARGUMENT` / `INVALID_ASSET_GROUP_ASSETS` | An asset is malformed or violates Google requirements | Fix the offending asset (length, type, url) |
| `INVALID_ARGUMENT` / `INVALID_IMAGE_FORMAT` | Image format/dimensions unsupported | Use a supported ratio/size; regenerate via image-asset-suggestions |
| `INVALID_ARGUMENT` / `DUPLICATE_IMAGE_ASSETS` / `DUPLICATE_ASSET` | Same asset provided twice | Deduplicate the asset group |
| `INVALID_ARGUMENT` / `SEARCH_THEME_POLICY_VIOLATION` / `POLICY_VIOLATION` | A signal/asset violates Google policy | Remove or rewrite the flagged item |
| `INVALID_ARGUMENT` / `RESTRICTED_LOCATION` | Targeted geo is restricted | Remove it; pick a specific allowed place |
| `INVALID_ARGUMENT` / `CAMPAIGN_DAILY_BUDGET_TOO_HIGH` | Budget over the account max | Lower it within `daily-budget-boundaries` |
| `FAILED_PRECONDITION` / `MAXIMUM_NUMBER_OF_CAMPAIGNS_REACHED` | 5 live campaigns already | Pause one before launching |
| `INVALID_ARGUMENT` / `GOOGLE_ADS_API_ERROR` | Unexpected Google Ads rejection | Surface the message; verify and retry |

## References

- [Campaign Service introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/introduction)
- [Create Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/create-campaign)
- [Launch Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/launch-campaign)
- [Get Text Asset Suggestions](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-text-asset-suggestions)
- [Get Image Asset Suggestions](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-image-asset-suggestions)
- [Get Search Theme Suggestions](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-search-theme-suggestions)
- [Generate Budget Recommendation](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/generate-budget-recommendation)
