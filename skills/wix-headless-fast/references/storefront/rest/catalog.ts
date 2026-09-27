// Catalog reads over REST — the twin of app/wix/storefront/catalog.ts. Same exports, same DTOs; the
// rules and mappers come from catalog-core (the SAME file the SDK transport uses, deployed flat next
// to this one by deploy.mjs --stack static), so this file is only the transport: one fetch with a
// literal body per function. Every call here is safe from a
// browser with a visitor token. Porting: keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/get-category-by-slug.md
import { WixApiError, wixRequest } from "./client.js";
import { imgSrc, mediaKey } from "./media.js";
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
} from "./catalog-core.js";
import type { Category, FacetData, ProductDetail, ProductSummary } from "./types.js";

export { CATALOG_SORTS, resolveVariant, sellingPrice, type CatalogSearchOptions, type CatalogSort };

const STORES_TREE = { appNamespace: "@wix/stores", treeKey: null };
const notFound = (e: unknown): boolean => e instanceof WixApiError && e.status === 404;

/**
 * The gallery query: sort, filter, facets, search, and cursor paging, all applied by Wix across the
 * whole catalog — never on a page already in hand. `total` is issued with the first page only.
 * POST /stores/v3/products/search  { fields, search: { filter, sort, search, cursorPaging } }
 */
export async function searchCatalog(o: CatalogSearchOptions = {}): Promise<{ products: ProductSummary[]; nextCursor: string | null; total: number | null }> {
  const search = searchQuery(o);
  const res = await wixRequest<Raw>("/stores/v3/products/search", { body: { fields: LIST_FIELDS, search } });
  let total: number | null = null;
  if (!o.cursor) {
    try {
      const c = await wixRequest<Raw>("/stores/v3/products/count", { body: { filter: search.filter } });
      total = typeof c?.count === "number" ? c.count : null;
    } catch {
      /* the count is a nicety — the page is still valid */
    }
  }
  return {
    products: ((res?.products ?? []) as Raw[]).map((p) => toSummary(p, imgSrc, mediaKey)),
    nextCursor: res?.pagingMetadata?.cursors?.next ?? null,
    total,
  };
}

/** Facets and price bounds of a scope from one 100-product read. Non-fatal: empty on failure. */
export async function fetchFacetData({ categoryId }: { categoryId?: string | null } = {}): Promise<FacetData> {
  try {
    const res = await wixRequest<Raw>("/stores/v3/products/search", {
      body: { fields: ["CURRENCY"], search: { filter: catalogFilter({ categoryId }), cursorPaging: { limit: 100 } } },
    });
    return toFacetData((res?.products ?? []) as Raw[]);
  } catch {
    return { facets: [], priceRange: null };
  }
}

export async function fetchProducts({ limit = 24 } = {}): Promise<ProductSummary[]> {
  return (await searchCatalog({ limit })).products;
}

export async function fetchProductsByCategory(categoryId: string, { limit = 24 } = {}): Promise<ProductSummary[]> {
  return (await searchCatalog({ limit, categoryId })).products;
}

/**
 * One complete product for the PDP; null when the slug doesn't resolve — a real 404, never a
 * fallback to another product.  GET /stores/v3/products/slug/{slug}?fields=…&fields=…
 */
export async function fetchProductBySlug(slug: string): Promise<ProductDetail | null> {
  try {
    const res = await wixRequest<Raw>(`/stores/v3/products/slug/${encodeURIComponent(slug)}`, { method: "GET", query: { fields: DETAIL_FIELDS } });
    return res?.product ? toDetail(res.product, imgSrc, mediaKey) : null;
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

/**
 * The live category tree for navigation — never a seeded list. The filter must be non-empty;
 * `visible` is not filterable (dropped client-side); the auto-created "all-products" system
 * category is skipped. Non-fatal: [] on failure.  POST /categories/v1/categories/query
 */
export async function fetchCategories(): Promise<Category[]> {
  try {
    const res = await wixRequest<Raw>("/categories/v1/categories/query", {
      body: { treeReference: STORES_TREE, query: { filter: { name: { $exists: true } }, cursorPaging: { limit: 100 } } },
    });
    return ((res?.categories ?? []) as Raw[]).filter((c) => c.visible !== false && c.slug !== "all-products").map(toCategory);
  } catch {
    return [];
  }
}

/**
 * One category by URL slug (its id feeds searchCatalog). The response is WRAPPED: { category }.
 * null when missing or hidden → a real 404.  GET /categories/v1/categories/slug/{slug}
 */
export async function fetchCategoryBySlug(slug: string): Promise<Category | null> {
  try {
    const res = await wixRequest<Raw>(`/categories/v1/categories/slug/${encodeURIComponent(slug)}`, {
      method: "GET",
      query: { "treeReference.appNamespace": "@wix/stores" },
    });
    const raw: Raw | undefined = res?.category;
    return raw && raw.visible !== false ? toCategory(raw) : null;
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}
