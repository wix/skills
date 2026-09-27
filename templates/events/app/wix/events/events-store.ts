// The events listing as a framework-free store — the logic behind useEvents, usable from React
// (useEvents wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and
// render), or as the specification for a port. State, actions, subscribe/getState, emit after
// every change.
//
// SSR-friendly: seed with `initialEvents` and they render at once with no client fetch; a SPA
// passes nothing and `start()` fetches. The category menu is DERIVED from the loaded events (the
// categories management API is admin-scope — visitors can't query it); filtering is client-side
// over the live list, which is small by definition (only UPCOMING/STARTED events are listed).
//
// One store per mounted listing (a page can hold the index and a "next up" rail):
// createEventsStore(), not a singleton.
import { fetchEvents } from "./events";
import type { EventSummary } from "./types";

export interface EventsStoreOptions {
  initialEvents?: EventSummary[];
}

/** Everything a listing surface renders from. Read it with getState() or through a subscription. */
export interface EventsState {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  events: EventSummary[] | null;
  /** Unique assigned categories in listing order — render a filter bar only when > 1. */
  categories: { id: string; name: string }[];
  activeCategoryId: string | null;
  error: string | null;
}

export interface EventsStore {
  getState(): EventsState;
  subscribe(listener: () => void): () => void;
  /** Fetch when no `initialEvents` were given. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop a late response. */
  stop(): void;
  setActiveCategoryId(id: string | null): void;
}

export function createEventsStore({ initialEvents }: EventsStoreOptions = {}): EventsStore {
  let all: EventSummary[] | null = initialEvents ?? null;
  let activeCategoryId: string | null = null;
  let error: string | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  let snapshot: EventsState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  function getState(): EventsState {
    if (snapshot) return snapshot;
    const seen = new Map<string, string>();
    for (const e of all ?? []) for (const c of e.categories) if (!seen.has(c.id)) seen.set(c.id, c.name);
    snapshot = {
      events: all === null ? null : activeCategoryId ? all.filter((e) => e.categories.some((c) => c.id === activeCategoryId)) : all,
      categories: [...seen.entries()].map(([id, name]) => ({ id, name })),
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
      if (initialEvents) return;
      fetchEvents()
        .then((list) => {
          if (!started) return;
          all = list;
          emit();
        })
        .catch((e) => {
          if (!started) return;
          all = [];
          error = e instanceof Error ? e.message : String(e);
          emit();
        });
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
