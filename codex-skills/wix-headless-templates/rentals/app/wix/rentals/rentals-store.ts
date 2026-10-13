// The rentals listing as a framework-free store — the logic behind useRentals, usable from React
// (useRentals wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and
// render), or as the specification for a port. Pages are 20 long with `hasMore`/`loadMore()`.
// SSR-friendly: seed with `initialRentals` (+ `initialHasMore`) and nothing is fetched for the first
// paint; without them `start()` loads the first page. One store per mounted listing.
import { RENTALS_PAGE_SIZE, fetchRentals } from "./rentals";
import type { RentalSummary } from "./types";

export interface RentalsStoreOptions {
  initialRentals?: RentalSummary[];
  /** Whether a page follows the seeded one (the page's `hasMore`); false when omitted. */
  initialHasMore?: boolean;
  pageSize?: number;
}

/** Everything a listing surface renders from. Read it with getState() or through a subscription. */
export interface RentalsState {
  /** null while the first page is in flight — render skeletons, not an empty state. */
  rentals: RentalSummary[] | null;
  /** Another page exists — render a "load more" affordance. */
  hasMore: boolean;
  loadingMore: boolean;
  error: string | null;
}

export interface RentalsStore {
  getState(): RentalsState;
  subscribe(listener: () => void): () => void;
  /** Fetch the first page unless it was seeded. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
  /** Append the next page. No-op while a page is loading or when none is left. */
  loadMore(): Promise<void>;
}

export function createRentalsStore({ initialRentals, initialHasMore = false, pageSize = RENTALS_PAGE_SIZE }: RentalsStoreOptions = {}): RentalsStore {
  let rentals: RentalSummary[] | null = initialRentals ?? null;
  let hasMore = initialHasMore;
  let loadingMore = false;
  let error: string | null = null;
  let started = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  let snapshot: RentalsState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  function getState(): RentalsState {
    if (snapshot) return snapshot;
    snapshot = { rentals, hasMore, loadingMore, error };
    return snapshot;
  }

  function loadFirstPage(): void {
    const id = ++generation;
    rentals = null;
    hasMore = false;
    error = null;
    emit();
    fetchRentals({ limit: pageSize, offset: 0 })
      .then((page) => {
        if (!started || generation !== id) return; // superseded — drop it
        rentals = page.items;
        hasMore = page.hasMore;
        emit();
      })
      .catch((e) => {
        if (!started || generation !== id) return;
        rentals = [];
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
      if (!initialRentals) loadFirstPage();
    },
    stop() {
      started = false;
      generation++;
    },
    async loadMore() {
      if (!started || loadingMore || !hasMore || !rentals) return;
      const id = generation;
      loadingMore = true;
      emit();
      try {
        const page = await fetchRentals({ limit: pageSize, offset: rentals.length });
        if (!started || generation !== id) return;
        rentals = [...rentals, ...page.items];
        hasMore = page.hasMore;
      } catch (e) {
        if (!started || generation !== id) return;
        error = e instanceof Error ? e.message : String(e);
      } finally {
        if (generation === id) loadingMore = false;
        emit();
      }
    },
  };
}
