// React binding of the collection-projects store (wix/portfolio/collection-projects-store.ts) —
// slug → collection header + its projects lives there, framework-free; this hook subscribes to
// one instance per (slug, mount) and recreates it when the slug changes. SSR-friendly: pass both
// `initial*` and no client fetch happens. `notFound` is the real not-found signal (collection
// stays null while loading too) — route a 404 off it, never off a transient null.
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  createCollectionProjectsStore,
  type CollectionProjectsState,
  type CollectionProjectsStore,
  type CollectionProjectsStoreOptions,
} from "../../wix/portfolio/collection-projects-store";

export type UseCollectionProjectsOptions = CollectionProjectsStoreOptions;

export type UseCollectionProjects = CollectionProjectsState;

export function useCollectionProjects(
  slug: string,
  { initialCollection, initialProjects }: UseCollectionProjectsOptions = {},
): UseCollectionProjects {
  const ref = useRef<{ slug: string; store: CollectionProjectsStore } | null>(null);
  if (!ref.current || ref.current.slug !== slug) {
    ref.current = { slug, store: createCollectionProjectsStore(slug, { initialCollection, initialProjects }) };
  }
  const store = ref.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
