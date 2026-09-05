---
name: "Uninstall Wix Apps"
description: Uninstalls Wix apps from a site using Apps Installer API. Covers listing installed apps first, required request body, verification, and HAS_EDITOR_PRESENCE editor-cleanup handling.
---
# Uninstall Wix Apps from a Site

This recipe guides you through uninstalling a Wix app from a site using the Apps Installer REST API.

## Prerequisites

- Site ID where the app is installed
- The app's `appDefId`
- Clear user intent to remove the app, because uninstalling is a mutating action

If the user only asks whether an app can be removed or how to remove it, answer with the flow and do not call the uninstall endpoint.

## Required APIs

- **Apps Installer API**: [Get Installed Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/get-installed-apps)
- **Apps Installer API**: [Uninstall App](https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/uninstall-app)

---

## Step 0: Find the App ID (skip if you already have it)

If you already know the `appDefId`, skip to Step 1.

For Wix-built apps, use [Apps Created by Wix](https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix). For third-party apps, resolve the app ID using the Search Market Listings API from the [Install Wix Apps](install-wix-apps.md) recipe.

Never guess the `appDefId`. Confirm the app name and ID before uninstalling.

## Step 1: Verify the App Is Installed

Use Get Installed Apps before uninstalling. This prevents unnecessary mutations and lets you report a clear "already not installed" result.

**Endpoint**: `GET https://www.wixapis.com/apps-installer-service/v1/app-instances`

**Request**:
```bash
curl -X GET \
  'https://www.wixapis.com/apps-installer-service/v1/app-instances' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json'
```

Match the target app by `appDefId`. If it is not present, stop and tell the user the app is already not installed on the site.

## Step 2: Uninstall the App

Only continue when the target app is present and the user has clearly asked to remove it.

**Endpoint**: `POST https://www.wixapis.com/apps-installer-service/v1/app-instance/uninstall`

**Request Body**:
```json
{
  "tenant": {
    "tenantType": "SITE",
    "id": "<SITE_ID>"
  },
  "appDefId": "<APP_DEF_ID>"
}
```

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/apps-installer-service/v1/app-instance/uninstall' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant": {
      "tenantType": "SITE",
      "id": "<SITE_ID>"
    },
    "appDefId": "<APP_DEF_ID>"
  }'
```

The successful response body is empty (`{}`).

## Step 3: Verify Removal

After a successful uninstall response, call Get Installed Apps again and confirm the `appDefId` is no longer present.

If the app still appears after a successful uninstall response, report that the uninstall was requested but the app still appears installed, and include the `appDefId` and site ID in the diagnostic summary.

---

## Error Handling

### `HAS_EDITOR_PRESENCE`

Apps that add editor pages, elements, widgets, or app-managed site structure can return:

```text
UNINSTALL_FAILED: reason on MetaSite [HAS_EDITOR_PRESENCE]
```

This is a non-retryable precondition failure. Do not retry the same uninstall call and do not describe it as an auth problem, missing header, bad endpoint, or request-body schema issue.

Tell the user that the app still has editor presence on the site and must be cleaned up in the Editor before the API uninstall can complete. The correct next step is:

1. Open the site in the Editor.
2. Delete or remove the app's pages, app widgets, sections, or elements from the site.
3. Remove the app from **Apps** -> **Manage Apps**, or rerun the uninstall flow after editor cleanup.

For Wix Portfolio, this usually means deleting Portfolio pages and removing Portfolio gallery/widgets before removing the app.

### App Not Installed

If the target `appDefId` is not returned by Get Installed Apps, stop and tell the user the app is already not installed on this site.

### Permission Errors

If the API returns `401` or `403`, verify that the caller is a logged-in Wix user or API key admin with Apps Installer uninstall permissions:

- `APPS_INSTALLER.UNINSTALL_SITE_LEVEL`
- `APPS_INSTALLER.UNINSTALL_ACCOUNT_LEVEL`

### Other `428` Precondition Errors

For any other `428` response, read the `details.applicationError.description` value and report that exact precondition to the user. Do not blindly retry a mutating uninstall call.

---

## Common App Definition IDs

Before uninstalling, refer to [Apps Created by Wix](https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/platform/about-apps-created-by-wix) for the current app IDs.

Some common apps:
| App | appDefId |
|-----|----------|
| Wix Bookings | `13d21c63-b5ec-5912-8397-c3a5ddb27a97` |
| Wix Blog | `14bcded7-0066-7c35-14d7-466cb3f09103` |
| Wix Events | `140603ad-af8d-84a5-2c80-a0f60cb47351` |
| Wix Pricing Plans | `1522827f-c56c-a5c9-2ac9-00f9e6ae12d3` |
| Wix CMS | `e593b0bd-b783-45b8-97c2-873d42aacaf4` |
| Wix Portfolio | `d90652a2-f5a1-4c7c-84c4-d4cdcc41f130` |

---

## Common Pitfalls

- **Do not skip the installed-apps check**: it turns "not installed" into a clear answer instead of a failed mutation.
- **Do not retry `HAS_EDITOR_PRESENCE`**: the same API call will keep failing until editor pages/elements are removed.
- **Do not invent app IDs**: resolve them from official docs or the App Market listing search.
- **Do not claim complete removal until verification passes**: a successful uninstall call should be followed by Get Installed Apps.
