---
name: "Site Properties Recipes"
description: "Site-level settings — payment currency, time zone and primary language through the Site Properties API, plus links to the site-settings dashboard pages. Use for anything users call site settings, currency, timezone, language, region, or general site configuration."
---

# Site Properties Recipes

One call covers currency, time zone and primary language, and it needs a field mask naming the top-level properties being changed — **Change Payment Currency (Site Properties)** documents the exact shape. Note that this API does not control business opening hours (see the calendar recipes) or store-level pricing behaviour. Use **Site Settings Dashboard Navigation** for the settings hub, website settings, and language and region pages.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Change Payment Currency (Site Properties)](https://dev.wix.com/docs/api-reference/business-management/site-properties/skills/change-payment-currency-site-properties)
**Technical:** Updates the site-level payment currency (store billing currency) using
Site Properties API, including the required request body shape and field mask. Covers
the site time zone and primary language through the same call, whose field mask names
top-level properties.

### [Site Settings Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-management/site-properties/skills/site-settings-dashboard-navigation)
**Technical:** Builds direct links to the site-settings dashboard pages on
manage.wix.com — the settings hub, website settings, and language & region. Pairs site
properties with the Site Properties read API. Use when the user asks where something is
in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard
URL to include with the result of an API operation.
