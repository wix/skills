---
name: "Sites Dashboard Navigation"
description: "Builds direct links to the account-level sites pages on manage.wix.com — the My Sites list (all sites in the account) and each site's own dashboard. Pairs the site list with the Query Sites read API. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Sites Dashboard Navigation

For the general URL contract, see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md). Sites pages are **account-level** — they live under `https://manage.wix.com/account/...` and take no metaSiteId.

## Main Pages

| Page | URL | What it manages |
|---|---|---|
| My Sites (site list) | `https://manage.wix.com/account/websites` | All sites in the account |
| A site's dashboard | `https://manage.wix.com/dashboard/{metaSiteId}/home` | One site's dashboard home |

## Pairing Entities with Their Read APIs

| Entity | Read API | Dashboard link |
|---|---|---|
| Site | `POST /site-list/v2/sites/query` (returns each site's `id` = metaSiteId + name) | `https://manage.wix.com/dashboard/{id}/home` |

Example — after creating a site from a template:

```
Created "Sunset Spa" from the template.
Open its dashboard: https://manage.wix.com/dashboard/{metaSiteId}/home
All your sites: https://manage.wix.com/account/websites
```
