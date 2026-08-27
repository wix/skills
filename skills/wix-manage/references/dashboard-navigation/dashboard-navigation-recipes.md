---
name: "Dashboard Navigation Recipes"
description: "Direct links into a site's Wix dashboard on manage.wix.com — the shared URL structure for site-level and account-level pages, entity deep links, and the per-product dashboard pages. Use when the user asks where something is in the dashboard, wants a link to a settings or management page, or an API result should come back with a place to see it."
---

# Dashboard Navigation Recipes

This area holds the shared rules for constructing dashboard URLs: site versus account scope, the app-ID fallback, entity deep links, and the machine-readable route list. Each product area also has its own dashboard-navigation recipe with that product's specific pages — start here for the URL structure, then use the product's own recipe for its pages.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-solutions/bookings/skills/dashboard-navigation)
**Technical:** Entry point for building direct links into a site's Wix dashboard
(manage.wix.com). Documents the shared URL structure for all dashboard pages (site and
account level, app-ID fallback, entity deep links, machine-readable routes.json) and
routes to a per-business-solution recipe for every covered solution — bookings,
stores/ecommerce, blog, pricing plans, restaurants, CMS, contacts, forms, marketing, get
paid, analytics, google ads, app management, site settings, sites, and domains. Use when
the user asks where something is in the Wix dashboard, wants a direct link to a
dashboard page, or you need a dashboard URL to include with the result of an API
operation.
