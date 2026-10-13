// One collection as list state, framework-free — the logic behind useCollection, usable from React
// (useCollection wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe
// and render), or as the specification for a port. Same shape as the storefront stores: state,
// actions, subscribe/getState, emit after every change.
//
// The query (collection, filters, sort, page size, includes) is identified BY VALUE; a changed
// query refetches from the first page, a late response from a superseded query is dropped.
// Stale-while-refetch: once items are on screen they STAY there while a new query, page, or
// refresh runs — `fetching` flips instead of `items` going null; only the very first load shows
// skeletons (`loading`). Two ways to page, both at the source: loadMore() appends the next page
// (skip = items shown so far); goToPage(n) replaces the list with page n (0-based; `hasPrev`,
// `page`, and — with `withTotal` — `total`/`pageCount` drive a numbered pager). refresh() re-reads
// what is on screen after a write.
//
// SSR-friendly: seed with `initialItems` from the SAME query and no client fetch happens for the
// first page. One store per mounted listing (a page can hold two collections): createCollectionStore(),
// not a singleton.
import { queryItems } from "./items";
import type { CmsFilter, CmsItem, CmsSort } from "./types";

export interface CollectionQuery {
  collectionId?: string;
  filters?: CmsFilter[];
  sort?: CmsSort[];
  /** Page size (default 20). */
  limit?: number;
  /** Reference field keys to inline as full items. */
  include?: string[];
}

export interface CollectionStoreOptions extends CollectionQuery {
  collectionId: string;
  /** Server-fetched first page — must come from the SAME query (filters/sort/limit/include). */
  initialItems?: CmsItem[];
  /** The server fetch's hasNext. Omitted → inferred (a full first page ⇒ assume more). */
  initialHasNext?: boolean;
  /** true → every query asks Wix for the total; `total` and `pageCount` fill in (a slower query). */
  withTotal?: boolean;
  /** The server fetch's total (it queried withTotal). */
  initialTotal?: number | null;
}

/** Everything a listing surface renders from. Read it with getState() or through a subscription. */
export interface CollectionState {
  /** null while the FIRST load is in flight — render skeletons, not an empty state. Never null again after. */
  items: CmsItem[] | null;
  hasNext: boolean;
  /** A page before the one shown exists (page > 0). */
  hasPrev: boolean;
  /** 0-based index of the first page on screen (loadMore appends after it). */
  page: number;
  /** Matching items across the collection — only with `withTotal`, else null. */
  total: number | null;
  /** ceil(total / limit) — only with `withTotal`, else null. */
  pageCount: number | null;
  /** True while items is null and a load is running (the same condition, named). */
  loading: boolean;
  /** True while a new query, page, or refresh runs BEHIND the items on screen — dim them, don't drop them. */
  fetching: boolean;
  loadingMore: boolean;
  error: string | null;
}

export interface CollectionStore {
  getState(): CollectionState;
  subscribe(listener: () => void): () => void;
  /** Run the first query unless the seed already answered it. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
  /** Change the query by value — same values keep the page, a change refetches page 0 (items stay on screen, `fetching`). */
  setQuery(query: CollectionQuery): void;
  /** Append the next page (skip = items shown so far). No-op while loading or when there is none. */
  loadMore(): Promise<void>;
  /** Replace the list with page n (0-based; skip = n × limit). No-op for a negative n or the page already shown. */
  goToPage(n: number): void;
  /** Re-read what is on screen (same query, same window) — after insertItem / patchItemFields / linkItems. */
  refresh(): void;
  /** Re-run the current query from page 0 after an error (skeletons again). */
  retry(): void;
}

const queryKey = (q: Required<Pick<CollectionQuery, "collectionId" | "limit">> & CollectionQuery): string =>
  // Dates in filters serialize to ISO, so this is stable.
  JSON.stringify([q.collectionId, q.filters ?? null, q.sort ?? null, q.limit, q.include ?? null]);

export function createCollectionStore(options: CollectionStoreOptions): CollectionStore {
  let collectionId = options.collectionId;
  let filters = options.filters;
  let sort = options.sort;
  let limit = options.limit ?? 20;
  let include = options.include;
  const withTotal = options.withTotal ?? false;
  const key = () => queryKey({ collectionId, filters, sort, limit, include });

  let items: CmsItem[] | null = options.initialItems ?? null;
  let hasNext = options.initialHasNext ?? (options.initialItems ? options.initialItems.length >= limit : false);
  let page = 0;
  let total: number | null = withTotal ? (options.initialTotal ?? null) : null;
  let loadingMore = false;
  let fetching = false;
  let error: string | null = null;
  // The query the latest request targets (null = nothing requested yet).
  let pageKey: string | null = options.initialItems ? key() : null;
  let inflight = false;
  let started = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  let snapshot: CollectionState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  function getState(): CollectionState {
    if (snapshot) return snapshot;
    snapshot = {
      items,
      hasNext,
      hasPrev: page > 0,
      page,
      total,
      pageCount: total === null ? null : Math.ceil(total / limit),
      loading: items === null,
      fetching,
      loadingMore,
      error,
    };
    return snapshot;
  }

  /**
   * Load page `nextPage` of the current query (`window` items wide — the page size, or the whole
   * shown list on a refresh). Items already on screen stay while it runs (fetching); the first load
   * has none, so it shows skeletons (loading).
   */
  function load(nextPage: number, window = limit): void {
    if (!started) return;
    const k = key();
    const id = ++generation;
    pageKey = k; inflight = true;
    error = null; loadingMore = false;
    fetching = items !== null; // something is on screen → it stays, dimmed; nothing yet → skeletons (loading)
    emit();
    queryItems(collectionId, { filters, sort, limit: window, skip: nextPage * limit, include, withTotal })
      .then((res) => {
        if (generation !== id) return; // superseded — drop it
        items = res.items; hasNext = res.hasNext; page = nextPage;
        if (withTotal) total = res.total;
        inflight = false; fetching = false;
        emit();
      })
      .catch((e) => {
        if (generation !== id) return;
        // A first load that fails shows the error with an empty list; a refetch keeps what was on screen.
        if (items === null) { items = []; hasNext = false; }
        inflight = false; fetching = false;
        error = e instanceof Error ? e.message : String(e);
        emit();
      });
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
      // The SSR seed answered this exact query — no fetch; a dropped first load reruns.
      if (pageKey !== key() || (items === null && !inflight)) load(0);
    },
    stop() {
      started = false;
      generation++;
      inflight = false;
      fetching = false;
    },
    setQuery(q) {
      if (q.collectionId !== undefined) collectionId = q.collectionId;
      filters = q.filters; sort = q.sort; include = q.include;
      if (q.limit !== undefined) limit = q.limit;
      if (key() === pageKey) return; // same values — same page
      if (started) load(0);
    },
    async loadMore() {
      const current = items;
      if (!current || loadingMore || inflight) return;
      const id = generation;
      loadingMore = true; emit();
      try {
        const res = await queryItems(collectionId, { filters, sort, limit, include, withTotal, skip: page * limit + current.length });
        if (generation !== id) return;
        items = [...(items ?? []), ...res.items];
        hasNext = res.hasNext;
        if (withTotal) total = res.total;
      } catch (e) {
        if (generation !== id) return;
        error = e instanceof Error ? e.message : String(e);
      } finally {
        if (generation === id) { loadingMore = false; emit(); }
      }
    },
    goToPage(n) {
      if (n < 0) return;
      // Already showing exactly that page of this query (appended pages collapse back to one).
      const shown = n === page && key() === pageKey && items !== null && !inflight && items.length <= limit;
      if (shown) return;
      load(n);
    },
    refresh() {
      // The whole shown window (several appended pages read as one), or the page size before any answer.
      load(page, items && items.length > limit ? items.length : limit);
    },
    retry() {
      pageKey = null;
      items = null; page = 0;
      load(0);
    },
  };
}
