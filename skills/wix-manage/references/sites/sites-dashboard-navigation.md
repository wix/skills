---
name: "Sites Dashboard Navigation"
description: "Builds direct links to the account-level sites pages on manage.wix.com — the My Sites list (all sites in the account) and each site's own dashboard. Pairs the site list with the Query Sites read API. Navigation only — never a substitute for API work: when the user asks to create, update, delete, or configure something, do it with the solution's API recipes and attach the dashboard link to the result. Use when the user asks where something is in the Wix dashboard or wants a direct link, or to hand back a 'view it in your dashboard' link after completing an API operation."
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
