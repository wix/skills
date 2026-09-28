// The shop listing as a framework-free store — the logic behind useShop, usable from React
// (useShop wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and
// render), or as the specification for a port. Same shape as cart-store.ts: state, actions,
// subscribe/getState, emit after every change.
//
// Category, sort, price/stock/search filters, option facets, and cursor paging are all applied
// by Wix across the whole catalog (searchCatalog), never to a page already in hand. A changed
// selection starts a fresh cursor chain; a late response from a superseded query is dropped. The
// previous page stays on screen (with `loading: true`) while the new one loads — skeletons only
// when there is nothing to show yet.
//
// Facet picks are kept PER FACET: choices inside one facet OR together, facets AND together
// ("Red or Blue, and Large"), exactly as Wix's own storefront filters; a linked choice's children
// ride along with it.
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
import { CATALOG_SORTS, fetchCategories, fetchFacetData, searchCatalog, type CatalogSort, type FacetSelection } from "./catalog";
import { expandFacetChoiceIds } from "./catalog-core";
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
  /**
   * null while the FIRST load is in flight — render skeletons. During a later selection change the
   * previous page stays here with `loading: true` (dim it, don't blank it).
   */
  products: ProductSummary[] | null;
  /** Matching products across the whole catalog for the current selection; null until known. */
  total: number | null;
  categories: Category[];
  /** null = "all products". */
  activeCategoryId: string | null;
  sort: CatalogSort;
  filters: ShopFilters;
  /** The filterable customizations of the current scope (Color, Size, a choice modifier…), from the catalog itself. */
  facets: Facet[];
  /** Lowest and highest product price in the scope — the price slider's bounds; null until known or when equal. */
  priceRange: PriceRange | null;
  /** Selected facet choice ids (every facet together) — what the chips and the panel's pressed state read. */
  selectedChoiceIds: string[];
  /** True when any filter or facet is active. */
  hasActiveFilters: boolean;
  /** A query is in flight for the current selection (the products shown may be the previous page's). */
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
  /** Select / deselect a facet choice (the facet is found from the loaded facets). */
  toggleChoice(choiceId: string): void;
  /** Clears price/stock/search filters and facet selections (keeps category and sort). */
  clearFilters(): void;
  retry(): void;
  loadMore(): Promise<void>;
}

/** A pick remembers its facet so the query can group it before the facets are loaded (a shared link). */
interface SelectedChoice {
  kind: Facet["kind"];
  facetId: string;
  choiceId: string;
}

const URL_KEYS = { sort: "sort", min: "min", max: "max", stock: "stock", q: "q", choice: "choice", category: "category" } as const;

// choice=<kind>:<facetId>:<choiceId>; a bare choice id (an older link) counts as an option pick.
const encodeChoice = (s: SelectedChoice): string => `${s.kind}:${s.facetId}:${s.choiceId}`;
function decodeChoice(token: string): SelectedChoice | null {
  const parts = token.split(":");
  if (parts.length === 3 && (parts[0] === "option" || parts[0] === "modifier") && parts[2]) return { kind: parts[0], facetId: parts[1], choiceId: parts[2] };
  if (parts.length === 1 && parts[0]) return { kind: "option", facetId: "", choiceId: parts[0] };
  return null;
}

function readUrlState(): { sort?: CatalogSort; filters: ShopFilters; selected: SelectedChoice[]; categoryId?: string | null } | null {
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
    selected: p.getAll(URL_KEYS.choice).map(decodeChoice).filter((s): s is SelectedChoice => s !== null),
    categoryId: p.has(URL_KEYS.category) ? p.get(URL_KEYS.category) : undefined,
  };
}

function writeUrlState(s: { sort: CatalogSort; filters: ShopFilters; selected: SelectedChoice[]; activeCategoryId: string | null }, initialCategoryId: string | null): void {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search);
  for (const k of Object.values(URL_KEYS)) p.delete(k);
  if (s.sort !== "featured") p.set(URL_KEYS.sort, s.sort);
  if (s.filters.minPrice != null && s.filters.minPrice !== "") p.set(URL_KEYS.min, String(s.filters.minPrice));
  if (s.filters.maxPrice != null && s.filters.maxPrice !== "") p.set(URL_KEYS.max, String(s.filters.maxPrice));
  if (s.filters.inStockOnly) p.set(URL_KEYS.stock, "1");
  if (s.filters.search?.trim()) p.set(URL_KEYS.q, s.filters.search.trim());
  for (const c of s.selected) p.append(URL_KEYS.choice, encodeChoice(c));
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
  let selected: SelectedChoice[] = [];
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
  let hasMore = false;
  let error: string | null = null;
  let loadingMore = false;
  // control
  let started = false;
  let generation = 0;
  let pendingMore: object | null = null;
  const listeners = new Set<() => void>();

  // The picks grouped per facet, each with its linked children (known once the facets loaded),
  // in a stable order — the query and its key are built from this.
  function facetSelections(): FacetSelection[] {
    const groups = new Map<string, FacetSelection>();
    for (const s of selected) {
      const key = `${s.kind}:${s.facetId}`;
      const g = groups.get(key) ?? { id: s.facetId, kind: s.kind, choiceIds: [] };
      for (const cid of expandFacetChoiceIds(facets.find((f) => f.id === s.facetId), [s.choiceId])) if (!g.choiceIds.includes(cid)) g.choiceIds.push(cid);
      groups.set(key, g);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, choiceIds: [...g.choiceIds].sort() }))
      .sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
  }

  const selectionKey = () =>
    JSON.stringify([pageSize, activeCategoryId, sort, filters.minPrice ?? null, filters.maxPrice ?? null, !!filters.inStockOnly, filters.search ?? "", facetSelections(), attempt]);

  let snapshot: ShopState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  function getState(): ShopState {
    if (snapshot) return snapshot;
    const key = selectionKey();
    const current = pageKey === key;
    const hasActiveFilters =
      selected.length > 0 ||
      !!filters.inStockOnly ||
      (filters.minPrice != null && filters.minPrice !== "") ||
      (filters.maxPrice != null && filters.maxPrice !== "") ||
      !!(filters.search && filters.search.trim());
    snapshot = {
      // the seed or the previous page stays visible while a query runs; null only before anything loaded
      products,
      total: current ? total : null,
      categories,
      activeCategoryId,
      sort,
      filters,
      facets,
      priceRange,
      selectedChoiceIds: selected.map((s) => s.choiceId),
      hasActiveFilters,
      // Content on screen is not "loading" in the skeleton sense — the flag says a query is in flight.
      loading: !current || products === null,
      error: current ? error : null,
      hasMore: current && hasMore && !!cursor,
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
      // A pick from the URL may have gained linked children now that its facet is known.
      if (selectionKey() !== pageKey) query();
      else emit();
    });
  }

  // Run the query for the current selection. Keeps the seed (or the previous page) on screen while
  // it runs; skeletons only when there is nothing yet.
  function query(): void {
    if (!started) return;
    const key = selectionKey();
    const id = ++generation;
    pendingMore = null;
    pageKey = key; total = null; cursor = null; hasMore = false; error = null; loadingMore = false;
    emit();
    const [limit, categoryId, selectedSort, minPrice, maxPrice, inStockOnly, search, selections] = JSON.parse(key);
    searchCatalog({ limit, categoryId, sort: selectedSort, minPrice, maxPrice, inStockOnly, search, facetSelections: selections })
      .then((res) => {
        if (generation !== id || selectionKey() !== key) return; // superseded — drop it
        products = res.products; total = res.total; cursor = res.nextCursor; hasMore = res.hasMore; error = null;
        emit();
      })
      .catch((e) => {
        if (generation !== id || selectionKey() !== key) return;
        products = []; total = null; cursor = null; hasMore = false;
        error = e instanceof Error ? e.message : "Couldn't load products.";
        emit();
      });
  }

  function changed(): void {
    if (syncUrl) writeUrlState({ sort, filters, selected, activeCategoryId }, initialCategoryId);
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
        if (u.selected.length) selected = u.selected;
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
      const existing = selected.find((s) => s.choiceId === choiceId);
      if (existing) selected = selected.filter((s) => s !== existing);
      else {
        const facet = facets.find((f) => f.choices.some((c) => c.id === choiceId));
        if (!facet) return; // not a choice of this scope's facets
        selected = [...selected, { kind: facet.kind, facetId: facet.id, choiceId }];
      }
      changed();
    },
    clearFilters() { filters = {}; selected = []; changed(); },
    retry() { attempt++; changed(); },
    async loadMore() {
      const key = selectionKey();
      if (pageKey !== key || !cursor || !hasMore || pendingMore) return;
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
          hasMore = res.hasMore;
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
