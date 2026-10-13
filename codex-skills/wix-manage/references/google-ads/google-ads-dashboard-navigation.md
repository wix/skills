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
| Keywords manager (campaign-scoped) | `google-ads/keywords-manager?campaignId={campaignId}` | Search themes and campaign exclusions: `excludedSearchTerms` for Smart campaigns and `excludedKeywords` for Performance Max Leads campaigns |

## Resolve a Campaign-Scoped Destination

A campaign-scoped URL requires the campaign's Wix `campaignId`. Never substitute a campaign name in the URL or omit the query parameter.

1. Reuse a `campaignId` already established in the conversation or returned by the preceding campaign operation. A Campaign Success Guide flow has already resolved its campaign, so use that ID without listing campaigns again.
2. If only the campaign name is known, list campaigns once in the selected site's context:

   ```bash
   curl -X GET 'https://www.wixapis.com/_serverless/pa-google/v1/campaigns' \
     -H 'Authorization: <AUTH>'
   ```

   Read `campaigns[].id` and `campaigns[].name`, and use the ID only when one campaign clearly matches the user's name.
3. If neither the campaign ID nor name is known, or the list does not yield exactly one clear match, ask the user for the campaign ID or a more specific name. Do not guess or build the link until the campaign is unambiguous.

## Pairing Entities with Their Read APIs

Fetch state via the Google Ads recipes in this area (`GET /_serverless/pa-google/v1/accounts/current-site`, `GET /_serverless/pa-google/v1/accounts/current-site/conversion-actions`), then link the page.

Example — after creating a campaign:

```
Your Performance Max campaign is live.
Manage it here: https://manage.wix.com/dashboard/{metaSiteId}/google-ads
```

When a user explicitly prefers to add a campaign's search themes manually, link directly to that campaign's keywords manager. Do not substitute this manual route for an agent-supported update the user wants the agent to perform.

```
Add Search Themes: https://manage.wix.com/dashboard/{metaSiteId}/google-ads/keywords-manager?campaignId={campaignId}
```

The same campaign-scoped route manages exclusions. Name the destination after the campaign field the user is managing:

- **Smart campaigns:** `excludedSearchTerms` → **Manage Excluded Search Terms**
- **Performance Max Leads campaigns:** `excludedKeywords` → **Manage Excluded Keywords**
