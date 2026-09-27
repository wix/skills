// Catalog reads (Wix Stores Catalog V3) over the SDK — the only file that touches raw catalog
// entities on this transport. Everything it returns is a plain DTO from ./types. The rules and
// mappers live in ./catalog-core (shared with the REST twin in references/storefront/rest/); this
// file is the transport only. Copy as-is; extend by adding functions, not by editing these.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product-by-slug.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/query-categories.md
import { productsV3 } from "@wix/stores";
import { categories as categoriesModule } from "@wix/categories";
import { wixModule } from "../sdk";
import { imgSrc, mediaKey } from "../media";
import {
  CATALOG_SORTS,
  DETAIL_FIELDS,
  LIST_FIELDS,
  catalogFilter,
  resolveVariant,
  searchQuery,
  sellingPrice,
  toCategory,
  toDetail,
  toFacetData,
  toSummary,
  type CatalogSearchOptions,
  type CatalogSort,
  type Raw,
} from "./catalog-core";
import type { Category, Facet, FacetData, ProductDetail, ProductSummary } from "./types";

export { CATALOG_SORTS, resolveVariant, sellingPrice, type CatalogSearchOptions, type CatalogSort };

const products = wixModule(productsV3);
const categories = wixModule(categoriesModule);

/**
 * Search visible catalog products — sorted, filtered, faceted, and searched by Wix across the
 * whole catalog, then cursor-paged. `nextCursor` continues the same query; start over (no cursor)
 * whenever any selection changes. `total` (the "N products" line) is issued with the first page.
 */
export async function searchCatalog(o: CatalogSearchOptions = {}): Promise<{ products: ProductSummary[]; nextCursor: string | null; total: number | null }> {
  const query = searchQuery(o);
  const res: Raw = await products.searchProducts(query, { fields: LIST_FIELDS as any });
  let total: number | null = null;
  if (!o.cursor && query.filter) {
    try {
      const count: Raw = await products.countProducts({ filter: query.filter });
      total = typeof count?.count === "number" ? count.count : null;
    } catch {
      /* the count is a nicety — the page is still valid */
    }
  }
  return {
    products: ((res.products ?? []) as Raw[]).map((p) => toSummary(p, imgSrc, mediaKey)),
    nextCursor: res.pagingMetadata?.cursors?.next ?? null,
    total,
  };
}

/** The filterable options of the catalog (or one category). Non-fatal: [] when the read fails. */
export async function fetchFacets(scope: { categoryId?: string | null } = {}): Promise<Facet[]> {
  return (await fetchFacetData(scope)).facets;
}

/**
 * Facets plus the scope's price bounds (lowest minimum, highest maximum across its products) — the
 * filter panel's slider needs both, from one 100-product read. Non-fatal: empty on failure.
 */
export async function fetchFacetData({ categoryId }: { categoryId?: string | null } = {}): Promise<FacetData> {
  try {
    const res: Raw = await products.searchProducts(
      { filter: catalogFilter({ categoryId }), cursorPaging: { limit: 100 } },
      { fields: ["CURRENCY"] as any },
    );
    return toFacetData((res.products ?? []) as Raw[]);
  } catch {
    return { facets: [], priceRange: null };
  }
}

/** First page of visible products in the default order — a thin wrap of searchCatalog. */
export async function fetchProducts({ limit = 24 } = {}): Promise<ProductSummary[]> {
  return (await searchCatalog({ limit })).products;
}

/** First page of a category — same wrap; category filtering only works through search. */
export async function fetchProductsByCategory(categoryId: string, { limit = 24 } = {}): Promise<ProductSummary[]> {
  return (await searchCatalog({ limit, categoryId })).products;
}

/** Fetch one product by its URL slug, with options/modifiers/variants. Null when not found. */
export async function fetchProductBySlug(slug: string): Promise<ProductDetail | null> {
  try {
    const res = await products.getProductBySlug(slug, { fields: DETAIL_FIELDS as any });
    return res.product ? toDetail(res.product as Raw, imgSrc, mediaKey) : null;
  } catch {
    return null;
  }
}

/**
 * List the store's categories for nav/filter UI, minus Wix's auto-created "all-products"
 * system category. The query must carry a filter condition (`.exists("name", true)` — a
 * tautology): a bare .find() serializes an empty filter that the API rejects on the
 * visitor-client path. Treat a failure as "no category nav", not a fatal error.
 */
export async function fetchCategories(): Promise<Category[]> {
  try {
    const res = await categories
      .queryCategories({ treeReference: { appNamespace: "@wix/stores" } })
      .exists("name", true)
      .find();
    return (res.items ?? []).map((c) => toCategory(c as Raw)).filter((c) => c.slug !== "all-products");
  } catch {
    return [];
  }
}

/**
 * One category by its URL slug — the data a /category/[slug] page needs (its id feeds
 * searchCatalog / useShop, its name and description head the page). The response is WRAPPED:
 * { category }. Null when not found or hidden, which the page turns into a real 404 — never a
 * fallback to all products.
 */
export async function fetchCategoryBySlug(slug: string): Promise<Category | null> {
  try {
    const res: Raw = await categories.getCategoryBySlug(slug, { appNamespace: "@wix/stores" } as any);
    const raw: Raw | undefined = res?.category;
    if (!raw || raw.visible === false) return null;
    return toCategory(raw);
  } catch {
    return null;
  }
}
