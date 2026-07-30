---
name: "App Management Dashboard Navigation"
description: "Builds direct links to the app-management dashboard pages on manage.wix.com — the App Market and the installed-apps management page. Pairs installed apps with the List Installed Apps read API. Navigation only — never a substitute for API work: when the user asks to create, update, delete, or configure something, do it with the solution's API recipes and attach the dashboard link to the result. Use when the user asks where something is in the Wix dashboard or wants a direct link, or to hand back a 'view it in your dashboard' link after completing an API operation."
---

# App Management Dashboard Navigation

Build direct links into the app-management pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| App Market | `app-market` | Browse and install apps |
| Manage apps | `manage-installed-apps` | Installed apps (update, remove, settings) |

The older `manage-apps` link redirects to `manage-installed-apps`.

## Pairing Entities with Their Read APIs

[List Installed Apps](list-installed-apps.md) (`GET /apps-installer-service/v1/app-instances`) returns each installed app's `appDefinitionId` and name — which is also what the app-ID fallback URL needs.

Example — after installing an app:

```
Installed Wix Bookings.
Manage your apps here: https://manage.wix.com/dashboard/{metaSiteId}/manage-installed-apps
```
