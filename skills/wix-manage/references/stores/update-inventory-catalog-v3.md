---
name: "Update Inventory (Catalog V3)"
description: "Restocks existing Wix Stores Catalog V3 products and variants, sets exact stock quantities, and marks status-tracked items available or unavailable. Covers existing and missing inventory records, location selection, bulk updates, and partial failures without changing product options or prices."
---

# Update Inventory (Catalog V3)

Use this recipe for stock-only changes to existing products. For a new product with starting stock, use [Create Product (Catalog V3)](create-product-catalog-v3.md); for changes to options or variant prices, use [Update Product with Options](update-product-with-options.md).

## Choose the stock operation

1. Confirm the requested mutation with the user unless already explicitly authorized. Resolve the product, variants, and location before writing. If the catalog version is unknown, use the version check in [Create Product (Catalog V3)](create-product-catalog-v3.md) and continue here only for V3.
2. Query Inventory Items first. Inventory records identify a product, variant, and location. An absent `inventoryItem` in a product response does **not** establish that an inventory record is missing. Do not recreate variants or patch product options for a stock-only request.
3. Match the user's intent to the current tracking mode:
   - “Set stock to 25” means the exact total: send `quantity: 25`, not an increment. This selects quantity tracking.
   - “Mark available again” on a status-tracked item means `inStock: true`.
   - If a quantity-tracked item is out of stock and the user provides no count, ask for the new quantity. Do not invent a count or silently switch to status tracking. An explicit request to stop quantity tracking can use `inStock`.
   - Send exactly one of `quantity` and `inStock`. `trackQuantity` and `availabilityStatus` are read-only results, not request fields.
4. Update existing inventory IDs with their current revisions. Create only variant/location pairs proven missing by the inventory query. A newly added variant can already have an inventory record; apply the same check after product updates.
5. Inspect every bulk result before reporting success. Keep unrelated prices, SKUs, options, variants, locations, and preorder settings unchanged.

## Find the inventory records

Site-scoped calls use `Authorization: <AUTH>`, `wix-site-id: <SITE_ID>`, and `Content-Type: application/json`.

[Query Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/query-inventory-items): `POST https://www.wixapis.com/stores/v3/inventory-items/query`.

For a named product, this query can resolve inventory directly without a product query:

```json
{
  "query": {
    "filter": {"product.name": {"$eq": "Wool Scarf"}},
    "cursorPaging": {"limit": 1000}
  }
}
```

When a product ID is already known, use `{"productId":{"$eq":"<PRODUCT_ID>"}}` instead. The returned `inventoryItems[]` provide `id`, `revision`, `productId`, `variantId`, `locationId`, `trackQuantity`, and `quantity` or `inStock`; `product.variantName` and `product.variantSku` identify the variant.

Follow `pagingMetadata.cursors.next` until absent. Subsequent requests use `{"query":{"cursorPaging":{"limit":1000,"cursor":"<NEXT_CURSOR>"}}}` without repeating the filter or sort. To enumerate all existing inventory, omit the filter and page through all records. This listing alone cannot establish complete coverage of all products: products or variants with no inventory record will not appear.

Group matches by product and location. If a name resolves to multiple product IDs, or multiple locations match an unspecified location, ask which to change; never update every location by accident. A user-specified location ID can be combined with the product filter using `$and` and `locationId.$eq`.

If inventory is absent, resolve the actual product and its variant IDs through [Find Products](find-products-query-and-search-catalog-v3.md). For “all products” or “all variants,” resolve the complete requested product/variant set through Find Products and compare it with the inventory records at the selected location, so missing records are not silently skipped. Do not treat an empty result as permission to create a new product.

## Update existing records

[Bulk Update Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-update-inventory-items): `POST https://www.wixapis.com/stores/v3/bulk/inventory-items/update`.

```json
{
  "inventoryItems": [
    {"inventoryItem": {"id": "<INVENTORY_ID>", "revision": "<CURRENT_REVISION>", "quantity": 25}}
  ],
  "reason": "MANUAL",
  "returnEntity": true
}
```

For a status-only change, replace `"quantity": 25` with `"inStock": true` (or `false`). Each entry is wrapped in `inventoryItem`; do not use the flat create shape. Use batches of at most 1,000 items and skip records already at the requested state. On a revision conflict, reread only the failed item and reassess the requested change before retrying with its new revision.

## Create missing records

[Bulk Create Inventory Items](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/inventory-items-v3/bulk-create-inventory-items): `POST https://www.wixapis.com/stores/v3/bulk/inventory-items/create`.

```json
{
  "inventoryItems": [
    {"productId": "<PRODUCT_ID>", "variantId": "<VARIANT_ID>", "locationId": "<LOCATION_ID>", "quantity": 25}
  ],
  "returnEntity": true
}
```

Create entries are flat and require `productId` and `variantId`. `variantId` plus `locationId` must be unique. Omit `locationId` only when intentionally creating at the store's default location; never substitute another location after a default-location error. Use `inStock` instead of `quantity` only for authorized status tracking. Batch at most 1,000 records.

If creation reports an existing record, query that variant/location and use its inventory ID and revision to update it. Do not delete the existing record or resend the entire create batch.

## Validate every result

Both inventory bulk methods return `results[]` and `bulkActionMetadata`:

- Correlate each result with its input using `itemMetadata.originalIndex` or its inventory ID. Require `itemMetadata.success === true`; inspect `itemMetadata.error` for failures.
- Reconcile `totalSuccesses`, `totalFailures`, and `undetailedFailures` against the submitted count. Missing results or undetailed failures prevent an “all succeeded” claim, even with HTTP 200.
- With `returnEntity: true`, the entity is `results[].item`. Verify the returned product/variant/location and requested `quantity` or `inStock` there. It is not a top-level `inventoryItems` response.
- Report completed, unchanged, and failed items separately. Retry only failed items when the cause is resolved. Do not repeat product queries or stock writes to reconfirm a result already proved by the mutation response.
