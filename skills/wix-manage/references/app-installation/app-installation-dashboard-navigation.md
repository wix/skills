---
name: "App Management Dashboard Navigation"
description: "Builds direct links to the app-management dashboard pages on manage.wix.com — the App Market and the installed-apps management page. Pairs installed apps with the List Installed Apps read API. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
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
