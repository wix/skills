
# Wix Stores Catalog Versioning (V1 / V3)

Wix Stores has two catalog versions that are **NOT backwards compatible**. Apps **must support both** — otherwise new apps will not be listed in the App Market and existing apps will not work on new sites.

| Version | Status | Modules |
|---------|--------|---------|
| **V1_CATALOG** | Legacy | `products`, `collections`, `inventory` |
| **V3_CATALOG** | Current | `productsV3`, `inventoryItemsV3`, `categories` (separate package), `customizationsV3`, `ribbonsV3`, `brandsV3`, `infoSectionsV3`, `subscriptionsDetails` |

V3 modules typically have a `V3` suffix. Categories live in a separate package: `@wix/categories`.

---

## Mandatory Pattern: Detect Version First

**Every Stores flow must call `catalogVersioning.getCatalogVersion()` before any other Stores operation.**

```typescript
import { catalogVersioning, products, productsV3 } from '@wix/stores';

const { catalogVersion } = await catalogVersioning.getCatalogVersion();

if (catalogVersion === 'STORES_NOT_INSTALLED') {
  return []; // App should handle gracefully — do not throw.
}

if (catalogVersion === 'V3_CATALOG') {
  // V3 path
} else {
  // V1 path
}
```

The catalog version is **permanent per site** — a V3 site never downgrades to V1. Cache the result per site if needed.

---

## Module Map (V1 → V3)

| Concern | V1 (`@wix/stores`) | V3 (`@wix/stores` unless noted) |
|---------|--------------------|--------------------------------|
| Catalog version | `catalogVersioning` | `catalogVersioning` (same) |
| Products CRUD | `products` | `productsV3` |
| Product variants | nested in `products` | nested in `productsV3` (every product has ≥1 variant) |
| Inventory | `inventory` | `inventoryItemsV3` |
| Collections / Categories | Read: `collections`. **Write ops live on `products`** (`createCollection`, `updateCollection`, `addProductsToCollection`, …) | `@wix/categories` → `categories` |
| Custom text fields | `customTextFields` on product | `customizationsV3` (FREE_TEXT modifier) |
| Ribbons (text on product) | inline `ribbon` string | `ribbonsV3` |
| Brand | inline `brand` string | `brandsV3` |
| Additional info sections | inline `additionalInfoSections` | `infoSectionsV3` |
| Subscriptions | dedicated subscriptions API | inline `subscriptionDetails` on product |

---

## Permissions Cheatsheet

**Always include `SCOPE.STORES.CATALOG_READ_LIMITED`** in every Stores app — required by `getCatalogVersion()`.

| Operation | V1 scope | V3 scope |
|-----------|----------|----------|
| Get catalog version | `SCOPE.STORES.CATALOG_READ_LIMITED` | `SCOPE.STORES.CATALOG_READ_LIMITED` |
| Read products | `SCOPE.DC-STORES.READ-PRODUCTS` | `SCOPE.STORES.PRODUCT_READ` |
| Read hidden products / merchant data | `SCOPE.DC-STORES.READ-PRODUCTS` | `SCOPE.STORES.PRODUCT_READ_ADMIN` |
| Create / update / delete products | `SCOPE.DC-STORES.MANAGE-PRODUCTS` | `SCOPE.STORES.PRODUCT_WRITE` |
| Read inventory | `SCOPE.DC-STORES.READ-PRODUCTS` | `SCOPE.STORES.INVENTORY_ITEM_READ` |
| Update inventory | `SCOPE.DC-STORES.MANAGE-PRODUCTS` | `SCOPE.STORES.INVENTORY_ITEM_WRITE` |
| Read orders | `SCOPE.DC-STORES.READ-ORDERS` | `SCOPE.DC-STORES.READ-ORDERS` (orders unchanged) |
| Manage collections (V1) | `SCOPE.DC-STORES.MANAGE-PRODUCTS` | — |
| Manage categories (V3) | — | `SCOPE.CATEGORIES.CATEGORY_WRITE` |
| Read categories (V3) | — | `SCOPE.CATEGORIES.CATEGORY_READ` |

When supporting both versions, **request both V1 and V3 scopes** for any operation you implement on both code paths.

---

## Copy-Paste Recipes

Each recipe handles both versions. Use these as starting points; rename helpers as needed.

### List products (single page, no pagination)

```typescript
import { catalogVersioning, products, productsV3 } from '@wix/stores';

export async function listProducts(limit = 20) {
  const { catalogVersion } = await catalogVersioning.getCatalogVersion();
  if (catalogVersion === 'STORES_NOT_INSTALLED') return [];

  if (catalogVersion === 'V3_CATALOG') {
    // V3: pass the query object directly. Returns { products, pagingMetadata }.
    const res = await productsV3.queryProducts({ cursorPaging: { limit } });
    return res.products ?? [];
  }

  // V1: fluent builder. Returns { items, totalCount, hasNext, ... }.
  const res = await products.queryProducts().limit(limit).find();
  return res.items;
}
```

> V3 `queryProducts` does **not** return variants. Use `getProduct(id)` per product, or the Read-Only Variants API, when variants are needed.

### List products with pagination (the gotchas)

V3 and V1 paginate completely differently. Pick the right pattern up front — the response shapes don't match.

| Aspect | V1 (`products.queryProducts()`) | V3 (`productsV3.queryProducts(query)`) |
|--------|--------------------------------|----------------------------------------|
| API style | Fluent builder: `.skip().limit().find()` | Direct call: `queryProducts({ cursorPaging })` |
| Pagination | Offset-based (`skip`) | **Cursor-based only** — no `skip` |
| Total count | `res.totalCount` available | **No total count** in `pagingMetadata` |
| Next page | offset += limit | `res.pagingMetadata.cursors.next` (string token) |
| `hasNext` | `res.hasNext()` (method) | `res.pagingMetadata.hasNext` (boolean) |
| Has builder? | Yes (recommended) | Builder exists but **does not support `cursorPaging`** — use the direct-call form for paging |

**Common runtime errors and how to avoid them:**

1. ❌ `Field '_createdDate' is not declared as sortable` — V3 SDK type allows `'_createdDate' | '_updatedDate' | 'slug' | 'visible'` for `sort.fieldName`, but the runtime catalog rejects most of them. **Omit `sort` entirely on V3 product queries** — cursor paging already preserves a stable order. Only sort when you have a specific need and have verified the field works on a real V3 site.
2. ❌ `Property 'skip' does not exist on type 'ProductsQueryBuilder'` — V3 has no offset paging. Build a cursor-based UI ("Next/Previous"), not a numbered-page UI.
3. ❌ `Property 'total' does not exist on type 'CommonCursorPagingMetadata'` — V3 paging response has no total count. Don't try to compute `totalPages = ceil(total / pageSize)` for V3.
4. ❌ `Object literal may only specify known properties, and 'cursorPaging' does not exist in type 'QueryProductsOptions'` — `cursorPaging` belongs in the `query` parameter (first arg), not `options` (second arg). Don't combine it with the builder.

**Cursor-paging pattern (V3) + offset-paging pattern (V1):**

```typescript
import { catalogVersioning, products, productsV3 } from '@wix/stores';

// Note: V3Product / V1 Product types aren't re-exported from '@wix/stores' top-level.
// Let TypeScript infer the array type from the SDK return value, or use `unknown[]`
// in shared interfaces and narrow at the call site.

export interface ProductsPage {
  products: unknown[];        // narrow at call site to V1 vs V3 shape
  nextCursor: string | null;  // V3 only; null on V1
  hasNext: boolean;
  totalCount: number | null;  // V1 only; null on V3
}

export async function listProductsPage(
  limit: number,
  cursorOrSkip: string | number | undefined,
): Promise<ProductsPage> {
  const { catalogVersion } = await catalogVersioning.getCatalogVersion();
  if (catalogVersion === 'STORES_NOT_INSTALLED') {
    return { products: [], nextCursor: null, hasNext: false, totalCount: 0 };
  }

  if (catalogVersion === 'V3_CATALOG') {
    const cursor = typeof cursorOrSkip === 'string' ? cursorOrSkip : undefined;
    const res = await productsV3.queryProducts({
      cursorPaging: { limit, ...(cursor ? { cursor } : {}) },
      // Do NOT pass `sort` here — see gotcha #1 above.
    });
    return {
      products: res.products ?? [],
      nextCursor: res.pagingMetadata?.cursors?.next ?? null,
      hasNext: res.pagingMetadata?.hasNext ?? false,
      totalCount: null, // V3 has no total
    };
  }

  // V1 — offset paging via the fluent builder.
  const skip = typeof cursorOrSkip === 'number' ? cursorOrSkip : 0;
  const res = await products
    .queryProducts()
    .skip(skip)
    .limit(limit)
    .find();
  return {
    products: res.items,
    nextCursor: null,
    hasNext: res.hasNext(),
    totalCount: res.totalCount ?? null,
  };
}
```

**UI implication:** A "page X of Y" numbered pager only works on V1. For V3, expose a "Next / Previous" pager driven by `pagingMetadata.cursors`. Or pick a single UI and run two implementations behind the helper — never try to fake a V3 total count.

### Display price/stock without fetching variants

`productsV3.queryProducts` does **not** return variant data. To render a product list with price and stock, use the read-only product-level fields instead — no per-product round trip needed:

```typescript
// Each `p` here is a V3 product as returned by productsV3.queryProducts.
// Type it via `Awaited<ReturnType<typeof productsV3.queryProducts>>['products'][number]`
// or use a structural type — V3Product is not re-exported from '@wix/stores'.

function displayPrice(p: { actualPriceRange?: { minValue?: { amount?: string }; maxValue?: { amount?: string } } }): string {
  const minAmount = p.actualPriceRange?.minValue?.amount;
  const maxAmount = p.actualPriceRange?.maxValue?.amount;
  if (!minAmount) return '—';
  if (maxAmount && maxAmount !== minAmount) return `${minAmount} – ${maxAmount}`;
  return minAmount; // string in V3, e.g. "19.99"
}

function displayStock(p: { inventory?: { availabilityStatus?: string } }): string {
  return p.inventory?.availabilityStatus ?? 'UNKNOWN';
}
```

> SKU is on the variant (`variantsInfo.variants[i].sku`), and variants are **not** returned by `queryProducts` in V3. Either show "—" for SKU in lists, or fetch each product individually with `getProduct` (slow), or use the Read-Only Variants API.

### Stock status enums

Both versions use **UPPER_SNAKE_CASE** literals — never lowercase. TypeScript will reject `'in_stock'` as a comparison.

| Field | V1 path | V3 path | Values |
|-------|---------|---------|--------|
| Product-level rollup | `product.stock.inventoryStatus` | `product.inventory.availabilityStatus` | `IN_STOCK`, `OUT_OF_STOCK`, `PARTIALLY_OUT_OF_STOCK` (V3 also: `PREORDER`) |
| Per-variant in V3 | n/a | `variantsInfo.variants[i].inventoryStatus.inStock` (boolean) + `preorderEnabled` (boolean) | — |
| V3 preorder rollup | n/a | `product.inventory.preorderStatus` | `ENABLED`, `DISABLED`, `PARTIALLY_ENABLED` |

```typescript
// Mapping the rollup status to a user-facing label, version-agnostic.
function stockLabel(status: string | undefined): string {
  switch (status) {
    case 'IN_STOCK': return 'In Stock';
    case 'OUT_OF_STOCK': return 'Out of Stock';
    case 'PARTIALLY_OUT_OF_STOCK': return 'Limited';
    case 'PREORDER': return 'Pre-order';
    default: return '—';
  }
}
```

### Get a single product

```typescript
if (catalogVersion === 'V3_CATALOG') {
  // V3 returns the product directly.
  const product = await productsV3.getProduct(id);
  return product;
}
// V1 wraps it in { product }.
const { product } = await products.getProduct(id);
return product;
```

### Create a product (single-variant, with price)

```typescript
if (catalogVersion === 'V3_CATALOG') {
  // V3 returns the product directly.
  const product = await productsV3.createProduct({
    name: 'My Product',
    productType: 'PHYSICAL',
    variantsInfo: {
      variants: [{
        price: { actualPrice: { amount: '19.99' } },
        sku: 'SKU-001',
      }],
    },
  });
  return product;
}

// V1 wraps it in { product }.
const { product } = await products.createProduct({
  name: 'My Product',
  productType: 'physical',
  priceData: { price: 19.99 },
  sku: 'SKU-001',
});
return product;
```

> V3 enums are **UPPER_CASE** (`PHYSICAL`); V1 enums are lower-case (`physical`).
> V3 prices are **strings** (`"19.99"`); V1 prices are **numbers** (`19.99`).
> V3 prices live on the variant; V1 prices live on the product.

### Update a product (V3 needs `revision`)

```typescript
if (catalogVersion === 'V3_CATALOG') {
  // V3 requires the current revision for optimistic concurrency.
  // Signature: updateProduct(_id, productFields). Returns the product directly.
  const current = await productsV3.getProduct(id);
  const product = await productsV3.updateProduct(id, {
    revision: current.revision,
    name: 'New name',
  });
  return product;
}

// V1 signature: updateProduct(id, productFields). Returns { product }.
const { product } = await products.updateProduct(id, { name: 'New name' });
return product;
```

> V3: when updating array fields (`options`, `modifiers`, `variantsInfo.variants`) you must pass the **entire** existing array — partial updates overwrite, they don't merge. When updating `variantsInfo.variants`, you must also pass `options` (and vice versa).

### Delete a product

```typescript
if (catalogVersion === 'V3_CATALOG') {
  await productsV3.deleteProduct(id);
} else {
  await products.deleteProduct(id);
}
```

### Inventory: increment / decrement stock

```typescript
import { inventory, inventoryItemsV3 } from '@wix/stores';

if (catalogVersion === 'V3_CATALOG') {
  // V3 is per-variant; pass inventory item IDs. Shape is flat.
  await inventoryItemsV3.bulkIncrementInventoryItems([
    { inventoryItemId, incrementBy: 5 },
  ]);
} else {
  // V1 is per-product (variant optional).
  await inventory.incrementInventory([
    { productId, variantId, incrementBy: 5 },
  ]);
}
```

To find the V3 inventory item ID for a product/variant, use `inventoryItemsV3.searchInventoryItems` and filter by `productId` and/or `variantId`.

### Query inventory

```typescript
if (catalogVersion === 'V3_CATALOG') {
  // V3 uses a fluent query builder.
  const res = await inventoryItemsV3
    .queryInventoryItems()
    .eq('productId', productId)
    .find();
  return res.items;
}

// V1 takes a Query object; `filter` is a JSON-stringified expression.
const res = await inventory.queryInventory({
  query: { filter: JSON.stringify({ productId }) },
});
return res.inventoryItems;
```

### Collections (V1) ↔ Categories (V3)

```typescript
// Note: in V1, write ops for collections live on the `products` namespace, not `collections`.
// The `collections` namespace only exposes read methods (getCollection, queryCollections, ...).
import { products } from '@wix/stores';
import { categories } from '@wix/categories';

if (catalogVersion === 'V3_CATALOG') {
  // V3 returns the category directly.
  const category = await categories.createCategory({
    name: 'Sale',
    treeReference: { appNamespace: 'STORES_NAMESPACE', treeKey: 'allProducts' },
  });
  return category;
}

// V1 returns { collection }.
const { collection } = await products.createCollection({ name: 'Sale' });
return collection;
```

> V3 categories live in `@wix/categories` (separate package). They are tree-structured (parent / child) — V1 collections are flat.
> Reference V3 categories on a product via `directCategories[]`, not `collectionIds[]`.
> **V1 gotcha:** `createCollection`, `updateCollection`, `deleteCollection`, `addProductsToCollection`, `removeProductsFromCollection` all live on the `products` namespace. The `collections` namespace is read-only.

---

## V1 → V3 Field Mapping (most common)

Use this when reading or migrating V1 data structures to V3 shape. Full reference: [Catalog V1 to V3 Migration Guide](https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/catalog-v1-to-v3-migration-guide?apiView=SDK).

### Product

| V1 | V3 |
|----|----|
| `priceData.price` (no discount) | `variantsInfo.variants[i].price.actualPrice.amount` |
| `priceData.price` (with discount) | `variantsInfo.variants[i].price.compareAtPrice.amount` |
| `priceData.discountedPrice` | `variantsInfo.variants[i].price.actualPrice.amount` |
| `priceData.currency` | `currency` (top-level, requested field) |
| `priceRange.minValue` / `maxValue` | `compareAtPriceRange.minValue.amount` / `maxValue.amount` |
| `sku` (single variant) | `variantsInfo.variants[0].sku` |
| `weight` | `variantsInfo.variants[i].physicalProperties.weight` |
| `stock.quantity`, `stock.trackInventory` | Inventory Items API (`inventoryItemsV3`) |
| `stock.inventoryStatus` | `inventory.availabilityStatus` |
| `productType: "physical"` | `productType: "PHYSICAL"` (upper-case) |
| `description` | `description` (Ricos) or `plainDescription` (string) |
| `additionalInfoSections[i]` | `infoSections[i]` (now requires `uniqueName`) |
| `customTextFields[i]` | `modifiers[i]` with `freeTextSettings` |
| `manageVariants: true` (options that create variants) | `options[i]` |
| `manageVariants: false` (options as customizations) | `modifiers[i]` |
| `productOptions[i].optionType: "drop_down"` | `options[i].optionRenderType: "TEXT_CHOICES"` |
| `productOptions[i].optionType: "color"` | `options[i].optionRenderType: "SWATCH_CHOICES"` |
| `collectionIds[i]` | `directCategories[i].id` |
| `discount.type` / `discount.value` | derived from `actualPrice` vs `compareAtPrice` |
| `ribbon` (string) | `ribbon.name` (managed via `ribbonsV3`) |
| `brand` (string) | `brand.name` (managed via `brandsV3`) |
| `lastUpdated` | `updatedDate` |
| `productPageUrl.base` / `path` | `url.url` / `url.relativePath` |

### Pricing model — the big one

V1 had a `discount` object. V3 removed it. Discounts are now expressed as the relationship between two fields on the variant:

- `actualPrice` (required) — what the customer pays
- `compareAtPrice` (optional) — original price, shown struck through

| V1 state | V3 conversion |
|----------|---------------|
| Has discount: V1 `price` = 100, `discountedPrice` = 80 | V3 `compareAtPrice` = 100, `actualPrice` = 80 |
| No discount: V1 `price` = 100 | V3 `actualPrice` = 100, leave `compareAtPrice` empty |

V3 also has read-only `actualPriceRange` / `compareAtPriceRange` at product level (min/max across variants).

### Inventory

| V1 (`inventory`) | V3 (`inventoryItemsV3`) |
|------------------|-------------------------|
| `variants[i].variantId` | `variantId` |
| `variants[i].inStock` | `trackingMethod.inStock` |
| `variants[i].quantity` | `trackingMethod.quantity` |
| `variants[i].availableForPreorder` | `availabilityStatus = 'PREORDER'` |
| `trackQuantity` (per product) | `trackQuantity` (per variant, **read-only**, derived from `inStock`/`quantity`) |
| `preorderInfo.*` (per product) | `preorderInfo.*` (per variant) |

### Media

| V1 | V3 |
|----|----|
| `media.mainMedia` | `media.main` |
| `media.items[i]` | `media.itemsInfo.items[i]` |
| `image.url` / `width` / `height` / `altText` | same fields under `image` |
| `video.files[i]` | `video.resolutions[i]` |

---

## Webhooks (Backend Events)

**Subscribe to BOTH V1 and V3 webhooks** so your app handles every site. Source: migration guide.

| V1 event | V3 event |
|----------|----------|
| `products.onProductCreated` (V1 `Product Created`) | `productsV3.onProductCreated` |
| `products.onProductChanged` | `productsV3.onProductUpdated` |
| `products.onProductDeleted` | `productsV3.onProductDeleted` |
| `products.onVariantsChanged` | `productsV3.onProductUpdated` (with `variantsInfo` in `modifiedFields`) |
| `collections.onCollectionCreated` | `categories.onCategoryCreated` |
| `collections.onCollectionChanged` | `categories.onCategoryUpdated` |
| `collections.onCollectionDeleted` | `categories.onCategoryDeleted` |

Payload shape changed in V3:
- Product/category ID is at top-level `entityId` AND inside the entity itself.
- V1 `changedFields` → V3 `modifiedFields`.
- V1 created-event entity → V3 `createdEvent.entityAsJson`.

For order webhooks (unchanged across V1/V3) use `@wix/ecom` → `orders`.

---

## Major V3 Behavior Changes (gotchas)

1. **Every product has at least one variant.** `manageVariants` is gone. Single-variant products still expose price/sku via `variantsInfo.variants[0]`.
2. **`revision` required on update.** V3 update endpoints use optimistic concurrency — fetch current `revision`, pass it back. Each update increments it by 1.
3. **Array fields overwrite, don't merge.** When updating `options`, `modifiers`, or `variantsInfo.variants`, send the entire existing array.
4. **`options` and `variantsInfo.variants` are coupled.** Update one, update the other.
5. **`queryProducts` (V3) does not return variants.** Use `getProduct` or the Read-Only Variants API.
6. **Hidden products require `SCOPE.STORES.PRODUCT_READ_ADMIN`** for V3 reads. The basic read scope only sees `visible: true` products.
7. **Currency / merchant data are requested fields** in V3 — pass them in the `fields` array (e.g. `'CURRENCY'`, `'MERCHANT_DATA'`, `'URL'`, `'INFO_SECTION'`).
8. **Prices are strings in V3, numbers in V1.** Always serialize/parse.
9. **Enums are UPPER_CASE in V3, lower-case in V1** (e.g. `PHYSICAL` vs `physical`).
10. **Categories require a `treeReference`** (`appNamespace` + `treeKey`) — V1 collections did not.
11. **V3 cursor paging has NO total count.** `pagingMetadata.cursors.next` + `hasNext` is all you get. Don't build "page X of Y" UI for V3 — use Next/Previous.
12. **V3 has no `skip` / offset.** The fluent builder pattern `.skip().limit().find()` is V1-only. V3 uses the direct call `productsV3.queryProducts({ cursorPaging: { limit, cursor } })`.
13. **V3 product sort fields fail at runtime even when TypeScript accepts them.** TS allows `'_createdDate' | '_updatedDate' | 'slug' | 'visible'`, but real V3 sites return `Field '_createdDate' is not declared as sortable`. **Omit `sort` on V3 product queries** unless you have verified the field works on a live V3 site.
14. **Stock status is UPPER_SNAKE_CASE on both versions** — `IN_STOCK`, `OUT_OF_STOCK`, `PARTIALLY_OUT_OF_STOCK`, V3 also `PREORDER`. Never compare against lowercase strings; TS will reject and runtime will mismatch.

---

## Recommended Code Layout for Stores Apps

Centralize the version branch in one helper module so the rest of the app stays version-agnostic:

```typescript
// backend/stores-api.ts
import { catalogVersioning, products, productsV3 } from '@wix/stores';

export type CatalogVersion = 'V1_CATALOG' | 'V3_CATALOG' | 'STORES_NOT_INSTALLED';

let cached: CatalogVersion | undefined;

export async function getVersion(): Promise<CatalogVersion> {
  if (cached) return cached;
  const { catalogVersion } = await catalogVersioning.getCatalogVersion();
  cached = catalogVersion as CatalogVersion;
  return cached;
}

export async function listProducts(limit = 20) {
  const v = await getVersion();
  if (v === 'STORES_NOT_INSTALLED') return [];
  if (v === 'V3_CATALOG') {
    const r = await productsV3.queryProducts().limit(limit).find();
    return r.items;
  }
  const r = await products.queryProducts().limit(limit).find();
  return r.items;
}
```

This keeps every dashboard page / backend endpoint free of version branching.

---

## When to Use MCP Search vs This Reference

This file covers the common 80%. For the long tail, fall back to MCP:

| Need | Use |
|------|-----|
| One of the recipes above | This file — copy-paste, no search needed |
| A method not listed here (subscriptions, brands, ribbons, etc.) | `SearchWixSDKDocumentation` |
| Full request schema (every field) | `ReadFullDocsArticle` |
| Exact permission scope ID | `SearchWixSDKDocumentation` then read `Permissions Scopes IDs` block |

After looking up a method, **return the required permissions to the user** — they need them for app installation.

---

## App Market Compatibility Reminder

To list in the App Market or remain installable on new sites, your app **must declare compatibility with both Catalog V1 and V3** in the app's dashboard. Code that only handles one version will fail on the other and block app installation.
