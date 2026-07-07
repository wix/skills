---
name: "Add Store Pages to Site"
description: Adds missing checkout and cart pages to a site when Stores app is installed. Used when store pages are missing after migration or setup issues.
---
# Add Store Pages to Site

This recipe demonstrates how to add checkout and cart pages to a Wix site when the Stores app is installed but pages are missing.

## Overview

When Wix Stores is installed on a site, it should automatically create cart and checkout pages. However, in some cases these pages may be missing. This recipe provides a way to add them programmatically.

## Prerequisites

- Wix Stores app installed on the site
- API access with site management permissions

---

## Step 1: Add Pages to Site

**Endpoint**: `POST https://www.wix.com/_api/add-pages-to-site/install`

**Request**:
```bash
curl -X POST \
  'https://www.wix.com/_api/add-pages-to-site/install' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Response**: `200` with `{"pagesAdded": ["<widgetId>", ...]}` when the call completes within the gateway timeout. On sites with many installed apps the call usually does **not** complete in time — see the notes below.

### If the User Already Got a 504

Answer as troubleshooting, not as a failed install:

| What happened | What to do | Why |
| --- | --- | --- |
| `504 Gateway Timeout` after ~30 seconds | Wait 1–2 minutes, then verify that the cart/checkout pages exist and checkout works | The gateway timed out while the server-side install may still be running |
| Pages now exist | Do not call the endpoint again | The repair completed despite the timeout |
| Pages are still missing after waiting | Call the endpoint once more, then verify again | A second call is only warranted after the first run had time to finish |

Do not describe an immediate retry as harmless or normally idempotent. The endpoint only adds missing pages, but each call still starts a full scan/add/republish pass, so retrying before the first pass finishes can create overlapping work and another publish.

### IMPORTANT NOTES:
- This endpoint adds missing store pages (cart, checkout) if they don't exist
- The request body is empty - no parameters needed
- Only required Authorization header
- **Long-running — a 504 does not mean failure.** The endpoint synchronously scans every app installed on the site, adds any missing essential pages, and republishes the site. On real sites this often exceeds the ~30-second gateway timeout, so the call returns `504 Gateway Timeout` (sometimes wrapped as `Internal Server Error` with `errorCode: -100`) while the installation keeps running server-side and usually completes.
- **On 504, do not retry immediately.** An immediate retry starts a second full install-and-republish pass. Wait 1–2 minutes, then verify the missing pages now exist (check the site's store pages, or have the user refresh and re-test checkout). Call the endpoint again only if the pages are still missing.
- **Call it from an HTTP tool that is allowed to reach `www.wix.com`** (for example, the Wix MCP `CallWixSiteAPI` tool). Sandboxed code-execution tools (such as `ExecuteWixAPI`) block this host and fail with `403 Forbidden: requests to www.wix.com not allowed`.
- **The operation republishes the site.** Confirm with the user before running it on a live site.

---

## When to Use This Recipe

Use this recipe when:
- Checkout flow fails because checkout page is missing
- Cart functionality doesn't work
- Store was migrated or had page issues
- You receive errors about missing store pages

---

## Next Steps

After adding pages:
- Verify checkout flow works by creating a test order
- Customize page designs if needed via the Editor
- Set up payment methods if not already configured
