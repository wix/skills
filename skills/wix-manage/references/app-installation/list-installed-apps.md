---
name: "List Installed Apps"
description: Lists all apps installed on a site using Apps Installer API. Useful for verifying app installations before making API calls and diagnosing authorization errors.
---
# List Installed Apps on a Site

This recipe guides you through listing all installed apps on a Wix site using the Apps Installer REST API. This is useful for verifying app installations before making API calls that require specific apps.

## Prerequisites

- A token scoped to the site: the call takes no site parameter and answers for the site the token is
  for. With the Wix CLI, `npx @wix/cli@latest token --site <siteId>`; through the Wix MCP, `ExecuteWixAPI`
  with `scope: 'site'` and the `siteId`. An account token, with or without a `wix-site-id` header, answers
  an empty list, which looks like a site with no apps.

## Required APIs

- **Apps Installer API**: [Get Installed Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/get-installed-apps)

---

## Step 1: Query Installed Apps

Use the Get Installed Apps endpoint to retrieve all apps installed on a site. It returns every app
instance, including the dozens of platform apps every site carries, as ids only: the response has no
names; match them against the table in Step 2. [Read Account or Site Context](../sites/read-site-context.md)
has the names, but its list can lag an install by many minutes; this call is immediate.

**Endpoint**: `GET https://www.wixapis.com/apps-installer-service/v1/app-instances`

**Request**:
```bash
curl -X GET \
  'https://www.wixapis.com/apps-installer-service/v1/app-instances' \
  -H "Authorization: $(npx @wix/cli@latest token --site <SITE_ID>)" \
  -H 'Content-Type: application/json'
```

**Response**:
```json
{
  "appInstances": [
    {
      "id": "instance-id-1",
      "appDefId": "215238eb-22a5-4c36-9e7b-e7c08025e04e",
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
| Wix Stores | `215238eb-22a5-4c36-9e7b-e7c08025e04e` |
| Wix Checkout & Orders (installed with Stores) | `1380b703-ce81-ff05-f115-39571d94dfcd` |
| Wix Bookings | `13d21c63-b5ec-5912-8397-c3a5ddb27a97` |
| Wix Blog | `14bcded7-0066-7c35-14d7-466cb3f09103` |
| Wix Events | `140603ad-af8d-84a5-2c80-a0f60cb47351` |
| Wix Pricing Plans | `1522827f-c56c-a5c9-2ac9-00f9e6ae12d3` |
| Wix CMS (Wix Data) | `e593b0bd-b783-45b8-97c2-873d42aacaf4` |
| Wix Forms | `225dd912-7dea-4738-8688-4b8c6955ffc2` |
| Wix Restaurants Menus | `b278a256-2757-4f19-9313-c05c783bec92` |
| Wix Restaurants Orders (online ordering) | `9a5d83fd-8570-482e-81ab-cfa88942ee60` |
| Wix Table Reservations | `f9c07de2-5341-40c6-b096-8eb39de391fb` |

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

If you receive `401 Unauthorized` or `403 Forbidden` errors from Wix APIs:

1. **List installed apps** using this recipe
2. **Check if the required app** is in the response
3. **If missing**: Install the app using the [Install Wix Apps](install-wix-apps.md) recipe
4. **Retry the original API call**

---

## Error Handling

### 401 Unauthorized
- Verify your authentication token is valid
- Check that the token has `APP-MARKET.VIEW-INSTALLED-APP` permission

### Empty Response
- Every site carries dozens of platform app instances, so an empty list means the token was not scoped to
  the site (an account token answers empty), not a site with no apps. Mint a site token and call again.

---

## Next Steps

After checking installed apps:
- **If app is missing**: Use the [Install Wix Apps](install-wix-apps.md) recipe to install required apps
- **If app is installed but API fails**: Check API permissions and authentication
- **For Bookings APIs**: See [Bookings recipes](../../SKILL.md) for service setup
