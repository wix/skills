// The collections gallery as a framework-free store — the logic behind useCollections, usable
// from React (useCollections wraps it with useSyncExternalStore), from a static page or
// Vue/Svelte (subscribe and render), or as the specification for a port. State, subscribe/getState,
// start()/stop(), emit after every change.
//
// SSR-friendly: seed with `initialCollections` and nothing is fetched; without a seed `start()`
// fetches once. One store per mounted gallery: createCollectionsStore(), not a singleton.
import { fetchCollections } from "./portfolio";
import type { CollectionSummary } from "./types";

export interface CollectionsStoreOptions {
  initialCollections?: CollectionSummary[];
}

export interface CollectionsState {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  collections: CollectionSummary[] | null;
  error: string | null;
}

export interface CollectionsStore {
  getState(): CollectionsState;
  subscribe(listener: () => void): () => void;
  /** Fetch when no seed was given. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop a late response. */
  stop(): void;
}

export function createCollectionsStore({ initialCollections }: CollectionsStoreOptions = {}): CollectionsStore {
  let collections: CollectionSummary[] | null = initialCollections ?? null;
  let error: string | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  let snapshot: CollectionsState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  return {
    getState() {
      return (snapshot ??= { collections, error });
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      if (initialCollections) return;
      fetchCollections()
        .then((c) => { if (started) { collections = c; emit(); } })
        .catch((e) => {
          if (!started) return;
          collections = [];
          error = e instanceof Error ? e.message : String(e);
          emit();
        });
    },
    stop() { started = false; },
  };
}
