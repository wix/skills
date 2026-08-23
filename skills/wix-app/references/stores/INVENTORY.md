# Stores — Inventory

## Read stock for display — don't use this API

To *show* whether something is in stock, read it off the product you already fetched. The Inventory API below is for **changing** stock and for quantity-level queries; reaching for it to render a badge costs an extra call and lands you on write-shaped fields (`{ productId, variantId, incrementBy }`) that don't type-check as a read.

```typescript
if (v === 'V3_CATALOG') {
  const product = await productsV3.getProduct(id);
  product.inventory?.availabilityStatus;                                    // whole product
  product.variantsInfo?.variants?.map(variant => variant.inventoryStatus?.inStock);  // per variant
} else {
  const res = await products.getProduct(id);
  res.product!.variants?.map(variant => variant.stock?.inStock);            // V1: stock, not inventoryStatus
}
```

Status values are UPPER_SNAKE_CASE on both versions — see [`../STORES_VERSIONING.md`](../STORES_VERSIONING.md).

---

## Increment stock

```typescript
import { inventory, inventoryItemsV3 } from '@wix/stores';

if (v === 'V3_CATALOG') {
  // Per-variant; flat shape.
  await inventoryItemsV3.bulkIncrementInventoryItems([
    { inventoryItemId, incrementBy: 5 },
  ]);
} else {
  // Per-product (variant optional).
  await inventory.incrementInventory([
    { productId, variantId, incrementBy: 5 },
  ]);
}
```

To find a V3 inventory item ID, use `inventoryItemsV3.searchInventoryItems` filtered by `productId` / `variantId`.

---

## Query inventory

```typescript
if (v === 'V3_CATALOG') {
  const res = await inventoryItemsV3.queryInventoryItems().eq('productId', productId).find();
  return res.items;
}
// V1: filter is a JSON-stringified expression.
const res = await inventory.queryInventory({
  query: { filter: JSON.stringify({ productId }) },
});
return res.inventoryItems;
```
