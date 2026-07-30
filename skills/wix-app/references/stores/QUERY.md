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

// Version detection is mandatory before any Stores call, and the version is
// permanent per site — see STORES_VERSIONING.md § "Mandatory: Detect Version First".
// Repeated here so every example below is complete and type-checks as written.
export type CatalogVersion = 'V1_CATALOG' | 'V3_CATALOG' | 'STORES_NOT_INSTALLED';

let cachedVersion: CatalogVersion | undefined;

export async function getVersion(): Promise<CatalogVersion> {
  if (cachedVersion) return cachedVersion;
  const { catalogVersion } = await catalogVersioning.getCatalogVersion();
  cachedVersion = catalogVersion as CatalogVersion;
  return cachedVersion;
}

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

```typescript
// ❌ TS2345: '"name"' is not assignable to '"_id" | "slug" | "options.id" | "handle"'
productsV3.queryProducts().startsWith('name', searchTerm);
// ❌ TS2339: Property 'contains' does not exist on type 'ProductsQueryBuilder'
productsV3.queryProducts().contains('name', searchTerm);
```

For free-text lookup by product name (or brand, SKU, description) call
**`productsV3.searchProducts()`**. It is a **direct call, not a fluent builder**
(imports and `getVersion` come from the first example in this file):

```typescript
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

### V1: no `searchProducts` — prefix match on the builder instead

**V1 has no search method at all.** The `products` namespace exposes only `queryProducts`;
there is no `products.searchProducts`. Instead, V1's builder *does* accept `name`, which is
exactly what V3's builder rejects:

```typescript
// ✅ V1 — allowed. startsWith accepts '_id' | 'name' | 'slug' | 'description' | 'sku'
export async function v1SearchByName(term: string, limit: number) {
  const res = await products.queryProducts().startsWith('name', term).limit(limit).find();
  return res.items;
}

// ❌ V1 — TS2339: Property 'contains' does not exist on type 'ProductsQueryBuilder'
products.queryProducts().contains('name', searchTerm);
```

⚠️ **The two versions are not equivalent in behaviour, only in intent.** V1 gives you a
**prefix match** (`startsWith`) — "sho" finds "Shoes" but *not* "Running Shoes". V3
`searchProducts` is real full-text with optional `fuzzy`, matching anywhere in the field and
tolerating typos. A single search box will behave noticeably differently across catalog
versions; if that matters to the user, say so rather than implying parity.

| | V1 (`products`) | V3 (`productsV3`) |
|---|---|---|
| Search method | none — use the builder | `searchProducts()` |
| Name matching | `startsWith` — prefix only | `search.expression` — full-text, anywhere |
| Fuzzy / typo tolerance | ✗ | ✓ via `fuzzy: true` |
| Other searchable fields | `_id`, `slug`, `description`, `sku` | `name`, `description`, `variantsInfo.variants.sku`, `minVariantPriceInfo.sku`, `directCategoryIdsInfo.categoryIds`, `physicalProperties.*` |
| `contains` | ✗ not on the builder | ✗ use `search.expression` |

So the two versions need genuinely different code paths here, not just a renamed module:

```typescript
export async function searchByName(term: string, limit: number, v: CatalogVersion) {
  if (v === 'V3_CATALOG') {
    const res = await productsV3.searchProducts({
      cursorPaging: { limit },
      search: { expression: term, fields: ['name'], fuzzy: true },
    });
    return res.products ?? [];          // full-text match
  }
  const res = await products.queryProducts()
    .startsWith('name', term)           // prefix match only
    .limit(limit)
    .find();
  return res.items;
}
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
