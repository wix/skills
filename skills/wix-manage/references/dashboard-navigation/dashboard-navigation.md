---
name: "Dashboard Navigation"
description: "Entry point for building direct links into a site's Wix dashboard (manage.wix.com). Documents the shared URL structure for all dashboard pages and routes to the per-business-solution recipes (Bookings, Stores) that list each solution's page routes and pair entities with their read APIs. Use when the user asks where to manage something in the Wix dashboard, wants a dashboard link, or after an API operation to hand back a 'view it in your dashboard' link."
---

# Dashboard Navigation

Build direct links into a site's Wix dashboard (manage.wix.com). This is the shared contract; per-business-solution recipes list the actual page routes.

## URL Structure

Every dashboard page lives under:

```
https://manage.wix.com/dashboard/{metaSiteId}/{route}
```

- `{metaSiteId}` — the site's meta site ID: the `id` returned by the Query Sites API, and the `siteId` in a CLI project's `wix.config.json`.
- `{route}` — `{appSlug}/{pagePath}`. Each Wix app owns a URL namespace (its slug) and registers pages under it, e.g. `bookings/services`, `wix-stores/products`.

Useful properties of these URLs:

- **App-ID fallback.** `https://manage.wix.com/dashboard/{metaSiteId}/app/{appDefinitionId}/{pagePath}` always works and redirects to the slug form — use it when you know the app ID but not its slug.
- **Graceful degradation.** Unknown deeper paths fall back to the longest matching route (`.../bookings/services/unknown` lands on the services list), so links don't 404.
- **Legacy redirects.** Older route formats (e.g. `store/orders`, `bookings/scheduler/owner/...`) redirect to the current pages; links in existing content keep working.
- **Entity deep links.** Pages that show a single entity accept the entity ID as an extra path segment (e.g. `bookings/services/form/{serviceId}`). Query params can follow.
- **Permissions.** The dashboard enforces its own login and per-page permissions; links just navigate.

## Per-Business-Solution Recipes

| Business solution | Recipe | Covers |
|---|---|---|
| Wix Bookings | [Bookings Dashboard Navigation](../bookings/bookings-dashboard-navigation.md) | Services, calendar, booking list, staff, availability, resources, settings |
| Wix Stores / eCommerce | [Stores Dashboard Navigation](../stores/stores-dashboard-navigation.md) | Products, categories, inventory, orders, abandoned checkouts, gift cards, shipping, tax |

For a business solution not listed yet, use the app-ID fallback URL with the solution's app definition ID, or link the dashboard home: `https://manage.wix.com/dashboard/{metaSiteId}/home`.

## Related

- For dashboard **extensions** navigating programmatically, the `dashboard.navigate({ pageId })` SDK method uses page IDs (GUIDs), not URL routes — see the [dashboard page IDs table](https://dev.wix.com/docs/sdk/host-modules/dashboard/page-ids). These recipes are for building shareable URLs.
