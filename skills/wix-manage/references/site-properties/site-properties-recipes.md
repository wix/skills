---
name: "Site Properties Recipes"
description: "Site-level settings — payment currency, time zone and primary language through the Site Properties API, plus links to the site-settings dashboard pages. Use for anything users call site settings, currency, timezone, language, region, or general site configuration."
---

# Site Properties Recipes

One call covers currency, time zone and primary language, and it needs a field mask naming the top-level properties being changed — **Change Payment Currency (Site Properties)** documents the exact shape. Note that this API does not control business opening hours (see the calendar recipes) or store-level pricing behaviour. Use **Site Settings Dashboard Navigation** for the settings hub, website settings, and language and region pages.

## Recipes

### [Change Payment Currency (Site Properties)](https://dev.wix.com/docs/api-reference/business-management/site-properties/skills/change-payment-currency-site-properties)
Use when changing a site's payment currency, time zone or primary language — including the field mask the call requires.

### [Site Settings Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-management/site-properties/skills/site-settings-dashboard-navigation)
Use when the user wants the settings hub, website settings, or the language and region page.
