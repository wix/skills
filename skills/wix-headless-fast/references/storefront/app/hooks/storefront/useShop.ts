// Catalog listing for a shop surface: category filter, sort, price/stock/search filters, and
// cursor paging — all applied by Wix across the whole catalog (searchCatalog), never to a page
// already in hand. A changed selection starts a fresh cursor chain.
//
// SSR-friendly: pass `initialProducts`/`initialCategories` (Astro frontmatter) and they render
// immediately — the hook still revalidates the first page once on mount to open the cursor
// chain, replacing the seed without a skeleton flash.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CATALOG_SORTS,
  fetchCategories,
  searchCatalog,
  type CatalogSort,
} from "../../wix/storefront/catalog";
import type { Category, ProductSummary } from "../../wix/storefront/types";

export const SORTS = CATALOG_SORTS;

export interface ShopFilters {
  minPrice?: number | string;
  maxPrice?: number | string;
  inStockOnly?: boolean;
  /** Name search, max 100 chars. */
  search?: string;
}

export interface UseShopOptions {
  initialProducts?: ProductSummary[];
  initialCategories?: Category[];
  pageSize?: number;
}

export interface UseShop {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  products: ProductSummary[] | null;
  categories: Category[];
  /** null = "all products". */
  activeCategoryId: string | null;
  setActiveCategoryId: (id: string | null) => void;
  sort: CatalogSort;
  setSort: (sort: CatalogSort) => void;
  filters: ShopFilters;
  setFilters: (filters: ShopFilters) => void;
  loading: boolean;
  error: string | null;
  retry: () => void;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  loadingMore: boolean;
}

interface PageState {
  key: string | null;
  products: ProductSummary[] | null;
  cursor: string | null;
  error: string | null;
  loadingMore: boolean;
}

export function useShop({
  initialProducts,
  initialCategories,
  pageSize = 24,
}: UseShopOptions = {}): UseShop {
  const [categories, setCategories] = useState<Category[]>(initialCategories ?? []);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [sort, setSort] = useState<CatalogSort>("featured");
  const [filters, setFilters] = useState<ShopFilters>({});
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<PageState>({
    key: null,
    products: initialProducts ?? null,
    cursor: null,
    error: null,
    loadingMore: false,
  });
  const generation = useRef(0);
  const pendingMore = useRef<object | null>(null);

  const key = JSON.stringify([
    pageSize,
    activeCategoryId,
    sort,
    filters.minPrice ?? null,
    filters.maxPrice ?? null,
    !!filters.inStockOnly,
    filters.search ?? "",
    attempt,
  ]);
  const currentKey = useRef(key);
  currentKey.current = key;

  useEffect(() => {
    if (initialCategories) return;
    let alive = true;
    fetchCategories().then((list) => alive && setCategories(list)).catch(() => alive && setCategories([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = ++generation.current;
    let alive = true;
    pendingMore.current = null;
    // Keep the SSR seed (or the previous page) on screen while the fresh query runs;
    // only a selection change with no seed shows skeletons.
    setPage((p) => ({ key, products: p.key === null ? p.products : null, cursor: null, error: null, loadingMore: false }));
    const [limit, categoryId, selectedSort, minPrice, maxPrice, inStockOnly, search] = JSON.parse(key);
    searchCatalog({ limit, categoryId, sort: selectedSort, minPrice, maxPrice, inStockOnly, search })
      .then((res) => {
        if (alive && generation.current === id && currentKey.current === key) {
          setPage({ key, products: res.products, cursor: res.nextCursor, error: null, loadingMore: false });
        }
      })
      .catch((e) => {
        if (alive && generation.current === id && currentKey.current === key) {
          setPage({
            key,
            products: [],
            cursor: null,
            error: e instanceof Error ? e.message : "Couldn't load products.",
            loadingMore: false,
          });
        }
      });
    return () => {
      alive = false;
      generation.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadMore = useCallback(async () => {
    if (page.key !== key || !page.cursor || pendingMore.current) return;
    const request = { generation: generation.current, key };
    pendingMore.current = request; // blocks repeated clicks before React rerenders
    const isCurrent = () => generation.current === request.generation && currentKey.current === key;
    setPage((p) => ({ ...p, loadingMore: true, error: null }));
    try {
      const res = await searchCatalog({ limit: pageSize, cursor: page.cursor });
      if (isCurrent())
        setPage((p) => {
          const seen = new Set((p.products ?? []).map((product) => product.id));
          return {
            ...p,
            products: [
              ...(p.products ?? []),
              ...res.products.filter((product) => {
                if (seen.has(product.id)) return false;
                seen.add(product.id);
                return true;
              }),
            ],
            cursor: res.nextCursor,
          };
        });
    } catch (e) {
      if (isCurrent())
        setPage((p) => ({ ...p, error: e instanceof Error ? e.message : "Couldn't load more products." }));
    } finally {
      if (pendingMore.current === request) pendingMore.current = null;
      if (isCurrent()) setPage((p) => ({ ...p, loadingMore: false }));
    }
  }, [key, page.key, page.cursor, pageSize]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const current = page.key === key;
  const seeded = page.key === null && page.products !== null; // SSR seed, first query in flight
  // Seeded content on screen is not "loading" — skeletons are only for a genuinely empty wait.
  const loading = (!current && !seeded) || (current && page.products === null);
  return {
    categories,
    activeCategoryId,
    setActiveCategoryId,
    sort,
    setSort,
    filters,
    setFilters,
    products: current || seeded ? page.products : null,
    loading,
    error: current ? page.error : null,
    retry,
    hasMore: current && !!page.cursor,
    loadMore,
    loadingMore: current && page.loadingMore,
  };
}
