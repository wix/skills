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
