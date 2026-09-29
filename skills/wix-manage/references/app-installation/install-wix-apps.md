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
| Wix Multilingual | `14d84998-ae09-1abf-c6fc-3f3cace5bf19` |
| Wix Pricing Plans | `1522827f-c56c-a5c9-2ac9-00f9e6ae12d3` |
| Wix CMS | `e593b0bd-b783-45b8-97c2-873d42aacaf4` |

### IMPORTANT NOTES:
- NEVER guess the `appDefId`. For Wix-built apps, use the table above. For any other app, resolve the ID using Step 0 (Search Market Listings).
- The `tenantType` MUST be `SITE`
- The `id` in tenant is the site's metaSiteId
- The endpoint, request body, and appDefId table above are complete and canonical for a listed Wix-built app — don't re-verify them with a separate REST/API doc search first; that's a redundant round-trip.
- Don't spend a call checking whether the app is already installed before installing it. If the task or the error you're handling already tells you it isn't installed (e.g. a fresh site, or a `*_NOT_INSTALLED` error), just call install directly.

---

## Error Handling

### App Not Installed Error
If you receive an error indicating a required app is not installed (e.g. a `428` or a `*_NOT_INSTALLED` error code), install the app it names using its appDefId, then retry the call that failed. If the user's own request already implies this app is needed — i.e. doing what they asked requires a feature only that app provides — just install it as part of doing that task; don't stop to ask permission or name the app first. Confirm first only when the app isn't implied by anything the user asked for.

**Example** (install the missing app, then retry the call that surfaced the error — all in one script):
```javascript
async function() {
  const siteId = "<SITE_ID>";

  await wix.request({
    method: "POST",
    url: "https://www.wixapis.com/apps-installer-service/v1/app-instance/install",
    body: {
      tenant: { tenantType: "SITE", id: siteId },
      appInstance: { appDefId: "<APP_DEF_ID>" }
    }
  });

  return await wix.request({
    method: "<METHOD>",
    url: "<ORIGINAL_URL_THAT_FAILED>",
    body: { /* original request body */ }
  });
}
```

### App-Dependent Call Fails Right After Install (Propagation Delay)
Installing an app and then immediately calling one of its own APIs — e.g. calling Set Multilingual Mode right after installing Wix Multilingual — can race the platform's install propagation, surfacing as a not-found error on the dependent call even though the install itself already succeeded.

**Example** (retry with backoff past the propagation delay instead of surfacing the error, all in one script):
```javascript
async function() {
  const siteId = "<SITE_ID>";

  async function requestWithRetry(requestOptions, delaysMs = [1000, 2000, 4000]) {
    let lastError;
    try {
      return await wix.request(requestOptions);
    } catch (err) {
      lastError = err;
    }
    for (const delayMs of delaysMs) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      try {
        return await wix.request(requestOptions);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }

  await wix.request({
    method: "POST",
    url: "https://www.wixapis.com/apps-installer-service/v1/app-instance/install",
    body: {
      tenant: { tenantType: "SITE", id: siteId },
      appInstance: { appDefId: "14d84998-ae09-1abf-c6fc-3f3cace5bf19" }
    }
  });

  return await requestWithRetry({
    method: "POST",
    url: "https://www.wixapis.com/locale-settings/v2/settings/mode",
    body: { multilingualModeEnabled: true }
  });
}
```
Chain any further calls inside this same function through the same `requestWithRetry` helper, after the first one succeeds.

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
