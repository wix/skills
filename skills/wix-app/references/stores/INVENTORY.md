# Stores — Inventory

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
