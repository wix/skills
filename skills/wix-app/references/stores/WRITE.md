# Stores — Write Operations (Create / Update / Delete / Inventory)

## Create a product (single-variant, with price)

```typescript
if (v === 'V3_CATALOG') {
  const product = await productsV3.createProduct({
    name: 'My Product',
    productType: 'PHYSICAL',                            // UPPER_CASE
    variantsInfo: {
      variants: [{
        price: { actualPrice: { amount: '19.99' } },    // string, on the variant
        sku: 'SKU-001',
      }],
    },
  });
  return product;
}

const { product } = await products.createProduct({
  name: 'My Product',
  productType: 'physical',                              // lower-case
  priceData: { price: 19.99 },                          // number, on the product
  sku: 'SKU-001',
});
return product;
```

---

## Update a product (V3 needs `revision`)

```typescript
if (v === 'V3_CATALOG') {
  // Signature: updateProduct(_id, productFields). Returns Product directly.
  const current = await productsV3.getProduct(id);
  if (current.revision == null) throw new Error(`Product ${id} has no revision`);
  return await productsV3.updateProduct(id, {
    revision: current.revision,  // narrowed — required under exactOptionalPropertyTypes
    name: 'New name',
  });
}
// V1: updateProduct(id, productFields). Returns { product }.
const { product } = await products.updateProduct(id, { name: 'New name' });
return product;
```

---

## Delete a product

```typescript
if (v === 'V3_CATALOG') await productsV3.deleteProduct(id);
else await products.deleteProduct(id);
```

---

## Inventory: increment stock

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
