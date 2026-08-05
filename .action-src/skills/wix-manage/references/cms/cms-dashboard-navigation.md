---
name: "CMS Dashboard Navigation"
description: "Builds direct links to the Wix CMS (Content Manager) dashboard pages on manage.wix.com — the collections list and a specific collection's items view. Pairs collections and data items with their read APIs so you can fetch data and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# CMS Dashboard Navigation

Build direct links into the CMS (Content Manager) pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

All CMS (app ID `e593b0bd-b783-45b8-97c2-873d42aacaf4`) pages live under:

```
https://manage.wix.com/dashboard/{metaSiteId}/wix-cms/{route}
```

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Collections list | `wix-cms` | All CMS collections on the site |
| Collection items | `wix-cms/data/{collectionId}` | A specific collection's items table |

Older links (`database`, `developer-tools/database`) redirect to `wix-cms`. `{collectionId}` is the collection's ID (e.g. `Stores/Products` for app collections, or the ID you set when creating the collection).

## Pairing Entities with Their Read APIs

Fetch the entity via REST, then link the matching dashboard page. All calls use `https://www.wixapis.com` with an `Authorization` header.

| Entity | Read API | Dashboard link |
|---|---|---|
| Collection (schema) | `GET /wix-data/v2/collections/{collectionId}` · `GET /wix-data/v2/collections` (list) | `wix-cms/data/{collectionId}` |
| Data item | `POST /wix-data/v2/items/query` (body includes `dataCollectionId`) · `GET /wix-data/v2/items/{itemId}?dataCollectionId=...` | `wix-cms/data/{collectionId}` (the collection's items table) |

Example — after creating a collection and inserting items:

```
Created the "Recipes" collection with 12 items.
Manage it here: https://manage.wix.com/dashboard/{metaSiteId}/wix-cms/data/Recipes
```

## Notes

- There is no per-item dashboard URL; link the collection's items table.
- Unknown deeper paths fall back to the longest matching route, so a wrong collection ID lands on the CMS home rather than a 404.
