// The services listing as a framework-free store — the logic behind useServices, usable from React
// (useServices wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and
// render), or as the specification for a port. State, actions, subscribe/getState, emit after every
// change. Category and location filters are applied by Wix (a fresh first page per selection, as its
// own service list does), pages are 20 long with `hasMore`/`loadMore()`, and the selection lives in
// the URL (`?category=`, `?location=`) so a filtered list is a link. After every page ONE batched
// calendar call fills `offeredDays` on the classes and courses of that page.
// SSR-friendly: seed with `initialServices` (+ `initialHasMore`, `initialCategories`, `initialLocations`)
// and nothing is fetched for the first paint; without them `start()` loads everything.
// One store per mounted listing: createServicesStore(), not a singleton.
import { fetchOfferedDays } from "./booking";
import { OTHER_LOCATIONS_ID, SERVICES_PAGE_SIZE, fetchBookingCategories, fetchLocations, fetchServices } from "./services";
import type { BookingCategory, LocationOption, ServiceSummary } from "./types";

export { OTHER_LOCATIONS_ID };

const CATEGORY_PARAM = "category";
const LOCATION_PARAM = "location";

export interface ServicesStoreOptions {
  initialServices?: ServiceSummary[];
  /** Whether a page follows the seeded one (the page's `hasMore`); false when omitted. */
  initialHasMore?: boolean;
  initialCategories?: BookingCategory[];
  initialLocations?: { locations: LocationOption[]; hasOtherLocations: boolean };
  /** The selection the seeded services were fetched with (the page read it from the URL). */
  initialCategoryId?: string | null;
  initialLocationId?: string | null;
  pageSize?: number;
  /** Read the selection from `?category=`/`?location=` on start and write it back on change (default true). */
  syncUrl?: boolean;
}

/** Everything a listing surface renders from. Read it with getState() or through a subscription. */
export interface ServicesState {
  /** null while the first page (of the current selection) is in flight — render skeletons, not an empty state. */
  services: ServiceSummary[] | null;
  categories: BookingCategory[];
  /** Business locations hosting a bookable service; show a location filter only when there is more than one option. */
  locations: LocationOption[];
  /** Some services are held at custom/customer locations — offer OTHER_LOCATIONS_ID as an extra option. */
  hasOtherLocations: boolean;
  activeCategoryId: string | null;
  /** A business location id, OTHER_LOCATIONS_ID, or null for all. */
  activeLocationId: string | null;
  /** Another page exists — render a "load more" affordance. */
  hasMore: boolean;
  loadingMore: boolean;
  error: string | null;
}

export interface ServicesStore {
  getState(): ServicesState;
  subscribe(listener: () => void): () => void;
  /** Fetch whatever wasn't seeded (and the offered days of the seeded page). Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
  setActiveCategoryId(id: string | null): void;
  setActiveLocationId(id: string | null): void;
  /** Append the next page. No-op while a page is loading or when none is left. */
  loadMore(): Promise<void>;
}

const readParam = (name: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return new URL(window.location.href).searchParams.get(name) || null;
  } catch {
    return null;
  }
};

const writeParams = (values: Record<string, string | null>): void => {
  if (typeof window === "undefined" || typeof history === "undefined") return;
  try {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(values)) v ? url.searchParams.set(k, v) : url.searchParams.delete(k);
    history.replaceState(history.state, "", url.toString());
  } catch {
    /* an unusual URL — the selection still applies, it just isn't shareable */
  }
};

export function createServicesStore({
  initialServices,
  initialHasMore = false,
  initialCategories,
  initialLocations,
  initialCategoryId = null,
  initialLocationId = null,
  pageSize = SERVICES_PAGE_SIZE,
  syncUrl = true,
}: ServicesStoreOptions = {}): ServicesStore {
  let services: ServiceSummary[] | null = initialServices ?? null;
  let categories: BookingCategory[] = initialCategories ?? [];
  let locations: LocationOption[] = initialLocations?.locations ?? [];
  let hasOtherLocations = initialLocations?.hasOtherLocations ?? false;
  let activeCategoryId: string | null = initialCategoryId;
  let activeLocationId: string | null = initialLocationId;
  let hasMore = initialHasMore;
  let loadingMore = false;
  let error: string | null = null;
  let started = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  let snapshot: ServicesState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  function getState(): ServicesState {
    if (snapshot) return snapshot;
    snapshot = { services, categories, locations, hasOtherLocations, activeCategoryId, activeLocationId, hasMore, loadingMore, error };
    return snapshot;
  }

  // One batched MASTER-events call per page: the weekdays every class/course on it meets (appointments have none).
  function fillOfferedDays(items: ServiceSummary[], id: number): void {
    const scheduleIds = [...new Set(items.filter((s) => s.type !== "APPOINTMENT").map((s) => s.scheduleId).filter((x): x is string => !!x))];
    if (!scheduleIds.length) return;
    fetchOfferedDays(scheduleIds).then((days) => {
      if (!started || generation !== id || !services) return;
      services = services.map((s) => (s.scheduleId && days[s.scheduleId] ? { ...s, offeredDays: days[s.scheduleId] } : s));
      emit();
    });
  }

  // The selection changed: a fresh first page from Wix (the filter is applied there, never to a page in hand).
  function loadFirstPage(): void {
    if (!started) return;
    const id = ++generation;
    services = null;
    hasMore = false;
    loadingMore = false; // an in-flight loadMore belongs to the old selection
    error = null;
    emit();
    fetchServices({ limit: pageSize, offset: 0, categoryId: activeCategoryId, locationId: activeLocationId })
      .then((page) => {
        if (!started || generation !== id) return; // superseded — drop it
        services = page.items;
        hasMore = page.hasMore;
        emit();
        fillOfferedDays(page.items, id);
      })
      .catch((e) => {
        if (!started || generation !== id) return;
        services = [];
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
      // The URL is the source of truth for the selection; a seeded page fetched with a different one is stale.
      const urlCategory = syncUrl ? readParam(CATEGORY_PARAM) : null;
      const urlLocation = syncUrl ? readParam(LOCATION_PARAM) : null;
      const selectionChanged = syncUrl && ((urlCategory ?? null) !== activeCategoryId || (urlLocation ?? null) !== activeLocationId);
      if (selectionChanged) {
        activeCategoryId = urlCategory;
        activeLocationId = urlLocation;
      }
      if (!initialServices || selectionChanged) loadFirstPage();
      else fillOfferedDays(initialServices, generation);
      if (!initialCategories) fetchBookingCategories().then((c) => { if (started) { categories = c; emit(); } });
      if (!initialLocations) fetchLocations().then((l) => { if (started) { locations = l.locations; hasOtherLocations = l.hasOtherLocations; emit(); } });
    },
    stop() {
      started = false;
      generation++;
    },
    setActiveCategoryId(id) {
      if (id === activeCategoryId) return;
      activeCategoryId = id;
      if (syncUrl) writeParams({ [CATEGORY_PARAM]: id });
      loadFirstPage();
    },
    setActiveLocationId(id) {
      if (id === activeLocationId) return;
      activeLocationId = id;
      if (syncUrl) writeParams({ [LOCATION_PARAM]: id });
      loadFirstPage();
    },
    async loadMore() {
      if (!started || loadingMore || !hasMore || !services) return;
      const id = generation;
      loadingMore = true;
      emit();
      try {
        const page = await fetchServices({ limit: pageSize, offset: services.length, categoryId: activeCategoryId, locationId: activeLocationId });
        if (!started || generation !== id) return;
        services = [...services, ...page.items];
        hasMore = page.hasMore;
        fillOfferedDays(page.items, id);
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
