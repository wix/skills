---
name: "Dashboard Navigation"
description: "Entry point for building direct links into a site's Wix dashboard (manage.wix.com). Documents the shared URL structure for all dashboard pages (site and account level, app-ID fallback, entity deep links, machine-readable routes.json) and routes to a per-business-solution recipe for every covered solution — bookings, stores/ecommerce, blog, pricing plans, restaurants, CMS, contacts, forms, marketing, get paid, analytics, google ads, app management, site settings, sites, and domains. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
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

- **App-ID fallback.** `https://manage.wix.com/dashboard/{metaSiteId}/app/{appDefinitionId}/{pagePath}` always works and redirects to the slug form. With no `pagePath` it lands on the app's main dashboard page, so knowing just the app ID is enough for a working link:

  ```
  https://manage.wix.com/dashboard/{metaSiteId}/app/13d21c63-b5ec-5912-8397-c3a5ddb27a97
  → redirects to .../bookings (the Wix Bookings main page)
  ```

  To get an app's `appDefinitionId`, use [List Installed Apps](../app-installation/list-installed-apps.md) (`GET /apps-installer-service/v1/app-instances` returns each installed app's ID and name), or take it from the per-solution recipe — each leaf states its apps' IDs.
- **Graceful degradation.** Unknown deeper paths fall back to the longest matching route (`.../bookings/services/unknown` lands on the services list), so links don't 404.
- **Legacy redirects.** Older route formats (e.g. `store/orders`, `bookings/scheduler/owner/...`) redirect to the current pages; links in existing content keep working.
- **Entity deep links.** Pages that show a single entity accept the entity ID as an extra path segment (e.g. `bookings/services/form/{serviceId}`). Query params can follow.
- **Permissions.** The dashboard enforces its own login and per-page permissions; links just navigate.
- **Site vs account pages.** Most pages are site-scoped (the `/dashboard/{metaSiteId}/...` form above). Some solutions also have **account-level** pages that apply to the whole Wix account and take no metaSiteId: `https://manage.wix.com/account/{route}` — e.g. `account/websites` (My Sites), `account/domains` (My Domains). The per-solution recipes say which is which.

## Per-Business-Solution Recipes

| Business solution | Recipe | Covers |
|---|---|---|
| Wix Bookings | [Bookings Dashboard Navigation](../bookings/bookings-dashboard-navigation.md) | Services, calendar, booking list, staff, availability, resources, settings |
| Wix Stores / eCommerce | [Stores Dashboard Navigation](../stores/stores-dashboard-navigation.md) | Products, categories, inventory, orders, abandoned checkouts, gift cards, shipping, tax |
| Wix Blog | [Blog Dashboard Navigation](../blog/blog-dashboard-navigation.md) | Posts (published + drafts), categories, tags, writers, comments, analytics, monetization, settings |
| Wix Pricing Plans | [Pricing Plans Dashboard Navigation](../pricing-plans/pricing-plans-dashboard-navigation.md) | Plans list, create/edit plan, manual orders, settings |
| Wix Restaurants | [Restaurants Dashboard Navigation](../restaurants/restaurants-dashboard-navigation.md) | Menus, items, online orders board, ordering settings, reservations, floor plans, reservation experiences |
| Wix CMS | [CMS Dashboard Navigation](../cms/cms-dashboard-navigation.md) | Collections list, collection items view |
| Wix Contacts (CRM) | [Contacts Dashboard Navigation](../contacts/contacts-dashboard-navigation.md) | Contacts list, contact view, import, segments |
| Wix Forms | [Forms Dashboard Navigation](../forms/forms-dashboard-navigation.md) | Forms list, submissions, form builder, standalone forms, templates, settings |
| Get Paid | [Get Paid Dashboard Navigation](../get-paid/get-paid-dashboard-navigation.md) | Payment links, invoices, recurring invoices, accept-payments settings |
| Wix Marketing | [Marketing Dashboard Navigation](../marketing/marketing-dashboard-navigation.md) | Social posts hub, design templates, email campaigns, campaign analytics |
| Wix Analytics | [Analytics Dashboard Navigation](../analytics/analytics-dashboard-navigation.md) | Highlights, reports, traffic/behavior/sales/marketing overviews, benchmarks |
| Google Ads | [Google Ads Dashboard Navigation](../google-ads/google-ads-dashboard-navigation.md) | The Google Ads campaign page |
| App management | [App Management Dashboard Navigation](../app-installation/app-installation-dashboard-navigation.md) | App Market, installed-apps management |
| Site settings | [Site Settings Dashboard Navigation](../site-properties/site-properties-dashboard-navigation.md) | Settings hub, website settings, language & region |
| Sites (account) | [Sites Dashboard Navigation](../sites/sites-dashboard-navigation.md) | My Sites list, per-site dashboard home |
| Domains | [Domains Dashboard Navigation](../domains/domains-dashboard-navigation.md) | Site domain settings, account-level My Domains |

For a business solution not listed yet, use the app-ID fallback URL with the solution's app definition ID, or link the dashboard home: `https://manage.wix.com/dashboard/{metaSiteId}/home`.

## Machine-Readable Route Data

[routes.json](https://www.wix.com/skills/manage/references/dashboard-navigation/routes.json) holds the full page inventory behind these recipes — every covered app with its `appDefinitionId`, `slug`, and per page: `path` (append to `https://manage.wix.com/dashboard/{metaSiteId}/`), `title`, `inSidebar`, redirecting `legacyAliases`, and — where the page shows a single entity — `deepLink` with the ID placeholder (`bookings/services/form/{serviceId}`). Prefer the per-solution recipes for guidance (curation, entity deep links, read-API pairing); use the JSON to look up or enumerate routes programmatically:

```bash
curl -s https://www.wix.com/skills/manage/references/dashboard-navigation/routes.json
```

```bash
# All user-facing pages of an app
jq -r '.apps[] | select(.app == "Wix Bookings") | .pages[] | select(.inSidebar) | .path' routes.json

# Find the page for a concept ("invoice") across all apps
jq -r '.apps[].pages[] | select(.title | test("invoice"; "i")) | .path' routes.json

# Entity deep link: fetch the pattern, substitute the ID, prepend the base
jq -r '.apps[].pages[] | select(.deepLink) | .deepLink' routes.json | grep productId
# → wix-stores/products/product/{productId}
# → https://manage.wix.com/dashboard/{metaSiteId}/wix-stores/products/product/8a12...

# Where does an old link land now?
jq -r '.apps[].pages[] | select(.legacyAliases | index("store/orders")) | .path' routes.json
```
