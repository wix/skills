---
name: "Update Product (Catalog V3)"
description: Updates existing Catalog V3 products and variants. Covers product-level fields such as name, description, visibility, and media; option and variant changes such as price and SKU; full-array replacement rules; exact variant selection; revision handling; and routing inventory or pre-order changes to the Inventory API.
---
**RECIPE**: Business Recipe - Updating a Wix Store Product (Catalog V3)

Use this recipe for any update to an existing Catalog V3 product. It is the single entry point for product-level changes such as name, description, visibility, and media, and for option or variant changes such as choices, price, SKU, barcode, or variant visibility.

Do not use this recipe on a Catalog V1 site. Quantity, inventory tracking, and pre-order settings are inventory operations; route those requests to the Catalog V3 Inventory API instead of placing inventory state in an Update Product request.

## Choose the Update Path

| User request | Write path | State that must be preserved |
|---|---|---|
| Rename, hide/show, change description, brand, ribbon, or another top-level product field | Get Product for the current revision, then Update Product with only the requested top-level field | Only `product.id` and `product.revision`; omitted top-level fields remain unchanged |
| Change a variant price, SKU, barcode, visibility, physical properties, or option choice | Get Product, copy the complete `options` and `variantsInfo.variants`, change only the requested value, then Update Product | Every option, every variant, every existing variant ID, and all unchanged fields in each variant |
| Add or remove options or choices | Get Product, rebuild the complete aligned options and variants arrays, then Update Product | All surviving options and variants; every variant must have choices matching the final option set |
| Make product-specific changes to 2-100 known products | Read the current revision and required state for every target, then send one Bulk Update Products request | The same per-product rules as above; each entry has its own `product` wrapper, ID, and revision |
| Apply the same top-level change to every product matching a filter | Use Bulk Update Products By Filter | This endpoint cannot update `slug`, `options`, `modifiers`, or `variantsInfo`; use Bulk Update Products when any of those fields changes |
| Apply the same price or cost adjustment to matching variants | Use Bulk Adjust Product Variants By Filter for a percentage or amount change; use Bulk Update Product Variants By Filter for explicit values | These are variant-specific bulk operations; do not loop over Update Product |
| Change quantity, inventory tracking, or preorder settings | Query Inventory Items, then use Bulk Update Inventory Items | Do not send inventory records through Update Product; each inventory item is one variant-location combination |

## Bulk Updates: Never Write Products One at a Time

When a request affects multiple products, choose a bulk endpoint before making any write. Do not issue sequential Update Product PATCH calls when a Catalog V3 bulk operation can express the request.

- Use [Bulk Update Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-update-products) for a known list of up to 100 products, including products with options or product-specific values. It accepts at most 100 products per request, 100 total options, 100 total modifiers, 100 total info sections, and 1000 total variants. Split larger jobs into the fewest batches that satisfy every limit.
- Use [Bulk Update Products By Filter](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-update-products-by-filter) when the same top-level patch applies to every matched product. It cannot update `slug`, `options`, `modifiers`, or `variantsInfo`.
- Use [Bulk Update Product Variants By Filter](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-update-product-variants-by-filter) to set explicit `visible`, `price`, `revenueDetails.cost`, or `physicalProperties` values on matching variants.
- Use [Bulk Adjust Product Variants By Filter](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/bulk-adjust-product-variants-by-filter) for relative price or cost changes such as “increase all prices by 10%.”
- Use the dedicated bulk tag operations for assigning or removing tags. Do not rebuild whole products just to change tags.

For Bulk Update Products, first obtain each target's current revision. A Query Products response is sufficient for a top-level-only patch because it contains product IDs and revisions. If an entry changes options or variants, Get Product for that entry so the complete arrays can be preserved. Then put all entries in one request:

```bash
curl -X POST "https://www.wixapis.com/stores/v3/bulk/products/update" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "products": [
      {
        "product": {
          "id": "{firstProductId}",
          "revision": "{firstCurrentRevision}",
          "visible": false
        }
      },
      {
        "product": {
          "id": "{secondProductId}",
          "revision": "{secondCurrentRevision}",
          "plainDescription": "<p>Updated description.</p>"
        }
      }
    ]
  }'
```

Do not add a field mask to this request. Inspect `bulkActionMetadata.totalSuccesses` and `totalFailures`, then match `results[].itemMetadata.originalIndex` to the submitted entry and check `results[].itemMetadata.success`. Retry only failed entries after re-reading their current revisions and required state; do not replay successful entries.

## Canonical Update Flow

1. Resolve the product ID. When the user supplies a name, Search Products and keep only an exact `product.name` match. If more than one exact match remains, ask the user which product to change.
2. Get Product immediately before the write. This is the source of the current revision and, for variant-level work, the complete options and variants.
3. Classify the requested fields using the table above. Build either a minimal top-level patch or a complete options-and-variants replacement. Never build a variant update from a Search Products or Query Products response.
4. Apply only the user's requested change to the retrieved state. Preserve every other option, variant, ID, and variant field.
5. For one product, send one Update Product PATCH. For multiple products, send the fewest Bulk Update Products requests allowed by the API limits—up to 100 products per request. If an entry fails only because its revision is stale, re-read and retry only that failed product once.
6. Confirm the requested fields and preserved state from the returned `product`. For a variant update, confirm the target variant and that the other variants and their IDs remain present.

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
      "search": {
        "expression": "Product name",
        "fields": ["name"],
        "fuzzy": false
      }
    }
  }'
```

For product-name lookup, prefer Search Products before retrieving the product by ID. Search can return near-matches even with fuzzy matching disabled, so compare `products[].name` for exact equality. Search only resolves the product ID; it does not replace the Get Product call.

### Get the current product state

```bash
curl -X GET "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Authorization: <AUTH>"
```

For a request that identifies a variant by an option choice name, request choice names in the same read:

```bash
curl -X GET "https://www.wixapis.com/stores/v3/products/{productId}?fields=VARIANT_OPTION_CHOICE_NAMES" \
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

### Update Quantity, Stock Status, or Preorder Settings

Inventory changes belong to the [Catalog V3 Inventory Items API](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/introduction), not the Products API. An inventory item represents one product variant at one location, so resolve both before writing. If the user has not named the variants or locations to change, ask them to confirm that scope.

1. Resolve the product ID and relevant variant IDs.
2. [Query Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/query-inventory-items) by `productId` or `variantId`. Read each inventory item's `id`, current `revision`, `locationId`, tracking mode, and preorder state.
3. Build one [Bulk Update Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-update-inventory-items) request for all selected variant-location combinations. It supports up to 1000 inventory items; do not update them one at a time.
4. Check `bulkActionMetadata` and every `results[].itemMetadata.success`. Confirm the returned entities when `returnEntity` is true, and retry only failed entries after refreshing their revisions.

This example enables preorder for two selected inventory items in one call:

```bash
curl -X POST "https://www.wixapis.com/stores/v3/bulk/inventory-items/update" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "inventoryItems": [
      {
        "inventoryItem": {
          "id": "{firstInventoryItemId}",
          "revision": "{firstCurrentRevision}",
          "preorderInfo": {
            "enabled": true,
            "message": "Ships in two weeks"
          }
        }
      },
      {
        "inventoryItem": {
          "id": "{secondInventoryItemId}",
          "revision": "{secondCurrentRevision}",
          "preorderInfo": {
            "enabled": true,
            "message": "Ships in two weeks"
          }
        }
      }
    ],
    "reason": "MANUAL",
    "returnEntity": true
  }'
```

Preorder rules:

- Preorder is configured per variant-location inventory item. It cannot be enabled for digital products or products with subscriptions.
- A preorder limit is supported only for quantity-tracked inventory. `trackQuantity` is read-only; to switch to quantity tracking, send `quantity` with the user-confirmed current stock value. Do not invent that quantity.
- Without quantity tracking, use `inStock` for status-based tracking and omit a preorder limit.
- `preorderInfo.limit` is the number of additional units accepted after stock reaches zero. Existing on-hand quantity is not part of that limit.
- To disable preorder, send `preorderInfo.enabled: false`. Preserve unrelated inventory state unless the user asked to change it.

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

### Update an Existing Variant's Price or SKU

Read the option, choice, and variant IDs from Get Product; Search Products and Query Products do not return the variants. Begin with the complete `options` and `variantsInfo.variants` from that response, then change only the requested fields. The example below changes the Large variant's price and SKU while carrying the Small variant forward unchanged. If the user requested only one of those changes, preserve the other field's retrieved value.

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
          "id": "{sizeOptionId}",
          "name": "Size",
          "key": "size",
          "optionRenderType": "TEXT_CHOICES",
          "choicesSettings": {
            "choices": [
              {
                "choiceId": "{smallChoiceId}",
                "choiceType": "CHOICE_TEXT",
                "key": "small",
                "name": "Small",
                "visible": true
              },
              {
                "choiceId": "{largeChoiceId}",
                "choiceType": "CHOICE_TEXT",
                "key": "large",
                "name": "Large",
                "visible": true
              }
            ]
          }
        }
      ],
      "variantsInfo": {
        "variants": [
          {
            "id": "{smallVariantId}",
            "visible": true,
            "choices": [
              {
                "optionChoiceNames": {
                  "optionName": "Size",
                  "choiceName": "Small",
                  "renderType": "TEXT_CHOICES"
                }
              }
            ],
            "price": {
              "actualPrice": {
                "amount": "12.00"
              }
            },
            "physicalProperties": {},
            "sku": "{existingSmallSku}"
          },
          {
            "id": "{largeVariantId}",
            "visible": true,
            "choices": [
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
                "amount": "29.99"
              }
            },
            "physicalProperties": {},
            "sku": "MUG-L-001"
          }
        ]
      }
    }
  }'
```

Do not copy the literal placeholder values above over real data. Preserve the product's returned option definitions and complete variants, including fields such as `barcode` or physical properties when present. Omitting an untouched variant removes it; rebuilding a variant from only `id` plus `sku` or `price` drops its other fields and can fail validation.

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
