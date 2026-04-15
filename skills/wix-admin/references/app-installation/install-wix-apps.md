---
name: "Install Wix Apps"
description: Installs Wix apps on a site using Apps Installer API. Covers enabling Velo (Wix Code), app installation, and common app definition IDs.
---
# Install Wix Apps on a Site

This recipe guides you through installing Wix apps on a site using the Apps Installer REST API, including enabling Velo (Wix Code) when needed.

## Prerequisites

- Site ID where apps will be installed
- Knowledge of which app to install (see [Apps Created by Wix](https://dev.wix.com/docs/rest/articles/get-started/apps-created-by-wix))

## Required APIs

- **Apps Installer API**: [REST](https://dev.wix.com/docs/rest/business-management/app-installation/install-app)

---

## Step 1: Enable Velo (Wix Code) if Needed

If you receive the error `WDE0110: Wix Code not enabled`, you must first enable Velo on the site.

**Endpoint**: `POST https://www.wixapis.com/mcp-serverless/v1/velo/provision`

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/mcp-serverless/v1/velo/provision/' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Response**: Empty body on success.

### IMPORTANT NOTES:
- Only call this endpoint if you receive the `WDE0110` error
- This is a one-time operation per site

---

## Step 2: Install the Wix App

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

Before installing, refer to the [Apps Created by Wix](https://dev.wix.com/docs/rest/articles/get-started/apps-created-by-wix) documentation to find the correct `appDefId` for the app you want to install.

Some common apps:
| App | appDefId |
|-----|----------|
| Wix Stores | `215238eb-22a5-4c36-9e7b-e7c08025e04e` |
| Wix Bookings | `13d21c63-b5ec-5912-8397-c3a5ddb27a97` |
| Wix Blog | `14bcded7-0066-7c35-14d7-466cb3f09103` |
| Wix Events | `140603ad-af8d-84a5-2c80-a0f60cb47351` |
| Wix Pricing Plans | `1522827f-c56c-a5c9-2ac9-00f9e6ae12d3` |

### IMPORTANT NOTES:
- I MUST NEVER guess the `appDefId` - always refer to the official documentation
- The `tenantType` MUST be `SITE`
- The `id` in tenant is the site's metaSiteId

---

## Error Handling

### App Not Installed Error
If you receive an error indicating a required app is not installed, use this recipe to install it before proceeding.

### WDE0110: Wix Code not enabled
Call the Velo provision endpoint (Step 1) first, then retry the original operation.

---

## Next Steps

After installing an app:
- Configure the app's settings using its specific APIs
- Set up any required app-specific data (products for Stores, services for Bookings, etc.)
