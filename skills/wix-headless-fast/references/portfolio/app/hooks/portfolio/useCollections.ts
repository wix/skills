// React binding of the collections store (wix/portfolio/collections-store.ts) — the gallery's
// load state lives there, framework-free; this hook subscribes to one instance per mounted
// gallery. SSR-friendly: pass server-fetched data as `initialCollections` and no client fetch
// happens; a SPA passes nothing. A static page, Vue, or Svelte uses the store directly.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createCollectionsStore, type CollectionsState, type CollectionsStore, type CollectionsStoreOptions } from "../../wix/portfolio/collections-store";

export type UseCollectionsOptions = CollectionsStoreOptions;

export type UseCollections = CollectionsState;

export function useCollections(options: UseCollectionsOptions = {}): UseCollections {
  const ref = useRef<CollectionsStore | null>(null);
  if (!ref.current) ref.current = createCollectionsStore(options);
  const store = ref.current;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
