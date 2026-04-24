---
name: "Create Product from Image"
description: Creates a product by uploading an image to Wix Media, using the LLM to generate the product name, description, and price from the image, and then creating the product with the image attached.
---
# RECIPE: Create Product from Image

Create a product by uploading an image URL to Wix Media Manager, analyzing the image with the LLM to generate product details (name, description, price), creating the product, and attaching the uploaded media.

---

## STEP 1: Upload Image to Wix Media Manager

Import the image from an external URL into the site's Media Manager.

**CRITICAL: The `url` field MUST be a publicly accessible HTTP/HTTPS URL** (e.g., `https://images.unsplash.com/...` or `https://example.com/photo.jpg`). It CANNOT be a local file reference, a client-side file ID, or an internal file token. If the user uploaded an image directly to the chat (not as a URL), ask them to provide a public URL where the image is hosted instead.

```bash
curl -X POST 'https://www.wixapis.com/site-media/v1/files/import' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
    "url": "<IMAGE_URL>",
    "mimeType": "image/jpeg",
    "displayName": "product-image.jpg"
}'
```

**Response:**

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

Save the `url` field (wixstatic.com URL) — you will use it in Step 3 and Step 4.

> **Tip:** The wixstatic.com URL can typically be used immediately. If you need guaranteed consistency, poll until `operationStatus: "READY"` using `GET https://www.wixapis.com/site-media/v1/files/get-file-by-id?fileId={fileId}`.

---

## STEP 2: Analyze the Image with the LLM

Use the original image URL to analyze the image. Based on what you see, generate:

- **name**: A concise, appealing product name (max 80 characters).
- **description**: A short marketing description (2-3 sentences) as an HTML string wrapped in `<p>` tags.
- **price**: A reasonable retail price as a number, based on the type of product shown.

**CRITICAL:** You MUST actually look at the image and describe the real product shown. Do not use placeholder or generic text.

---

## STEP 3: Create the Product

Use the Catalog V1 API to create the product with the LLM-generated details.

```bash
curl -X POST 'https://www.wixapis.com/stores/v1/products' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "product": {
    "name": "<LLM_GENERATED_NAME>",
    "description": "<LLM_GENERATED_DESCRIPTION_HTML>",
    "visible": true,
    "productType": "physical",
    "priceData": {
      "price": <LLM_GENERATED_PRICE>
    }
  }
}'
```

**Example with LLM-generated values:**

```bash
curl -X POST 'https://www.wixapis.com/stores/v1/products' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "product": {
    "name": "Handcrafted Ceramic Mug",
    "description": "<p>A beautifully handcrafted ceramic mug with an earthy glaze finish. Perfect for your morning coffee or tea. Holds approximately 12oz.</p>",
    "visible": true,
    "productType": "physical",
    "priceData": {
      "price": 24.99
    }
  }
}'
```

**Response (partial):**

```json
{
  "product": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "name": "Handcrafted Ceramic Mug",
    "visible": true,
    "productType": "physical",
    "priceData": {
      "price": 24.99
    }
  }
}
```

Save the `product.id` — you need it in Step 4.

---

## STEP 4: Add the Uploaded Media to the Product

Attach the uploaded image to the product using the Add Product Media endpoint.

```bash
curl -X POST 'https://www.wixapis.com/stores/v1/products/<PRODUCT_ID>/media' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "media": [
    {
      "url": "<WIXSTATIC_URL_FROM_STEP_1>"
    }
  ]
}'
```

**Example:**

```bash
curl -X POST 'https://www.wixapis.com/stores/v1/products/a1b2c3d4-e5f6-7890-abcd-ef1234567890/media' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "media": [
    {
      "url": "https://static.wixstatic.com/media/e6a89e_19dae9fef9bb48a6b5e392d0d2e5b95d~mv2.jpg"
    }
  ]
}'
```

This endpoint returns an empty object `{}` on success.

---

## Full Flow Summary

| Step | Action | API | Key Output |
|------|--------|-----|------------|
| 1 | Upload image to Media Manager | `POST /site-media/v1/files/import` | wixstatic.com `url` |
| 2 | Analyze image with LLM | — | Product name, description, price |
| 3 | Create the product | `POST /stores/v1/products` | `product.id` |
| 4 | Attach image to product | `POST /stores/v1/products/{id}/media` | — |

---

## Important Notes

- **Image URL requirements:** Use publicly accessible image URLs. Sources like Unsplash, Pexels, and public cloud storage work reliably. URLs behind authentication or that block hotlinking will fail.
- **Description format:** The Catalog V1 API requires HTML strings for descriptions (e.g., `"<p>text</p>"`). Do NOT use plain text or rich text nodes.
- **Product type:** Only `"physical"` is supported via the API.
- **Media via URL vs mediaId:** You can attach media using either the wixstatic.com `url` (for newly uploaded files) or a `mediaId` (for files already in the Media Manager). This recipe uses `url`.
- **Multiple images:** You can upload multiple images in Step 1 and pass them all in the `media` array in Step 4.
- **Catalog version:** This recipe uses Catalog V1 endpoints. Never use `/stores/v3/` endpoints on a CATALOG_V1 site — they return `428 Precondition Required`. Check the site's catalog version in dynamic context before choosing endpoints.

## Troubleshooting

### Image import fails (operationStatus: FAILED)
The source server may block external requests. Use a different image host (Unsplash, Pexels, public S3/GCS).

### Product created but no image visible
Ensure you used the wixstatic.com URL from Step 1 (not the original external URL) in Step 4. Also verify the product ID matches the one returned in Step 3.

### 428 Precondition Required on product creation
You are using V3 endpoints on a V1 catalog site. Use `POST /stores/v1/products` instead.

## References

- [Upload Media to Wix](../media/upload-media-to-wix.md)
- [Create Product (Catalog V1)](create-product-catalog-v1.md)
- [Add Product Media](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v1/catalog/add-product-media)
