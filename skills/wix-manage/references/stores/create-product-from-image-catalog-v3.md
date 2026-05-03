---
name: "Create Product from Image (Catalog V3)"
description: "AI-powered product creation from 1-3 images. Uploads images to Media Manager, analyzes them to generate name, description, price, info sections (materials, care, specs), SEO meta, and variant options. Interactive review and approval flow. Uses Catalog V3 API — only for sites with CATALOG_V3 catalog version."
---
# RECIPE: Create Product from Image (Catalog V3)

> **Catalog V3 only.** This recipe uses the Catalog V3 API (`/stores/v3/products`). It will NOT work on sites using Catalog V1. **Recommended:** Always start from the [Version Router](create-product-from-image-router.md) which auto-detects the catalog version.

This recipe creates a complete, ready-to-publish Wix Store product from 1-3 product images. It follows a 6-step interactive flow. Steps 4 and 5 require user interaction — do NOT skip them.

**Prerequisites:**
- The site MUST be using **Catalog V3**. If the site uses Catalog V1, do NOT use this recipe.

---

## STEP 1: Collect Images from User

Ask the user to provide **1 to 3 images** of their product. Present the following prompt:

> Upload 1-3 images of your product. If your product comes in different colors or sizes, feel free to upload images of those variants — I'll use them to set up product options automatically.
>
> You can upload images directly or provide public URLs.

**Rules:**
- Accept uploaded files (any image the user sends in the chat) OR publicly accessible URLs (`https://`).
- Minimum: 1 image. Maximum: 3 images.
- Supported formats: JPG, PNG, WEBP.
- All images must be of the **same product**. If the images appear to show completely different products, respond: "It looks like these images show different products. For now, I can create one product at a time. Please upload images of a single product."
- If an image is blurry or unrecognizable, respond: "I wasn't able to identify a product in this image. Try a clearer photo or add a description."

**Optional free-text:** The user may include a text note with context (e.g., "handmade ceramic mug, usually around $25, available in blue and green"). Use this to supplement the image analysis.

---

## STEP 2: Upload Images to Wix Media Manager

For each image provided by the user, upload it to the Wix Media Manager. This ensures reliable wixstatic.com URLs for the product.

**API Endpoint:** `POST https://www.wixapis.com/site-media/v1/files/import`

**For each image, send:**

```json
{
    "url": "<image_url>",
    "mimeType": "image/jpeg",
    "displayName": "product-image-1.jpg"
}
```

**Expected response:**

```json
{
    "file": {
        "id": "e6a89e_19dae9fef9bb48a6b5e392d0d2e5b95d~mv2.jpg",
        "displayName": "product-image-1.jpg",
        "url": "https://static.wixstatic.com/media/e6a89e_19dae9fef9bb48a6b5e392d0d2e5b95d~mv2.jpg",
        "parentFolderId": "media-root",
        "mediaType": "IMAGE",
        "operationStatus": "PENDING"
    }
}
```

**After uploading, save the `file.url` (wixstatic.com URL) for each image.** You need these in Step 6.

**Fallback:** If the upload fails (e.g., the source URL is not publicly accessible, or `operationStatus: "FAILED"`), ask the user: "I couldn't upload that image. Could you provide a publicly accessible URL for it (e.g., from Unsplash, Imgur, or any https:// link)?"

**Media assignment:**
- The **first** successfully uploaded image becomes `media.main`.
- **All** images go into `media.itemsInfo.items[]`.

---

## STEP 3: Analyze Images and Generate Product Details

Analyze **all** uploaded images together. If the user provided a free-text note, incorporate it into the analysis. Generate the following fields:

### 3a. Product Name
A concise, appealing product name optimized for e-commerce discoverability. Maximum 80 characters. Follow the naming convention: `[Brand/Style] [Material] [Product Type]`.

Example: `"Artisan Stoneware Ceramic Mug"` — not generic names like `"Mug"` or `"Product"`.

### 3b. Product Description
A marketing description of 2-4 sentences. Highlight key features, materials, and use case. Adapt tone to the product type (artisanal for handmade, technical for electronics, warm for home goods). This will be formatted as rich text nodes in Step 6.

### 3c. Price with Market Range
- Suggest a retail price based on the product type and industry averages.
- Also determine an approximate **market range** for annotation (e.g., "avg. market: $28-$42"). This range is shown to the user in Step 4 but is NOT sent to the API.

### 3d. Info Sections (only if relevant)
Based on the product type and what's visible in the image, generate category-specific info sections. **Only include sections that are relevant — omit entirely if not applicable.**

| Product Category | Possible Info Sections |
|-----------------|----------------------|
| Clothing/Textiles | "Materials & Composition" (e.g., "100% Organic Cotton"), "Care Instructions" (e.g., "Machine wash cold, tumble dry low") |
| Candles/Fragrance | "Burn Time & Care" (e.g., "Approx. 45 hours burn time. Trim wick to 1/4 inch before each use.") |
| Furniture/Home | "Dimensions & Specs" (e.g., "Height: 30cm, Width: 15cm"), "Assembly" if applicable |
| Electronics | "Technical Specifications", "What's Included" |
| Food/Beverages | "Ingredients", "Nutritional Info", "Storage Instructions" |
| Jewelry | "Materials" (e.g., "Sterling Silver 925"), "Sizing Guide" |
| Skincare/Beauty | "Ingredients", "How to Use" |

Each info section needs: a `uniqueName` (lowercase-hyphenated, e.g., `"care-instructions"`), a `title` (display name, e.g., `"Care Instructions"`), and a description (2-3 sentences).

### 3e. SEO Meta Description
A short meta description (120-160 characters) optimized for search. Include the product type, key materials, and primary use case.

Example: `"Handcrafted stoneware ceramic mug with a matte glaze finish. Perfect for coffee and tea lovers. Microwave and dishwasher safe."`

### 3f. Suggested Options (from images)
Examine the images for visible product attributes that should become variant options.

**CRITICAL: Do NOT invent attributes.** Only suggest options that are:
- Visually confirmed in the image(s), OR
- Explicitly stated by the user in their text note

**Multi-image variant detection:**
- If multiple images show the **same product in different colors** (e.g., one red shirt, one blue shirt), suggest a Color option with those colors as choices.
- If multiple images show the **same product from different angles**, treat them as additional product media — NOT as separate variants.
- If only one image is provided and a color is visible, suggest that single color as a choice and ask the user if the product comes in other colors.

Common options to detect:
- **Color** — visible color(s) across images
- **Size** — if apparel, footwear, or size-varying product

---

## STEP 4: Present Review Card to User (INTERACTIVE)

**You MUST present ALL generated fields to the user and ask for confirmation before proceeding.**

Present a structured review card:

> **Here's what I've generated from your image(s):**
>
> **Name:** [generated name]
>
> **Description:** [generated description text]
>
> **Price:** $[price] *(avg. market: $[low]-$[high])*
>
> **Info Sections:**
> - **[Title 1]:** [summary]
> - **[Title 2]:** [summary]
>
> **SEO Description:** [meta description]
>
> Would you like to:
> - **Refine** — tell me what to change (e.g., "make the description shorter", "the price should be lower")
> - **Regenerate** — I'll start the analysis over, optionally with additional context from you
> - **Approve** — proceed to options and product creation

If the user provided a text note that **contradicts** what's visible in the image (e.g., image shows blue but note says "available in red"), ask the user to clarify before proceeding.

**Wait for user confirmation.** Apply any corrections they request. Do NOT proceed until approved.

---

## STEP 5: Suggest Options and Ask User (INTERACTIVE)

**Present the detected options from Step 3f and ask the user if they want to add product options.**

If options were detected:

> **Based on your image(s), I suggest the following product options:**
>
> - **[Option Name]:** [Choice 1], [Choice 2], ...
>
> Would you like to:
> 1. Use these options as suggested
> 2. Add more choices (e.g., additional colors or sizes)
> 3. Add entirely new options
> 4. Skip options and create a simple product (no variants)

If no options were detected:

> I didn't detect any variant attributes from the image(s). Would you like to add product options (such as Size or Color), or should I create a simple product without variants?

**Wait for user response.** Collect the final list of options and choices based on their answer.

---

## STEP 6: Create the Product

**API Endpoint:** `POST https://www.wixapis.com/stores/v3/products`

Build the request body with all confirmed fields. The write must be **atomic** — either all fields save or none do.

---

### Path A: Simple Product (No Options)

Use this if the user chose to skip options in Step 5.

**Exact request example:**

```json
{
    "product": {
        "name": "Artisan Stoneware Ceramic Mug",
        "description": {
            "nodes": [
                {
                    "type": "PARAGRAPH",
                    "id": "desc1",
                    "nodes": [
                        {
                            "type": "TEXT",
                            "textData": {
                                "text": "A beautifully handcrafted stoneware mug with a smooth matte glaze. Its generous 12oz capacity and comfortable handle make it perfect for your morning coffee or evening tea. Microwave and dishwasher safe."
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
                "url": "https://static.wixstatic.com/media/e6a89e_abc123~mv2.jpg",
                "altText": "Artisan Stoneware Ceramic Mug - Front View"
            },
            "itemsInfo": {
                "items": [
                    {
                        "url": "https://static.wixstatic.com/media/e6a89e_abc123~mv2.jpg",
                        "altText": "Artisan Stoneware Ceramic Mug - Front View"
                    },
                    {
                        "url": "https://static.wixstatic.com/media/e6a89e_def456~mv2.jpg",
                        "altText": "Artisan Stoneware Ceramic Mug - Side View"
                    }
                ]
            }
        },
        "infoSections": [
            {
                "uniqueName": "materials-composition",
                "title": "Materials & Composition",
                "description": {
                    "nodes": [
                        {
                            "type": "PARAGRAPH",
                            "id": "info-materials-1",
                            "nodes": [
                                {
                                    "type": "TEXT",
                                    "textData": {
                                        "text": "Made from high-fired stoneware clay with a food-safe matte glaze finish. Lead-free and cadmium-free."
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
                        "id": "info-materials"
                    }
                }
            },
            {
                "uniqueName": "care-instructions",
                "title": "Care Instructions",
                "description": {
                    "nodes": [
                        {
                            "type": "PARAGRAPH",
                            "id": "info-care-1",
                            "nodes": [
                                {
                                    "type": "TEXT",
                                    "textData": {
                                        "text": "Microwave and dishwasher safe. Hand washing recommended to preserve the glaze finish. Avoid sudden temperature changes."
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
                        "id": "info-care"
                    }
                }
            }
        ],
        "seoData": {
            "tags": [
                {
                    "type": "meta",
                    "props": {
                        "name": "description",
                        "content": "Handcrafted stoneware ceramic mug with matte glaze finish. 12oz capacity, microwave and dishwasher safe. Perfect for coffee and tea lovers."
                    }
                }
            ]
        },
        "price": {
            "actualPrice": {
                "amount": "34.99"
            }
        }
    }
}
```

---

### Path B: Product with Options

Use this if the user confirmed or provided options in Step 5. You MUST define both `options` and `variantsInfo.variants`.

**Rules for variants:**
- Generate ALL combinations of option choices as variants.
- Each variant uses the same price unless the user specified different prices.
- Set `visible: true` for all variants.

**Exact request example (product with Color option detected from two images):**

```json
{
    "product": {
        "name": "Artisan Stoneware Ceramic Mug",
        "description": {
            "nodes": [
                {
                    "type": "PARAGRAPH",
                    "id": "desc1",
                    "nodes": [
                        {
                            "type": "TEXT",
                            "textData": {
                                "text": "A beautifully handcrafted stoneware mug with a smooth matte glaze. Its generous 12oz capacity and comfortable handle make it perfect for your morning coffee or evening tea. Microwave and dishwasher safe."
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
                "url": "https://static.wixstatic.com/media/e6a89e_abc123~mv2.jpg",
                "altText": "Artisan Stoneware Ceramic Mug - Slate Blue"
            },
            "itemsInfo": {
                "items": [
                    {
                        "url": "https://static.wixstatic.com/media/e6a89e_abc123~mv2.jpg",
                        "altText": "Artisan Stoneware Ceramic Mug - Slate Blue"
                    },
                    {
                        "url": "https://static.wixstatic.com/media/e6a89e_def456~mv2.jpg",
                        "altText": "Artisan Stoneware Ceramic Mug - Terracotta"
                    }
                ]
            }
        },
        "options": [
            {
                "name": "Color",
                "optionRenderType": "TEXT_CHOICES",
                "choicesSettings": {
                    "choices": [
                        {
                            "choiceType": "CHOICE_TEXT",
                            "name": "Slate Blue"
                        },
                        {
                            "choiceType": "CHOICE_TEXT",
                            "name": "Terracotta"
                        }
                    ]
                }
            }
        ],
        "variantsInfo": {
            "variants": [
                {
                    "choices": [
                        {
                            "optionChoiceNames": {
                                "optionName": "Color",
                                "choiceName": "Slate Blue",
                                "renderType": "TEXT_CHOICES"
                            }
                        }
                    ],
                    "price": {
                        "actualPrice": {
                            "amount": "34.99"
                        }
                    },
                    "physicalProperties": {},
                    "visible": true
                },
                {
                    "choices": [
                        {
                            "optionChoiceNames": {
                                "optionName": "Color",
                                "choiceName": "Terracotta",
                                "renderType": "TEXT_CHOICES"
                            }
                        }
                    ],
                    "price": {
                        "actualPrice": {
                            "amount": "34.99"
                        }
                    },
                    "physicalProperties": {},
                    "visible": true
                }
            ]
        },
        "infoSections": [
            {
                "uniqueName": "materials-composition",
                "title": "Materials & Composition",
                "description": {
                    "nodes": [
                        {
                            "type": "PARAGRAPH",
                            "id": "info-materials-1",
                            "nodes": [
                                {
                                    "type": "TEXT",
                                    "textData": {
                                        "text": "Made from high-fired stoneware clay with a food-safe matte glaze finish. Lead-free and cadmium-free."
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
                        "id": "info-materials"
                    }
                }
            },
            {
                "uniqueName": "care-instructions",
                "title": "Care Instructions",
                "description": {
                    "nodes": [
                        {
                            "type": "PARAGRAPH",
                            "id": "info-care-1",
                            "nodes": [
                                {
                                    "type": "TEXT",
                                    "textData": {
                                        "text": "Microwave and dishwasher safe. Hand washing recommended to preserve the glaze finish. Avoid sudden temperature changes."
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
                        "id": "info-care"
                    }
                }
            }
        ],
        "seoData": {
            "tags": [
                {
                    "type": "meta",
                    "props": {
                        "name": "description",
                        "content": "Handcrafted stoneware ceramic mug with matte glaze finish. 12oz capacity, microwave and dishwasher safe. Perfect for coffee and tea lovers."
                    }
                }
            ]
        },
        "price": {
            "actualPrice": {
                "amount": "34.99"
            }
        }
    }
}
```

---

**Expected response (partial):**

```json
{
    "product": {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "name": "Artisan Stoneware Ceramic Mug",
        "visible": true,
        "productType": "PHYSICAL",
        "price": {
            "actualPrice": {
                "amount": "34.99"
            }
        }
    }
}
```

**On success:** Report to the user the product name, price, options (if any), info sections added, and confirm the product was created with images attached.

**On failure:** Show an error message and offer to retry. Do NOT leave a partially created product.

---

## Completion Checklist

Before reporting success to the user, verify ALL of the following:

- [ ] Step 1 completed: User provided 1-3 images of a single product.
- [ ] Step 2 completed: All images were uploaded to Media Manager (or fallback URLs collected).
- [ ] Step 3 completed: All product fields generated (name, description, price, info sections, SEO, options).
- [ ] Step 4 completed: User reviewed and approved the generated details.
- [ ] Step 5 completed: User confirmed, modified, or skipped product options.
- [ ] Step 6 completed: Product was created via API and you received a product ID.

---

## Error Handling

### Image is blurry or unrecognizable
Respond: "I wasn't able to identify a product in this image. Try a clearer photo or add a description."

### Images show different products
Respond: "It looks like these images show different products. For now, I can create one product at a time. Please upload images of a single product."

### User text contradicts images
If the user's free-text note conflicts with what's visible (e.g., image shows blue but note says "available in red"), ask the user to clarify before showing the review card.

### Upload fails (operationStatus: FAILED)
Ask for a different image or a public URL. Reliable sources: Unsplash, Pexels, Imgur, public S3/GCS.

### 428 Precondition Required on product creation
The site uses Catalog V1, not V3. Use the [Version Router](create-product-from-image-router.md) to detect and route correctly.

### Description format error
V3 requires rich text nodes, NOT HTML strings. Ensure the description is an object with `nodes` array.

### Variant count mismatch
You must generate ALL combinations of option choices. For example, 2 colors x 2 sizes = 4 variants.

### API write fails
Show an error and offer to retry. Do NOT leave a partially created product.

## References

- [Create Product (Catalog V3)](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/products-v3/create-product)
- [Create Product with Options (Catalog V3)](create-product-with-options-catalog-v3.md)
- [Info Sections API](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/info-sections-v3/introduction)
- [Upload Media to Wix](../media/upload-media-to-wix.md)
- [Create Product from Image (Catalog V1)](create-product-from-image.md)
- [Create Product from Image Router](create-product-from-image-router.md)
- [Catalog Versioning Overview](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-versioning/introduction)
