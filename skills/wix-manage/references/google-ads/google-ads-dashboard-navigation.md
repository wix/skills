---
name: "Google Ads Dashboard Navigation"
description: "Builds a direct link to the Wix Google Ads dashboard page on manage.wix.com, where campaigns created via the Google Ads API recipes are managed. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Google Ads Dashboard Navigation

Build direct links into the Google Ads page of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Google Ads | `google-ads` | The Google Ads account, campaigns, and their performance |

## Pairing Entities with Their Read APIs

Fetch state via the Google Ads recipes in this area (`GET /google-ads/v1/accounts/current-site`, `GET /google-ads/v1/accounts/current-site/conversion-actions`), then link the page.

Example — after creating a campaign:

```
Your Performance Max campaign is live.
Manage it here: https://manage.wix.com/dashboard/{metaSiteId}/google-ads
```
