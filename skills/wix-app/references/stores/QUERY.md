# Stores — Query / List Products

## List products with pagination

Both versions expose a fluent query builder, but the paging method differs:

| Aspect | V1 (`products.queryProducts()`) | V3 (`productsV3.queryProducts()`) |
|--------|--------------------------------|----------------------------------|
| API style | Fluent builder: `.skip().limit().find()` | Fluent builder: `.skipTo(cursor).limit().find()` |
| Pagination | Offset (`.skip(n)`) | Cursor (`.skipTo(cursor)`) |
| Result `items` | `res.items` (V1 `Product[]`) | `res.items` (V3 `Product[]`) |
| Total count | `res.totalCount` | **None** — V3 only has `cursors.next` + `hasNext()` |
| `hasNext` | `res.hasNext()` (method) | `res.hasNext()` (method) |
| Next cursor | n/a | `res.cursors.next` (string) |

```typescript
import { catalogVersioning, products, productsV3 } from '@wix/stores';

export interface ProductsPage {
  products: unknown[];        // narrow at call site
  nextCursor: string | null;  // V3 only
  hasNext: boolean;
  totalCount: number | null;  // V1 only
}

export async function listProductsPage(
  limit: number,
  cursorOrSkip: string | number | undefined,
): Promise<ProductsPage> {
  const v = await getVersion();
  if (v === 'STORES_NOT_INSTALLED') {
    return { products: [], nextCursor: null, hasNext: false, totalCount: 0 };
  }

  if (v === 'V3_CATALOG') {
    let builder = productsV3.queryProducts().limit(limit);
    if (typeof cursorOrSkip === 'string') builder = builder.skipTo(cursorOrSkip);
    // Do NOT chain a sort — see OVERVIEW.md gotcha #10.
    const res = await builder.find();
    return {
      products: res.items,
      nextCursor: res.cursors.next ?? null,
      hasNext: res.hasNext(),
      totalCount: null,
    };
  }

  const skip = typeof cursorOrSkip === 'number' ? cursorOrSkip : 0;
  const res = await products.queryProducts().skip(skip).limit(limit).find();
  return {
    products: res.items,
    nextCursor: null,
    hasNext: res.hasNext(),
    totalCount: res.totalCount ?? null,
  };
}
```

> **Two ways to call V3 `queryProducts`:** the canonical builder shown above, and a direct-call form `productsV3.queryProducts({ cursorPaging: { limit, cursor } })` returning a `Promise<{ products, pagingMetadata }>`. Both compile and run, but the builder is more idiomatic and matches V1's shape.

---

## Search products by name — use `searchProducts`, NOT `queryProducts`

**V3 `queryProducts` can only filter on `_id`, `slug`, `options.id`, and `handle`.** Any other
field is a compile error on the builder methods:

```ts
// ❌ error TS2345: Argument of type '"name"' is not assignable to parameter of
//    type '"_id" | "slug" | "options.id" | "handle"'
productsV3.queryProducts().startsWith('name', term);

// ❌ error TS2339: Property 'contains' does not exist on type 'ProductsQueryBuilder'
productsV3.queryProducts().contains('name', term);
```

For free-text lookup by product name (or brand, SKU, description) call
**`productsV3.searchProducts()`**. It is a **direct call, not a fluent builder**:

```typescript
import { productsV3 } from '@wix/stores';

export async function searchProductsByName(term: string, limit = 20, cursor?: string) {
  const res = await productsV3.searchProducts({
    cursorPaging: { limit, ...(cursor ? { cursor } : {}) },
    // `fields` is required for free-text search — searchable: 'name', 'description',
    // 'variantsInfo.variants.sku', 'minVariantPriceInfo.sku',
    // 'directCategoryIdsInfo.categoryIds', 'physicalProperties.*'
    search: { expression: term, fields: ['name'], fuzzy: true },
  });

  return {
    products: res.products ?? [],                  // ⚠️ `products`, NOT `items`
    nextCursor: res.pagingMetadata?.cursors?.next ?? null,
    hasNext: res.pagingMetadata?.hasNext ?? false,  // ⚠️ property, NOT a `hasNext()` call
  };
}
```

**Shape differences from the `queryProducts` builder — these are the ones that bite:**

| | `queryProducts()` builder | `searchProducts()` |
|---|---|---|
| Call style | fluent, ends in `.find()` | single call, returns the response |
| Result array | `res.items` | `res.products` |
| `hasNext` | `res.hasNext()` — **method** | `res.pagingMetadata?.hasNext` — **property** |
| Next cursor | `res.cursors.next` | `res.pagingMetadata?.cursors?.next` |
| Paging in | `.limit()` / `.skipTo()` | `cursorPaging: { limit, cursor }` |

**V1 equivalent:** V1 has no separate search method — use the builder's
`products.queryProducts().startsWith('name', term)`, which V1 *does* allow. So the two
catalog versions need genuinely different code paths here, not just a renamed module:

```typescript
if (v === 'V3_CATALOG') {
  const res = await productsV3.searchProducts({
    cursorPaging: { limit },
    search: { expression: term, fields: ['name'] },
  });
  return res.products ?? [];
}
const res = await products.queryProducts().startsWith('name', term).limit(limit).find();
return res.items;
```

> **If a name/brand search cannot be expressed, do not silently drop the feature.** Removing
> the user's search box to make `tsc` pass is a functional regression, not a fix — switch to
> `searchProducts`.

---

## Display price/stock without fetching variants

V3 `queryProducts` does not return variants. Read product-level rollup fields instead:

```typescript
function displayPrice(p: { actualPriceRange?: { minValue?: { amount?: string }; maxValue?: { amount?: string } } }): string {
  const min = p.actualPriceRange?.minValue?.amount;
  const max = p.actualPriceRange?.maxValue?.amount;
  if (!min) return '—';
  return max && max !== min ? `${min} – ${max}` : min;
}

function stockLabel(status: string | undefined): string {
  switch (status) {
    case 'IN_STOCK': return 'In Stock';
    case 'OUT_OF_STOCK': return 'Out of Stock';
    case 'PARTIALLY_OUT_OF_STOCK': return 'Limited';
    case 'PREORDER': return 'Pre-order';
    default: return '—';
  }
}
// V1 path: product.stock.inventoryStatus  (same UPPER_SNAKE_CASE values)
// V3 path: product.inventory.availabilityStatus (adds PREORDER)
// SKU lives on the variant — show "—" in lists, or use Read-Only Variants API.
```
