---
name: "Create and Launch a Performance Max Campaign"
description: "Creates and launches a Google Ads Performance Max (PMAX) campaign for a Wix site — a goal-based campaign that runs across all Google channels (Search, Display, YouTube, Gmail, Discover, Maps) from an asset group of headlines, descriptions, images, and (for PMAX Leads) search-theme signals. Covers generating AI text and image assets (headlines, descriptions, marketing images, logo), generating search themes, resolving target locations to geoTargetConstants via geo-options, getting a Google budget recommendation, assembling the asset group with the required minimum assets, choosing PERFORMANCE_MAX vs PERFORMANCE_MAX_LEADS (leads: phone/form goals, negative keywords, 28-day learning) vs retail/Shopping (Merchant Center feed), creating in PAUSED, and launching. Use for 'create a Performance Max campaign', 'PMAX', 'run ads across all of Google', 'lead-gen Google campaign', or 'Google Shopping ads'. Requires an existing Google Ads account. REST base https://www.wixapis.com/google-ads/v1."
---
# RECIPE: Create and Launch a Performance Max Campaign

A **Performance Max (PMAX)** campaign runs across every Google channel from a single **asset group** — a bundle of headlines, descriptions, images, and (optionally) videos that Google mixes into ads. There are three flavors, set by `campaignType`:

- **`PERFORMANCE_MAX`** — general multi-channel campaign.
- **`PERFORMANCE_MAX_LEADS`** — lead-gen variant (phone/form conversions, search-theme signals, negative keywords, a ~28-day learning phase). **Requires** at least one asset group with headlines, descriptions, and images; assets are validated synchronously, so bad assets fail the create call immediately.
- **Retail / Shopping** — a `PERFORMANCE_MAX` campaign linked to a Google Merchant Center feed (set `merchantCenterAccountId` on the account first — see [install-and-create-account](install-and-create-account.md) — and use `feedLabel`). Retail campaigns don't require a hand-built asset group.

Base URL: `https://www.wixapis.com/google-ads/v1`. `<AUTH>` is the `Authorization` header; body calls also need `Content-Type: application/json`. The bidding strategy is server-enforced to `MAXIMIZE_CONVERSIONS` — never set it yourself.

> **Launching spends real money.** Present the assembled asset group and budget and get explicit approval before the Launch call (STEP 6). Create in `PAUSED` first — nothing serves until Launch.

**Prerequisite:** a Google Ads account (`ACCOUNT_NOT_FOUND` → run [install-and-create-account](install-and-create-account.md)). You need `account.id` as `campaign.accountId`.

**Flow:** STEP 1 text assets → STEP 2 image assets (incl. logo) → STEP 3 (leads) search themes → STEP 4 resolve target locations → STEP 5 budget recommendation → **pre-flight gate** → assemble & create PAUSED → **show & approve** → STEP 6 launch.

> **Gather every input *before* the create call — never build the campaign optimistically and let Create fail.** The generation/suggestion endpoints (images, geo lookup) can fail independently and Create validates PMAX Leads assets and locations synchronously, so one missing image or an unresolved location makes the whole billable-path create call fail. Generate and **verify** all assets (STEP 2) and resolve **every** location to a real `geoTargetConstant` (STEP 4) first; the pre-flight gate below is the checkpoint that all of them succeeded before you assemble anything.

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

## STEP 2: Generate image assets (do this *before* creating — it's the asset gate)

PMAX Leads **requires** at least one landscape marketing image, one square marketing image, and one square logo (see the asset table below). These are generated with AI here, so **generate them up front and confirm they came back** — never start the create call assuming the images exist. Images are **automatically uploaded to the site's Wix Media Manager**, so the returned `url` is a `static.wixstatic.com` link you can drop straight into the asset group. `suggestionInfo.landingPageUrl` is required. Request all three required types (including `LOGO`) in one call:

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/image-asset-suggestions' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "suggestionInfo": { "landingPageUrl": "https://www.example.com", "assetTypes": ["MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE", "LOGO"] } }'
```

```json
{ "assetSuggestions": [
  { "assetType": "MARKETING_IMAGE", "imageAsset": { "name": "storefront-banner", "url": "https://static.wixstatic.com/media/abc123.jpg" } },
  { "assetType": "SQUARE_MARKETING_IMAGE", "imageAsset": { "name": "product-square", "url": "https://static.wixstatic.com/media/def456.jpg" } },
  { "assetType": "LOGO", "imageAsset": { "name": "brand-logo", "url": "https://static.wixstatic.com/media/ghi789.jpg" } }
] }
```

**Verify the response before moving on.** Confirm you got a `static.wixstatic.com` `url` for **each** required `assetType` (`MARKETING_IMAGE`, `SQUARE_MARKETING_IMAGE`, `LOGO`). If generation returns an error or is missing a type:

- **Retry once** — generation is AI-backed and can fail transiently.
- If it still fails, **do not attempt the create call** (it would fail with `NOT_ENOUGH_ASSETS`). Ask the user to upload the missing images (at least 1 landscape marketing image, 1 square image, 1 square logo) via the [Media Manager](../media/upload-media-to-wix.md) and use those `static.wixstatic.com` URLs instead.

Only proceed once every required image type has a usable URL.

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

## STEP 4: Resolve target locations (geo-options)

`campaign.locations[]` needs a real `geoTargetConstants/{id}` for every place you target — **you cannot guess or hardcode these ids**. Whenever the user names a location ("Israel", "Tel Aviv", "New York"), call the Suggestions **geo-options** endpoint to resolve the name into Google's geo-target id, then wrap it as `geoTargetConstants/{id}`.

```bash
curl -X GET 'https://www.wixapis.com/google-ads/v1/geo-options?queryLocation=Tel%20Aviv&languageCode=en&countryCode=IL' \
  -H 'Authorization: <AUTH>'
```

```json
{ "googleSuggestion": { "geoTargetsSuggestions": { "geoTargets": [
  { "id": "1007754", "displayName": "Tel Aviv-Yafo, Tel Aviv, Israel", "countryCode": "IL" }
] } } }
```

Take the matching `geoTargets[].id`, wrap it as `geoTargetConstants/{id}`, and use the `displayName` for the `locations[].displayName` field:

```json
"locations": [
  { "location": { "geoTargetConstant": "geoTargetConstants/1007754" }, "displayName": "Tel Aviv-Yafo, Tel Aviv, Israel" }
]
```

**If the geo lookup fails or returns no match** (a whole-country query like `queryLocation=Israel` can return a Google Ads internal error / `GOOGLE_ADS_API_ERROR`):

- **Retry once**, passing `countryCode` (ISO 3166-1 alpha-2, e.g. `IL`) to bias the search.
- If a **country-level** query keeps failing, ask the user to name a **specific city** in that country (e.g. Tel Aviv / Jerusalem / Haifa) and resolve that instead — a city query almost always succeeds where the bare country fails.
- **Never fall back to a hardcoded or guessed id, and never skip resolution and pass a raw name** — an unresolved location makes the create call fail. If no location resolves, stop and ask the user rather than creating with a bad target.

Do this for **every** location the user asked for before assembling the campaign.

## STEP 5: Get a budget recommendation

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

## Pre-flight gate — confirm every input resolved before you assemble

Do not build the request body until all of these are true. If any is missing, fix that step first (or ask the user) — assembling with a gap just produces a create call that fails on the billable path:

- [ ] **Text assets** — enough headlines/descriptions for the minimums (STEP 1).
- [ ] **Images** — a usable `static.wixstatic.com` URL for **each** required type: `MARKETING_IMAGE`, `SQUARE_MARKETING_IMAGE`, `LOGO` (STEP 2).
- [ ] **Search themes** (PMAX Leads only) — at least one (STEP 3).
- [ ] **Locations** — **every** targeted place resolved to a `geoTargetConstants/{id}` via geo-options (STEP 4). No raw names, no guessed ids.
- [ ] **Budget** — a `budget.amountMicros` value (STEP 5 recommendation or a manual amount within the daily-budget boundaries).

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
            { "imageAsset": { "name": "brand-logo",        "url": "https://static.wixstatic.com/media/ghi789.jpg" }, "assetFieldType": "LOGO" },
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

## STEP 6: Launch the campaign

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
| `INVALID_ARGUMENT` / `NOT_ENOUGH_ASSETS` | Asset group below minimums (often a missing generated image/logo) | Meet the per-type counts; regenerate via STEP 2 or have the user upload the missing image/logo — don't create until all are present |
| image-asset-suggestions errors or omits a required type | AI image/logo generation failed | Retry once; if still failing, have the user upload a landscape image, square image, and square logo (STEP 2) before creating |
| `GOOGLE_ADS_API_ERROR` / internal error on **geo-options** | Whole-country geo lookup (e.g. "Israel") can fail internally | Retry with `countryCode`; if a country query keeps failing, resolve a **specific city** (e.g. Tel Aviv / Jerusalem / Haifa) instead (STEP 4) |
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
- [Get Geo Options](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-geo-options)
- [Generate Budget Recommendation](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/generate-budget-recommendation)
