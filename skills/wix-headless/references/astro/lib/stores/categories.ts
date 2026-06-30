/**
 * TTL-cached Wix Stores category helpers.
 *
 * Uses `@wix/auto_sdk_categories_categories` (already on disk via transitive deps)
 * — NOT `@wix/categories` (importing the published name triggers a fresh install).
 *
 * Module-level 5-min cache is opportunistic and safe under the Cloudflare-style
 * fetch adapter (each worker isolate is single-tenant). Errors are not cached.
 */

import * as categories from "@wix/auto_sdk_categories_categories";
import { productsV3 } from "@wix/stores";

// Wix Stores install/catalog app id — the same id Wix Stores writes to its
// products and the value used for cart ops + Phase 1 seed. NOT the back-in-stock
// id (1380b703-…).
export const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

const ALL_PRODUCTS_HANDLE = "online_stores_all_products";
const TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 24;

export interface StoreCategory {
  _id: string;
  name: string;
  slug: string;
  itemCount: number;
}

interface CacheEntry<T> {
  value: T;
  expires: number;
}

const categoriesCache = new Map<string, CacheEntry<any>>();

function readCache<T>(key: string): T | undefined {
  const hit = categoriesCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;
  if (hit) categoriesCache.delete(key);
  return undefined;
}

function writeCache<T>(key: string, value: T): T {
  categoriesCache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

function toStoreCategory(c: any): StoreCategory {
  return {
    _id: c._id ?? c.id ?? "",
    name: c.name ?? "",
    slug: c.slug ?? "",
    itemCount: c.itemCount ?? c.itemCounter ?? 0,
  };
}

/**
 * Visible, non-empty categories, excluding the auto-managed "All Products"
 * bucket. 5-min cache.
 */
export async function listStoreCategories(): Promise<StoreCategory[]> {
  const cached = readCache<StoreCategory[]>("list");
  if (cached) return cached;

  try {
    // queryCategories rejects empty filters — always chain at least one predicate.
    const result = await categories.queryCategories({ treeReference: { appNamespace: "@wix/stores" } } as any)
      .eq("visible", true)
      .find();
    const items = (result.items ?? [])
      .map(toStoreCategory)
      .filter(
        (c) =>
          c.slug !== ALL_PRODUCTS_HANDLE &&
          (c as any).handle !== ALL_PRODUCTS_HANDLE,
      )
      .filter((c) => c.itemCount > 0);
    return writeCache("list", items);
  } catch (err) {
    console.error("[categories] listStoreCategories failed:", err);
    return [];
  }
}

/** Single category by slug. 5-min cache. */
export async function getCategoryBySlug(
  slug: string,
): Promise<StoreCategory | null> {
  const key = `slug:${slug}`;
  const cached = readCache<StoreCategory | null>(key);
  if (cached !== undefined) return cached;

  try {
    const result: any = await (categories as any).getCategoryBySlug(slug, {
      treeReference: { appNamespace: "@wix/stores" },
    });
    const category = result?.category ?? result;
    if (!category?._id && !category?.id) return writeCache(key, null);
    return writeCache(key, toStoreCategory(category));
  } catch (err) {
    console.error(`[categories] getCategoryBySlug(${slug}) failed:`, err);
    return null;
  }
}

export interface CategoryProductsResult {
  items: any[];
  cursors: { next?: string | null; prev?: string | null };
}

/**
 * Two-call pipeline: list item IDs in the category, then fetch those products
 * with cursor paging. There is no single endpoint that does category filter +
 * cursor paging in one shot. 5-min cache per (categoryId, cursor).
 */
export async function listProductsInCategory(
  categoryId: string,
  cursor?: string | null,
): Promise<CategoryProductsResult> {
  const key = `cat:${categoryId}:${cursor ?? ""}`;
  const cached = readCache<CategoryProductsResult>(key);
  if (cached) return cached;

  try {
    const idsResult: any = await categories.listItemsInCategory(categoryId, {
      appNamespace: "@wix/stores",
    } as any);
    const ids: string[] = (idsResult?.items ?? idsResult?.itemIds ?? [])
      .map((it: any) =>
        typeof it === "string" ? it : it.catalogItemId ?? it._id ?? it.id,
      )
      .filter(Boolean);

    if (ids.length === 0) {
      return writeCache(key, { items: [], cursors: {} });
    }

    let builder = productsV3
      .queryProducts({ fields: ["CURRENCY"] })
      .in("_id", ids)
      .limit(PAGE_SIZE);
    if (cursor) builder = builder.skipTo(cursor);
    const result: any = await builder.find();

    return writeCache(key, {
      items: result.items ?? [],
      cursors: {
        next: result.cursors?.next ?? null,
        prev: result.cursors?.prev ?? null,
      },
    });
  } catch (err) {
    console.error(
      `[categories] listProductsInCategory(${categoryId}) failed:`,
      err,
    );
    return { items: [], cursors: {} };
  }
}
