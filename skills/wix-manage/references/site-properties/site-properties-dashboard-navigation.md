---
name: "Site Settings Dashboard Navigation"
description: "Builds direct links to the site-settings dashboard pages on manage.wix.com — the settings hub, website settings, and language & region. Pairs site properties with the Site Properties read API. Use when the user asks WHERE to change site settings (business info, name, language, currency) in the Wix dashboard; to change the language or currency over the API instead, use the Change Payment Currency (Site Properties) recipe."
---

# Site Settings Dashboard Navigation

Build direct links into the settings pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

This recipe only builds links. To actually **change** a site's language or payment currency over the API, use [Change Payment Currency (Site Properties)](change-payment-currency-site-properties.md) — a single `PATCH /site-properties/v4/properties`.

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Settings hub | `settings` | All site settings sections (business info, payments, etc.) |
| Website settings | `settings/website-settings` | Site name, favicon, social sharing |
| Language & region | `settings/language-and-region` | Language, currency, time zone |

Older `manage-website...` links redirect to the current routes.

## Pairing Entities with Their Read APIs

| Entity | Read API | Dashboard link |
|---|---|---|
| Site properties (business info, locale, currency) | `GET /site-properties/v4/properties` | `settings` (hub) or `settings/language-and-region` |

Example — after changing the payment currency:

```
Payment currency set to EUR.
Review your regional settings: https://manage.wix.com/dashboard/{metaSiteId}/settings/language-and-region
```
