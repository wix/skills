---
name: "Create Product from Image (Catalog V1)"
description: Creates a product by uploading an image to Wix Media, using the LLM to generate the product name, description, and price from the image, and then creating the product with the image attached. Requires a publicly accessible image URL. Uses Catalog V1 API — only for sites with CATALOG_V1 catalog version.
---
# RECIPE: Create Product from Image (Catalog V1)

> **Recommended:** Always start from the [Version Router](create-product-from-image-router.md) which auto-detects the catalog version and routes here automatically.

> **Catalog V1 only.** This recipe uses the Catalog V1 API (`/stores/v1/products`). It will NOT work on sites using Catalog V3. If the site uses Catalog V3, use the [Create Product from Image (Catalog V3)](create-product-from-image-catalog-v3.md) recipe instead.

This recipe creates a Wix Store product from an image. It has exactly 4 steps that MUST ALL be completed in order. Do NOT report success until ALL 4 steps have been executed successfully.

**Prerequisites:**
- The site MUST be using **Catalog V1**. If the site uses Catalog V3, do NOT use this recipe.
- The user MUST provide a publicly accessible image URL (starts with `https://` or `http://`).
- If the user uploaded an image directly to the chat instead of providing a URL, you MUST ask them: "Please provide a public URL where the image is hosted (e.g., an Unsplash, Imgur, or any https:// link). I cannot use images uploaded directly to the chat — I need a publicly accessible URL that the Wix Media API can download from."
- Do NOT proceed until you have a valid public URL.

---

## STEP 1: Upload the Image to Wix Media Manager (MANDATORY)

**API Endpoint:** `POST https://www.wixapis.com/site-media/v1/files/import`

**Request body fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | The publicly accessible HTTP/HTTPS URL of the image. MUST start with `https://` or `http://`. CANNOT be a file ID, file reference, local path, or chat-uploaded file token. |
| `mimeType` | string | Recommended | The MIME type of the image. Use `image/jpeg` for .jpg/.jpeg files, `image/png` for .png files, `image/webp` for .webp files. |
| `displayName` | string | No | A display name for the file in Media Manager. Include the file extension (e.g., `product-image.jpg`). |

**Exact request example:**

```json
{
    "url": "https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=400",
    "mimeType": "image/jpeg",
    "displayName": "product-image.jpg"
}
```

**Expected response:**

```json
{
    "file": {
        "id": "e6a89e_19dae9fef9bb48a6b5e392d0d2e5b95d~mv2.jpg",
        "displayName": "product-image.jpg",
        "url": "https://static.wixstatic.com/media/e6a89e_19dae9fef9bb48a6b5e392d0d2e5b95d~mv2.jpg",
        "parentFolderId": "media-root",
        "mediaType": "IMAGE",
        "operationStatus": "PENDING"
    }
}
```

**After this step, save these values — you need them later:**
- `file.url` — the wixstatic.com URL (use in Step 4)
- `file.id` — the media file ID

**If the response contains `operationStatus: "FAILED"`:** The source URL is not accessible. Ask the user for a different image URL.

---

## STEP 2: Analyze the Image and Generate Product Details

Look at the image from the URL provided by the user. Based on what you see in the image, generate the following three values:

1. **Product name** — A concise, appealing product name. Maximum 80 characters. Example: `"Premium Spinning Fishing Reel"`.
2. **Product description** — A marketing description of 2-3 sentences. MUST be wrapped in HTML `<p>` tags. Example: `"<p>A sleek black-and-gold spinning fishing reel designed for smooth retrieves. Ideal for freshwater or light saltwater fishing.</p>"`. Do NOT use plain text without `<p>` tags — the API will reject it.
3. **Product price** — A reasonable retail price as a number (not a string). Example: `79.99`.

**CRITICAL:** These values MUST describe the actual product visible in the image. Do NOT use generic placeholder text.

---

## STEP 3: Create the Product

**API Endpoint:** `POST https://www.wixapis.com/stores/v1/products`

**Request body fields:**
| Field | Type | Required | Value |
|-------|------|----------|-------|
| `product.name` | string | Yes | The product name from Step 2 (max 80 chars) |
| `product.description` | string | Yes | The HTML description from Step 2 (wrapped in `<p>` tags) |
| `product.visible` | boolean | Yes | `true` |
| `product.productType` | string | Yes | `"physical"` (only supported value) |
| `product.priceData.price` | number | Yes | The price from Step 2 |

**Exact request example (using values from Step 2):**

```json
{
  "product": {
    "name": "Premium Spinning Fishing Reel",
    "description": "<p>A sleek black-and-gold spinning fishing reel designed for smooth retrieves and dependable performance. Ideal for anglers targeting freshwater or light saltwater species.</p>",
    "visible": true,
    "productType": "physical",
    "priceData": {
      "price": 79.99
    }
  }
}
```

**Expected response (partial):**

```json
{
  "product": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "Premium Spinning Fishing Reel",
    "visible": true,
    "productType": "physical",
    "priceData": {
      "price": 79.99
    }
  }
}
```

**After this step, save this value — you need it in Step 4:**
- `product.id` — the product ID (a UUID string like `"a1b2c3d4-e5f6-7890-abcd-ef1234567890"`)

---

## STEP 4: Attach the Image to the Product (MANDATORY — DO NOT SKIP)

**API Endpoint:** `POST https://www.wixapis.com/stores/v1/products/{id}/media`

Replace `{id}` in the URL with the `product.id` from Step 3.

**Request body fields:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `media` | array | Yes | Array of media objects to attach |
| `media[].url` | string | Yes | The `file.url` (wixstatic.com URL) from Step 1. Do NOT use the original image URL — use the wixstatic.com URL returned by the Media Manager. |

**Exact request example:**

URL: `POST https://www.wixapis.com/stores/v1/products/a1b2c3d4-e5f6-7890-abcd-ef1234567890/media`

```json
{
  "media": [
    {
      "url": "https://static.wixstatic.com/media/e6a89e_19dae9fef9bb48a6b5e392d0d2e5b95d~mv2.jpg"
    }
  ]
}
```

**Expected response:** Empty object `{}` — this means success.

**This step is MANDATORY.** The product is not complete without its image. Do NOT report success to the user before this step returns successfully.

---

## Completion Checklist

Before reporting success to the user, verify ALL of the following:

- [ ] Step 1 completed: Image was uploaded to Wix Media Manager and you received a wixstatic.com URL.
- [ ] Step 2 completed: You analyzed the image and generated a name, description, and price.
- [ ] Step 3 completed: Product was created and you received a product ID.
- [ ] Step 4 completed: Image was attached to the product using the Add Product Media endpoint.

Only after ALL 4 steps succeed, report to the user: the product name, price, and that it was created with the image attached.

---

## Troubleshooting

### "The url field must be a publicly accessible URL"
The user provided a file ID, file token, or local file reference instead of a public URL. Ask for a URL that starts with `https://`.

### Image import fails (operationStatus: FAILED)
The source server blocks external requests. Ask the user for a different image URL. Reliable sources: Unsplash (`images.unsplash.com`), Pexels (`images.pexels.com`), Imgur, public S3/GCS buckets.

### Product created but no image visible
You used the original external URL instead of the wixstatic.com URL in Step 4. Always use the `file.url` from Step 1's response.

### 428 Precondition Required on product creation
The site uses Catalog V3, not V1. Use `POST https://www.wixapis.com/stores/v3/products` instead and format the description as rich text nodes (not HTML).

## References

- [Upload Media to Wix](../media/upload-media-to-wix.md)
- [Create Product (Catalog V1)](create-product-catalog-v1.md)
- [Add Product Media](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/add-product-media)
