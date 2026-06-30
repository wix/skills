---
name: "Install Wix Apps"
description: Installs Wix apps on a site using Apps Installer API. Covers enabling Velo (Wix Code), app installation, and common app definition IDs.
---
# Install Wix Apps on a Site

This recipe guides you through installing Wix apps on a site using the Apps Installer REST API.

## Prerequisites

- Site ID where apps will be installed
- Knowledge of which app to install (see [Apps Created by Wix](https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix))

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

### Common App Definition IDs

Before installing, refer to the [Apps Created by Wix](https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix) documentation to find the correct `appDefId` for the app you want to install.

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
- NEVER guess the `appDefId`. For Wix-built apps, use the table above. For any other app, resolve the ID using Step 0 (Search Market Listings).
- The `tenantType` MUST be `SITE`
- The `id` in tenant is the site's metaSiteId
- Installing an app only adds/enables the app on the site. Do not tell the user that app-specific setup, payout rules, automations, products, or other configuration are complete unless you successfully performed those steps through verified app-specific APIs.
- For third-party apps, the Apps Installer API usually cannot configure the app's internal setup wizard or vendor dashboard. After installation, tell the user the app is installed and guide them to open the app's own dashboard/settings for any remaining setup.

---

## Error Handling

### App Not Installed Error
If you receive an error indicating a required app is not installed, use this recipe to install it before proceeding.

### Third-party app dashboard does not load
If a third-party app's dashboard, settings panel, or setup wizard does not load after installation:
- Do not keep claiming the app is configured or that the user's business rules were applied.
- First use Wix Help Center guidance for app panels that do not open: try an incognito/private window, allow popups for the Wix dashboard, disable ad blockers/privacy extensions for the Wix dashboard, and hard-refresh the page.
- Ask the user for the exact visible state: blank page, endless spinner, popup blocked message, browser console error, or screenshot.
- If the Wix dashboard itself works but only the third-party app iframe/page still fails after those checks, explain that the app's in-app setup is owned by the third-party provider and direct the user to the app's App Market support/contact option or Wix Customer Care with the app name, site name, browser, and screenshot/error.
- Offer to continue once the app screen loads, using the user's saved setup choices to guide field-by-field configuration.

---

## Next Steps

After installing an app:
- For Wix-built apps, configure settings or data only through documented APIs for that app (for example, products for Stores or services for Bookings).
- For third-party apps, open the app's own dashboard/settings and guide the user through what they see. Do not invent internal fields or setup steps.
- If no verified app-specific API or visible setup screen is available, stop at installation confirmation and ask the user to open the app UI or contact the app provider.

---

## Common Pitfalls

- **"I don't have the appDefId"** → Run Step 0. The table in Step 2 only covers Wix-built apps; the App Market has thousands of others.
- **Don't try to scrape the App Market website to find IDs** — pages are client-rendered and the appId is not in the HTML. Use Search Market Listings instead.
- **Don't try `InstallAppFromShareUrl` as a workaround for unknown IDs** — `shareUrlId` is an internal identifier you generally don't have either.
