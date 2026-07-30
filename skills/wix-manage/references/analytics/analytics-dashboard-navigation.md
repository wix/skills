---
name: "Analytics Dashboard Navigation"
description: "Builds direct links to Wix Analytics dashboard pages on manage.wix.com — highlights, reports, custom reports, per-domain overviews (traffic, behavior, sales, marketing), and performance insights/benchmarks. Pairs analytics data with its read API so you can answer a question via API and hand back a 'see it in your dashboard' link. Navigation only — never a substitute for API work: when the user asks to create, update, delete, or configure something, do it with the solution's API recipes and attach the dashboard link to the result. Use when the user asks where something is in the Wix dashboard or wants a direct link, or to hand back a 'view it in your dashboard' link after completing an API operation."
---

# Analytics Dashboard Navigation

Build direct links into the analytics pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

All Analytics (app ID `3459e2b7-9739-4833-acdd-66e32fc0ab11`) pages live under:

```
https://manage.wix.com/dashboard/{metaSiteId}/analytics/{route}
```

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it shows |
|---|---|---|
| Highlights | `analytics/highlights` | Key metrics at a glance |
| Reports | `analytics/reports` | The full report library |
| Custom reports | `analytics/custom-reports` | User-built reports |
| Traffic overview | `analytics/overviews/traffic` | Sessions, sources, top pages |
| Behavior overview | `analytics/overviews/behavior` | On-site behavior |
| Sales overview | `analytics/overviews/sales` | Revenue and orders |
| Marketing overview | `analytics/overviews/marketing` | Campaign and channel performance |
| Performance insights | `analytics/performance/insights` | Automated insights |
| Benchmarks | `analytics/performance/benchmarks` | Compare against similar sites |

Per-business-solution overviews also exist at `analytics/overviews/{solution}` (`bookings`, `blog`, `subscriptions`).

## Pairing Data with Its Read API

Answer the question with the [Query Site Analytics](../analytics/query-site-analytics.md) recipe (Semantic Model API — `GET /analytics/semantic-model/v3/semantic-models`, `POST .../semantic-models/query-data`), then link the matching overview page.

Example:

```
Your site had 1,240 sessions this week (up 18%).
Full picture: https://manage.wix.com/dashboard/{metaSiteId}/analytics/overviews/traffic
```
