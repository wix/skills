// Catalog reads over REST — the twin of app/wix/storefront/catalog.ts. Same exports, same DTOs; the
// rules and mappers come from catalog-core (the SAME file the SDK transport uses, deployed flat next
// to this one by deploy.mjs --stack static), so this file is only the transport: one fetch with a
// literal body per function. Every call here is safe from a browser with a visitor token.
// Porting: keep the paths, keep the bodies, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/get-category-by-slug.md
import { WixApiError, wixRequest } from "./client.js";
import { imgSrc, mediaKey } from "./media.js";
import {
  CATALOG_SORTS,
  DETAIL_FIELDS,
  LIST_FIELDS,
  STORES_TREE,
  choiceAvailability,
  facetCustomizationIds,
  facetSearchBody,
  pageInfo,
  readFacetAggregates,
  resolveVariant,
  searchQuery,
  sellingPrice,
  toCategory,
  toDetail,
  toFacetData,
  toInventory,
  toSummary,
  type CatalogSearchOptions,
  type CatalogSort,
  type FacetSelection,
  type Raw,
} from "./catalog-core.js";
import { WIX_STORES_APP_ID } from "./cart-core.js";
import type { Category, Facet, FacetData, ProductDetail, ProductSummary, VariantInventory } from "./types.js";

export { CATALOG_SORTS, choiceAvailability, resolveVariant, sellingPrice, type CatalogSearchOptions, type CatalogSort, type FacetSelection };

const notFound = (e: unknown): boolean => e instanceof WixApiError && e.status === 404;

/**
 * The gallery query: sort, filter, facets, search, and cursor paging, all applied by Wix across the
 * whole catalog — never on a page already in hand. `total` is issued alongside the first page only;
 * `hasMore` is the API's own `hasNext`.
 * POST /stores/v3/products/search  { fields, search: { filter, sort, search, cursorPaging } }
 * POST /stores/v3/products/count   { filter }
 */
export async function searchCatalog(o: CatalogSearchOptions = {}): Promise<{ products: ProductSummary[]; nextCursor: string | null; hasMore: boolean; total: number | null }> {
  const search = searchQuery(o);
  const [res, count] = await Promise.all([
    wixRequest<Raw>("/stores/v3/products/search", { body: { fields: LIST_FIELDS, search } }),
    // the count is a nicety — the page is still valid without it
    !o.cursor ? wixRequest<Raw>("/stores/v3/products/count", { body: { filter: search.filter } }).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    products: ((res?.products ?? []) as Raw[]).map((p) => toSummary(p, imgSrc, mediaKey)),
    ...pageInfo(res),
    total: typeof count?.count === "number" ? count.count : null,
  };
}

export async function fetchFacets(scope: { categoryId?: string | null } = {}): Promise<Facet[]> {
  return (await fetchFacetData(scope)).facets;
}

/**
 * Facets and price bounds of a scope: ONE aggregations-only search (cursorPaging.limit 0 — no
 * products, whatever the catalog size), then the named customizations for names, colors, order.
 * Non-fatal: empty on failure.
 * POST /stores/v3/products/search        { search: { filter, cursorPaging: { limit: 0 }, aggregations } }
 * POST /stores/v3/customizations/query   { query: { filter: { id: { $in }, customizationRenderType: { $ne: "FREE_TEXT" } }, cursorPaging: { limit: 100 } } }
 */
export async function fetchFacetData({ categoryId }: { categoryId?: string | null } = {}): Promise<FacetData> {
  try {
    const res = await wixRequest<Raw>("/stores/v3/products/search", { body: { search: facetSearchBody(categoryId) } });
    const agg = readFacetAggregates(res);
    return toFacetData(agg, await fetchCustomizations(facetCustomizationIds(agg)));
  } catch {
    return { facets: [], priceRange: null };
  }
}

async function fetchCustomizations(ids: string[]): Promise<Raw[]> {
  if (!ids.length) return [];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  const pages = await Promise.all(
    batches.map((batch) =>
      wixRequest<Raw>("/stores/v3/customizations/query", {
        body: { query: { filter: { id: { $in: batch }, customizationRenderType: { $ne: "FREE_TEXT" } }, cursorPaging: { limit: 100 } } },
      }),
    ),
  );
  return pages.flatMap((p) => (p?.customizations ?? []) as Raw[]);
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
    const res = await wixRequest<Raw>(`/stores/v3/products/slug/${encodeURIComponent(decodeSlug(slug))}`, { method: "GET", query: { fields: DETAIL_FIELDS } });
    return res?.product ? toDetail(res.product, imgSrc, mediaKey) : null;
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

/**
 * The id of Wix's auto-created "All Products" system category — excluded from navigation by id.
 * null when the read fails (the slug heuristic then stands in).  GET /stores/v3/all-products-category
 */
export async function fetchAllProductsCategoryId(): Promise<string | null> {
  try {
    const res = await wixRequest<Raw>("/stores/v3/all-products-category", { method: "GET" });
    return res?.categoryId ?? null;
  } catch {
    return null;
  }
}

/**
 * The live VISIBLE category tree for navigation — never a seeded list; every page of it; the
 * "All Products" system category dropped by id. The API returns only visible categories unless
 * asked otherwise; the `visible` filter also keeps the query non-empty (an empty filter is
 * rejected on the visitor path). Non-fatal: [] on failure.
 * POST /categories/v1/categories/query  { treeReference, fields, query: { filter: { visible: true }, cursorPaging: { limit, cursor } } }
 */
export async function fetchCategories(): Promise<Category[]> {
  try {
    const [allProductsId, items] = await Promise.all([fetchAllProductsCategoryId(), readCategoryPages()]);
    return items
      .filter((c) => c.visible !== false)
      .map((c) => toCategory(c, imgSrc))
      .filter((c) => (allProductsId ? c.id !== allProductsId : c.slug !== "all-products"));
  } catch {
    return [];
  }
}

async function readCategoryPages(): Promise<Raw[]> {
  const out: Raw[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const res: Raw = await wixRequest<Raw>("/categories/v1/categories/query", {
      body: {
        treeReference: STORES_TREE,
        fields: ["DESCRIPTION"],
        query: cursor ? { cursorPaging: { limit: 100, cursor } } : { filter: { visible: true }, cursorPaging: { limit: 100 } },
      },
    });
    out.push(...((res?.categories ?? []) as Raw[]));
    cursor = res?.pagingMetadata?.hasNext ? res?.pagingMetadata?.cursors?.next ?? null : null;
    if (!cursor) break;
  }
  return out;
}

/**
 * One category by URL slug (its id feeds searchCatalog; name, description, image, breadcrumbs head
 * the page). The response is WRAPPED: { category }. null when missing or hidden → a real 404.
 * GET /categories/v1/categories/slug/{slug}?treeReference.appNamespace=@wix/stores&fields=BREADCRUMBS_INFO&fields=DESCRIPTION
 */
export async function fetchCategoryBySlug(slug: string): Promise<Category | null> {
  try {
    const res = await wixRequest<Raw>(`/categories/v1/categories/slug/${encodeURIComponent(decodeSlug(slug))}`, {
      method: "GET",
      query: { "treeReference.appNamespace": "@wix/stores", fields: ["BREADCRUMBS_INFO", "DESCRIPTION"] },
    });
    const raw: Raw | undefined = res?.category;
    return raw && raw.visible !== false ? toCategory(raw, imgSrc) : null;
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

// The default Stores location — inventory is per location. Read once per session.
// POST /stores/v3/locations/query  { query: { filter: { defaultLocation: true } } }
let defaultLocation: Promise<string | null> | null = null;
export function fetchDefaultLocationId(): Promise<string | null> {
  defaultLocation ??= wixRequest<Raw>("/stores/v3/locations/query", { body: { query: { filter: { defaultLocation: true } } } })
    .then((r) => ((r?.storesLocations ?? []) as Raw[])[0]?.id ?? null)
    .catch(() => null);
  return defaultLocation;
}

/**
 * Live inventory of a product's variants at the default location, keyed by variantId; {} on
 * failure. Merge with mergeInventory() from ./catalog-core.
 * POST /stores/v3/inventory-items/query  { query: { filter: { productId, locationId }, cursorPaging: { limit: 100 } } }
 */
export async function fetchInventory(productId: string): Promise<Record<string, VariantInventory>> {
  try {
    const locationId = await fetchDefaultLocationId();
    const items: Raw[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const res: Raw = await wixRequest<Raw>("/stores/v3/inventory-items/query", {
        body: { query: cursor ? { cursorPaging: { limit: 100, cursor } } : { filter: { productId, ...(locationId ? { locationId } : {}) }, cursorPaging: { limit: 100 } } },
      });
      items.push(...((res?.inventoryItems ?? []) as Raw[]));
      cursor = res?.pagingMetadata?.hasNext ? res?.pagingMetadata?.cursors?.next ?? null : null;
      if (!cursor) break;
    }
    return toInventory(items);
  } catch {
    return {};
  }
}

// Back in Stock (eCom). The public paths are the ones the generated SDK resolves for
// www.wixapis.com: its "/back-in-stock-service" prefix in front of the service paths, and
// GetSettings as a PUT with an empty body — kept exactly, not guessed.
const BACK_IN_STOCK = "/back-in-stock-service/v1/back-in-stock-notification-requests";

// Whether the merchant collects "notify me" requests for Stores items. Read once; false on failure.
// PUT /back-in-stock-service/v1/back-in-stock-notification-requests/settings  {}
let backInStockEnabled: Promise<boolean> | null = null;
export function fetchBackInStockEnabled(): Promise<boolean> {
  backInStockEnabled ??= wixRequest<Raw>(`${BACK_IN_STOCK}/settings`, { method: "PUT", body: {} })
    .then((r) => ((r?.settings?.collectionStates ?? []) as Raw[]).some((s) => s.appId === WIX_STORES_APP_ID && s.collectingRequests === true))
    .catch(() => false);
  return backInStockEnabled;
}

/**
 * Ask Wix to email the buyer when the variant is back in stock. `price` is the variant's plain
 * amount (a decimal string). "already-subscribed" when that email already asked for this item.
 * POST /back-in-stock-service/v1/back-in-stock-notification-requests  { request: { catalogReference, email }, itemDetails: { name, price, image } }
 */
export async function requestBackInStock(
  productId: string,
  variantId: string | null,
  email: string,
  item: { name: string; price: string; imageUrl?: string },
): Promise<"created" | "already-subscribed"> {
  try {
    await wixRequest<Raw>(BACK_IN_STOCK, {
      body: {
        request: { catalogReference: { catalogItemId: productId, appId: WIX_STORES_APP_ID, ...(variantId ? { options: { variantId } } : {}) }, email },
        itemDetails: { name: item.name, price: item.price, ...(item.imageUrl ? { image: item.imageUrl } : {}) },
      },
    });
    return "created";
  } catch (e) {
    if (e instanceof WixApiError && e.code === "BACK_IN_STOCK_NOTIFICATION_REQUEST_ALREADY_EXISTS") return "already-subscribed";
    throw e;
  }
}
