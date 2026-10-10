---
name: "Update Product with Options (Catalog V3)"
description: Modifies existing products and variants using Catalog V3 Products API. Covers adding/removing option choices, variant-specific pricing, product visibility (hide, unhide, or show a product in the storefront — a product-level `visible` update, never a delete), editing existing descriptions while preserving formatting and links, and revision-based updates to prevent conflicts.
---
**RECIPE**: Business Recipe - Updating a Wix Store Product (Catalog V3)

Use this recipe to update an existing Catalog V3 product: storefront visibility, description, media, options, variants, prices, or stock-related inventory records.

## Before Any Product Update

Every Catalog V3 product update is revision-based:

- If the user gives a product name instead of a product ID, use [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) and choose the exact product name match.
- Use [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product) to retrieve the current product, its `product.revision`, and its existing variants. Search Products and Query Products responses do not include `variantsInfo.variants`, so a variant or price update assembled from a search result sends an empty variants array and is rejected. Re-read the product before every variant-level update.
- Include `product.id` and the current `product.revision` in every [Update Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/update-product) PATCH body.
- Update Product is a partial update: only `product`, `product.id`, and `product.revision` are required, and top-level fields you omit (for example `name`, `ribbon`, `brand`) are left unchanged. The full-array overwrite rule applies only to the repeated fields `options`, `modifiers`, and `variantsInfo.variants`.
- Get Product returns a default set of fields. When an update keeps or carries over existing projected data, request that data in `fields` before building the PATCH. For any edit that keeps part of the existing product description, request `DESCRIPTION`; a read without it has no Rich Content document to preserve.
- For description changes, see [Update Description](#update-description): replacing the whole description uses `plainDescription`; editing any existing content uses the Rich Content `description` field.

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

Read `products` from the search response. Prefer an exact name match; otherwise select a clear, unambiguous match, such as a name differing only in capitalization. If no result clearly identifies the requested product, or multiple products could match, ask the user which product they mean. Use the selected `products[].id` in Get Product; search only resolves the ID.

### Get the current revision

```bash
curl -X GET "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Authorization: <AUTH>"
```

To edit an existing description, request its Rich Content document in the same read:

```bash
curl -X GET "https://www.wixapis.com/stores/v3/products/{productId}?fields=DESCRIPTION" \
  -H "Authorization: <AUTH>"
```

`product.description` is returned only when `DESCRIPTION` is requested. Request every other projected field that you need to carry over with its documented `fields` value as well.

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

### Update Description

Choose the flow from the user's request:

- "Set the description to X", "replace the description", or "write a new description": **Replace the Description**.
- "Add", "append", "prepend", "insert", "fix a typo", or "remove" existing text: **Edit the Existing Description**. Any request that keeps part of the current description is an edit.

#### Replace the Description

For a request like "set the product description to X", use `plainDescription` with valid HTML. The API converts it to rich content.

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

For a full replacement with node types beyond the paragraph below, read [Author Ricos Rich Content](../rich-content/author-ricos-rich-content.md). Existing-document edits use the read-modify-write flow below:

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

Both fields replace the whole description. To keep any existing content, use **Edit the Existing Description**.

#### Edit the Existing Description

For prepend, append, and text removal, execute the documented calls directly: the examples in this recipe and the request/response contract below provide the fields this flow needs. Reuse this contract rather than rediscovering the Search, Get, and Update schemas. Consult further API documentation when the request requires a field or node type not covered here, or when a documented call fails. Read [Author Ricos Rich Content](../rich-content/author-ricos-rich-content.md) when creating other node types.

| Call | Request | Response fields used next |
|---|---|---|
| Search Products, when given a name | Use [Find the product by name](#find-the-product-by-name); `search.search` contains `expression`, `fields: ["name"]`, and `fuzzy: false`. | `products[]` contains `id` and `name`; select the product using the name-matching guidance above. |
| Get Product | `GET https://www.wixapis.com/stores/v3/products/{productId}?fields=DESCRIPTION` | `product.id`, `product.revision`, and the full `product.description`. |
| Update Product | `PATCH https://www.wixapis.com/stores/v3/products/{productId}` with `{ product: { id, revision, description }, fields: ["DESCRIPTION"] }`, using the read ID/revision and complete edited document. | `product.description` verifies the edit; `product.revision` is the new revision. |

The request-level `fields` array projects response data; it is separate from `search.search.fields`, which selects the fields searched. A description-only PATCH needs only the three product fields shown above; variant, option, price, and physical-property fields belong to other update flows.

Use a single read-modify-write operation: locate the product, read its description and revision, make the requested change in memory, then PATCH once and verify the response.

1. Read [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product) with `?fields=DESCRIPTION`. Its response wraps the document as `product.description` and the current revision as `product.revision`. If the description is missing or has no `nodes`, stop and ask before replacing it.
2. Copy the complete returned `product.description`, including node IDs, decorations, `metadata`, and `documentStyle`, **before locating any nodes to edit**. Traverse the copy and keep references to its nodes; edit that same copy and send it in the PATCH. For prepend/append, insert one new `PARAGRAPH` at the beginning/end of its `nodes`. For a wording change, modify only the matching `TEXT` node's `textData.text`.
3. For removal, trim only the requested substring from the matching TEXT run and keep its decorations. When the whole run or node is targeted, remove that entry from its parent `nodes` array. If text spans runs, trim the matching portion of each run. Preserve all other nodes, spacer paragraphs, and document properties. If the requested change is already present, report that state and finish without a write.
4. Check the in-memory PATCH document before sending: the targeted text has the requested value and untouched content matches the read document. Then send [Update Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/update-product) to `PATCH https://www.wixapis.com/stores/v3/products/{productId}` with `product.id`, the read revision, the full edited `product.description`, and top-level `fields: ["DESCRIPTION"]`. Leave other product fields out of this description-only update; `plainDescription` is for whole-description replacements.
5. Verify `product.description` in the PATCH response: the requested change is present and untouched nodes, decorations, and document properties remain. Confirm completion from that response and finish. A successful PATCH has already performed the edit; verification does not require another PATCH. If the response is incomplete, read once with `?fields=DESCRIPTION` to verify. If a revision conflict rejects the write, read the latest document and reapply the requested change only if it is still needed.

For a prepend, build the complete PATCH body from the Get Product response (`getResponse` below). For an append, use `push` instead of `unshift`:

```javascript
const product = getResponse.product;
const description = structuredClone(product.description);
description.nodes.unshift({
  type: "PARAGRAPH",
  nodes: [{
    type: "TEXT",
    textData: { text: "New text.", decorations: [] }
  }],
  paragraphData: { textStyle: { textAlignment: "AUTO" } }
});
const patchBody = {
  product: { id: product.id, revision: product.revision, description },
  fields: ["DESCRIPTION"]
};
```

Send `patchBody` as the JSON body of the PATCH above. The copy retains the returned document's other properties and existing nodes, including links and buttons; the response's `product.description` includes the edited document because the request projects `DESCRIPTION`.

For example, remove only `read ` from a TEXT run containing `read the guide`, retaining its BOLD and LINK decorations and siblings. Locate the run in the cloned document, including nested nodes, rather than assuming a paragraph/run index. This example handles a phrase within one TEXT run; a phrase spanning runs uses the per-run trimming in step 3, with all run references taken from the copy.

```javascript
const product = getResponse.product;
const description = structuredClone(product.description);
const target = "read the guide";
const replacement = "the guide";
const matches = [];
function locate(node) {
  if (node.type === "TEXT" && node.textData.text.includes(target)) matches.push(node.textData);
  for (const child of node.nodes ?? []) locate(child);
}
locate(description);
if (matches.length !== 1) throw new Error("Clarify which text occurrence to edit");
const textData = matches[0];
const originalText = textData.text;
const start = originalText.indexOf(target);
if (start !== originalText.lastIndexOf(target)) throw new Error("Clarify which text occurrence to edit");
textData.text = originalText.slice(0, start) + replacement + originalText.slice(start + target.length);
if (textData.text === originalText || textData.text.includes(target)) {
  throw new Error("The PATCH document must contain the requested edit before writing");
}
const patchBody = {
  product: { id: product.id, revision: product.revision, description },
  fields: ["DESCRIPTION"]
};
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

### Renaming an Existing Choice Is Not Supported

`options[].choicesSettings.choices` is immutable once a choice exists — this includes the choice's own `name`. If the user asks to rename, fix a typo in, or standardize the name of an **existing** option choice (for example a shared/reusable customization like "Color" or "Patch Design" that already has variants), do not attempt an Update Product or Update Customization PATCH: it returns `200`, `product.revision`/`customization.revision` increments, but the name is silently left unchanged — confirm this yourself with a fresh Get Product/Get Customization call and you will still see the old name. There is currently no endpoint that renames an existing choice, even when you pass back the same `choiceId` and preserve every other choice, option, and variant exactly.

Do not try workarounds that risk the existing variant matrix — do not delete and recreate the choice/option (this destroys all variants using it, along with their prices, SKUs, and inventory), and do not use Set Customization Choices (it fails once the choice is assigned to any product). Tell the user this specific rename isn't possible via the API today and that manually renaming the choice in the Wix dashboard (Site → Products → the product's options) is the only way, or point them to `SupportAndFeedback` to report the gap.

This only blocks renaming an *existing* choice. Adding brand-new choices to an option (Add/Bulk Add Customization Choices, or including a new choice name in a full Update Product `options` payload) works normally.

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

Sets the product-level gallery (`media.itemsInfo.items`). For an image shown per option choice (a swatch's photo), see **Per-choice media** below.

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

### Choice & variant fields (what you can set)

Send these inside the `options` / `variantsInfo.variants` arrays — **both arrays complete, in the
same PATCH**, with the current `revision`, and **identity-preserving** (see *Update Options and
Variants*): keep the option's `id` and every `choiceId`, or the ids are re-minted and the existing
variants no longer resolve (`400 "Variant choice not found in product options"`). Each variant needs
its `id`, its `choices` (by `optionChoiceIds` — or `optionChoiceNames`, see *Gotchas*) **and** a
`price` — omitting price is `400 "price must not be empty"`.

**Option choice** (`options[].choicesSettings.choices[]`):
- `name`, `choiceType`, `colorCode` — the choice's identity and swatch colour.
- `media` = `{ "items": [ { "mediaId" } | { "url" } ] }` — the product photos shown when this choice is picked. `url` is write-only; on read you get `mediaId` (request the `PRODUCT_CHOICES_MEDIA_REFERENCES` mask). Use `media`, **not** `linkedMedia` (a separate display-filter, returned empty when you read `media`).
  - **Gallery-first; the id you link is the gallery item's, not the upload's.** Add the `url` to the gallery, then read the product back and link the id you see there:

    ```
    GET /stores/v3/products/{id}?fields=MEDIA_ITEMS_INFO
    #  → media.itemsInfo.items[].id = "abc~mv2.jpg"   ← link THIS as choice media.items[].mediaId
    # the id from POST /site-media/v1/files/import or /files/get-file-by-id 400s as a choice mediaId
    ```
    `{ "url" }` works in place of `{ "mediaId" }` too, but only once the image is already in the gallery.
- `displayImage` — the image shown on the swatch itself (distinct from `media`).
- Read-only, don't send: `inStock`, `visible`, `key`.

**Variant** (`variantsInfo.variants[]`, by its `id` from Get Product; always send `choices` + `price` with it):
- `price` = `{ "actualPrice": { "amount" }, "compareAtPrice": { "amount" } }` — set `compareAtPrice` above `actualPrice` for a strikethrough sale; omit it for full price.
- `sku`, `barcode` — per combination.
- `visible` — hide a single variant.
- `revenueDetails` — cost / profit tracking.
- Read-only, don't send: `media` (derived from the choices' media **at creation only**, and only on single-option products — a choice image linked by a later update never reaches the variant, so a storefront reads the choice's `media`, not the variant's), `inventoryStatus` (stock — use the Inventory API, see *Set Stock for New Variants*), `subscriptionPricesInfo`.

```bash
# A choice image + a variant's sale price, one PATCH. Both arrays are complete and keep their ids —
# keep the option and choice IDs when rebuilding the options array, and each variant
# with its choices and price. Omitting those identities or required variant fields can reject the update.
curl -X PATCH "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Content-Type: application/json" -H "Authorization: <AUTH>" \
  -d '{ "product": { "id": "{productId}", "revision": "{currentRevision}",
        "options": [ { "id": "{optionId}", "name": "Color", "optionRenderType": "COLOR_CHOICES",
          "choicesSettings": { "choices": [
            { "choiceId": "{choiceId1}", "name": "Red", "choiceType": "ONE_COLOR", "colorCode": "#C0392B",
              "media": { "items": [ { "mediaId": "abc~mv2.jpg" } ] } },
            { "choiceId": "{choiceId2}", "name": "Blue", "choiceType": "ONE_COLOR", "colorCode": "#2C3E50" } ] } } ],
        "variantsInfo": { "variants": [
          { "id": "{variantId1}", "sku": "TEE-RED-L",
            "price": { "actualPrice": { "amount": "20" }, "compareAtPrice": { "amount": "30" } },
            "choices": [ { "optionChoiceIds": { "optionId": "{optionId}", "choiceId": "{choiceId1}" } } ] },
          { "id": "{variantId2}", "price": { "actualPrice": { "amount": "20" } },
            "choices": [ { "optionChoiceIds": { "optionId": "{optionId}", "choiceId": "{choiceId2}" } } ] } ] } } }'
```

### Prepare a Price or SKU Update

For an existing product's price or SKU, use the name lookup above, then Get Product. Request `?fields=VARIANT_OPTION_CHOICE_NAMES&fields=MERCHANT_DATA&fields=PRODUCT_CHOICES_MEDIA_REFERENCES&fields=PRODUCT_CHOICES_DISPLAY_IMAGE` so the same read supplies variant choice names, permitted cost data, and choice media to preserve. The response is `{ product: { id, revision, options, variantsInfo: { variants } } }`; search results cannot supply the variants.

Build the complete writable options and variants from that response, then change only the requested field. **Every variants PATCH also includes the complete `options` array**, even for an SKU-only change; for a product without options, send `options: []`. Omitting options caused `428 MISSING_OPTIONS_ON_UPDATE_VARIANTS`. A variant retains its `id`, `choices`, price, and other writable fields. The example below copies the writable fields used by these flows and strips calculated monetary values; inventory status and variant media are read-only and are not part of this update.

```javascript
const product = getResponse.product;
const pick = (source, keys) => Object.fromEntries(keys
  .filter(key => source[key] !== undefined)
  .map(key => [key, structuredClone(source[key])]));
const amountOnly = value => ({ amount: value.amount });
const options = (product.options ?? []).map(option => ({
  ...pick(option, ["id", "name", "optionRenderType"]),
  choicesSettings: { choices: option.choicesSettings.choices.map(choice =>
    pick(choice, ["choiceId", "name", "choiceType", "colorCode", "media", "displayImage"])) }
}));
const variants = product.variantsInfo.variants.map(variant => {
  const copy = pick(variant, ["id", "visible", "sku", "barcode", "physicalProperties"]);
  copy.choices = (variant.choices ?? []).map(choice => ({
    optionChoiceNames: pick(choice.optionChoiceNames, ["optionName", "choiceName", "renderType"])
  }));
  copy.price = { actualPrice: amountOnly(variant.price.actualPrice) };
  if (variant.price.compareAtPrice) copy.price.compareAtPrice = amountOnly(variant.price.compareAtPrice);
  if (variant.revenueDetails?.cost) copy.revenueDetails = { cost: amountOnly(variant.revenueDetails.cost) };
  if (variant.digitalProperties) {
    copy.digitalProperties = variant.digitalProperties.digitalFile
      ? { digitalFile: { id: variant.digitalProperties.digitalFile.id } } : {};
  }
  if (copy.physicalProperties?.pricePerUnit) delete copy.physicalProperties.pricePerUnit.value;
  return copy;
});
const variantPatchProduct = {
  id: product.id, revision: product.revision, options,
  variantsInfo: { variants }
};
```

For the single-variant product case (a user asking to change a simple product's price), use the prepared body above:

```javascript
if (variants.length !== 1) throw new Error("Clarify which variants should receive the price change");
variants[0].price.actualPrice.amount = "25"; // requested price
const pricePatchBody = { product: variantPatchProduct };
```

For a named option choice such as `Size = Large`, use its returned choice names to select one variant, then change its SKU:

```javascript
const matches = variants.filter(variant => variant.choices.some(choice =>
  choice.optionChoiceNames.optionName === "Size" && choice.optionChoiceNames.choiceName === "Large"));
if (matches.length !== 1) throw new Error("Clarify which variant should receive the SKU change");
matches[0].sku = "MUG-L-001"; // requested SKU
const skuPatchBody = { product: variantPatchProduct };
```

Send the selected body to `PATCH https://www.wixapis.com/stores/v3/products/{productId}` in the same ExecuteWixAPI invocation as the name lookup and Get Product. Its response is `{ product: { id, revision, variantsInfo: { variants } } }`; verify the changed variant by its retained ID and confirm from that response. These examples provide the request fields and response paths for price and SKU changes; proceed directly after reading this recipe. Discover further schemas only for fields not covered here or a documented call that fails.

### Update Variant Price Only

Read `{existingVariantId}` off the Get Product response; a Search or Query Products result does not carry it. The curl below is for a single-variant product without options. For an optioned product, use the complete options/variants body in **Prepare a Price or SKU Update**.

```bash
curl -X PATCH "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "product": {
      "id": "{productId}",
      "revision": "{currentRevision}",
      "options": [],
      "variantsInfo": {
        "variants": [
          {
            "id": "{existingVariantId}",
            "choices": [],
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

### Attach a Digital File

For an existing digital product rejected at add-to-cart with `ITEM_NOT_FOUND_IN_CATALOG`, use this repair flow. For a supplied external PDF URL, the table below is the complete request/response contract; execute it directly after reading this recipe. Use its linked method URLs as source citations. Further schema discovery is needed only for a field not covered here or a documented call that fails.

First locate the existing product with the name lookup above, then Get Product for its revision and variants. If the requested product is absent or ambiguous, ask for the correct product or site and stop before uploading media. Repairing an existing product does not authorize creating a replacement.

A `DIGITAL` product is sellable only when its variant has both a digital file and stock. For a product already in stock, keep that stock unchanged and attach only the missing file. `digitalProperties` belongs to the variant.

| Call | Request | Response fields used next |
|---|---|---|
| [Search Products](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products) | Use the `search.search` name lookup above. | `products[].id` and `name` select the existing product. |
| [Get Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product) | `GET https://www.wixapis.com/stores/v3/products/{productId}?fields=VARIANT_OPTION_CHOICE_NAMES&fields=MERCHANT_DATA&fields=PRODUCT_CHOICES_MEDIA_REFERENCES&fields=PRODUCT_CHOICES_DISPLAY_IMAGE` | `product.id`, `revision`, `productType`, `options`, and `variantsInfo.variants` supply the complete writable state. |
| [Import File](https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/import-file) | `POST https://www.wixapis.com/site-media/v1/files/import` with `{ "url": "{suppliedPdfUrl}", "mimeType": "application/pdf", "displayName": "download.pdf", "private": true }` | `file.id` and `file.operationStatus`. Import the exact supplied URL once; retain this ID. |
| [Get File Descriptor](https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/get-file-descriptor), only while PENDING | `GET https://www.wixapis.com/site-media/v1/files/get-file-by-id?fileId={fileId}` | `file.operationStatus`: wait for `READY`, stop on `FAILED`. The response is wrapped in `file`. |
| [Update Product](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/update-product) | `PATCH https://www.wixapis.com/stores/v3/products/{productId}` with `{ product: { id, revision, options, variantsInfo: { variants } } }` | `product.variantsInfo.variants[].digitalProperties.digitalFile.id` confirms the attachment on the retained variant ID. |

Chain these requests in one ExecuteWixAPI invocation; with `wix.request`, the REST response body is in `response.data`. Private import keeps the stored download private. For a local file rather than a supplied URL, read [Upload Media to Wix](../media/upload-media-to-wix.md) and use its Generate Upload URL flow instead.

Prepare the complete options/variants body as in **Prepare a Price or SKU Update**, retain every variant ID, choice and price, and set the requested variant's `digitalProperties.digitalFile.id` to the imported file ID. For one existing variant with no options:

```bash
curl -X PATCH "https://www.wixapis.com/stores/v3/products/{productId}" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "product": {
      "id": "{productId}",
      "revision": "{currentRevision}",
      "options": [],
      "variantsInfo": {
        "variants": [{
          "id": "{existingVariantId}",
          "choices": [],
          "price": { "actualPrice": { "amount": "{existingPrice}" } },
          "visible": true,
          "digitalProperties": { "digitalFile": { "id": "{fileId}" } }
        }]
      }
    }
  }'
```

Copy any other writable variant fields from the read product using the preparation example. Chain the product lookup, read, selected upload path, and one PATCH in one ExecuteWixAPI invocation. Confirm from `product.variantsInfo.variants[].digitalProperties.digitalFile.id` in the PATCH response; no extra product read is needed when that response supplies it.

## Important Notes

- A request to hide a product is a `visible: false` update on the product, never a Delete Product call and never a variant-only change.
- To update array fields like `options`, `modifiers`, `variantsInfo.variants`, and any others, pass the entire existing array. Passing only the changed item overwrites the whole array.
- To update `variantsInfo.variants`, also pass `options`, and vice versa. Variants and options are mutually dependent and must stay aligned.
- When converting a simple product to an optioned product, rebuild the variants list so every variant has `choices`; do not keep an existing choice-less default variant unchanged.
- Always include `choicesSettings` with the complete list of choices when updating a product with options.
- An existing choice's `name` can't be changed via Update Product or Update Customization. The request succeeds and revision increments, but the rename is silently dropped — see "Renaming an Existing Choice Is Not Supported" above.
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
| `ITEM_NOT_FOUND_IN_CATALOG` at add-to-cart, product exists | A `DIGITAL` variant has no `digitalProperties.digitalFile` | Attach a file — see [Attach a Digital File](#attach-a-digital-file) |
| `exceeds available inventory` at add-to-cart, product exists | The variant has no stock (`DIGITAL` products included) | Update its stock through the Inventory API; inventory is separate from an Update Product PATCH |
