---
name: "Create Product from Image (Version Router)"
description: "MANDATORY entry point for creating a product from an image. Detects the site's catalog version using Get Catalog Version endpoint, then routes to the correct version-specific recipe (V1 or V3). Always start here — do NOT skip version detection."
---
# RECIPE: Create Product from Image (Version Router)

> **ALWAYS use this recipe as the entry point** when the user wants to create a product from an image. Do NOT skip version detection — even if you believe you know the catalog version from dynamic context.

This recipe determines the site's catalog version and then delegates to the version-specific "Create Product from Image" recipe.

**Prerequisites:**
- The user MUST provide a publicly accessible image URL (starts with `https://` or `http://`).
- If the user uploaded an image directly to the chat instead of providing a URL, you MUST ask them: "Please provide a public URL where the image is hosted (e.g., an Unsplash, Imgur, or any https:// link). I cannot use images uploaded directly to the chat — I need a publicly accessible URL that the Wix Media API can download from."
- Do NOT proceed until you have a valid public URL.

---

## STEP 1: Detect Catalog Version

**API Endpoint:** `GET https://www.wixapis.com/stores/v3/provision/version`

No request body is needed — this is a GET request.

**Expected response:**

```json
{
    "catalogVersion": "V3_CATALOG"
}
```

Possible values for `catalogVersion`:
| Value | Meaning |
|-------|---------|
| `V3_CATALOG` | Site uses Catalog V3 |
| `V1_CATALOG` | Site uses Catalog V1 |
| `STORES_NOT_INSTALLED` | Wix Stores is not installed on this site |

---

## STEP 2: Route to the Correct Recipe

Based on the `catalogVersion` value from Step 1, follow the appropriate path:

### If `V3_CATALOG`:

Follow the **[Create Product from Image (Catalog V3)](create-product-from-image-catalog-v3.md)** recipe.

This is a 2-step flow:
1. Analyze the image and generate product details (name, rich text description, price)
2. Create the product with media inline via `POST https://www.wixapis.com/stores/v3/products`

### If `V1_CATALOG`:

Follow the **[Create Product from Image (Catalog V1)](create-product-from-image.md)** recipe.

This is a 4-step flow:
1. Upload the image to Wix Media Manager
2. Analyze the image and generate product details (name, HTML description, price)
3. Create the product via `POST https://www.wixapis.com/stores/v1/products`
4. Attach the image to the product using Add Product Media endpoint

### If `STORES_NOT_INSTALLED`:

**Do NOT proceed.** Inform the user:
"The Wix Stores app is not installed on this site. Please install Wix Stores first before creating products. You can install it using the [Install Wix Apps](../app-installation/install-wix-apps.md) recipe with the Stores app ID."

---

## Troubleshooting

### Get Catalog Version returns 404 or authorization error
The API key may not have permission to access Stores APIs, or Stores may not be installed. Verify that the Stores app is installed on the site.

### Unsure which version the response indicates
The response field is `catalogVersion`. Map it as follows:
- `V3_CATALOG` → use V3 recipe
- `V1_CATALOG` → use V1 recipe
- Any other value or `STORES_NOT_INSTALLED` → do not proceed with product creation

## References

- [Get Catalog Version](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-versioning/get-catalog-version)
- [Create Product from Image (Catalog V1)](create-product-from-image.md)
- [Create Product from Image (Catalog V3)](create-product-from-image-catalog-v3.md)
- [Catalog Versioning Overview](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-versioning/introduction)
