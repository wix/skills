---
name: "App Installation Recipes"
description: "Wix app installation — install apps on a site, enable Velo, list what is already installed, and link to the App Market and installed-apps dashboard pages. Use for anything users call installing an app, adding a feature, app market, plugins, or a 428 / app-not-installed error."
---

# App Installation Recipes

Most business-solution APIs return 428 until the owning app is installed on the site, which makes this area a prerequisite for the rest: when an API call fails that way, check **List Installed Apps** and then install with **Install Wix Apps**. Installing is also the first step whenever a user asks to add a capability (a store, bookings, a blog) that the site does not have yet.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Install Wix Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/install-wix-apps)
**Technical:** Installs Wix apps on a site using Apps Installer API. Covers enabling
Velo (Wix Code), app installation, and common app definition IDs.

### [List Installed Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/list-installed-apps)
**Technical:** Lists all apps installed on a site using Apps Installer API. Useful for
verifying app installations before making API calls and diagnosing authorization errors.

### [App Management Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/app-management-dashboard-navigation)
**Technical:** Builds direct links to the app-management dashboard pages on
manage.wix.com — the App Market and the installed-apps management page. Pairs installed
apps with the List Installed Apps read API. Use when the user asks where something is in
the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL
to include with the result of an API operation.
