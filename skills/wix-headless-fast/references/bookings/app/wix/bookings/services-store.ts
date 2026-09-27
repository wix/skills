// The services listing as a framework-free store — the logic behind useServices, usable from React
// (useServices wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and
// render), or as the specification for a port. State, actions, subscribe/getState, emit after every
// change. SSR-friendly: seed with `initialServices`/`initialCategories` and nothing is fetched;
// without them `start()` loads both. Category filtering is client-side — bookings catalogs are
// small and fully fetched. One store per mounted listing: createServicesStore(), not a singleton.
import { fetchBookingCategories, fetchServices } from "./services";
import type { BookingCategory, ServiceSummary } from "./types";

export interface ServicesStoreOptions {
  initialServices?: ServiceSummary[];
  initialCategories?: BookingCategory[];
}

/** Everything a listing surface renders from. Read it with getState() or through a subscription. */
export interface ServicesState {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  services: ServiceSummary[] | null;
  categories: BookingCategory[];
  activeCategoryId: string | null;
  error: string | null;
}

export interface ServicesStore {
  getState(): ServicesState;
  subscribe(listener: () => void): () => void;
  /** Fetch whatever wasn't seeded. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
  setActiveCategoryId(id: string | null): void;
}

export function createServicesStore({ initialServices, initialCategories }: ServicesStoreOptions = {}): ServicesStore {
  let all: ServiceSummary[] | null = initialServices ?? null;
  let categories: BookingCategory[] = initialCategories ?? [];
  let activeCategoryId: string | null = null;
  let error: string | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  let snapshot: ServicesState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  function getState(): ServicesState {
    if (snapshot) return snapshot;
    snapshot = {
      services: all === null ? null : activeCategoryId ? all.filter((s) => s.categoryId === activeCategoryId) : all,
      categories,
      activeCategoryId,
      error,
    };
    return snapshot;
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
      if (!initialServices) {
        fetchServices()
          .then((s) => { if (started) { all = s; emit(); } })
          .catch((e) => {
            if (!started) return;
            all = [];
            error = e instanceof Error ? e.message : String(e);
            emit();
          });
      }
      if (!initialCategories) {
        fetchBookingCategories().then((c) => { if (started) { categories = c; emit(); } });
      }
    },
    stop() {
      started = false;
    },
    setActiveCategoryId(id) {
      if (id === activeCategoryId) return;
      activeCategoryId = id;
      emit();
    },
  };
}
