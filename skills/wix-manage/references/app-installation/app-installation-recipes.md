---
name: "App Installation Recipes"
description: "Wix app installation — install apps on a site, enable Velo, list what is already installed, and link to the App Market and installed-apps dashboard pages. Use for anything users call installing an app, adding a feature, app market, plugins, or a 428 / app-not-installed error."
---

# App Installation Recipes

Most business-solution APIs return 428 until the owning app is installed on the site, which makes this area a prerequisite for the rest: when an API call fails that way, check **List Installed Apps** and then install with **Install Wix Apps**. Installing is also the first step whenever a user asks to add a capability (a store, bookings, a blog) that the site does not have yet.

## Recipes

### [Install Wix Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/install-wix-apps)
Use when a site needs an app it does not have — including enabling Velo and finding the right app definition ID.

### [List Installed Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/list-installed-apps)
Use to check what is installed before calling a product API, or to diagnose a 428 or authorization error.

### [App Management Dashboard Navigation](https://dev.wix.com/docs/api-reference/business-management/app-installation/skills/app-management-dashboard-navigation)
Use when the user wants the App Market or the installed-apps management page.
