---
name: "Analytics Recipes"
description: "Site analytics — query traffic, sales, behavior and marketing metrics through the Semantic Model API, and link users to the analytics dashboard. Use for anything users call analytics, stats, metrics, reports, traffic, visitors, conversion, or performance numbers."
---

# Analytics Recipes

Answering a numbers question is a three-step flow: list the semantic models, inspect the model's schema to learn its measures and dimensions, then query it with a time interval (always required), filters, sorting and paging. Use **Query Site Analytics** for the data itself, and **Analytics Dashboard Navigation** when the user wants to see it in their dashboard — pairing the two lets an answer come back with a link to the matching report.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Query Site Analytics](https://dev.wix.com/docs/api-reference/business-management/analytics/skills/query-site-analytics)
**Technical:** Retrieve a Wix site's analytics through the Semantic Model API. Covers
listing semantic models, inspecting a model's schema (measures, dimensions, parameters),
and querying model data with a required time interval, filters, sorting, paging, and
human-readable formatting.

### [Analytics Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-management/analytics/skills/analytics-dashboard-navigation)
**Technical:** Builds direct links to Wix Analytics dashboard pages on manage.wix.com —
highlights, reports, per-domain overviews (traffic, behavior, sales, marketing), and
performance insights/benchmarks. Pairs analytics data with its read API so you can
answer a question via API and hand back a 'see it in your dashboard' link. Use when the
user asks where something is in the Wix dashboard, wants a direct link to a dashboard
page, or you need a dashboard URL to include with the result of an API operation.
