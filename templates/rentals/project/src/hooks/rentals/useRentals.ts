// React binding of the rentals store (wix/rentals/rentals-store.ts) — the listing state lives
// there, framework-free; this hook subscribes to one instance per mounted listing and exposes its
// state and actions under one name. SSR-friendly: pass server-fetched data as `initial*` (Astro
// frontmatter / server component) and no client fetch happens for the first paint; a SPA passes
// nothing. Astro islands and React SPAs use this; a static page, Vue, or Svelte uses the store directly.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createRentalsStore, type RentalsState, type RentalsStore, type RentalsStoreOptions } from "../../wix/rentals/rentals-store";

export type UseRentalsOptions = RentalsStoreOptions;

export type UseRentals = RentalsState & Pick<RentalsStore, "loadMore">;

export function useRentals(options: UseRentalsOptions = {}): UseRentals {
  const ref = useRef<RentalsStore | null>(null);
  if (!ref.current) ref.current = createRentalsStore(options);
  const store = ref.current;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { ...state, loadMore: store.loadMore };
}
