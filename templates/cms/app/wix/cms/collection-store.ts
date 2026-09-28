// One collection as list state, framework-free — the logic behind useCollection, usable from React
// (useCollection wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe
// and render), or as the specification for a port. Same shape as the storefront stores: state,
// actions, subscribe/getState, emit after every change.
//
// The query (collection, filters, sort, page size, includes) is identified BY VALUE; a changed
// query refetches from the first page, a late response from a superseded query is dropped.
// loadMore() appends the next page (skip paging: skip = items shown so far).
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
}

/** Everything a listing surface renders from. Read it with getState() or through a subscription. */
export interface CollectionState {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  items: CmsItem[] | null;
  hasNext: boolean;
  loadingMore: boolean;
  error: string | null;
  /** True while items is null and a load is running (the same condition, named). */
  loading: boolean;
}

export interface CollectionStore {
  getState(): CollectionState;
  subscribe(listener: () => void): () => void;
  /** Run the first query unless the seed already answered it. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
  /** Change the query by value — same values keep the page, a change refetches from the first page. */
  setQuery(query: CollectionQuery): void;
  /** Append the next page (skip = items shown so far). No-op while loading or when there is none. */
  loadMore(): Promise<void>;
  /** Re-run the current query after an error. */
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
  const key = () => queryKey({ collectionId, filters, sort, limit, include });

  let items: CmsItem[] | null = options.initialItems ?? null;
  let hasNext = options.initialHasNext ?? (options.initialItems ? options.initialItems.length >= limit : false);
  let loadingMore = false;
  let error: string | null = null;
  // The query the current items answer (null = nothing answered yet).
  let pageKey: string | null = options.initialItems ? key() : null;
  let inflight = false;
  let started = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  let snapshot: CollectionState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  function getState(): CollectionState {
    if (snapshot) return snapshot;
    snapshot = { items, hasNext, loadingMore, error, loading: items === null };
    return snapshot;
  }

  function run(): void {
    if (!started) return;
    const k = key();
    const id = ++generation;
    pageKey = k; inflight = true;
    items = null; error = null; loadingMore = false;
    emit();
    queryItems(collectionId, { filters, sort, limit, include })
      .then((page) => {
        if (generation !== id) return; // superseded — drop it
        items = page.items; hasNext = page.hasNext; inflight = false;
        emit();
      })
      .catch((e) => {
        if (generation !== id) return;
        items = []; hasNext = false; inflight = false;
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
      if (pageKey !== key() || (items === null && !inflight)) run();
    },
    stop() {
      started = false;
      generation++;
      inflight = false;
    },
    setQuery(q) {
      if (q.collectionId !== undefined) collectionId = q.collectionId;
      filters = q.filters; sort = q.sort; include = q.include;
      if (q.limit !== undefined) limit = q.limit;
      if (key() === pageKey) return; // same values — same page
      if (started) run();
    },
    async loadMore() {
      const current = items;
      if (!current || loadingMore) return;
      const id = generation;
      loadingMore = true; emit();
      try {
        const page = await queryItems(collectionId, { filters, sort, limit, include, skip: current.length });
        if (generation !== id) return;
        items = [...(items ?? []), ...page.items];
        hasNext = page.hasNext;
      } catch (e) {
        if (generation !== id) return;
        error = e instanceof Error ? e.message : String(e);
      } finally {
        if (generation === id) { loadingMore = false; emit(); }
      }
    },
    retry() {
      pageKey = null;
      run();
    },
  };
}
