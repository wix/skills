# Stores — Collections (V1) ↔ Categories (V3)

```typescript
// V1 write ops (createCollection, updateCollection, addProductsToCollection, …)
// live on the `products` namespace, NOT `collections`. The `collections` namespace is read-only.
import { products } from '@wix/stores';
import { categories } from '@wix/categories';

if (v === 'V3_CATALOG') {
  // V3 createCategory(category, options). treeReference is REQUIRED and goes in `options`.
  // For Wix Stores categories: appNamespace MUST be the literal "@wix/stores", treeKey is null.
  const category = await categories.createCategory(
    { name: 'Sale' },
    { treeReference: { appNamespace: '@wix/stores', treeKey: null } },
  );
  return category;
}
const { collection } = await products.createCollection({ name: 'Sale' });  // V1 returns { collection }
return collection;
```

V3 categories are tree-structured. Reference them on a product via `directCategories[]`, not `collectionIds[]`. **All Stores category API calls must pass `treeReference: { appNamespace: '@wix/stores', treeKey: null }` in `options`** — applies to `createCategory`, `updateCategory`, `queryCategories`, etc.
