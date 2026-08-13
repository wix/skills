---
name: "Create Product (Catalog V3)"
description: Mandatory first recipe for every Wix Stores Catalog V3 create-product request. Before any mutation, require an explicit name and price for every product; an absent price is never 0. If no product is identified, offer both image-upload and text-description paths and stop. If name or price is missing, ask or offer a suggestion and stop. If enrichment is unresolved, ask one bundled question and stop. Covers single/bulk creation, inventory, physical/digital products, images, options, variants, SKUs, and validation.
---

# Create Product (Catalog V3)

Use this recipe for one or multiple Catalog V3 products. Catalog V1 remains supported through [Create Product (Catalog V1)](create-product-catalog-v1.md).

> [!IMPORTANT]
> **Apply the no-product gate first.** A vague request such as “I’d like to add a new product” does not identify a product. Respond only:
>
> **“What product would you like to create? You can upload up to 3 images and I’ll generate the product information from them, or describe the product in text.”**
>
> Then end the turn. Do not ask for name, price, product type, options, SEO, inventory, or any other structured field yet. Do not replace the image-or-text choice with a checklist, form, or questionnaire. Reading this recipe must be the final tool call in that turn.

> [!IMPORTANT]
> **A create request is not permission to create a bare product.** When the user has supplied a name and price but has not addressed enrichment, the first response must be exactly one bundled question and then the turn must end:
>
> **“Does this product come in different sizes or colors, and would you like me to generate an SEO description or info sections for it?”**
>
> Reading this recipe is the only tool call allowed in that turn. Do not detect the catalog version, inspect the site, upload media, or call any product endpoint until the user answers or explicitly declines both parts of the question.

Canonical example:

- User: “For my Wix store, I’d like to add a new product.”
- Assistant: “What product would you like to create? You can upload up to 3 images and I’ll generate the product information from them, or describe the product in text.”
- Result: **Stop. Do not request structured product fields yet.**

- User: “For my Wix store, create a product called ‘Handmade Ceramic Mug’ priced at $24.”
- Assistant: “Does this product come in different sizes or colors, and would you like me to generate an SEO description or info sections for it?”
- Result: **Stop. No product has been created yet.**

## Preflight: respond and return before mutation

Name and price are mandatory **workflow inputs for every product**, even when the API schema accepts an omitted price or initializes it to zero. Evaluate the cases below in order. When a case says **RETURN**, end the turn immediately: do not call a create endpoint, do not continue to examples, and do not create first and ask afterward.

1. **No product identified:** Respond only: “What product would you like to create? You can upload up to 3 images and I’ll generate the product information from them, or describe the product in text.” **RETURN.** Do not replace the two paths with a form, checklist, questionnaire, text-only prompt, or requests for name, price, type, options, SEO, or inventory.
2. **Any product lacks an explicit name or price:** Ask for all missing mandatory values in one question and offer to suggest them. When only price is missing, respond only: “What price should I set for [product name]? I can suggest one if you’d like.” **RETURN.** Do not ask about enrichment in this turn.
3. **Every name and price is known, but enrichment is unresolved:** This includes direct commands such as “create a product called X priced at Y.” Respond only: “Does this product come in different sizes or colors, and would you like me to generate an SEO description or info sections for it?” **RETURN.** The docs read must be the turn's final tool call. Treat enrichment as resolved only when the user supplies preferences or explicitly declines both options/choices and generated content.
4. **Every name, price, and enrichment choice is resolved:** Creation may continue. Optional type, description, SKU, inventory, and images are not required.

“Create it,” “create it now,” “for my store, create,” or similar mutation language does not satisfy a missing price or enrichment choice. A usable price must be either explicitly supplied by the user or a suggestion the user accepted. Treat `0` as supplied only when the user explicitly requests a free or zero-priced product.

Before every create call, assert all three conditions:

- Every product has a non-empty name from the user or an accepted suggestion.
- Every variant has a price from the user or an accepted suggestion; no price came from an API default, placeholder, example, or assumption.
- Enrichment was answered or explicitly declined in the conversation; a create-now instruction, absent answer, or internal assumption is not an enrichment decision.

If any product is missing a price, **do not call the API**. Ask for the missing price, using the product's supplied name when available, and offer to suggest one. Never put `"amount": "0"` in the request unless the user explicitly chose a zero price.

For any request where every product has a name and price but enrichment is unresolved, ask the single bundled enrichment question from preflight step 3 and **RETURN**. Adapt singular or plural wording to the request. Do not call a create endpoint, treat omitted options or content as a decline, or postpone the enrichment offer until after creation.

## Core flow

1. Apply the preflight. When it says **RETURN**, make no API call in that turn.
2. Send site-scoped calls with `Authorization`, `wix-site-id`, and `Content-Type: application/json`.
3. If the catalog version is unknown, run:

   ```bash
   curl --request GET \
     --url 'https://www.wixapis.com/stores/v3/provision/version' \
     --header 'Authorization: <AUTH>' \
     --header 'wix-site-id: <SITE_ID>' \
     --header 'Content-Type: application/json'
   ```

   Continue here only for `V3_CATALOG`; use the V1 recipe for `V1_CATALOG`.
4. Resolve each product's supplied type, variants, SKUs, inventory intent, and images only after its mandatory name, variant price, and enrichment choice are known.
5. Choose the endpoint, build the products, upload any images, create, and validate every result. Continue until all requested products succeed or report the exact failed items.

## Choose the endpoint

| Request | No inventory | Quantity or in-stock state |
|---|---|---|
| One product | `POST /stores/v3/products` | `POST /stores/v3/products-with-inventory` |
| Multiple products | `POST /stores/v3/bulk/products/create` | `POST /stores/v3/bulk/products-with-inventory/create` |

- Bulk endpoints accept 1–100 products, so a compatible bulk endpoint is also valid for one product.
- For multiple products requested as one batch, send one bulk call. Use the with-inventory endpoint when any product needs inventory; include `inventoryItem` only on tracked variants.
- Never send `inventoryItem` to a no-inventory endpoint. Do not invent inventory.
- Digital products normally use a no-inventory endpoint.
- Per bulk request, allow at most 100 products, 100 total options, 100 modifiers, 100 info sections, and 1000 variants. Split larger input into compliant batches.

## Build each product

| Concern | Rule |
|---|---|
| Type | `PHYSICAL` uses product- and variant-level `physicalProperties`; `DIGITAL` omits physical properties and inventory. |
| Variants | Include at least one. Price, SKU, barcode, inventory, and digital file are variant-level fields. |
| Price | Use a string in `price.actualPrice.amount`; add `compareAtPrice` only when supplied. |
| SKU | Preserve supplied strings exactly, including `#`, punctuation, and leading zeroes. Keep variant SKUs unique unless explicitly requested otherwise. |
| Options | Define non-empty choices and create every requested Cartesian combination. Each variant references one choice from every option through `optionChoiceNames`. |
| Text | Prefer `plainDescription` for unformatted copy. Use `description` only for a valid Ricos document. |
| Media | Up to 3 images are supported per product. Preserve their supplied order in `media.itemsInfo.items`; `media.main` is read-only. |

This inventory-aware physical product is the reusable shape. Remove `inventoryItem` when using a no-inventory endpoint; remove `media` when no image was supplied.

```json
{
  "name": "Canvas Tee",
  "productType": "PHYSICAL",
  "physicalProperties": {},
  "media": {"itemsInfo": {"items": [{
    "url": "https://static.wixstatic.com/media/example.jpg",
    "altText": "Canvas Tee"
  }]}},
  "options": [{
    "name": "Size",
    "optionRenderType": "TEXT_CHOICES",
    "choicesSettings": {"choices": [
      {"choiceType": "CHOICE_TEXT", "name": "Small"},
      {"choiceType": "CHOICE_TEXT", "name": "Large"}
    ]}
  }],
  "variantsInfo": {"variants": [
    {
      "choices": [{"optionChoiceNames": {
        "optionName": "Size", "choiceName": "Small", "renderType": "TEXT_CHOICES"
      }}],
      "sku": "TEE-001-S",
      "price": {
        "actualPrice": {"amount": "18.50"},
        "compareAtPrice": {"amount": "22.00"}
      },
      "inventoryItem": {"quantity": 13},
      "physicalProperties": {},
      "visible": true
    },
    {
      "choices": [{"optionChoiceNames": {
        "optionName": "Size", "choiceName": "Large", "renderType": "TEXT_CHOICES"
      }}],
      "sku": "TEE-001-L",
      "price": {"actualPrice": {"amount": "18.50"}},
      "inventoryItem": {"inStock": true},
      "physicalProperties": {},
      "visible": true
    }
  ]}
}
```

For a color option, use `SWATCH_CHOICES`; each choice uses `choiceType: ONE_COLOR` and `colorCode`, and the variant reference uses `renderType: SWATCH_CHOICES`.

A digital product uses the smaller shape below. Add the supplied variant-level digital file only when one was provided.

```json
{
  "name": "Focus Planner PDF",
  "productType": "DIGITAL",
  "variantsInfo": {"variants": [{
    "sku": "PDF-FOCUS-01",
    "price": {"actualPrice": {"amount": "9.99"}},
    "visible": true
  }]}
}
```

### Generated descriptions and SEO

- When copy is generated from an image, state only user-supplied or visually supported facts. Do not present material, dimensions, capacity, care instructions, compatibility, or other non-visible attributes as facts.
- Use `plainDescription` unless formatting is required. SEO tags use `seoData.tags`.
- For formatted bullets, the Ricos node is `BULLETED_LIST`, not `BULLET_LIST`, and its data field is `bulletedListData`:

```json
{
  "description": {"nodes": [{
    "type": "BULLETED_LIST",
    "nodes": [{"type": "LIST_ITEM", "nodes": [{
      "type": "PARAGRAPH",
      "nodes": [{"type": "TEXT", "textData": {"text": "Visible blue glaze"}}],
      "paragraphData": {}
    }]}],
    "bulletedListData": {}
  }]}
}
```

## Add images

Skip this step when no image was supplied. Upload all attachments and public image URLs together through the available Wix image-upload capability; otherwise use `POST /site-media/v1/files/import`. Poll `GET /site-media/v1/files/get-file-by-id?fileId=<FILE_ID>` until `file.operationStatus` is `READY`; stop on `FAILED`. `READY` is the only usable status: an ID, URL, or `thumbnailUrl` on a `PENDING` or `FAILED` file is not proof that the asset is stored and must never be sent in product media. Then place each ready `wixstatic.com` URL on its matching product. Do not reuse the original external URL after upload.

Track every upload as its own product-to-file record. A poll or timeout fallback may return only that file's URL—never another product's URL. If an import fails, retry the same asset through another supported transfer method when possible; never silently replace it with a different image. If the exact asset cannot be preserved, create only products whose requested images are ready and report every blocked product and failed source exactly; for a single required-image product, make no product-create call.

## Wrap the request

Use the chosen product object directly in either envelope:

```json
{"product": PRODUCT}
```

```json
{"products": [PRODUCT_1, PRODUCT_2], "returnEntity": true}
```

The first is for single endpoints; the second is for bulk endpoints. If the user supplies only a SKU pattern for variants, generate a stable unique SKU per combination and preserve the mapping in the result.

### Request projected media when validating images

`media.itemsInfo.items` is a projected response field. Creating a product with media does not guarantee that the create response—or an ordinary Get Product call—returns the gallery. To receive it, pass `"MEDIA_ITEMS_INFO"` in the request-level `fields` array.

For a single create with images:

```json
{"product": PRODUCT_WITH_MEDIA, "fields": ["MEDIA_ITEMS_INFO"]}
```

For a bulk create with images:

```json
{
  "products": [PRODUCT_1, PRODUCT_2],
  "returnEntity": true,
  "fields": ["MEDIA_ITEMS_INFO"]
}
```

If the create result still does not prove the stored gallery, make at most one read-only verification call:

```http
GET /stores/v3/products/<PRODUCT_ID>?fields=MEDIA_ITEMS_INFO
```

Inspect `product.media.itemsInfo.items` from that projected response. Do not interpret an omitted `itemsInfo` as lost media, search the Update Product schema, or PATCH the same media merely to retrieve it. A PATCH is appropriate only when a projected response proves the stored media is actually wrong.

## Validate before reporting success

| Endpoint result | Required checks |
|---|---|
| Single, no inventory | Require `product.id`; report only response-backed fields as verified. For images, request `MEDIA_ITEMS_INFO` on create or use one projected Get Product verification call. |
| Single, with inventory | Require `product.id`; inspect `inventoryResults.results`, item metadata, and top-level error. |
| Bulk, no inventory | Inspect every `results[].itemMetadata`; with `returnEntity: true`, the created entity is `results[].item`, not `results[].product`. Reconcile `bulkActionMetadata.totalSuccesses` and `totalFailures` with the requested count. |
| Bulk, with inventory | Use the exact two-sibling response paths below. Inspect every product and inventory result, both bulk metadata objects, item metadata, and the inventory error before reporting success. |

`POST /stores/v3/bulk/products-with-inventory/create` does **not** return the same flat envelope as `/stores/v3/bulk/products/create`. Its response has two top-level sibling objects:

```json
{
  "productResults": {
    "results": [{"itemMetadata": {}, "item": {}}],
    "bulkActionMetadata": {}
  },
  "inventoryResults": {
    "results": [{"itemMetadata": {}, "item": {}}],
    "bulkActionMetadata": {},
    "error": null
  }
}
```

Before claiming that an inventory-aware bulk create succeeded:

1. Inspect every `productResults.results[]` entry and require `itemMetadata.success`; with `returnEntity: true`, read the product from `item`.
2. Reconcile `productResults.bulkActionMetadata.totalSuccesses`, `totalFailures`, and `undetailedFailures` with the requested product count.
3. Separately inspect every top-level `inventoryResults.results[]` entry and require `itemMetadata.success`; with `returnEntity: true`, read the inventory entity from `item`.
4. Reconcile `inventoryResults.bulkActionMetadata.totalSuccesses`, `totalFailures`, and `undetailedFailures` with the expected inventory-item count, and inspect `inventoryResults.error`.

Never read `productResults.inventoryResults`: that path does not exist. A successful product result or HTTP 200 does not prove inventory creation succeeded.

Retry only failed transient items, not successful products. If a requested field is absent from the response, call it submitted rather than API-verified; never echo the request as proof that it was stored.

`product.visible: true` proves catalog visibility, not that an unpublished site is live. Say “created” or “visible in the catalog”; say “live” only when site publication is independently confirmed.

## Failure guide

- Inventory missing: use the with-inventory endpoint and include `inventoryItem` on each tracked variant.
- Multiple requested products sent separately: use one compatible bulk call unless they cannot form a compliant batch or specific failed items are being retried.
- `variantsInfo must not be empty`: include at least one priced variant per product.
- Option/variant mismatch: create every requested combination and reference every option once per variant.
- Media not visible: use the uploaded `wixstatic.com` URL in `media.itemsInfo.items`; do not set `media.main`.
- Digital product rejected: omit physical properties and inventory; keep price, SKU, and any supplied digital file on the variant.
