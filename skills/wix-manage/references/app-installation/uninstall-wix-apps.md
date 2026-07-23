---
name: "Uninstall Wix Apps"
description: Uninstalls Wix apps from a site using Apps Installer API. Covers resolving app IDs, confirming destructive removal, verifying uninstall, and avoiding false promises about product dashboard entry points.
---
# Uninstall Wix Apps from a Site

This recipe guides you through uninstalling an app from a Wix site using the Apps Installer REST API.

Use this when a user explicitly wants to remove or uninstall an app from their site.

## Prerequisites

- Site ID where the app is installed
- The app's `appDefId`, or enough information to resolve it safely
- User confirmation for destructive removal if the user has not already clearly requested uninstalling that exact app

## Required APIs

- **Apps Installer API**: [Uninstall App](https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/uninstall-app)
- **Apps Installer API**: [Get Installed Apps](https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/get-installed-apps)
- **Market Listing API**: [Search Market Listings](https://dev.wix.com/docs/api-reference/app-management/market-listing/search-market-listings) when you need to resolve a third-party app by name

---

## Step 0: Resolve the App ID Safely

If you already have the exact `appDefId` from the conversation or a trusted API response, use it.

If the user only provides an app name, resolve the app first:

1. Use [Search Market Listings](https://dev.wix.com/docs/api-reference/app-management/market-listing/search-market-listings) to find matching App Market listings.
2. Match on the listing's display name and publisher when possible.
3. Use the returned `appId` as the `appDefId`.
4. If multiple plausible apps match, ask the user which app to uninstall.

Do not guess an `appDefId` from memory or from an unrelated app with a similar name.

---

## Step 1: Check Whether the App Is Installed

Use Get Installed Apps to verify the app is currently installed on the site.

**Endpoint**: `GET https://www.wixapis.com/apps-installer-service/v1/app-instances`

**Request**:
```bash
curl -X GET \
  'https://www.wixapis.com/apps-installer-service/v1/app-instances' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json'
```

Look for an `appInstances` entry whose `appDefId` matches the app you plan to uninstall.

If the app is not present, do not call uninstall. Tell the user the app is not installed and explain any remaining visible product area as a separate dashboard/product entry point when relevant.

---

## Step 2: Confirm Destructive Removal

Uninstalling an app can remove app-specific setup or disconnect app functionality.

Ask for confirmation unless the user already clearly confirmed the exact uninstall action in the current task, for example:

- "Remove the Twipla app."
- "Uninstall Wix Blog from this site."
- A prior explicit selection from a removal confirmation widget.

If the user only asked how to disable, hide, or stop a feature, explain the difference between disabling settings and uninstalling the app before removing anything.

---

## Step 3: Uninstall the App

Use the Uninstall App endpoint with a `SITE` tenant.

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

**Response**:
```json
{}
```

An empty successful response means the uninstall request succeeded.

---

## Step 4: Verify the App Instance Is Gone

Call Get Installed Apps again and confirm the target `appDefId` no longer appears.

Report the verification in user-facing language:

- Good: "I removed the app from your site's installed apps."
- Good: "I verified that the app no longer appears in your installed apps list."
- Bad: "The feature is completely removed from the dashboard."

---

## Important Limitations

Uninstalling an app removes the app instance from the tenant. It does not guarantee that every Wix product menu item, dashboard entry point, historical data page, iframe shell, or analytics surface disappears immediately.

If a product area remains visible after uninstall:

1. Re-check installed apps and confirm the target `appDefId` is absent.
2. Search installed apps for another related app if the user mentions a different app name or brand.
3. Explain that the remaining visible page may be a Wix product entry point or historical/analytics surface, not proof that the app is still installed.
4. Do not claim you can fully hide or remove that entry point unless you have a documented API or setting for that product.
5. If no documented API or setting exists, tell the user what was removed and route them to the relevant product settings or support path.

### Session Recordings / Twipla Example

For Session Recordings, a site may still show **Analytics → Session Recordings** after the Twipla app instance is uninstalled. Treat that as a separate product/dashboard visibility question.

After uninstalling Twipla:

- Verify that the Twipla `appDefId` no longer appears in Get Installed Apps.
- Do not promise the Analytics → Session Recordings entry point or iframe will disappear.
- If the user wants recordings to stop, say the app instance has been removed and recommend checking Session Recordings settings or Wix Support for remaining dashboard visibility.

---

## Error Handling

### 401 Unauthorized or 403 Forbidden
- Verify the caller has Apps Installer uninstall permissions.
- Required permissions include `APPS_INSTALLER.UNINSTALL_SITE_LEVEL` for site-level uninstall.

### App Is Not Installed
- Do not retry uninstall blindly.
- Confirm whether the user means a different app name or a related product feature.

### Ambiguous App Name
- Ask the user to choose the exact app before uninstalling.
- Use Search Market Listings and Get Installed Apps to narrow the options.

---

## Common Pitfalls

- **Do not guess app IDs.** Resolve third-party apps by App Market listing or use an installed app entry from Get Installed Apps.
- **Do not uninstall based only on a dashboard menu label.** Menu labels can refer to product entry points, not app instances.
- **Do not promise UI cleanup.** App uninstall and dashboard navigation visibility are different product behaviors.
- **Do not use install APIs to reverse an uninstall.** If the user changes their mind later, follow the [Install Wix Apps](install-wix-apps.md) recipe.
