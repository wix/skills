---
name: "Update Product with Options (Catalog V3)"
description: Modifies existing products and variants using Catalog V3 Products API. Covers adding/removing option choices, variant-specific pricing, product visibility (hide, unhide, or show a product in the storefront — a product-level `visible` update, never a delete), and revision-based updates to prevent conflicts.
---
**RECIPE**: Business Recipe - Updating a Wix Store Product (Catalog V3)

Use this recipe to update an existing Catalog V3 product: storefront visibility, description, media, options, variants, prices, or stock-related inventory records.

## Before Any Product Update

Every Catalog V3 product update is revision-based:

- If the user gives a product name instead of a product ID, use [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) and choose the exact product name match.
- Use [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product) to retrieve the current product, its `product.revision`, and its existing variants. Search Products and Query Products responses do not include `variantsInfo.variants`, so a variant or price update assembled from a search result sends an empty variants array and is rejected. Re-read the product before every variant-level update.
- Include `product.id` and the current `product.revision` in every [Update Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/update-product) PATCH body.
- Update Product is a partial update: only `product`, `product.id`, and `product.revision` are required, and top-level fields you omit (for example `name`, `ribbon`, `brand`) are left unchanged. The full-array overwrite rule applies only to the repeated fields `options`, `modifiers`, and `variantsInfo.variants`.
- For simple text/HTML description updates, prefer `plainDescription`. Use `description` only when sending a Rich Content object.

### Find the product by name

```bash
curl -X POST "https://www.wixapis.com/stores/v3/products/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "search": {
      "expression": "Product name"
    }
  }'
```

For product-name lookup, prefer Search Products before retrieving the product by ID. Search only resolves the product ID; it does not replace the Get Product call.

### Get the current revision

```bash
curl -X GET "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Authorization: <AUTH>"
```

## Common Update Patterns

### Hide or Show a Product

"Hide this product", "make it not show in my store", "unhide it", "put it back in the store" are all product-level visibility changes. Set the `visible` boolean on the product in an Update Product PATCH. Do not delete the product, and do not change variant visibility to hide the product.

```bash
curl -X PATCH "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "product": {
      "id": "{productId}",
      "revision": "{currentRevision}",
      "visible": false
    }
  }'
```

Send `"visible": true` to show it again. Nothing else needs to be in the body — `name`, `options`, `variantsInfo` and the other top-level fields you omit are left unchanged. Confirm the result from `product.visible` in the response.

Visibility behaviour to report back accurately:

- `visible` defaults to `true`.
- For a product **without** options, updating `product.visible` automatically updates the default variant's `visible` to match.
- For a product **with** options, product and variant visibility are independent: setting `product.visible` to `false` leaves each `variantsInfo.variants[].visible` as it was.
- Point-of-sale visibility is a separate field, `visibleInPos`. Only change it when the user asks about POS. It is always `false` for `productType: DIGITAL`.

### Update Description Only

For a normal user request like "set the product description to X", use `plainDescription` with valid HTML. The API converts it to rich content.

Do not send a plain string in `description`. `description` is a Rich Content object.

```bash
curl -X PATCH "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "product": {
      "id": "{productId}",
      "revision": "{currentRevision}",
      "plainDescription": "<p>A great product for everyone.</p>"
    }
  }'
```

Use `description` only when you intentionally need to send Rich Content:

```bash
curl -X PATCH "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "product": {
        "id": "{productId}",
        "revision": "{currentRevision}",
        "description": {
            "nodes": [
                {
                    "type": "PARAGRAPH",
                    "id": "description",
                    "nodes": [
                        {
                            "type": "TEXT",
                            "textData": {
                                "text": "Updated product description."
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
                "version": 1
            }
        }
    }
  }'
```

### Update Options and Variants

When adding or changing options and variants, send the full option definitions and one variant for each option-choice combination. Use `optionChoiceNames` to reference choices.

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

When updating existing variants, include each existing variant `id`. If no GUID is passed, a variant is created with a new GUID. Each variant object is replaced whole rather than merged, so carry over the fields you are not changing: rebuilding a variant from just its `id` plus the field you want to set drops everything else and is rejected on the first required field it lost (`price must not be empty`). Start from the variant as returned by Get Product and override only what the user asked to change.

### Convert a Simple Product to Color Variants

When adding the first option to a simple product, do not preserve a choice-less default variant unchanged. A simple product often has one existing variant with price or stock but no `choices`. After you add a `Color` option, every variant in `variantsInfo.variants` must include choices that match the product options.

Use the existing default variant as source data only. For example, copy its price if the user did not ask to change price, then send a complete optioned variants list where each variant has:

```json
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
      "amount": "{existingOrRequestedPrice}"
    }
  }
}
```

After the product update returns the new variant IDs, use those IDs to set inventory.

### Set Stock for New Variants

Inventory is handled separately from product updates. After the product update returns variant IDs, use [Bulk Create Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-create-inventory-items) with `productId`, `variantId`, and `quantity`.

If the store has multiple inventory locations, include `locationId`; otherwise the store's default location is used.
After bulk inventory create, check `bulkActionMetadata.totalSuccesses` and `results[].itemMetadata.success`. Returned inventory entities are under `results[].item`, not a top-level `inventoryItems` field; confirm stock from `results[].item.quantity`.

```bash
curl -X POST "https://www.wixapis.com/stores/v3/bulk/inventory-items/create" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "inventoryItems": [
      {
        "productId": "{productId}",
        "variantId": "{redVariantId}",
        "quantity": 10
      },
      {
        "productId": "{productId}",
        "variantId": "{blueVariantId}",
        "quantity": 10
      }
    ],
    "returnEntity": true
  }'
```

### Update Media Only

```bash
curl -X PATCH "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "product": {
      "id": "{productId}",
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

### Update Variant Price Only

Read `{existingVariantId}` off the Get Product response; a Search or Query Products result does not carry it.

```bash
curl -X PATCH "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "product": {
      "id": "{productId}",
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

## Important Notes

- A request to hide a product is a `visible: false` update on the product, never a Delete Product call and never a variant-only change.
- To update array fields like `options`, `modifiers`, `variantsInfo.variants`, and any others, pass the entire existing array. Passing only the changed item overwrites the whole array.
- To update `variantsInfo.variants`, also pass `options`, and vice versa. Variants and options are mutually dependent and must stay aligned.
- When converting a simple product to an optioned product, rebuild the variants list so every variant has `choices`; do not keep an existing choice-less default variant unchanged.
- Always include `choicesSettings` with the complete list of choices when updating a product with options.
- Use `optionChoiceNames` rather than `optionChoiceIds` in variants for more reliable updates. Reading them back is not symmetric: Get Product returns each variant's `choices` with `optionChoiceIds` only, and fills in `optionChoiceNames` just when the request's `fields` array includes `"VARIANT_OPTION_CHOICE_NAMES"`. So to find the variant for a named choice such as `Large`, either pass that field and match on the name, or take the choice GUID from `options[].choicesSettings.choices[].choiceId` and match it against `variants[].choices[].optionChoiceIds.choiceId`. Matching on a name the response never carried raises nothing — it just selects no variant.
- Include the `renderType` in `optionChoiceNames`.

## Error Message Reference

| Error Message | Meaning | Fix |
|---------------|---------|-----|
| `revision must not be empty` | Missing optimistic lock | GET product first and include `product.revision` in PATCH |
| `revision mismatch` | Stale revision | Re-GET product and retry with the new revision |
| `Expected an object` for `description` | Sent `description` as a string | Use `plainDescription` for HTML strings, or send `description` as Rich Content |
| `choicesSettings must not be empty` | Missing choices array | Include full `choicesSettings.choices` array |
| `Missing product option choices` | Variant references non-existent option | Use `optionChoiceNames` with exact option and choice names |
| `price must not be empty` | A variant was sent without a price — including an existing variant rebuilt from only its `id` and the field being changed | Carry `price.actualPrice.amount` on every variant you send, not just new ones; copy it from the Get Product response for variants you are not repricing |
| `variantsInfo is invalid: variants has size 0, expected 1 or more` | Variants were read from a Search or Query Products response, which does not return them | Re-read the product with Get Product and send its `variantsInfo.variants` |
| `Missing option choices` or `INVALID_DEFAULT_VARIANT` | Product has options but at least one variant has no matching choices | Rebuild `variantsInfo.variants` so every variant includes choices for all product options |
| `DIGITAL_PRODUCT_CANNOT_BE_VISIBLE_IN_POS` | Sent `visibleInPos: true` on a digital product | Digital products can't be visible in POS; leave `visibleInPos` out of the body |
