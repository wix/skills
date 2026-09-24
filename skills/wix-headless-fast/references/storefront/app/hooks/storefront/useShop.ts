// Catalog listing for a shop or category surface: category, sort, price/stock/search filters,
// option facets, and cursor paging — all applied by Wix across the whole catalog (searchCatalog),
// never to a page already in hand. A changed selection starts a fresh cursor chain.
//
// SSR-friendly: pass `initialProducts`/`initialCategories` (Astro frontmatter) and they render
// immediately — the hook still revalidates the first page once on mount to open the cursor
// chain, replacing the seed without a skeleton flash. A /category/[slug] page passes
// `initialCategoryId` so the first query is already scoped.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CATALOG_SORTS,
  fetchCategories,
  fetchFacets,
  searchCatalog,
  type CatalogSort,
} from "../../wix/storefront/catalog";
import type { Category, Facet, ProductSummary } from "../../wix/storefront/types";

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
  /** Scope the listing to one category from the first render (a /category/[slug] page). */
  initialCategoryId?: string | null;
  pageSize?: number;
}

export interface UseShop {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  products: ProductSummary[] | null;
  /** Matching products across the whole catalog for the current selection; null until known. */
  total: number | null;
  categories: Category[];
  /** null = "all products". */
  activeCategoryId: string | null;
  setActiveCategoryId: (id: string | null) => void;
  sort: CatalogSort;
  setSort: (sort: CatalogSort) => void;
  filters: ShopFilters;
  setFilters: (filters: ShopFilters) => void;
  /** The filterable options of the current scope (Color, Size…), from the catalog itself. */
  facets: Facet[];
  /** Selected facet choice ids — products carrying ANY of them match. */
  selectedChoiceIds: string[];
  toggleChoice: (choiceId: string) => void;
  /** Clears price/stock/search filters and facet selections (keeps category and sort). */
  clearFilters: () => void;
  /** True when any filter or facet is active. */
  hasActiveFilters: boolean;
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
  total: number | null;
  cursor: string | null;
  error: string | null;
  loadingMore: boolean;
}

export function useShop({
  initialProducts,
  initialCategories,
  initialCategoryId = null,
  pageSize = 24,
}: UseShopOptions = {}): UseShop {
  const [categories, setCategories] = useState<Category[]>(initialCategories ?? []);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(initialCategoryId);
  const [sort, setSort] = useState<CatalogSort>("featured");
  const [filters, setFilters] = useState<ShopFilters>({});
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState<PageState>({
    key: null,
    products: initialProducts ?? null,
    total: null,
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
    [...selectedChoiceIds].sort(),
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

  // Facets follow the category scope (a Size facet in "Donuts" is meaningless).
  useEffect(() => {
    let alive = true;
    fetchFacets({ categoryId: activeCategoryId }).then((f) => alive && setFacets(f));
    return () => {
      alive = false;
    };
  }, [activeCategoryId]);

  useEffect(() => {
    const id = ++generation.current;
    let alive = true;
    pendingMore.current = null;
    // Keep the SSR seed (or the previous page) on screen while the fresh query runs;
    // only a selection change with no seed shows skeletons.
    setPage((p) => ({ key, products: p.key === null ? p.products : null, total: null, cursor: null, error: null, loadingMore: false }));
    const [limit, categoryId, selectedSort, minPrice, maxPrice, inStockOnly, search, choiceIds] = JSON.parse(key);
    searchCatalog({ limit, categoryId, sort: selectedSort, minPrice, maxPrice, inStockOnly, search, choiceIds })
      .then((res) => {
        if (alive && generation.current === id && currentKey.current === key) {
          setPage({ key, products: res.products, total: res.total, cursor: res.nextCursor, error: null, loadingMore: false });
        }
      })
      .catch((e) => {
        if (alive && generation.current === id && currentKey.current === key) {
          setPage({
            key,
            products: [],
            total: null,
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
  const toggleChoice = useCallback(
    (choiceId: string) =>
      setSelectedChoiceIds((ids) => (ids.includes(choiceId) ? ids.filter((x) => x !== choiceId) : [...ids, choiceId])),
    [],
  );
  const clearFilters = useCallback(() => {
    setFilters({});
    setSelectedChoiceIds([]);
  }, []);

  const current = page.key === key;
  const seeded = page.key === null && page.products !== null; // SSR seed, first query in flight
  // Seeded content on screen is not "loading" — skeletons are only for a genuinely empty wait.
  const loading = (!current && !seeded) || (current && page.products === null);
  const hasActiveFilters =
    selectedChoiceIds.length > 0 ||
    !!filters.inStockOnly ||
    filters.minPrice != null && filters.minPrice !== "" ||
    filters.maxPrice != null && filters.maxPrice !== "" ||
    !!(filters.search && filters.search.trim());
  return {
    products: current || seeded ? page.products : null,
    total: current ? page.total : null,
    categories,
    activeCategoryId,
    setActiveCategoryId,
    sort,
    setSort,
    filters,
    setFilters,
    facets,
    selectedChoiceIds,
    toggleChoice,
    clearFilters,
    hasActiveFilters,
    loading,
    error: current ? page.error : null,
    retry,
    hasMore: current && !!page.cursor,
    loadMore,
    loadingMore: current && page.loadingMore,
  };
}
