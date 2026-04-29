---
name: "Create Product from Image (Catalog V3)"
description: Creates a product by analyzing an image with the LLM to generate product name, description, and price, then creating the product with the image attached inline. Requires a publicly accessible image URL. Uses Catalog V3 API — only for sites with CATALOG_V3 catalog version.
---
# RECIPE: Create Product from Image (Catalog V3)

> **Catalog V3 only.** This recipe uses the Catalog V3 API (`/stores/v3/products`). It will NOT work on sites using Catalog V1. If the site uses Catalog V1, use the [Create Product from Image (Catalog V1)](create-product-from-image.md) recipe instead. Check the site's catalog version in dynamic context before proceeding, or use the [Create Product from Image Router](create-product-from-image-router.md) to auto-detect.

This recipe creates a Wix Store product from an image. It has exactly 2 steps that MUST ALL be completed in order. Do NOT report success until ALL 2 steps have been executed successfully.

**Prerequisites:**
- The site MUST be using **Catalog V3**. If the site uses Catalog V1, do NOT use this recipe.
- The user MUST provide a publicly accessible image URL (starts with `https://` or `http://`).
- If the user uploaded an image directly to the chat instead of providing a URL, you MUST ask them: "Please provide a public URL where the image is hosted (e.g., an Unsplash, Imgur, or any https:// link). I cannot use images uploaded directly to the chat — I need a publicly accessible URL that the Wix Media API can download from."
- Do NOT proceed until you have a valid public URL.

---

## STEP 1: Analyze the Image and Generate Product Details

Look at the image from the URL provided by the user. Based on what you see in the image, generate the following three values:

1. **Product name** — A concise, appealing product name. Maximum 80 characters. Example: `"Premium Spinning Fishing Reel"`.
2. **Product description** — A marketing description of 2-3 sentences. This MUST be formatted as **rich text nodes** (NOT HTML). See the exact format in Step 2's request body.
3. **Product price** — A reasonable retail price as a string (e.g. `"79.99"`).

**CRITICAL:** These values MUST describe the actual product visible in the image. Do NOT use generic placeholder text.

---

## STEP 2: Create the Product with Inline Media

**API Endpoint:** `POST https://www.wixapis.com/stores/v3/products`

In Catalog V3, media is passed directly in the product creation request — no separate upload or attach step is needed. The image URL is included inline in the `media` field.

**Request body fields:**
| Field | Type | Required | Value |
|-------|------|----------|-------|
| `product.name` | string | Yes | The product name from Step 1 (max 80 chars) |
| `product.description` | object | Yes | Rich text nodes object from Step 1 |
| `product.productType` | string | Yes | `"PHYSICAL"` (uppercase) |
| `product.physicalProperties` | object | Yes | Empty object `{}` |
| `product.media.main.url` | string | Yes | The publicly accessible image URL provided by the user |
| `product.media.main.altText` | string | Yes | A short description of the image for accessibility |
| `product.media.itemsInfo.items` | array | Yes | Array with at least one item containing `url` and `altText` |
| `product.price.actualPrice.amount` | string | Yes | The price from Step 1 as a string (e.g. `"79.99"`) |

**Exact request example (using values from Step 1):**

```json
{
    "product": {
        "name": "Premium Spinning Fishing Reel",
        "description": {
            "nodes": [
                {
                    "type": "PARAGRAPH",
                    "id": "desc1",
                    "nodes": [
                        {
                            "type": "TEXT",
                            "textData": {
                                "text": "A sleek black-and-gold spinning fishing reel designed for smooth retrieves and dependable performance. Ideal for anglers targeting freshwater or light saltwater species."
                            }
                        }
                    ],
                    "paragraphData": {
                        "textStyle": {
                            "textAlignment": "AUTO"
                        }
                    }
                }
            ],
            "metadata": {
                "version": 1,
                "id": "product-desc-001"
            }
        },
        "productType": "PHYSICAL",
        "physicalProperties": {},
        "media": {
            "main": {
                "url": "https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=400",
                "altText": "Premium Spinning Fishing Reel - Product Image"
            },
            "itemsInfo": {
                "items": [
                    {
                        "url": "https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=400",
                        "altText": "Premium Spinning Fishing Reel - Product View"
                    }
                ]
            }
        },
        "price": {
            "actualPrice": {
                "amount": "79.99"
            }
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
        "productType": "PHYSICAL",
        "price": {
            "actualPrice": {
                "amount": "79.99"
            }
        },
        "media": {
            "main": {
                "url": "https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=400",
                "altText": "Premium Spinning Fishing Reel - Product Image"
            }
        }
    }
}
```

---

## Completion Checklist

Before reporting success to the user, verify ALL of the following:

- [ ] Step 1 completed: You analyzed the image and generated a name, description (rich text nodes), and price.
- [ ] Step 2 completed: Product was created with the image attached inline and you received a product ID.

Only after ALL 2 steps succeed, report to the user: the product name, price, and that it was created with the image attached.

---

## Troubleshooting

### "The url field must be a publicly accessible URL"
The user provided a file ID, file token, or local file reference instead of a public URL. Ask for a URL that starts with `https://`.

### Image not appearing on the product
Verify that the `media.main.url` and `media.itemsInfo.items[].url` both contain the correct publicly accessible URL. Both fields must be set.

### 428 Precondition Required on product creation
The site uses Catalog V1, not V3. Use `POST https://www.wixapis.com/stores/v1/products` instead and format the description as HTML (not rich text nodes). See [Create Product from Image (Catalog V1)](create-product-from-image.md).

### Description format error
V3 requires rich text nodes, NOT HTML strings. Ensure the description is an object with `nodes` array, not a string like `"<p>text</p>"`.

## References

- [Create Product (Catalog V3)](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/products-v3/create-product)
- [Create Product with Options (Catalog V3)](create-product-with-options-catalog-v3.md)
- [Create Product from Image (Catalog V1)](create-product-from-image.md)
- [Create Product from Image Router](create-product-from-image-router.md)
- [Catalog Versioning Overview](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-versioning/introduction)
