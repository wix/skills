---
name: "Add Store Pages to Site"
description: Adds missing checkout and cart pages to a site when Stores app is installed. Does not restore Product Page, category pages, product detail routes, or product URL slugs.
---
# Add Store Pages to Site

This recipe demonstrates how to add checkout and cart pages to a Wix site when the Stores app is installed but those pages are missing.

## Overview

When Wix Stores is installed on a site, it should automatically create cart and checkout pages. However, in some cases these pages may be missing. This recipe provides a way to add only those checkout/cart pages programmatically.

## Scope and Limitations

Use this recipe only for missing checkout or cart pages.

Do not use this recipe as a fix for missing Product Page, product detail pages, category pages, product URL slugs, or root-level product URLs returning 404. The endpoint in this recipe does not recreate the Wix Stores Product Page and does not repair product routing.

If a user reports that product URLs return 404 while category pages work, or says that **Product Page** is absent from **Editor -> Pages -> Store Pages**, explain that this recipe cannot restore that page. Guide the user to verify the Product Page in the Editor / Store Pages panel, reinstall or repair Wix Stores only with explicit consent and backup guidance, or escalate to Wix Stores support/product ownership when no documented API is available. Do not claim this recipe restored the Product Page.

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

**Response**: Empty body on success.

### IMPORTANT NOTES:
- This endpoint adds missing checkout and cart pages if they don't exist
- This endpoint does not add or restore the Product Page, category pages, product detail pages, or product URL routes
- The request body is empty - no parameters needed
- Only required Authorization header

---

## When to Use This Recipe

Use this recipe when:
- Checkout flow fails because checkout page is missing
- Cart functionality doesn't work
- Store was migrated or had checkout/cart page issues
- You receive errors specifically about missing cart or checkout pages

Do not use this recipe when:
- Product URLs or product slugs return 404
- Category pages work but individual product pages do not
- The Editor's Store Pages list is missing **Product Page**
- The user asks to restore, recreate, or add a Wix Stores Product Page

---

## Next Steps

After adding pages:
- Verify checkout flow works by creating a test order
- Customize page designs if needed via the Editor
- Set up payment methods if not already configured
