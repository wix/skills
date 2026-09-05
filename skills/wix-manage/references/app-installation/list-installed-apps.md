---
name: "List Installed Apps"
description: Lists all apps installed on a site using Apps Installer API. Useful for verifying app installations before making API calls and diagnosing authorization errors.
---
# List Installed Apps on a Site

This recipe guides you through listing all installed apps on a Wix site using the Apps Installer REST API. This is useful for verifying app installations before making API calls that require specific apps.

## Prerequisites

- Site ID for the site you want to check

## Required APIs

- **Apps Installer API**: [Get Installed Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/get-installed-apps)

---

## Step 1: Query Installed Apps

Use the Get Installed Apps endpoint to retrieve all apps installed on a site.

**Endpoint**: `GET https://www.wixapis.com/apps-installer-service/v1/app-instances`

**Request**:
```bash
curl -X GET \
  'https://www.wixapis.com/apps-installer-service/v1/app-instances' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json'
```

**Response**:
```json
{
  "appInstances": [
    {
      "id": "instance-id-1",
      "appDefId": "1380b703-ce81-ff05-f115-39571d94dfcd",
      "version": "^0.0.0",
      "enabled": true,
      "status": "UNKNOWN"
    },
    {
      "id": "instance-id-2",
      "appDefId": "13d21c63-b5ec-5912-8397-c3a5ddb27a97",
      "enabled": true,
      "status": "UNKNOWN"
    }
  ]
}
```

---

## Step 2: Identify Apps by Definition ID

Match the `appDefId` values from the response against known Wix app IDs.

### Common Wix App Definition IDs

| App | appDefId |
|-----|----------|
| Wix Stores | `1380b703-ce81-ff05-f115-39571d94dfcd` |
| Wix Bookings | `13d21c63-b5ec-5912-8397-c3a5ddb27a97` |
| Wix Blog | `14bcded7-0066-7c35-14d7-466cb3f09103` |
| Wix Events | `140603ad-af8d-84a5-2c80-a0f60cb47351` |
| Wix Pricing Plans | `1522827f-c56c-a5c9-2ac9-00f9e6ae12d3` |
| Wix Restaurants | `13e8d036-5516-6f75-e025-2aca3b5d7930` |

For a complete list, see [Apps Created by Wix](https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix).

---

## Use Cases

### Verify App Before API Calls

Before calling APIs that require specific apps (e.g., Bookings, Stores), check if the app is installed:

```javascript
// Pseudocode example
const installedApps = await getInstalledApps(siteId);
const bookingsAppId = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";

const hasBookings = installedApps.appInstances.some(
  app => app.appDefId === bookingsAppId
);

if (!hasBookings) {
  // Install Bookings app first
  // See: Install Wix Apps recipe
}
```

### Diagnose Authorization Errors

If you receive `401 Unauthorized` or `403 Forbidden` errors from Wix APIs, first tell the two failure modes apart — they need different fixes:

- **App not installed** — typically a `401` with a message like `"No <app> instanceId found"`. Fix: **list installed apps** using this recipe; if the required app is missing, install it with the [Install Wix Apps](install-wix-apps.md) recipe, then retry.
- **App installed, but the calling identity lacks the permission scope for that app's API** — typically a `403` with a message like `"The auth identity is not allowed on this resource for this site/account"`. Installing the app again will **not** fix this — the app is already there. This means the token making the call doesn't carry the required scope (e.g. Blog, Stores) for this identity:
  - **API key**: open the [API Keys Manager](https://manage.wix.com/account/api-keys) and check the key's assigned permissions; add the missing one and retry.
  - **OAuth app**: check the app's granted [permission scopes](https://dev.wix.com/docs/build-apps/develop-your-app/access/authorization/configure-permissions-for-your-app) in the Dev Center and add the missing one.
  - **Wix MCP connector (e.g. the built-in Claude connector)**: disconnecting/reconnecting does **not** let you add scopes — the connector's OAuth grant is fixed by its registration, not chosen per-session, and there's currently no self-service scope picker. If a required scope is missing, report it as feedback rather than repeatedly retrying reconnect.

---

## Error Handling

### 401 Unauthorized
- Verify your authentication token is valid
- Check that the token has `APP-MARKET.VIEW-INSTALLED-APP` permission

### Empty Response
- The site may have no additional apps installed beyond core Wix functionality
- This is normal for new or minimal sites

---

## Next Steps

After checking installed apps:
- **If app is missing**: Use the [Install Wix Apps](install-wix-apps.md) recipe to install required apps
- **If app is installed but API fails with 403**: See [Diagnose Authorization Errors](#diagnose-authorization-errors) above — this is almost always a missing permission scope on the caller's token, not an installation problem
- **For Bookings APIs**: See [Bookings recipes](../../SKILL.md) for service setup
