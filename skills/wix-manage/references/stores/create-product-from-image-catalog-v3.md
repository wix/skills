---
name: "Create Product from Image (Catalog V3)"
description: Creates a product from an image using an interactive flow. Analyzes the image, presents generated details for user confirmation, suggests product options (Color, Size, etc.) based on what's visible in the image, and creates the product with inline media. Uses Catalog V3 API — only for sites with CATALOG_V3 catalog version.
---
# RECIPE: Create Product from Image (Catalog V3)

> **Catalog V3 only.** This recipe uses the Catalog V3 API (`/stores/v3/products`). It will NOT work on sites using Catalog V1. **Recommended:** Always start from the [Version Router](create-product-from-image-router.md) which auto-detects the catalog version.

This recipe creates a Wix Store product from an image through an interactive flow. It has 4 steps that MUST be completed in order. Steps 2 and 3 require user interaction — do NOT skip them.

**Prerequisites:**
- The site MUST be using **Catalog V3**. If the site uses Catalog V1, do NOT use this recipe.
- The user MUST provide a publicly accessible image URL (starts with `https://` or `http://`).
- If the user uploaded an image directly to the chat instead of providing a URL, you MUST ask them: "Please provide a public URL where the image is hosted (e.g., an Unsplash, Imgur, or any https:// link). I cannot use images uploaded directly to the chat — I need a publicly accessible URL that the Wix Media API can download from."
- Do NOT proceed until you have a valid public URL.

---

## STEP 1: Analyze the Image and Generate Product Details

Look at the image from the URL provided by the user. Based on what you see in the image, generate the following:

1. **Product name** — A concise, appealing product name. Maximum 80 characters.
2. **Product description** — A marketing description of 2-3 sentences (will be formatted as rich text nodes in Step 4).
3. **Product price** — A reasonable retail price as a string (e.g. `"79.99"`).
4. **Suggested options** — Identify visible product attributes from the image that could become product options. Common options to look for:
   - **Color** — If the product has a visible color, suggest it as a choice (e.g., "Black", "Red", "Navy Blue")
   - **Size** — If the product is apparel, footwear, or comes in sizes, suggest likely sizes (e.g., "S", "M", "L", "XL" or "8", "9", "10")
   - **Material** — If the material is identifiable (e.g., "Leather", "Cotton", "Stainless Steel")
   - **Style/Variant** — Any other visible variant (e.g., "With Lid", "Without Lid")

**CRITICAL:** All values MUST describe the actual product visible in the image. Do NOT use generic placeholder text.

---

## STEP 2: Present Details to User for Confirmation (INTERACTIVE)

**You MUST show the user the generated details and ask for confirmation before proceeding.**

Present the following to the user in a clear format:

> **Here's what I've generated from the image:**
>
> - **Name:** [generated name]
> - **Description:** [generated description text]
> - **Price:** $[generated price]
>
> Would you like to adjust any of these details, or should I proceed?

**Wait for the user's response.** If the user wants changes, update the values accordingly. Do NOT proceed to Step 3 until the user confirms or provides corrections.

---

## STEP 3: Suggest Options and Ask User (INTERACTIVE)

**You MUST present the suggested options from Step 1 and ask the user if they want to add product options.**

Present the suggested options to the user:

> **Based on the image, I can suggest the following product options:**
>
> - **[Option Name]:** [Choice 1], [Choice 2], ...
> - **[Option Name]:** [Choice 1], [Choice 2], ...
>
> Would you like to:
> 1. Use these options as suggested
> 2. Add more choices to these options (e.g., additional colors or sizes)
> 3. Add entirely new options
> 4. Skip options and create a simple product (no variants)

**Wait for the user's response.** Based on their answer:
- If they confirm or modify options, collect the final list of options and choices.
- If they add more choices, merge them with the suggested ones.
- If they want to skip options entirely, proceed with a simple product (no `options` or `variantsInfo`).

---

## STEP 4: Create the Product

**API Endpoint:** `POST https://www.wixapis.com/stores/v3/products`

In Catalog V3, media is passed directly in the product creation request — no separate upload or attach step is needed.

---

### Path A: Simple Product (No Options)

Use this if the user chose to skip options in Step 3.

**Exact request example:**

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

---

### Path B: Product with Options

Use this if the user confirmed or provided options in Step 3. You MUST define both `options` and `variantsInfo.variants`.

**Rules for variants:**
- Generate ALL combinations of option choices as variants.
- Each variant uses the same price unless the user specified different prices per variant.
- Set `visible: true` for all variants.

**Exact request example (product with Color and Size options):**

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
        "options": [
            {
                "name": "Color",
                "optionRenderType": "TEXT_CHOICES",
                "choicesSettings": {
                    "choices": [
                        {
                            "choiceType": "CHOICE_TEXT",
                            "name": "Black"
                        },
                        {
                            "choiceType": "CHOICE_TEXT",
                            "name": "Gold"
                        }
                    ]
                }
            },
            {
                "name": "Size",
                "optionRenderType": "TEXT_CHOICES",
                "choicesSettings": {
                    "choices": [
                        {
                            "choiceType": "CHOICE_TEXT",
                            "name": "Standard"
                        },
                        {
                            "choiceType": "CHOICE_TEXT",
                            "name": "Large"
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
                                "choiceName": "Black",
                                "renderType": "TEXT_CHOICES"
                            }
                        },
                        {
                            "optionChoiceNames": {
                                "optionName": "Size",
                                "choiceName": "Standard",
                                "renderType": "TEXT_CHOICES"
                            }
                        }
                    ],
                    "price": {
                        "actualPrice": {
                            "amount": "79.99"
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
                                "choiceName": "Black",
                                "renderType": "TEXT_CHOICES"
                            }
                        },
                        {
                            "optionChoiceNames": {
                                "optionName": "Size",
                                "choiceName": "Large",
                                "renderType": "TEXT_CHOICES"
                            }
                        }
                    ],
                    "price": {
                        "actualPrice": {
                            "amount": "79.99"
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
                                "choiceName": "Gold",
                                "renderType": "TEXT_CHOICES"
                            }
                        },
                        {
                            "optionChoiceNames": {
                                "optionName": "Size",
                                "choiceName": "Standard",
                                "renderType": "TEXT_CHOICES"
                            }
                        }
                    ],
                    "price": {
                        "actualPrice": {
                            "amount": "79.99"
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
                                "choiceName": "Gold",
                                "renderType": "TEXT_CHOICES"
                            }
                        },
                        {
                            "optionChoiceNames": {
                                "optionName": "Size",
                                "choiceName": "Large",
                                "renderType": "TEXT_CHOICES"
                            }
                        }
                    ],
                    "price": {
                        "actualPrice": {
                            "amount": "79.99"
                        }
                    },
                    "physicalProperties": {},
                    "visible": true
                }
            ]
        },
        "price": {
            "actualPrice": {
                "amount": "79.99"
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
        "name": "Premium Spinning Fishing Reel",
        "visible": true,
        "productType": "PHYSICAL",
        "price": {
            "actualPrice": {
                "amount": "79.99"
            }
        }
    }
}
```

---

## Completion Checklist

Before reporting success to the user, verify ALL of the following:

- [ ] Step 1 completed: You analyzed the image and generated name, description, price, and suggested options.
- [ ] Step 2 completed: You presented the details to the user and received confirmation (or applied their corrections).
- [ ] Step 3 completed: You presented option suggestions and the user chose to use options, modify them, or skip them.
- [ ] Step 4 completed: Product was created with the image attached inline and you received a product ID.

Only after ALL 4 steps succeed, report to the user: the product name, price, options (if any), and that it was created with the image attached.

---

## Troubleshooting

### "The url field must be a publicly accessible URL"
The user provided a file ID, file token, or local file reference instead of a public URL. Ask for a URL that starts with `https://`.

### Image not appearing on the product
Verify that the `media.main.url` and `media.itemsInfo.items[].url` both contain the correct publicly accessible URL. Both fields must be set.

### 428 Precondition Required on product creation
The site uses Catalog V1, not V3. Use the [Version Router](create-product-from-image-router.md) to detect and route correctly.

### Description format error
V3 requires rich text nodes, NOT HTML strings. Ensure the description is an object with `nodes` array, not a string like `"<p>text</p>"`.

### Variant count mismatch
You must generate ALL combinations of option choices. For example, 2 colors x 2 sizes = 4 variants. Missing variants will cause an error.

## References

- [Create Product (Catalog V3)](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/products-v3/create-product)
- [Create Product with Options (Catalog V3)](create-product-with-options-catalog-v3.md)
- [Create Product from Image (Catalog V1)](create-product-from-image.md)
- [Create Product from Image Router](create-product-from-image-router.md)
- [Catalog Versioning Overview](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-versioning/introduction)
