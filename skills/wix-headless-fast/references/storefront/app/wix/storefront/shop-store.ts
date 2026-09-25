// The shop listing as a framework-free store — the logic behind useShop, usable from React
// (useShop wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and
// render), or as the specification for a port. Same shape as cart-store.ts: state, actions,
// subscribe/getState, emit after every change.
//
// Category, sort, price/stock/search filters, option facets, and cursor paging are all applied
// by Wix across the whole catalog (searchCatalog), never to a page already in hand. A changed
// selection starts a fresh cursor chain; a late response from a superseded query is dropped.
//
// SSR-friendly: seed with `initialProducts`/`initialCategories` and they render at once; `start()`
// then revalidates the first page to open the cursor chain, replacing the seed without a
// skeleton flash. `initialCategoryId` scopes the first query (a /category/[slug] page).
//
// URL state: sort, filters, facet choices (and a live category switch on /shop) are read from the
// query string by `start()` and written back with replaceState after every change — a filtered
// gallery is a link a shopper can share, reload, and step back to. Paging stays out of the URL.
//
// One store per mounted listing (a page can hold a shop and a featured rail): createShopStore(),
// not a singleton. The cart store is a singleton because the cart is one per visitor.
import { CATALOG_SORTS, fetchCategories, fetchFacetData, searchCatalog, type CatalogSort } from "./catalog";
import type { Category, Facet, PriceRange, ProductSummary } from "./types";

export const SORTS = CATALOG_SORTS;

export interface ShopFilters {
  minPrice?: number | string;
  maxPrice?: number | string;
  inStockOnly?: boolean;
  /** Name search, max 100 chars. */
  search?: string;
}

export interface ShopStoreOptions {
  initialProducts?: ProductSummary[];
  initialCategories?: Category[];
  /** Scope the listing to one category from the first render (a /category/[slug] page). */
  initialCategoryId?: string | null;
  pageSize?: number;
  /** Mirror the selection into the query string (default true; off for a rail that isn't the page's subject). */
  syncUrl?: boolean;
}

/** Everything a listing surface renders from. Read it with getState() or through a subscription. */
export interface ShopState {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  products: ProductSummary[] | null;
  /** Matching products across the whole catalog for the current selection; null until known. */
  total: number | null;
  categories: Category[];
  /** null = "all products". */
  activeCategoryId: string | null;
  sort: CatalogSort;
  filters: ShopFilters;
  /** The filterable options of the current scope (Color, Size…), from the catalog itself. */
  facets: Facet[];
  /** Lowest and highest product price in the scope — the price slider's bounds; null until known or when equal. */
  priceRange: PriceRange | null;
  /** Selected facet choice ids — products carrying ANY of them match. */
  selectedChoiceIds: string[];
  /** True when any filter or facet is active. */
  hasActiveFilters: boolean;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
}

export interface ShopStore {
  getState(): ShopState;
  subscribe(listener: () => void): () => void;
  /** Adopt the URL, fetch categories/facets, open the cursor chain. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
  setActiveCategoryId(id: string | null): void;
  setSort(sort: CatalogSort): void;
  setFilters(filters: ShopFilters): void;
  toggleChoice(choiceId: string): void;
  /** Clears price/stock/search filters and facet selections (keeps category and sort). */
  clearFilters(): void;
  retry(): void;
  loadMore(): Promise<void>;
}

const URL_KEYS = { sort: "sort", min: "min", max: "max", stock: "stock", q: "q", choice: "choice", category: "category" } as const;

function readUrlState(): { sort?: CatalogSort; filters: ShopFilters; choiceIds: string[]; categoryId?: string | null } | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  const sort = p.get(URL_KEYS.sort);
  const filters: ShopFilters = {};
  if (p.get(URL_KEYS.min)) filters.minPrice = p.get(URL_KEYS.min)!;
  if (p.get(URL_KEYS.max)) filters.maxPrice = p.get(URL_KEYS.max)!;
  if (p.get(URL_KEYS.stock) === "1") filters.inStockOnly = true;
  if (p.get(URL_KEYS.q)) filters.search = p.get(URL_KEYS.q)!;
  return {
    sort: sort && sort in CATALOG_SORTS ? (sort as CatalogSort) : undefined,
    filters,
    choiceIds: p.getAll(URL_KEYS.choice),
    categoryId: p.has(URL_KEYS.category) ? p.get(URL_KEYS.category) : undefined,
  };
}

function writeUrlState(s: { sort: CatalogSort; filters: ShopFilters; selectedChoiceIds: string[]; activeCategoryId: string | null }, initialCategoryId: string | null): void {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search);
  for (const k of Object.values(URL_KEYS)) p.delete(k);
  if (s.sort !== "featured") p.set(URL_KEYS.sort, s.sort);
  if (s.filters.minPrice != null && s.filters.minPrice !== "") p.set(URL_KEYS.min, String(s.filters.minPrice));
  if (s.filters.maxPrice != null && s.filters.maxPrice !== "") p.set(URL_KEYS.max, String(s.filters.maxPrice));
  if (s.filters.inStockOnly) p.set(URL_KEYS.stock, "1");
  if (s.filters.search?.trim()) p.set(URL_KEYS.q, s.filters.search.trim());
  for (const id of s.selectedChoiceIds) p.append(URL_KEYS.choice, id);
  if (s.activeCategoryId !== initialCategoryId) p.set(URL_KEYS.category, s.activeCategoryId ?? "");
  const qs = p.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
}

export function createShopStore({ initialProducts, initialCategories, initialCategoryId = null, pageSize = 24, syncUrl = true }: ShopStoreOptions = {}): ShopStore {
  // selection
  let activeCategoryId: string | null = initialCategoryId;
  let sort: CatalogSort = "featured";
  let filters: ShopFilters = {};
  let selectedChoiceIds: string[] = [];
  let attempt = 0;
  // data
  let categories: Category[] = initialCategories ?? [];
  let facets: Facet[] = [];
  let priceRange: PriceRange | null = null;
  // the current page; `key` is the selection it answers to (null = the SSR seed, no query yet)
  let pageKey: string | null = null;
  let products: ProductSummary[] | null = initialProducts ?? null;
  let total: number | null = null;
  let cursor: string | null = null;
  let error: string | null = null;
  let loadingMore = false;
  // control
  let started = false;
  let generation = 0;
  let pendingMore: object | null = null;
  const listeners = new Set<() => void>();

  const selectionKey = () =>
    JSON.stringify([pageSize, activeCategoryId, sort, filters.minPrice ?? null, filters.maxPrice ?? null, !!filters.inStockOnly, filters.search ?? "", [...selectedChoiceIds].sort(), attempt]);

  let snapshot: ShopState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  function getState(): ShopState {
    if (snapshot) return snapshot;
    const key = selectionKey();
    const current = pageKey === key;
    const seeded = pageKey === null && products !== null; // SSR seed, first query in flight
    const hasActiveFilters =
      selectedChoiceIds.length > 0 ||
      !!filters.inStockOnly ||
      (filters.minPrice != null && filters.minPrice !== "") ||
      (filters.maxPrice != null && filters.maxPrice !== "") ||
      !!(filters.search && filters.search.trim());
    snapshot = {
      products: current || seeded ? products : null,
      total: current ? total : null,
      categories,
      activeCategoryId,
      sort,
      filters,
      facets,
      priceRange,
      selectedChoiceIds,
      hasActiveFilters,
      // Seeded content on screen is not "loading" — skeletons are only for a genuinely empty wait.
      loading: (!current && !seeded) || (current && products === null),
      error: current ? error : null,
      hasMore: current && !!cursor,
      loadingMore: current && loadingMore,
    };
    return snapshot;
  }

  // Facets follow the category scope (a Size facet in "Donuts" is meaningless).
  let facetScope: string | null | undefined;
  function loadFacets(): void {
    if (facetScope === activeCategoryId) return;
    facetScope = activeCategoryId;
    const scope = activeCategoryId;
    fetchFacetData({ categoryId: scope }).then((d) => {
      if (!started || scope !== activeCategoryId) return;
      facets = d.facets;
      priceRange = d.priceRange;
      emit();
    });
  }

  // Run the query for the current selection. Keeps the seed (or the previous page) on screen while
  // it runs; only a selection change with no seed shows skeletons.
  function query(): void {
    if (!started) return;
    const key = selectionKey();
    const id = ++generation;
    pendingMore = null;
    if (pageKey !== null) products = null;
    pageKey = key; total = null; cursor = null; error = null; loadingMore = false;
    emit();
    const [limit, categoryId, selectedSort, minPrice, maxPrice, inStockOnly, search, choiceIds] = JSON.parse(key);
    searchCatalog({ limit, categoryId, sort: selectedSort, minPrice, maxPrice, inStockOnly, search, choiceIds })
      .then((res) => {
        if (generation !== id || selectionKey() !== key) return; // superseded — drop it
        products = res.products; total = res.total; cursor = res.nextCursor; error = null;
        emit();
      })
      .catch((e) => {
        if (generation !== id || selectionKey() !== key) return;
        products = []; total = null; cursor = null;
        error = e instanceof Error ? e.message : "Couldn't load products.";
        emit();
      });
  }

  function changed(): void {
    if (syncUrl) writeUrlState({ sort, filters, selectedChoiceIds, activeCategoryId }, initialCategoryId);
    loadFacets();
    // A new filters object with the same values keeps the page (same selection, same query).
    if (selectionKey() === pageKey) emit();
    else query();
  }

  return {
    getState,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      if (started) return;
      started = true;
      // Adopt the URL's selection once (the server rendered the defaults).
      const u = syncUrl ? readUrlState() : null;
      if (u) {
        if (u.sort) sort = u.sort;
        if (Object.keys(u.filters).length) filters = u.filters;
        if (u.choiceIds.length) selectedChoiceIds = u.choiceIds;
        if (u.categoryId !== undefined && u.categoryId !== initialCategoryId) activeCategoryId = u.categoryId || null;
      }
      if (!initialCategories) {
        fetchCategories().then((list) => { if (started) { categories = list; emit(); } }).catch(() => { if (started) { categories = []; emit(); } });
      }
      loadFacets();
      query();
    },
    stop() {
      started = false;
      generation++;
    },
    setActiveCategoryId(id) { if (id === activeCategoryId) return; activeCategoryId = id; changed(); },
    setSort(next) { if (next === sort) return; sort = next; changed(); },
    setFilters(next) { filters = next; changed(); },
    toggleChoice(choiceId) {
      selectedChoiceIds = selectedChoiceIds.includes(choiceId) ? selectedChoiceIds.filter((x) => x !== choiceId) : [...selectedChoiceIds, choiceId];
      changed();
    },
    clearFilters() { filters = {}; selectedChoiceIds = []; changed(); },
    retry() { attempt++; changed(); },
    async loadMore() {
      const key = selectionKey();
      if (pageKey !== key || !cursor || pendingMore) return;
      const request = { generation, key };
      pendingMore = request; // blocks repeated clicks before a re-render
      const isCurrent = () => generation === request.generation && selectionKey() === key;
      loadingMore = true; error = null; emit();
      try {
        const res = await searchCatalog({ limit: pageSize, cursor });
        if (isCurrent()) {
          const seen = new Set((products ?? []).map((p) => p.id));
          products = [...(products ?? []), ...res.products.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))];
          cursor = res.nextCursor;
        }
      } catch (e) {
        if (isCurrent()) error = e instanceof Error ? e.message : "Couldn't load more products.";
      } finally {
        if (pendingMore === request) pendingMore = null;
        if (isCurrent()) { loadingMore = false; emit(); }
      }
    },
  };
}
