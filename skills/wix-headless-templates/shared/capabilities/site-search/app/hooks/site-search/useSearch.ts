// React binding of the search store (wix/site-search/search-store.ts) — the results state machine
// lives there, framework-free; this hook subscribes to one instance per mounted results surface.
// SSR-friendly: pass the server's `initialGroups`/`initialIndexed` (grouped) or `initialPage`
// (single-type) from the SAME q/type and no client fetch happens for the first render. Astro islands
// and React SPAs use this; a static page, Vue, or Svelte uses the store directly.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createSearchStore, type SearchState, type SearchStore, type SearchStoreOptions } from "../../wix/site-search/search-store";

export type UseSearchOptions = SearchStoreOptions;

export type UseSearch = SearchState & Pick<SearchStore, "setQuery" | "setType" | "setSort" | "setFilter" | "loadMore" | "retry">;

export function useSearch(options: UseSearchOptions = {}): UseSearch {
  const ref = useRef<SearchStore | null>(null);
  if (!ref.current) ref.current = createSearchStore(options);
  const store = ref.current;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    ...state,
    setQuery: store.setQuery,
    setType: store.setType,
    setSort: store.setSort,
    setFilter: store.setFilter,
    loadMore: store.loadMore,
    retry: store.retry,
  };
}
