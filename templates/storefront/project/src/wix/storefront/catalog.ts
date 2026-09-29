// Catalog reads (Wix Stores Catalog V3, Categories, Inventory, Back in Stock) over the SDK — the
// only file that touches raw catalog entities on this transport. Everything it returns is a plain
// DTO from ./types. The rules and mappers live in ./catalog-core (shared with the REST twin in
// templates/storefront/rest/); this file is the transport only. Copy as-is; extend by adding
// functions, not by editing these.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/search-products.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/products-v3/get-product-by-slug.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/categories/query-categories.md
import { customizationsV3, inventoryItemsV3, productsV3, storesLocationsV3 } from "@wix/stores";
import { categories as categoriesModule } from "@wix/categories";
import { backInStockNotifications, backInStockSettings } from "@wix/ecom";
import { wixModule } from "../sdk";
import { imgSrc, mediaKey } from "../media";
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
} from "./catalog-core";
import { WIX_STORES_APP_ID, errorCode } from "./cart-core";
import type { Category, Facet, FacetData, ProductDetail, ProductSummary, VariantInventory } from "./types";

export { CATALOG_SORTS, choiceAvailability, resolveVariant, sellingPrice, type CatalogSearchOptions, type CatalogSort, type FacetSelection };

const products = wixModule(productsV3);
const customizations = wixModule(customizationsV3);
const inventory = wixModule(inventoryItemsV3);
const locations = wixModule(storesLocationsV3);
const categories = wixModule(categoriesModule);
const backInStock = wixModule(backInStockNotifications);
const backInStockConfig = wixModule(backInStockSettings);

/**
 * Search visible catalog products — sorted, filtered, faceted, and searched by Wix across the
 * whole catalog, then cursor-paged. `nextCursor` continues the same query; start over (no cursor)
 * whenever any selection changes. `total` (the "N products" line) is issued alongside the first
 * page; `hasMore` is the API's own `hasNext`.
 */
export async function searchCatalog(o: CatalogSearchOptions = {}): Promise<{ products: ProductSummary[]; nextCursor: string | null; hasMore: boolean; total: number | null }> {
  const query = searchQuery(o);
  const [res, count] = await Promise.all([
    products.searchProducts(query as any, { fields: LIST_FIELDS as any }) as Promise<Raw>,
    // the count is a nicety — the page is still valid without it
    !o.cursor && query.filter ? (products.countProducts({ filter: query.filter }) as Promise<Raw>).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    products: ((res.products ?? []) as Raw[]).map((p) => toSummary(p, imgSrc, mediaKey)),
    ...pageInfo(res),
    total: typeof count?.count === "number" ? count.count : null,
  };
}

/** The filterable options of the catalog (or one category). Non-fatal: [] when the read fails. */
export async function fetchFacets(scope: { categoryId?: string | null } = {}): Promise<Facet[]> {
  return (await fetchFacetData(scope)).facets;
}

/**
 * Facets plus the scope's price bounds — from ONE aggregations-only search (no products returned,
 * however large the catalog) and the customization entities the aggregation named, for names,
 * colors, and choice order. Non-fatal: empty on failure.
 */
export async function fetchFacetData({ categoryId }: { categoryId?: string | null } = {}): Promise<FacetData> {
  try {
    const res: Raw = await products.searchProducts(facetSearchBody(categoryId) as any, {});
    const agg = readFacetAggregates(res);
    return toFacetData(agg, await fetchCustomizations(facetCustomizationIds(agg)));
  } catch {
    return { facets: [], priceRange: null };
  }
}

// Customizations by id, 100 per query (the API's page size); free-text ones never filter.
async function fetchCustomizations(ids: string[]): Promise<Raw[]> {
  if (!ids.length) return [];
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
  const pages = await Promise.all(
    batches.map((batch) => customizations.queryCustomizations().in("_id", batch).ne("customizationRenderType", "FREE_TEXT").limit(100).find()),
  );
  return pages.flatMap((p) => p.items as Raw[]);
}

/** First page of visible products in the default order — a thin wrap of searchCatalog. */
export async function fetchProducts({ limit = 24 } = {}): Promise<ProductSummary[]> {
  return (await searchCatalog({ limit })).products;
}

/** First page of a category — same wrap; category filtering only works through search. */
export async function fetchProductsByCategory(categoryId: string, { limit = 24 } = {}): Promise<ProductSummary[]> {
  return (await searchCatalog({ limit, categoryId })).products;
}

/** Fetch one product by its URL slug, with options/modifiers/variants/plans/breadcrumbs. Null when not found. */
export async function fetchProductBySlug(slug: string): Promise<ProductDetail | null> {
  try {
    const res = await products.getProductBySlug(decodeSlug(slug), { fields: DETAIL_FIELDS as any });
    return res.product ? toDetail(res.product as Raw, imgSrc, mediaKey) : null;
  } catch {
    return null;
  }
}

// A slug arrives URL-encoded from some routers and plain from others; the API wants it plain.
function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

/**
 * The id of Wix's auto-created "All Products" system category — excluded from navigation by id,
 * not by guessing its slug. null when the read fails (the slug heuristic then stands in).
 */
export async function fetchAllProductsCategoryId(): Promise<string | null> {
  try {
    const res: Raw = await products.getAllProductsCategory();
    return res?.categoryId ?? null;
  } catch {
    return null;
  }
}

/**
 * The store's VISIBLE categories for nav/filter UI (`visible` filtered server-side — a hidden
 * category never leaks into the nav), every page of them, minus the "All Products" system
 * category. The query must carry a filter condition: a bare .find() serializes an empty filter
 * that the API rejects on the visitor-client path. Treat a failure as "no category nav", not a
 * fatal error.
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
  let page = await categories
    .queryCategories({ treeReference: STORES_TREE, fields: ["DESCRIPTION"] as any })
    .eq("visible", true)
    .limit(100)
    .find();
  const out: Raw[] = [...(page.items as Raw[])];
  for (let i = 0; i < 20 && page.hasNext(); i++) {
    page = await page.next();
    out.push(...(page.items as Raw[]));
  }
  return out;
}

/**
 * One category by its URL slug — the data a /category/[slug] page needs (its id feeds
 * searchCatalog / useShop, its name, description, image and breadcrumbs head the page). The
 * response is WRAPPED: { category }. Null when not found or hidden, which the page turns into a
 * real 404 — never a fallback to all products.
 */
export async function fetchCategoryBySlug(slug: string): Promise<Category | null> {
  try {
    const res: Raw = await categories.getCategoryBySlug(decodeSlug(slug), STORES_TREE, { fields: ["BREADCRUMBS_INFO", "DESCRIPTION"] as any });
    const raw: Raw | undefined = res?.category;
    if (!raw || raw.visible === false) return null;
    return toCategory(raw, imgSrc);
  } catch {
    return null;
  }
}

// The default Stores location — inventory is per location, and the product's own flags reflect
// this one. Read once per session.
let defaultLocation: Promise<string | null> | null = null;
export function fetchDefaultLocationId(): Promise<string | null> {
  defaultLocation ??= locations
    .queryStoresLocations()
    .eq("defaultLocation", true)
    .find()
    .then((r) => ((r.items?.[0] as Raw | undefined)?._id as string | undefined) ?? null)
    .catch(() => null);
  return defaultLocation;
}

/**
 * Live inventory of a product's variants at the default location: status (IN_STOCK, OUT_OF_STOCK,
 * PREORDER), the counted units, the pre-order allowance and message. Keyed by variantId; {} on
 * failure (the catalog's own flags stand in). Merge with mergeInventory() from ./catalog-core.
 */
export async function fetchInventory(productId: string): Promise<Record<string, VariantInventory>> {
  try {
    const locationId = await fetchDefaultLocationId();
    let q = inventory.queryInventoryItems().eq("productId", productId);
    if (locationId) q = q.eq("locationId", locationId);
    let page = await q.limit(100).find();
    const items: Raw[] = [...(page.items as Raw[])];
    for (let i = 0; i < 10 && page.hasNext(); i++) {
      page = await page.next();
      items.push(...(page.items as Raw[]));
    }
    return toInventory(items);
  } catch {
    return {};
  }
}

// Whether the merchant collects "notify me when back in stock" requests for Stores items. Read
// once per session; false on failure (the button simply doesn't show).
let backInStockEnabled: Promise<boolean> | null = null;
export function fetchBackInStockEnabled(): Promise<boolean> {
  backInStockEnabled ??= backInStockConfig
    .getSettings()
    .then((r) => ((r?.settings?.collectionStates ?? []) as Raw[]).some((s) => s.appId === WIX_STORES_APP_ID && s.collectingRequests === true))
    .catch(() => false);
  return backInStockEnabled;
}

/**
 * Ask Wix to email the buyer when the variant is back in stock. `price` is the variant's plain
 * amount (a decimal string, not a formatted one). "already-subscribed" when that email already
 * asked for this item.
 */
export async function requestBackInStock(
  productId: string,
  variantId: string | null,
  email: string,
  item: { name: string; price: string; imageUrl?: string },
): Promise<"created" | "already-subscribed"> {
  try {
    await backInStock.createBackInStockNotificationRequest(
      { catalogReference: { catalogItemId: productId, appId: WIX_STORES_APP_ID, ...(variantId ? { options: { variantId } } : {}) }, email },
      { name: item.name, price: item.price, ...(item.imageUrl ? { image: item.imageUrl } : {}) },
    );
    return "created";
  } catch (e) {
    if (errorCode(e) === "BACK_IN_STOCK_NOTIFICATION_REQUEST_ALREADY_EXISTS") return "already-subscribed";
    throw e;
  }
}
