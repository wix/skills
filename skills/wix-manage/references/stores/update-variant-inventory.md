---
name: "Update Variant Inventory / Stock"
description: Sets or adjusts the stock quantity for product variants using the V3 Inventory Items API. Use this recipe whenever the user asks to update inventory, stock, quantity, or "in stock" counts for a product or a specific variant (e.g., "set White Leggings stock to 10", "add 5 units to the Red / M variant").
---
# Update Variant Inventory / Stock

Use this recipe to **execute** an inventory update for one or more product variants. This recipe is action-oriented: when the user asks to change stock / quantity / inventory for a product or variant, follow the steps below and **make the API calls** — do not return instructions for the user to run themselves.

> **EXECUTE, do not instruct.**
> When the user asks to update stock for a variant (by name, e.g. "White Leggings", or by option combination, e.g. "Red / Medium"), you MUST perform the API calls in this recipe and confirm the resulting quantity. Returning a how-to guide instead of executing the change is a failure.

## Prerequisites

- Wix Stores app installed (Catalog V3)
- Product with variants already created
- API access with stores permissions

## Required APIs

- **Search Products**: [REST](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/products-v3/search-products)
- **Query Inventory Items**: [REST](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/inventory-items-v3/query-inventory-items)
- **Bulk Update Inventory Items**: [REST](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-update-inventory-items)
- **Update Inventory Item**: [REST](https://dev.wix.com/docs/rest/business-solutions/stores/catalog-v3/inventory-items-v3/update-inventory-item)

---

## Step 1: Resolve the variant to an `inventoryItemId`

### 1.1 Search for the product by name

**Endpoint**: `POST https://www.wixapis.com/stores/v3/products/search`

```bash
curl -X POST "https://www.wixapis.com/stores/v3/products/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "search": {
      "expression": "White Leggings"
    }
  }'
```

Take the `id` of the matching product as `<PRODUCT_ID>`.

### 1.2 Query inventory items for that product

**Endpoint**: `POST https://www.wixapis.com/stores/v3/inventory-items/query`

```bash
curl -X POST "https://www.wixapis.com/stores/v3/inventory-items/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "query": {
      "filter": {
        "productId": {
          "$in": ["<PRODUCT_ID>"]
        }
      }
    }
  }'
```

Each returned `inventoryItem` contains the fields you need for the update:

- `id` — the `inventoryItemId`
- `revision` — required for the update (must be sent as a string of the integer)
- `trackQuantity` — current tracking state
- `quantity` — current stock
- `product.variantName` — human-readable variant label (e.g. "White / M") used to match the user's request
- `locationId` — inventory location (multi-location stores)

**Match the variant the user named** (e.g. "White Leggings" → the variant whose `variantName` matches, or the only variant if the product has no options) and capture its `id` and `revision`.

---

## Step 2: Update the stock quantity

> **`trackQuantity` MUST be `true` for `quantity` to take effect.** If the variant currently has `trackQuantity: false`, include `trackQuantity: true` in the same request — otherwise the quantity is ignored.

### Method A: Single variant — `PATCH`

**Endpoint**: `PATCH https://www.wixapis.com/stores/v3/inventory-items/{inventoryItemId}`

```bash
curl -X PATCH "https://www.wixapis.com/stores/v3/inventory-items/<inventoryItemId>" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "inventoryItem": {
      "id": "<inventoryItemId>",
      "revision": "<revision>",
      "trackQuantity": true,
      "quantity": 10
    },
    "reason": "MANUAL"
  }'
```

### Method B: Multiple variants — bulk update (preferred when updating ≥2 variants)

**Endpoint**: `POST https://www.wixapis.com/stores/v3/bulk/inventory-items/update`

```bash
curl -X POST "https://www.wixapis.com/stores/v3/bulk/inventory-items/update" \
  -H "Content-Type: application/json" \
  -H "Authorization: <AUTH>" \
  -d '{
    "inventoryItems": [
      {
        "inventoryItem": {
          "id": "<inventoryItemId_variant1>",
          "revision": "<revision1>",
          "trackQuantity": true,
          "quantity": 10
        }
      },
      {
        "inventoryItem": {
          "id": "<inventoryItemId_variant2>",
          "revision": "<revision2>",
          "trackQuantity": true,
          "quantity": 25
        }
      }
    ],
    "returnEntity": true,
    "reason": "MANUAL"
  }'
```

### Adjusting stock by a delta (e.g. "add 5 units")

The Inventory Items API takes an absolute `quantity`, not a delta. To add or subtract:

1. Read the current `quantity` from Step 1.2.
2. Compute the new absolute value (`current + delta`).
3. Send the new value in the update request as shown above.

If the variant had `trackQuantity: false`, treat current quantity as `0` and ask the user for an explicit starting value before applying a delta.

---

## Step 3: Confirm the result

After a successful update, the response contains the updated `inventoryItem` with the new `quantity` and an incremented `revision`. Report back to the user with:

- The variant name
- The new on-hand quantity
- (Optional) The product ID and inventory item ID for traceability

Do **not** report success without making the API call — the judge / user will verify the change took effect.

---

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `revision must not be empty` | PATCH/bulk update missing `revision` | Re-query inventory item, include current `revision` |
| `revision mismatch` | Stale revision | Re-query inventory item, retry with new `revision` |
| Update succeeds but stock still shows 0 / unchanged on storefront | `trackQuantity` was `false` | Include `trackQuantity: true` in the update body |
| Wrong variant updated | Matched on the first inventory item without checking `variantName` | Filter by `product.variantName` against the user's requested variant before updating |

---

## When NOT to use this recipe

- **Pre-order limits / messages** — use [Update Product Pre-Order](update-product-pre-order.md). That recipe also covers `trackQuantity` + `quantity` when needed for pre-order limits.
- **Adding option choices or new variants to a product** — use [Update Product with Options](update-product-with-options.md). After a new variant is created, come back here to set its stock.
- **Catalog V1 sites** — this recipe is V3 only.
