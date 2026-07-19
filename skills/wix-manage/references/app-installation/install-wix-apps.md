---
name: "Install Wix Apps"
description: Installs Wix apps on a site using Apps Installer API. Covers installable app IDs and distinguishes Wix CMS installation from manual Velo enablement.
---
# Install Wix Apps on a Site

This recipe guides you through installing Wix apps on a site using the Apps Installer REST API.

## What This Recipe Does Not Do

Apps Installer does **not** enable Velo / Dev Mode / Wix Code for editing a site. If the user asks to enable Velo itself so they can add custom code in the editor, do not install an app. Tell them to enable Velo manually in the Wix editor: open the site editor, use the Dev Mode / Velo menu, and turn it on.

Use this recipe for Wix apps that are installable through Apps Installer. If a Wix Data or CMS REST API returns `WDE0110` / "Wix Code not enabled", that means the Wix CMS (Wix Data) app is missing for API use. Install the Wix CMS app with the Apps Installer ID `e593b0bd-b783-45b8-97c2-873d42aacaf4`.

## Prerequisites

- Site ID where apps will be installed
- Knowledge of which installable app to install

## Required APIs

- **Apps Installer API**: [REST](https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/install-app)

---
## Step 0: Find the App ID (skip if you already have it)

If you already know the `appDefId` (e.g. from the table of Wix-built apps below), skip to Step 1.

For any third-party app, or any app you only know by name, resolve the ID first using the Search Market Listings API.

**Endpoint**: `POST https://www.wixapis.com/devcenter/app-market-listing/v1/market-listings/search`

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/devcenter/app-market-listing/v1/market-listings/search' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{ "searchTerm": "Usercentrics" }'
```

**Response** (truncated):
```json
{
  "marketListings": [
    {
      "appId": "b8cfbda5-91e8-45ad-8c8d-4d4700534ab5",
      "basicInfo": { "name": "Usercentrics for Wix", ... }
    }
  ]
}
```

Use the returned `appId` as the `appDefId` in Step 2.

### IMPORTANT NOTES
- The `appDefId` field in the install request and the `appId` field returned here are the same value
- If multiple results come back, match on `basicInfo.name` to confirm you have the right app before installing
- Only listings with `status: "PUBLISHED"` can be installed

## Install the Wix App

Use the Apps Installer API to install any Wix app on a site.

**Endpoint**: `POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install`

**Request Body**:
```json
{
  "tenant": {
    "tenantType": "SITE",
    "id": "<SITE_ID>"
  },
  "appInstance": {
    "appDefId": "<APP_DEF_ID>"
  }
}
```

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/apps-installer-service/v1/app-instance/install' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant": {
      "tenantType": "SITE",
      "id": "<SITE_ID>"
    },
    "appInstance": {
      "appDefId": "<APP_DEF_ID>"
    }
  }'
```

### Common Apps Installer IDs

Use these IDs with the Apps Installer API. Do not replace them with IDs from general "Apps Created by Wix" docs unless you have verified they are installable through Apps Installer.

Important CMS distinction: some Wix docs list Wix CMS as app ID `675bbcef-18d8-41f5-800e-131ec9e08762`. That ID is for app/API attribution and is **not installable** through Apps Installer. For Apps Installer, use the Wix CMS (Wix Data) ID below: `e593b0bd-b783-45b8-97c2-873d42aacaf4`.

Some common apps:
| App | appDefId |
|-----|----------|
| Wix Stores | `215238eb-22a5-4c36-9e7b-e7c08025e04e` |
| Wix Bookings | `13d21c63-b5ec-5912-8397-c3a5ddb27a97` |
| Wix Blog | `14bcded7-0066-7c35-14d7-466cb3f09103` |
| Wix Events | `140603ad-af8d-84a5-2c80-a0f60cb47351` |
| Wix Pricing Plans | `1522827f-c56c-a5c9-2ac9-00f9e6ae12d3` |
| Wix CMS | `e593b0bd-b783-45b8-97c2-873d42aacaf4` |

### IMPORTANT NOTES:
- NEVER guess the `appDefId`. For Wix-built apps, use the table above when it contains the app. For third-party apps, resolve the ID using Step 0 (Search Market Listings).
- Do not call Apps Installer to enable Velo / Dev Mode / Wix Code. Velo itself is enabled manually in the editor.
- Do not install `675bbcef-18d8-41f5-800e-131ec9e08762` for Wix CMS; Apps Installer rejects it with `APPS_NOT_FOUND_IN_APPS_SERVICE`.
- The `tenantType` MUST be `SITE`
- The `id` in tenant is the site's metaSiteId

---

## Error Handling

### App Not Installed Error
If you receive an error indicating a required app is not installed, use this recipe to install it before proceeding.

### `WDE0110` / "Wix Code not enabled"
For Wix Data / CMS REST APIs, this error usually means the Wix CMS (Wix Data) app is missing. Install Wix CMS with `e593b0bd-b783-45b8-97c2-873d42aacaf4`, then retry the original CMS API call.

### `APPS_NOT_FOUND_IN_APPS_SERVICE` for `675bbcef-18d8-41f5-800e-131ec9e08762`
Stop and do not retry the same ID. If the user wanted to enable Velo / Dev Mode / Wix Code, explain that Apps Installer cannot do that and ask them to enable Velo manually in the editor. If the user wanted Wix Data / CMS API support, use `e593b0bd-b783-45b8-97c2-873d42aacaf4` instead.

---

## Next Steps

After installing an app:
- Configure the app's settings using its specific APIs
- Set up any required app-specific data (products for Stores, services for Bookings, etc.)

---

## Common Pitfalls

- **"I don't have the appDefId"** → Run Step 0. The table in Step 2 only covers Wix-built apps; the App Market has thousands of others.
- **Don't try to scrape the App Market website to find IDs** — pages are client-rendered and the appId is not in the HTML. Use Search Market Listings instead.
- **Don't try `InstallAppFromShareUrl` as a workaround for unknown IDs** — `shareUrlId` is an internal identifier you generally don't have either.
