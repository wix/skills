---
name: "Update Product with Options"
description: Modifies existing products and variants using Catalog V3 Products API. Covers adding/removing option choices, variant-specific pricing, and revision-based updates to prevent conflicts.
---
**RECIPE**: Business Recipe - Updating a Wix Store Product (V3)

Learn how to update existing Wix store products, including adding options, changing media, updating prices, or modifying other product properties.

---

> **CRITICAL: Revision Required for All Updates**
>
> All PATCH operations on Catalog V3 products require the current `product.revision`. Without it, you'll get: `"revision must not be empty"`
>
> **Always:**
> 1. GET the product first to obtain current revision
> 2. Include `product.revision` in every PATCH body

---

## Article: Steps for Updating Wix Store Products

## STEP 1: Get the current product to obtain its revision
1. Before updating the product, you need to retrieve its current revision to prevent conflicts using [Get Product](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/products-v3/get-product):

```bash
curl -X GET "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Authorization: <AUTH>"
```

The response will include a `revision` field in the product object. Save this value for use in Step 2.

## STEP 2: Update the product with options and variants
1. Update the product to add options and create variants using the revision obtained in Step 1 - [Wix REST API: Update Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/update-product)

```bash
curl -X PATCH "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "product": {
        "id": "{productId}",
        "revision": "{currentRevision}",
        "options": [
            {
                "name": "Color",
                "optionRenderType": "SWATCH_CHOICES",
                "choicesSettings": {
                    "choices": [
                        {
                            "name": "White",
                            "choiceType": "ONE_COLOR",
                            "colorCode": "#FFFFFF"
                        },
                        {
                            "name": "Red",
                            "choiceType": "ONE_COLOR",
                            "colorCode": "#FF0000"
                        },
                        {
                            "name": "Black",
                            "choiceType": "ONE_COLOR",
                            "colorCode": "#000000"
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
                                "choiceName": "White",
                                "renderType": "SWATCH_CHOICES"
                            }
                        }
                    ],
                    "price": {
                        "actualPrice": {
                            "amount": "270.00"
                        }
                    }
                },
                {
                    "choices": [
                        {
                            "optionChoiceNames": {
                                "optionName": "Color",
                                "choiceName": "Red",
                                "renderType": "SWATCH_CHOICES"
                            }
                        }
                    ],
                    "price": {
                        "actualPrice": {
                            "amount": "270.00"
                        }
                    }
                },
                {
                    "choices": [
                        {
                            "optionChoiceNames": {
                                "optionName": "Color",
                                "choiceName": "Black",
                                "renderType": "SWATCH_CHOICES"
                            }
                        }
                    ],
                    "price": {
                        "actualPrice": {
                            "amount": "270.00"
                        }
                    }
                }
            ]
        }
    }
}'
```

## Common Update Patterns (Minimal Examples)

### Update Media Only

To update just the product's media without changing other fields:

```bash
curl -X PATCH "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "product": {
      "revision": "{currentRevision}",
      "media": {
        "itemsInfo": {
          "items": [
            {
              "url": "https://static.wixstatic.com/media/your-image.jpg",
              "altText": "Product image"
            }
          ]
        }
      }
    }
  }'
```

### Update Price Only

To update just the variant prices:

```bash
curl -X PATCH "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "product": {
      "revision": "{currentRevision}",
      "variantsInfo": {
        "variants": [
          {
            "id": "{existingVariantId}",
            "price": {
              "actualPrice": {
                "amount": "29.99"
              }
            }
          }
        ]
      }
    }
  }'
```

> **Note:** When updating variants, you must include the variant `id` to update existing variants. Without the `id`, a new variant will be created.

---

### IMPORTANT NOTES:
The Update Product API can handle creating customizations and choices in a single call. There's no need to separately check for existing customizations, create new ones, or add choices to them—the API handles all of this automatically:

1. If you provide an option with a name that doesn't exist as a customization, a new customization will be created
2. If a customization with that name already exists, it will be associated with the product
3. New choices will be added to the customization if they don't exist
4. When creating variants, use optionChoiceNames rather than optionChoiceIds to reference the options and choices
5. Always include the choicesSettings object with the complete list of choices
6. You must create one variant for each combination of option choices

### Next Steps:
After updating the product, verify that the options appear correctly in the store and that customers can select different variants.

## Troubleshooting Common Issues

### Issue 1: "ChoicesSettings must not be empty" error
- **Problem**: When updating a product with options, you get an error saying `choicesSettings must not be empty`.
- **Solution**: Always include the `choicesSettings` object with the full array of `choices` when updating a product with options, even when using an existing customization.

### Issue 2: "Missing product option choices" error
- **Problem**: You get an error message like `Missing product option choices. Every variant option id (variants.choices.optionId field) must exist in options.id`.
- **Solution**:
- Use `optionChoiceNames` instead of `optionChoiceIds` in variants
- Make sure the option name in variants exactly matches the option name defined in the options array
- Include the renderType in optionChoiceNames

### Issue 3: Variants not matching options
- **Problem**: The API returns errors about variants not matching the product's options.
- **Solution**:
- Create one variant for each possible combination of option choices
- Ensure each variant references all options defined on the product
- If the product has only one option with three choices, you need three variants
- Make sure each variant's option choice name exactly matches the corresponding option choice

### Issue 4: Conflicts when using existing customizations
- **Problem**: When attempting to use existing customizations, you encounter name conflicts or choice conflicts.
- **Solution**:
- If you need to use a specific existing customization ID, first query customizations to get the correct ID
- When working with existing customizations, ensure all choices you reference actually exist in that customization
- If you're creating a new customization with the same name as an existing one, the API will use the existing one
- Be aware that customizations are shared across all products in your store

### Issue 5: Inconsistencies in documentation vs. actual API behavior
- **Problem**: Several API requirements are not well-documented or are documented differently from how the API actually behaves.
- **Solution**:
- Always include choicesSettings with all choices when updating a product
- Use optionChoiceNames rather than optionChoiceIds in variants for more reliable results
- Include the renderType in optionChoiceNames
- Use the exact same choice names as defined in the customization
- Always get the current product revision before updating to prevent conflicts

## Error Message Reference

| Error Message | Meaning | Fix |
|---------------|---------|-----|
| `revision must not be empty` | Missing optimistic lock | GET product first, include `revision` in PATCH |
| `revision mismatch` | Stale revision (product was updated elsewhere) | Re-GET product, retry with new revision |
| `choicesSettings must not be empty` | Missing choices array | Include full `choicesSettings.choices` array |
| `Missing product option choices` | Variant references non-existent option | Use `optionChoiceNames` with exact match to option names |

## Conclusion

Updating a Wix store product involves understanding the revision-based optimistic concurrency model and the relationship between store-wide customizations and product-specific options and variants. The key is to always fetch the current revision before updating and ensure consistency between customization definitions, product options, and product variants.

By following this recipe and being aware of the common pitfalls, you can successfully update your Wix store products.
