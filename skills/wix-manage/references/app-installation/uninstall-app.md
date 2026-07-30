---
name: "Uninstall App"
description: Uninstalls a Wix app from a site using the Apps Installer API. Covers the HAS_EDITOR_PRESENCE precondition failure and why blind retries never resolve it.
---
# Uninstall an App from a Site

This recipe guides you through uninstalling a Wix app from a site using the Apps Installer REST API, and how to diagnose the most common failure.

## Prerequisites

- Site ID for the site
- `appDefId` of the app to uninstall (use the [List Installed Apps](list-installed-apps.md) recipe if you only know the app by name)

## Required APIs

- **Apps Installer API**: [Uninstall App](https://dev.wix.com/docs/api-reference/business-management/app-installation/app-installation/uninstall-app)

---

## Uninstall the App

**Endpoint**: `POST https://www.wixapis.com/apps-installer-service/v1/app-instance/uninstall`

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

A successful call returns `{}`.

---

## Error Handling

### 428 FAILED_PRECONDITION — `UNINSTALL_FAILED`

The response body's description embeds the real reason as `reason on MetaSite [<reason>]`. The reason is one of:

- **`APP_NOT_FOUND`** — the app was already uninstalled, or never existed on this tenant. Nothing to do.
- **`HAS_EDITOR_PRESENCE`** — the app has pages, widgets, or other components placed in the site's Wix Editor, and can't be uninstalled through this API alone.
- **`ERROR`** — an unexpected internal error. Safe to retry once; if it persists, report the request ID.

### `HAS_EDITOR_PRESENCE`: do NOT blind-retry

**This is not a live editor session lock and it does not expire.** It is a persisted flag on the app's installation state, set because the app has components living in the site's Editor document (e.g. Wix Bookings' `/book-online` page and its widgets). It is only cleared by an actual Wix Editor session removing those components and saving — never by the passage of time.

Concretely:
- Retrying the identical uninstall call will fail identically, no matter how many times or how long you wait.
- Asking the user to close the Wix Editor tab does **nothing** — closing a browser tab isn't the event that clears the flag.
- There is currently **no API** to inspect or force-clear this flag, and no API to remove an app's Editor-placed components on the user's behalf.

**Correct remediation**: the site owner needs to open the site in the actual Wix Editor, delete the app's page(s)/widget(s) from the Editor itself, and save. Only then will an API-level uninstall (or a Dashboard "Remove App" click) succeed. Tell the user this directly instead of retrying — repeated identical retries waste turns and give false hope that the issue is transient.

If the app being removed is not actually needed by site visitors (e.g. all its services/items are hidden), removing it from the Editor may still require going through the Editor's own UI for that app type — there's no cross-app-type generic "detach from Editor" endpoint.

---

## Next Steps

After uninstalling:
- Confirm removal with the [List Installed Apps](list-installed-apps.md) recipe.
- Note that uninstalling and reinstalling the same app doesn't create a new app instance — `status` flips between `INSTALLED`/`UNINSTALLED` and `instanceId` is preserved.

---

## Common Pitfalls

- **Retrying `HAS_EDITOR_PRESENCE` in a loop** — it will never clear on its own; see above.
- **Assuming the error means "someone has the editor open right now"** — it doesn't; it's about the app's Editor-placed components, not a live session.
- **Confusing this with the app just being hidden/unused** — an app can have zero visible pages (e.g. all services marked `hidden: true`) and still have `HAS_EDITOR_PRESENCE`, because the flag tracks Editor component presence, not visibility.
