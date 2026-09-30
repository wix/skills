// The results page as a framework-free store — the logic behind useSearch, usable from React
// (useSearch wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and
// render), or as the specification for a port. Same shape as the vertical stores: state, actions,
// subscribe/getState, emit after every change.
//
// Two views of one query: GROUPED (type null — federatedSearch, a few hits per type, no paging) and
// SINGLE-TYPE (type set — search with documentType, sort, filter, facets, offset paging). The query
// (q, type, sort, filter, limits) is identified BY VALUE; a change refetches from the first page, a
// late response from a superseded query is dropped. Paging appends (offset = hits shown so far).
//
// SSR-friendly: seed with `initialGroups`/`initialIndexed` or `initialPage` from the SAME q/type and
// no client fetch happens for the first render. URL state (`?q=&type=`) is the surface's job, not
// the store's. One store per mounted results surface: createSearchStore(), not a singleton.
import { searchAll, searchType } from "./search";
import { GROUP_LIMIT, PAGE_LIMIT, clampQuery, sortsFor } from "./search-core";
import type { SearchDocType, SearchFilter, SearchGroup, SearchPage, SearchSort } from "./types";

export interface SearchStoreOptions {
  q?: string;
  /** null = the grouped view. */
  type?: SearchDocType | null;
  sort?: SearchSort;
  filter?: SearchFilter;
  /** Hits per type in the grouped view (default 4). */
  groupLimit?: number;
  /** Page size of the single-type view (default 12). */
  pageLimit?: number;
  /** Server-fetched grouped result — must come from the SAME q with type null. */
  initialGroups?: SearchGroup[] | null;
  initialIndexed?: boolean | null;
  /** Server-fetched first page — must come from the SAME q/type/sort/filter. */
  initialPage?: SearchPage | null;
}

/** Everything a results surface renders from. Read it with getState() or through a subscription. */
export interface SearchState {
  q: string;
  type: SearchDocType | null;
  sort: SearchSort;
  filter: SearchFilter;
  /** Grouped view: null while the first load is in flight — render skeletons, not an empty state. [] = no results. */
  groups: SearchGroup[] | null;
  /** Grouped view: see SearchAllResult.indexed. */
  indexed: boolean | null;
  /** Single-type view: null while the first load is in flight. */
  page: SearchPage | null;
  /** The sorts the current type offers (relevance always). */
  sorts: SearchSort[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
}

export interface SearchStore {
  getState(): SearchState;
  subscribe(listener: () => void): () => void;
  /** Run the first query unless the seed already answered it. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
  /** A new phrase (trimmed, cut at 100 chars) — refetches from the first page in the current view. */
  setQuery(q: string): void;
  /** Switch views: a type for its single-type page, null for the grouped view. Resets sort and filter. */
  setType(type: SearchDocType | null): void;
  setSort(sort: SearchSort): void;
  setFilter(filter: SearchFilter): void;
  /** Single-type view: append the next page. No-op while loading or when there is none. */
  loadMore(): Promise<void>;
  /** Re-run the current query after an error. */
  retry(): void;
}

export function createSearchStore(options: SearchStoreOptions = {}): SearchStore {
  let q = clampQuery(options.q);
  let type: SearchDocType | null = options.type ?? null;
  let sort: SearchSort = options.sort ?? "relevance";
  let filter: SearchFilter = options.filter ?? {};
  const groupLimit = options.groupLimit ?? GROUP_LIMIT;
  const pageLimit = options.pageLimit ?? PAGE_LIMIT;
  let attempt = 0;
  const key = () => JSON.stringify([q, type, sort, filter, groupLimit, pageLimit, attempt]);

  let groups: SearchGroup[] | null = type === null ? (options.initialGroups ?? null) : null;
  let indexed: boolean | null = options.initialIndexed ?? null;
  let page: SearchPage | null = type !== null ? (options.initialPage ?? null) : null;
  let error: string | null = null;
  let loadingMore = false;
  // The query the current data answers (null = nothing answered yet).
  let pageKey: string | null = groups !== null || page !== null ? key() : null;
  let inflight = false;
  let started = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  let snapshot: SearchState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  function getState(): SearchState {
    if (snapshot) return snapshot;
    const answered = pageKey === key();
    snapshot = {
      q,
      type,
      sort,
      filter,
      groups: type === null && answered ? groups : null,
      indexed: type === null && answered ? indexed : null,
      page: type !== null && answered ? page : null,
      sorts: type ? sortsFor(type) : ["relevance"],
      loading: !!q && (!answered || (type === null ? groups === null : page === null)),
      loadingMore: answered && loadingMore,
      hasMore: answered && !!page?.hasNext,
      error: answered ? error : null,
    };
    return snapshot;
  }

  function run(): void {
    if (!started) return;
    const k = key();
    const id = ++generation;
    pageKey = k;
    groups = null;
    page = null;
    indexed = null;
    error = null;
    loadingMore = false;
    if (!q) {
      // Nothing to search — an empty, answered state (no request).
      groups = type === null ? [] : null;
      inflight = false;
      emit();
      return;
    }
    inflight = true;
    emit();
    const request = type === null ? searchAll(q, { limit: groupLimit }) : searchType({ q, type, sort, filter, limit: pageLimit, offset: 0 });
    request
      .then((res) => {
        if (generation !== id) return; // superseded — drop it
        if ("groups" in res) {
          groups = res.groups;
          indexed = res.indexed;
        } else {
          page = res;
        }
        inflight = false;
        emit();
      })
      .catch((e) => {
        if (generation !== id) return;
        groups = type === null ? [] : null;
        page = null;
        inflight = false;
        error = e instanceof Error ? e.message : String(e);
        emit();
      });
  }

  function changed(): void {
    if (key() === pageKey) return; // same values — same data
    if (started) run();
    else emit();
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
      if (pageKey !== key() || (!inflight && (type === null ? groups === null : page === null))) run();
    },
    stop() {
      started = false;
      generation++;
      inflight = false;
    },
    setQuery(next) {
      const value = clampQuery(next);
      if (value === q) return;
      q = value;
      changed();
    },
    setType(next) {
      if (next === type) return;
      type = next;
      sort = "relevance";
      filter = {};
      changed();
    },
    setSort(next) {
      if (next === sort || (type && !sortsFor(type).includes(next))) return;
      sort = next;
      changed();
    },
    setFilter(next) {
      filter = next;
      changed();
    },
    async loadMore() {
      const current = page;
      if (!type || !current?.hasNext || loadingMore || pageKey !== key()) return;
      const id = generation;
      loadingMore = true;
      error = null;
      emit();
      try {
        const more = await searchType({ q, type, sort, filter, limit: pageLimit, offset: current.hits.length });
        if (generation !== id) return;
        const seen = new Set(current.hits.map((h) => h.id));
        page = { ...more, offset: 0, hits: [...current.hits, ...more.hits.filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))] };
      } catch (e) {
        if (generation !== id) return;
        error = e instanceof Error ? e.message : String(e);
      } finally {
        if (generation === id) {
          loadingMore = false;
          emit();
        }
      }
    },
    retry() {
      attempt++;
      run();
    },
  };
}
