---
name: "Query Campaign Performance Analytics"
description: "Reads performance analytics for a Google Ads campaign on a Wix site: daily performance metrics (impressions, clicks, CTR, cost, leads, phone calls) with optional previous-period comparison and trends; conversion metrics from Wix Analytics (orders, revenue, leads, CPL, ROAS); the search terms that triggered a campaign's ads; per-product shopping performance for retail campaigns; and per-asset performance (headlines, descriptions, images) for PMAX Leads. Explains when to use campaignResourceName vs the Wix campaignId, the dateRange shape, field enums, sorting, and paging. Use when the user asks 'how is my campaign doing', 'show ad performance', 'what search terms triggered my ads', 'which products/assets perform best', 'campaign ROI/ROAS', or 'conversions from my Google ads'. REST base https://www.wixapis.com/google-ads/v1."
---
# RECIPE: Query Campaign Performance Analytics

Read how a Google Ads campaign is performing. Six query endpoints cover different breakdowns; picking the right one depends on the metric and the campaign type. Performance data is only available once a campaign is `LIVE`, and typically appears within a few hours of activity.

Base URL: `https://www.wixapis.com/google-ads/v1` (search-term V2 is under `/v2`). `<AUTH>` is the `Authorization` header; body calls also need `Content-Type: application/json`. All endpoints are read-only.

**Two identifiers — get them right:**
- **`campaignResourceName`** — the Google Ads resource name `customers/{customerId}/campaigns/{campaignId}` (from `campaign.resourceName`). Used by **Performance Metrics** and **Search Term Metrics (v1)**.
- **`campaignId`** — the Wix-internal campaign GUID (from `campaign.id`). Used by **Conversion Metrics**, **Shopping Performance**, **Asset Performance**, and **Search Term Metrics V2**.

Both come from Get/List Campaign (see [Manage Campaign Lifecycle](manage-campaign-lifecycle.md)).

**Which query?**

| Question | Endpoint | Campaign types | ID |
| --- | --- | --- | --- |
| Daily impressions/clicks/CTR/cost/leads | `POST /v1/performance-metrics` | all | `campaignResourceName` |
| Orders / revenue / ROAS (from Wix) | `POST /v1/conversion-metrics` | all | `campaignId` |
| Which search queries triggered ads | `POST /v2/search-term-metrics` | Smart + PMAX Leads | `campaignId` |
| Per-product performance | `POST /v1/shopping-performance-metrics` | Shopping / retail PMAX | `campaignId` |
| Per-asset (headline/description/image) | `POST /v1/asset-performance-metrics` | PMAX Leads only | `campaignId` |

**Date range** is shared: `{ "dateRange": { "custom": { "from": "2026-03-01", "to": "2026-03-31" } } }` (YYYY-MM-DD). Omit `dateRange` to default to the campaign lifetime.

---

## Daily performance metrics

Clicks, impressions, CTR, cost, leads, phone calls — per day, plus a summary row. `fields` chooses which metrics to return (defaults to clicks, impressions, CTR, cost, phone calls, date). `includePreviousPeriod: true` adds a `previousPeriodSummaryRow` and `trends` (decimal % change vs the equivalent preceding period).

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/performance-metrics' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{
    "campaignResourceName": "customers/3827461950/campaigns/7412836509",
    "dateRange": { "custom": { "from": "2026-03-01", "to": "2026-03-31" } },
    "fields": ["DATE", "IMPRESSIONS", "CLICKS", "CTR", "COST", "LEADS"],
    "sort": { "field": "DATE", "order": "DESC" },
    "includePreviousPeriod": true
  }'
```

```json
{
  "results": [ { "date": "2026-03-31", "impressions": 1820, "clicks": 128, "ctr": 0.0703, "cost": 54.20, "leads": 3 } ],
  "summaryRow": { "impressions": 47381, "clicks": 3316, "ctr": 0.0699, "cost": 1408.65, "leads": 87 },
  "previousPeriodSummaryRow": { "impressions": 41020, "clicks": 2874, "ctr": 0.0700, "cost": 1215.40, "leads": 71 },
  "trends": { "impressions": 0.155, "clicks": 0.154, "ctr": -0.001, "cost": 0.159, "leads": 0.225 }
}
```

`fields` enum: `DATE`, `IMPRESSIONS`, `CLICKS`, `CTR`, `COST`, `LEADS`, `PHONE_CALLS`, `COST_PER_CLICK`, `CLICKS_BY_AD_NETWORK_TYPE`, `IMPRESSIONS_BY_AD_NETWORK_TYPE`. `ctr` and `trends` are decimals (`0.0703` = 7.03%; `0.155` = +15.5%). `cost` is already in currency units (converted from micros).

## Conversion metrics (orders, revenue, ROAS)

Business outcomes from **Wix Analytics** (not Google). Both `campaignId` and `dateRange` are **required**. Complex query — 120s SLA.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/conversion-metrics' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{ "campaignId": "b3f8e241-7c4a-4d19-a562-9f1e30d87c05", "dateRange": { "custom": { "from": "2026-03-01", "to": "2026-03-31" } } }'
```

```json
{ "summaryRow": { "orders": 214, "revenue": 18750.40, "leads": 87, "cpl": 16.19, "leadsConversionRate": 0.0262, "cpp": 6.58, "roas": 13.31 } }
```

## Search terms that triggered ads

The actual queries users typed. Use **V2** (`/v2/search-term-metrics`, keyed by `campaignId`) — it supports both Smart and PMAX Leads. Optional `searchTermText` (contains-match) and `searchTermTextsFilter` (`{ type: "MATCH" | "NOT_MATCH", searchTermTexts: [...] }`). Sortable by `COST`/`CLICKS`/`IMPRESSIONS`; paged with `nextPageToken`.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v2/search-term-metrics' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{
    "campaignId": "b3f8e241-7c4a-4d19-a562-9f1e30d87c05",
    "searchTermText": "leather bag",
    "dateRange": { "custom": { "from": "2026-03-01", "to": "2026-03-31" } },
    "sort": { "field": "CLICKS", "order": "DESC" },
    "paging": { "pageSize": 10 }
  }'
```

```json
{
  "results": [ { "searchTerm": "leather bag women", "impressions": 5632, "clicks": 421, "cost": 176.82 } ],
  "summaryRow": { "searchTerm": "", "impressions": 9522, "clicks": 719, "cost": 301.98 },
  "nextPageToken": "CAoQAA"
}
```

(The v1 `/v1/search-term-metrics` variant exists but takes `campaignResourceName` and is Smart-only — prefer V2.)

## Per-product shopping performance (retail / Shopping PMAX)

Product-level rows for a Shopping campaign, plus a summary with total conversions, revenue, and ROAS. `resultSetting` controls the payload: `SUMMARY_ONLY`, `RESULTS_ONLY`, or `SUMMARY_AND_RESULTS`. 120s SLA. Note: per-product `conversions`/`conversionRate` always return 0 (not queried from Google) — use the summary's `totalConversions`/`roas` for outcomes.

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/shopping-performance-metrics' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{
    "campaignId": "b3f8e241-7c4a-4d19-a562-9f1e30d87c05",
    "dateRange": { "custom": { "from": "2026-03-01", "to": "2026-03-31" } },
    "fields": ["IMPRESSIONS", "CLICKS", "CTR", "COST", "COST_PER_CLICK"],
    "sort": { "field": "COST", "order": "DESC" },
    "paging": { "pageSize": 10 },
    "resultSetting": "SUMMARY_AND_RESULTS"
  }'
```

Results carry `productTitle`, `productImageUrl`, and the Wix `productId`; the `summaryRow` has `totalConversions`, `totalRevenue`, `roas`, and `moreResultsAvailable`.

## Per-asset performance (PMAX Leads only)

Which creative assets perform best. `filter.assetTypes` narrows to specific roles (`HEADLINE`, `DESCRIPTION`, `MARKETING_IMAGE`, …).

```bash
curl -X POST 'https://www.wixapis.com/google-ads/v1/asset-performance-metrics' \
  -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
  -d '{
    "campaignId": "b3f8e241-7c4a-4d19-a562-9f1e30d87c05",
    "dateRange": { "custom": { "from": "2026-03-01", "to": "2026-03-31" } },
    "fields": ["IMPRESSIONS", "CLICKS", "CTR", "COST", "ASSET_SOURCE"],
    "sort": { "field": "IMPRESSIONS", "order": "DESC" },
    "filter": { "assetTypes": ["HEADLINE", "DESCRIPTION", "MARKETING_IMAGE"] }
  }'
```

Each result has `assetContent`, `assetFieldType`, `assetSource` (`ADVERTISER` vs auto-generated), a `performanceLabel` (`EXCELLENT`/`GOOD`/…), and a nested `metrics` object.

---

## Error handling

| Symptom | Cause | Fix |
| --- | --- | --- |
| Empty results / all-zero metrics | Campaign not `LIVE`, or no activity yet in the range | Confirm the campaign is live; data lags a few hours. Widen the date range |
| `ACCOUNT_NOT_FOUND` / `CAMPAIGN_NOT_FOUND` | Wrong id or no account | Verify via List/Get Campaign |
| Wrong-id error on performance/search-term-v1 | Passed `campaignId` where `campaignResourceName` is required (or vice-versa) | Match the ID column in the "Which query?" table |
| Asset-performance returns nothing on a non-Leads campaign | Only PMAX Leads is supported | Use performance/shopping metrics for other types |
| Shopping per-product `conversions`/`conversionRate` are 0 | By design (not queried from Google) | Read the summary's `totalConversions`/`roas` |
| Slow response (conversion/shopping) | 120s SLA | Wait; don't retry prematurely |

## References

- [Analytics Service introduction](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/performance-metrics-v1/introduction)
- [Query Performance Metrics](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/performance-metrics-v1/query-performance-metrics)
- [Query Conversion Metrics](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/performance-metrics-v1/query-conversion-metrics)
- [Query Search Term Metrics V2](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/performance-metrics-v1/query-search-term-metrics-v2)
- [Query Shopping Performance Metrics](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/performance-metrics-v1/query-shopping-performance-metrics)
- [Query Asset Performance Metrics](https://dev.wix.com/docs/api-reference/business-management/marketing/ads/google-ads/performance-metrics-v1/query-asset-performance-metrics)
