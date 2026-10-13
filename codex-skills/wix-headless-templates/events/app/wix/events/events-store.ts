// The events listing as a framework-free store — the logic behind useEvents, usable from React
// (useEvents wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and
// render), or as the specification for a port. State, actions, subscribe/getState, emit after
// every change.
//
// SSR-friendly: seed with `initialEvents` (+ `initialTotal` from fetchEventsPage) and they render
// at once with no client fetch; a SPA passes nothing and `start()` fetches the first page. Pages
// are Wix's 20; `loadMore()` appends the next. The category pills are the site's MANUAL categories
// (Query Categories on the visitor token, as Wix's listing does); when that read is refused for
// this site's visitor scope the pills fall back to the manual categories on the loaded events.
// Filtering by category is client-side while the whole list is loaded, server-side (a refetch)
// once there are more pages than loaded — so a filter never hides events on unloaded pages.
//
// One store per mounted listing (a page can hold the index and a "next up" rail):
// createEventsStore(), not a singleton.
import { fetchCategories, fetchEventsPage } from "./events";
import { DEFAULT_PAGE_SIZE, type StatusFilter } from "./events-core";
import type { EventCategory, EventSummary } from "./types";

export interface EventsStoreOptions {
  /** Server-fetched first page (Astro frontmatter) — renders at once, no client fetch. */
  initialEvents?: EventSummary[];
  /** Matching events overall (from fetchEventsPage) — enables "load more"; absent → the list is complete. */
  initialTotal?: number;
  /** Page size (default 20). */
  pageSize?: number;
  /** "upcoming" (default) lists UPCOMING/STARTED; "past" ENDED; "all" both. A past event is never registerable. */
  status?: StatusFilter;
}

/** Everything a listing surface renders from. Read it with getState() or through a subscription. */
export interface EventsState {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  events: EventSummary[] | null;
  /** Manual categories — render a filter bar only when > 1. */
  categories: EventCategory[];
  activeCategoryId: string | null;
  /** More pages exist for the current filter — render a "load more" control on this. */
  hasMore: boolean;
  /** A page (or a refetch for a category) is loading; the current `events` stay rendered. */
  loadingMore: boolean;
  error: string | null;
}

export interface EventsStore {
  getState(): EventsState;
  subscribe(listener: () => void): () => void;
  /** Fetch the first page when no `initialEvents` were given, and the categories. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop a late response. */
  stop(): void;
  /** Filter to one category (null = all). Client-side while everything is loaded, else a server-side refetch. */
  setActiveCategoryId(id: string | null): void;
  /** Append the next page for the current filter. No-op while loading or when `hasMore` is false. */
  loadMore(): Promise<void>;
}

export function createEventsStore({ initialEvents, initialTotal, pageSize = DEFAULT_PAGE_SIZE, status }: EventsStoreOptions = {}): EventsStore {
  // `all` is the unfiltered list; `filtered` is the server-filtered list for the active category (null = not in use).
  let all: EventSummary[] | null = initialEvents ?? null;
  let allTotal: number = initialTotal ?? initialEvents?.length ?? 0;
  let filtered: EventSummary[] | null = null;
  let filteredTotal = 0;
  let fetchedCategories: EventCategory[] | null = null;
  let activeCategoryId: string | null = null;
  let loadingMore = false;
  let error: string | null = null;
  let started = false;
  let generation = 0; // bumps on every filter change so a late page for an old filter is dropped
  const listeners = new Set<() => void>();
  let snapshot: EventsState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  const allLoaded = () => all !== null && all.length >= allTotal;
  const serverFiltering = () => activeCategoryId !== null && !allLoaded();

  function derivedCategories(): EventCategory[] {
    const seen = new Map<string, string>();
    for (const e of all ?? []) for (const c of e.categories) if (!seen.has(c.id)) seen.set(c.id, c.name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }

  function getState(): EventsState {
    if (snapshot) return snapshot;
    const events = serverFiltering()
      ? filtered
      : all === null
        ? null
        : activeCategoryId
          ? all.filter((e) => e.categories.some((c) => c.id === activeCategoryId))
          : all;
    // Never before the first page is in: a "load more" under skeletons would be a lie.
    const hasMore = serverFiltering() ? filtered !== null && filtered.length < filteredTotal : activeCategoryId === null && all !== null && !allLoaded();
    snapshot = {
      events,
      categories: fetchedCategories ?? derivedCategories(),
      activeCategoryId,
      hasMore,
      loadingMore,
      error,
    };
    return snapshot;
  }

  async function loadPage(categoryId: string | null, offset: number): Promise<void> {
    const gen = generation;
    loadingMore = true;
    error = null;
    emit();
    try {
      const page = await fetchEventsPage({ limit: pageSize, offset, categoryId: categoryId ?? undefined, status });
      if (!started || gen !== generation) return;
      if (categoryId === null) {
        all = offset === 0 ? page.events : [...(all ?? []), ...page.events];
        allTotal = page.total;
      } else {
        filtered = offset === 0 ? page.events : [...(filtered ?? []), ...page.events];
        filteredTotal = page.total;
      }
    } catch (e) {
      if (!started || gen !== generation) return;
      if (categoryId === null && all === null) all = [];
      if (categoryId !== null && filtered === null) filtered = [];
      error = message(e);
    } finally {
      if (started && gen === generation) {
        loadingMore = false;
        emit();
      }
    }
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
      // The visitor-scope category read — a refusal is not an error state, the pills derive from the events instead.
      fetchCategories()
        .then((list) => {
          if (!started) return;
          fetchedCategories = list;
          emit();
        })
        .catch(() => {});
      if (!initialEvents) void loadPage(null, 0);
    },
    stop() {
      started = false;
    },
    setActiveCategoryId(id) {
      if (id === activeCategoryId) return;
      activeCategoryId = id;
      generation++;
      filtered = null;
      filteredTotal = 0;
      loadingMore = false;
      emit();
      if (serverFiltering()) void loadPage(id, 0);
    },
    async loadMore() {
      if (loadingMore || !getState().hasMore) return;
      if (serverFiltering()) await loadPage(activeCategoryId, (filtered ?? []).length);
      else await loadPage(null, (all ?? []).length);
    },
  };
}
