---
name: "Abandoned Carts: Recovery Health"
description: Monitors abandoned-checkout recovery health by comparing abandoned-checkout volume, recovery rate, automation state, and common failure signals. Routes root causes to checkout, shipping, pricing, or recovery troubleshooting.
---

# Recovery Health Monitor

Use this for periodic or on-demand health checks of abandoned-checkout recovery. The goal is to spot whether recovery is underperforming and identify the likely reason.

Merchants often say "abandoned carts"; the API entity is **Abandoned Checkout**. For information, reporting, and trend questions, use Analytics APIs first. Use the Abandoned Checkout API for record-level drill-down and recovery-link verification.

## Required APIs and inferred metrics

| Measurement | Source | Status |
|---|---|---|
| Abandoned checkout count / trend | Analytics Data API or Semantic Model API | Site Analytics read; Semantic Model API is Developer Preview |
| Conversion/recovery performance | Semantic Model API, after discovering available measures and dimensions | Site Analytics read; do not invent field names |
| Automation activity signals | `activities` on abandoned checkout objects, when Wix Automations populated them | TPA-public read, Dashboard-configured |
| Redirect/link usability | `GET /ecom/v1/abandoned-checkout/{abandonedCheckoutId}/redirect-to-checkout?metasiteId={metasiteId}` | TPA-public |
| Record-level abandoned checkout evidence | `POST /ecom/v1/abandoned-checkout/query` or `/search` | TPA-public, drill-down only |
| Recovered count / recovery rate | Analytics model fields if available; otherwise infer from abandoned checkout status/activity plus order/recovery attribution if present | Do not claim a single guaranteed field |
| Automation enabled/configured | Wix Dashboard -> Marketing -> Automations | Dashboard-managed |

## What to measure

Collect enough data to answer:

- How many abandoned checkouts happened in the period?
- How many were recovered?
- Did abandonment spike compared with a trailing baseline?
- Did recovery rate drop compared with a trailing baseline?
- Are recovery emails or links enabled and usable?

Use this rough benchmark:

- **Healthy:** recovery rate is stable and generally in the 5-15% range.
- **Warning:** recovery rate drops materially, abandonment spikes, or eligible abandoned checkouts are not receiving recovery.
- **Critical:** recovery links fail, automation is disabled, or checkout cannot complete.

## Analytics checks

For information queries such as "how many abandoned carts", "did recovery drop", or "show a report", use Analytics APIs before record lookup:

```http
GET https://www.wixapis.com/analytics/v2/site-analytics/data
POST https://www.wixapis.com/analytics/semantic-model/v3/semantic-models/query-data
```

Use `analytics/v2/site-analytics/data` for available high-level site measurements. Use the Semantic Model API for custom abandoned-cart or funnel reports: discover the relevant model and fields first, include the required `interval`, and do not invent measure or dimension names. The Semantic Model API can return up to 1,000 rows per query; page when needed.

## Record-level checks

Use Abandoned Checkout API query/search only after the analytics question needs record-level evidence, sample checkouts, or link verification:

```http
POST https://www.wixapis.com/ecom/v1/abandoned-checkout/query
```

Query can return up to 100 abandoned checkouts per request, so page through the full period before sampling records. When available, cross-check recovered orders against abandoned checkout IDs, status/activity fields, or recovery attribution.

## Dashboard checks

Recovery email automation is Dashboard-managed. Ask the merchant to confirm:

- the automation is active
- the trigger is abandoned checkout / cart
- sender email is valid
- email content includes a recovery CTA
- no condition accidentally excludes eligible shoppers

## Root-cause routing

Route the likely cause:

- Recovery automation off or misconfigured -> [Troubleshoot Abandoned-Cart Recovery](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-abandoned-carts-troubleshoot-recovery)
- Recovery links fail -> [Generate a Recovery Link](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-abandoned-carts-recovery-link)
- Abandonment spike at delivery step -> [Checkout & Cart](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout) and shipping coverage/rate checks
- Incentive or discount issue -> [Pricing & Promotions](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-pricing)

## Report

Return:

- status: OK, WARNING, or CRITICAL
- abandoned checkout volume or trend from Analytics APIs
- recovery rate if available, otherwise say which source data is missing
- change versus baseline
- top suspected cause
- one next action

## Audit note

This file is not redundant with the API docs because it defines the health rubric, baseline comparison, Dashboard/manual checks, Analytics/API boundary, and root-cause routing. It must stay honest about inferred metrics: if Analytics models or API data do not expose recovery attribution directly, report volume and evidence instead of fabricating a recovery rate.
