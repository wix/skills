---
name: "Optimize a Google Ads Campaign"
description: "Optimizes an existing Google Ads campaign on a Wix site: resolves the campaign, picks the right source for its type and age (Campaign Success Guide, Google Ads recommendations, performance analytics, or a lever-based Smart-campaign diagnosis), presents a prioritized plan, and performs approved changes through Update Campaign: assets, search themes, excluded search terms, keyword themes, ad copy, locations, landing page, daily budget, final-URL expansion. Also marks or reopens success guide suggestions. Use for 'optimize my campaign', 'how can I improve it', 'what should I fix', 'not getting leads', 'more leads', 'lower cost per lead', 'what does Google recommend', 'show the success guide', 'mark it done'. REST bases https://www.wixapis.com/_serverless/pa-google/v1 and https://www.wixapis.com/pa-platform/suggestions/v1."
---
# RECIPE: Optimize a Google Ads Campaign

Improve one **existing** campaign at a time: diagnose, propose a short plan, perform the changes the user approves. Pre-campaign inputs belong to [Get AI Campaign Suggestions](get-campaign-suggestions.md); plain reporting to [Query Campaign Performance Analytics](query-campaign-analytics.md).

Base URL `https://www.wixapis.com/_serverless/pa-google` unless shown in full; the paths below include their version. `<AUTH>` is the `Authorization` header; body calls also need `Content-Type: application/json`. Amounts are in micros (1,000,000 = 1 unit of the account currency, read from `GET /v1/accounts/current-site`).

## Order of operations

1. **Data in the conversation wins.** Facts the user states and data already present (campaign details, how long it has run, metrics, recommendations, a guide) are used as given; never re-derive, dispute or refetch them. When the user pasted the campaign or the recommendations, skip resolution and make **no API call** before presenting the plan; a pasted campaign may not even exist on the current site, so do not look it up.
2. **Check the type first.** `campaignType: "SMART"` → the first thing you say is the Performance Max Leads offer (see Smart campaigns); no diagnosis and no call before it, unless the user already declined.
3. Otherwise resolve the campaign, pick the path for its type and age, and build the plan only from items a source raised in this run.
4. **Nothing changes until approval.** Approval means the user has seen the specific before/after changes and said yes; "optimize my campaign" or "what should we change" is a request for the plan, not approval. The only read before a write is the re-read of the campaign with `GET /v1/campaigns/{id}` right before an approved update, because the update sends the whole entity. For a pasted campaign that re-read is the first call you make; if it returns `CAMPAIGN_NOT_FOUND`, the campaign is not on the current site: ask the user which site or campaign to apply the change to, and apply nothing until a re-read succeeds.

## Resolve the campaign

Calls run on the current site from the call context; ask which site only when none is selected, and never list sites to hunt for a campaign.

1. Campaign pasted by the user → use it as is, without fetching it. Campaign ID known → use it.
2. Otherwise `GET /v1/campaigns` **once**; never call it again for a smaller response. It returns full campaign objects, every asset, signal and setting included, and takes no parameter for fewer fields, so in the code that makes the call, map each campaign to the fields this recipe reads before returning it: `id`, `name`, `campaignType`, `status`, `resourceName`, `createdDate`, `actionDate`, `budget.amountMicros`, and, on Performance Max campaigns only, `performanceMaxCampaign.url` and `.languages` (read for search themes).
3. Ignore `DRAFT` campaigns (nothing serves yet). One non-draft campaign left → proceed; several → list them one line each and ask. Mention a draft in one line; if the user explicitly wants to improve a draft, offer to add assets when there are few and to add search themes, otherwise point to launching it ([Manage Campaign Lifecycle](manage-campaign-lifecycle.md)).

**Days running** = days since `actionDate` (last launch or resume), else since `createdDate`. A statement from the user about the campaign's age ("just created", "still learning", "running for a month") overrides the dates: use it, do not recompute or dispute it.

## Pick the path

Status other than `LIVE` or `LEARNING`: name the blocking action first, then continue with the row for the campaign's type. `PAUSED` → resume first ([Manage Campaign Lifecycle](manage-campaign-lifecycle.md)); `IN_REVIEW` → wait for review; `DISAPPROVED` → fix the policy issue; `NOT_SERVING` → [billing](billing-and-payment.md); `ENDED`/`ERROR` → stop here and offer a new campaign.

| Campaign | Sources |
| --- | --- |
| `PERFORMANCE_MAX_LEADS`, under 14 days (or the user says it is new or still learning) | **Success guide only**; no recommendations or analytics calls. Say performance-based advice starts after about two weeks. Discourage edits during learning except adding search themes (which the guide itself raises); if the user insists, warn that an edit resets Google's learning, then proceed |
| `PERFORMANCE_MAX_LEADS`, 14 days or more | **Recommendations + analytics.** Do not retrieve the guide for advice (reading it to mark or reopen an item is still fine). While `status` is `LEARNING` (about 28 days), say the data is usable but early |
| `PERFORMANCE_MAX` (retail) | Recommendations + analytics, always with shopping performance (`POST /v1/shopping-performance-metrics`) |
| `SMART` | Offer the Performance Max Leads upgrade first (below); if declined, run the Smart path |

## Campaign success guide (Performance Max Leads, first 14 days)

The guide scans the landing page, the campaign configuration and the site's Google connections; it never uses metrics, so `LEARNING` and empty analytics do not block it. A request to improve the campaign or see the guide is approval to retrieve it. `platformType` is always `GOOGLE`.

```bash
curl -X POST 'https://www.wixapis.com/pa-platform/suggestions/v1/campaign-success-guides/get-or-create' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "campaignId": "7d4a9c2e-86f1-4b37-a2d5-9e18c6f043ab", "platformType": "GOOGLE" }'
```

Response: `{ "campaignSuccessGuide": { "id", "url" (landing page), "suggestions": [ { "id", "type", "status" } ] } }`. The first call can take **120 seconds**; wait, do not retry. Later calls return the saved guide at any campaign age, unless the landing page URL changed. `suggestions` is in priority order and lists only items that need attention; `OPEN` = pending, `COMPLETED` = the user marked it done (nothing was changed for them). Show `OPEN` items three at a time in API order, hide `COMPLETED` ones, and invite the next batch when more remain.

| Types | What to offer |
| --- | --- |
| `GOOGLE_ADS_SEARCH_THEMES` | Generate a set with `POST /v1/search-theme-suggestions` and `{ "landingPageUrl": "<performanceMaxCampaign.url>", "textSuggestionInfo": { "languageCode": "<performanceMaxCampaign.languages[0].languageCode>" } }` → `searchThemes[]`, each becoming `{ "searchTheme": { "text": "…" } }`; show it, apply the approved set with the update below. Link the Keywords Manager ([Google Ads Dashboard Navigation](google-ads-dashboard-navigation.md)) only if the user prefers the manual route |
| `CONVERSION_POINT` (no visible lead form or booking action), `HEADER_MATCH` (page heading does not match the ad headlines), `CONTACT_AND_CREDIBILITY` (no visible phone and email), `CLEAR_CTA_COPY`, `ABOVE_THE_FOLD_CTA`, `MINIMIZE_FORM_FIELDS` (over 4 fields), `TESTIMONIAL`, `SOCIAL_CHANNELS`, `GOOGLE_REVIEWS`, `FAQ_SECTION` | Landing-page content: describe the edit in one line, offer to draft copy after approval; the user applies it in the Editor |
| `GOOGLE_BUSINESS_PROFILE_CONNECTION` | Offer to start [Connect a Wix Site to Google Business Profile](../google-business-profile/connect-google-business-profile.md); the owner finishes Google's consent in the browser |
| `GOOGLE_MERCHANT_CENTER_CONNECTION` | Read `account.merchantCenterAccountId` from `GET /v1/accounts/current-site`; ask for the ID if absent; update the account per [Install Google Ads and Create an Account](install-and-create-account.md). The link starts `PENDING` |
| `MOBILE_OPTIMIZATION`, `SITE_SPEED` | Offer to inspect and name a concrete cause before promising anything; the user applies the site change |

**Editor link:** use `editUrl` from the site context; if absent, make one [Query Sites](../sites/query-sites.md) lookup filtered by `id.$in` with the current site ID; otherwise write **Go to the Editor** as plain text. One Editor link per answer, never guessed.

**Mark done or reopen:** retrieve the guide first (works at any age), confirm the `type` is present and read its current status, then update by `type`. A clear "I did X" is approval, no extra confirmation. The response wraps the updated guide; `"status": "OPEN"` reopens. Completion is self-reported: never say the page or campaign changed.

```bash
curl -X POST 'https://www.wixapis.com/pa-platform/suggestions/v1/campaign-success-guides/{campaignId}/update-suggestion-status' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "type": "CLEAR_CTA_COPY", "status": "COMPLETED" }'
```

## Google Ads recommendations (day 14 onward, and retail Performance Max)

```bash
curl -X GET 'https://www.wixapis.com/_serverless/pa-google/v1/recommendations?campaignId=0b6c8f3e-2a41-4d7e-9c1a-5f2e8d4b7a10' \
  -H 'Authorization: <AUTH>'
```

```json
{ "recommendations": [ { "type": "IMPROVE_PERFORMANCE_MAX_AD_STRENGTH", "campaignIds": ["0b6c8f3e-…"],
    "impact": { "baseMetrics": { … }, "potentialMetrics": { … } },
    "details": { "adStrength": "AVERAGE", "assetCoverage": { "adStrengthActionItems": [
      { "actionItemType": "ADD_ASSET", "addAssetDetails": { "assetFieldType": "MARKETING_IMAGE", "assetCount": 3 } } ] } } } ] }
```

Google generates these from the account's settings and recent performance and regenerates them on its own schedule, so an item can keep appearing after you act on it; say so. Only types the user can act on through Wix are returned. `details` is Google's payload for the type, read as is; `impact` is Google's forecast, not a promise (convert `costMicros` with the account currency). An empty list is a finding, not an error: fall through to the performance diagnosis.

| `type` | Act through |
| --- | --- |
| `CAMPAIGN_BUDGET`, `FORECASTING_CAMPAIGN_BUDGET`, `MARGINAL_ROI_CAMPAIGN_BUDGET` | Daily budget (update below), proposing the option from `details.budgetOptions` with its impact |
| `IMPROVE_PERFORMANCE_MAX_AD_STRENGTH` | Leads: add the field types and counts in `details.assetCoverage.adStrengthActionItems` (a Wix addition, already filtered to the text and image types the update accepts). Other Performance Max campaigns: describe it and offer no asset edit, the update ignores their assets |
| `PERFORMANCE_MAX_FINAL_URL_OPT_IN` | Set `performanceMaxCampaign.assetAutomationSettings` to `[{ "type": "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION", "status": "OPTED_IN" }]` |
| `CALL_ASSET` | Set `performanceMaxCampaign.phone` (`countryCode`, `phoneNumber`) |
| `SHOPPING_*` (disapproved products, Merchant Center suspension, missing GTIN, color, size…) | Not fixable through the Google Ads APIs: summarize `details` (merchant, product counts) and link the Stores products page ([Stores Dashboard Navigation](../stores/stores-dashboard-navigation.md)) and Google Merchant Center |
| `PERFORMANCE_MAX_OPT_IN` (account-level, empty `campaignIds`) | Create a Performance Max Leads campaign with [Create and Launch a Performance Max Campaign](create-performance-max-campaign.md) |

A type not listed here: describe it from Google's name and offer no action.

## Performance diagnosis (supporting)

Use the analytics calls that fit the question; do not invent thresholds. Bodies and enums are in [Query Campaign Performance Analytics](query-campaign-analytics.md). The minimal diagnosis is one `POST /v1/performance-metrics` call, keyed by `campaignResourceName` (the campaign's `resourceName`), with an explicit 30-day `dateRange.custom` (`from`/`to`, `YYYY-MM-DD`) and `includePreviousPeriod: true`; the previous-period comparison needs that finite range, an omitted range (campaign lifetime) fails. Add others only when the question needs them: `POST /v1/conversion-metrics` (leads, orders, cost per lead; `dateRange` is required), `POST /v2/search-term-metrics` (sort by `COST`: terms that spend without converting are exclusion candidates, judged for relevance to the business) and `POST /v1/asset-performance-metrics` (Leads only; `performanceLabel` is `LOW`, `GOOD` or `EXCELLENT` once an asset leaves `LEARNING`: a `LOW` asset is a replacement candidate) take `campaignId`. Summarize in two to four lines; every proposal cites the number behind it.

## Smart campaigns

Offer the upgrade first, before any diagnosis or API call, unless the user has already declined it; two sentences, never forced, ending with the question of which way to go. **Stop there**: the Smart plan below comes only after the user declines, never in the same message as the offer. The reasons: Performance Max Leads is Google's recommended path from Smart campaigns, and it serves across all Google surfaces (Search, Display, YouTube, Gmail, Discover, Maps) rather than Search alone. If accepted, follow [Create and Launch a Performance Max Campaign](create-performance-max-campaign.md), keep the Smart campaign running until the new one is launched, then offer to pause it (five live campaigns per site, and double spend otherwise). Google issues no recommendations for Smart campaigns, so if the user keeps theirs, diagnose with analytics. Exclude clearly irrelevant search terms that spend under any focus; then, when the user states no goal, pick the focus with these rules of thumb (what they asked for, such as "more leads" or "spending too much", wins):

- Under about 1,000 impressions in 30 days → **reach**: locations, keyword themes, daily budget.
- Otherwise CTR under about 1% → **clicks**: excluded search terms, ad copy, keyword themes.
- Otherwise → **conversions**: landing page, chosen from the site's published pages (a services page for leads, a shop or all-products page for sales).

## Make changes

Propose first, change only on approval (see Order of operations): present the plan → the user picks items → generate what is needed and show it → re-read the campaign → show **only what changes** (field, before, after; never the whole entity) → one explicit yes → one update → confirm from the response.

**Every update sends the whole campaign; never send a partial body.** `PATCH /v1/campaigns/{id}` takes the entire entity returned by Get Campaign with only the changed fields different; the fields to update are inferred, `updateMask` is ignored, and omitted fields may be cleared. To add a list item (asset, search theme, excluded term) append it without a `resourceName`; to remove one, omit it. Keep `id`, `accountId`, `campaignType`, `locations`, languages, `phone`, and every existing asset and signal you are not removing. The same rule governs every update in [Manage Campaign Lifecycle](manage-campaign-lifecycle.md); field-level examples: [Update Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/update-campaign).

```bash
curl -X PATCH 'https://www.wixapis.com/_serverless/pa-google/v1/campaigns/{campaignId}' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "campaign": { …the entire object returned by GET /v1/campaigns/{campaignId}…, "budget": { "amountMicros": "45000000" } } }'
```

The response is `{ "campaign": { … } }` with the saved state; confirm the change from it.

| Change | Field (type) | Rules |
| --- | --- | --- |
| Daily budget | `budget.amountMicros` (any) | Source, in order: Google's `budgetOptions`; `POST /v1/budget-recommendation` (Performance Max) or `POST /v1/budget-suggestions` (Smart), bodies in [Get AI Campaign Suggestions](get-campaign-suggestions.md#quick-reference--the-create-flow-suggestion-endpoints); last resort about 1.5× the current budget. Always within `GET /v1/campaign/daily-budget-boundaries` |
| Assets | `performanceMaxCampaign.assetGroups[0].assetGroupAssets.assets[]` (Leads only; retail asset edits are ignored) | **Ask whether to generate images or use Media Manager URLs the user supplies.** Generate with `POST /v1/text-asset-suggestions` and `POST /v1/image-asset-suggestions` (60 to 120 s; images are saved to the Media Manager). Per-asset shape and the count table (headlines 3–15, descriptions 2–5, images 1–20 per type, logos 1–5) are in [Create and Launch a Performance Max Campaign](create-performance-max-campaign.md#assemble--create-the-campaign-in-paused); the update also accepts `PORTRAIT_MARKETING_IMAGE` (4:5) and `LANDSCAPE_LOGO` (4:1), 0–20 each; max 120 assets, no duplicates. Offer removing `LOW`-labelled assets as a separate optional item, keeping the minimums |
| Search themes | `assetGroups[0].assetGroupSignals.signals[].searchTheme.text` (Leads) | Max 25 |
| Excluded search terms | `smartCampaign.excludedSearchTerms[]` (Smart); `performanceMaxCampaign.excludedKeywords[]` (Leads) | `{ "freeFormKeywordTheme": "…", "displayName": "…" }` appended to the existing list |
| Keyword themes, ad copy, landing page | `smartCampaign.keywordThemes[]` (max 10, same shape as excluded terms), `smartCampaign.adGroups[0].ads[0].headlines` (3, ≤30 chars) and `.descriptions` (2, ≤90), `smartCampaign.url` (Smart) | Landing page must be a published page of the site. For a Leads campaign, changing `performanceMaxCampaign.url` resets learning and the guide: warn, and change it only if the user insists |
| Locations | `locations[]` (any) | `geoTargetConstants/{id}` from `GET /v1/geo-options` |

## Present the plan

1. **What I found**: two to four lines with status, days running, and the 30-day numbers against the previous period when read.
2. **Do now**: never more than three items, each tagged with its source (Google, Success guide, Performance) and ending in one concrete step. Every item traces to something a source raised in this run; no generic advice such as landing-page tips nobody flagged. Further items wait for the next batch.
3. **I can do this for you**: one grouped offer of the changes you can perform after approval.
4. **Next actions**: each destination once (Editor, Keywords Manager, Stores, Merchant Center), as an absolute link when known.
5. One closing line when more items remain, inviting the next batch.
6. End with a question: which of these should I apply? (For a Smart campaign before the user has chosen, the question is whether to upgrade or keep the campaign.)

Plain Markdown, top to bottom; no tables or columns in the user-facing answer.

## Errors

| Error | Response |
| --- | --- |
| `ACCOUNT_NOT_FOUND`, `CAMPAIGN_NOT_FOUND`, `CAMPAIGN_DAILY_BUDGET_TOO_HIGH`, `MAXIMUM_NUMBER_OF_CAMPAIGNS_REACHED` | As in [Manage Campaign Lifecycle](manage-campaign-lifecycle.md); never probe other sites to recover. On the re-read of a pasted campaign, `CAMPAIGN_NOT_FOUND` means it is not on the current site: ask which site or campaign before applying anything |
| `CAMPAIGN_TYPE_NOT_SUPPORTED`, `PLATFORM_NOT_SUPPORTED` | Guides exist only for Performance Max Leads with `platformType: "GOOGLE"`; use the recommendations path |
| `SUGGESTION_NOT_FOUND` | Retrieve the guide and use a `type` it contains |
| `INVALID_ASSET_GROUP_ASSETS`, `NOT_ENOUGH_ASSETS`, `DUPLICATE_ASSET`, `INVALID_IMAGE_FORMAT` | The resulting asset list breaks a count, size or uniqueness rule; fix and resend the full entity |
| Timeout on the guide or asset generation; permission error | Report the unknown outcome and retry later, never a second scan immediately; after a rejected call stop, do not try other base URLs or sites |

## References

- [Get Recommendations](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/google-suggestion-v1/get-recommendations)
- [Get or Create Campaign Success Guide](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/platform/suggestion-v1/get-or-create-campaign-success-guide), [Update Campaign Success Guide Suggestion Status](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/platform/suggestion-v1/update-campaign-success-guide-suggestion-status)
- [Update Campaign](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/campaign-v1/update-campaign)
- [Google Ads sample flows: improve campaign performance](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/sample-flows#improve-campaign-performance)
