// React binding of the plans store (wix/pricing-plans/plans-store.ts) — the listing logic lives
// there, framework-free; this hook subscribes to one instance per mounted listing. SSR-friendly:
// pass server-fetched data as `initialPlans` (Astro frontmatter / server component) and no client
// fetch happens; a SPA passes nothing. Astro islands and React SPAs use this; a static page, Vue,
// or Svelte uses the store directly.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPlansStore, type PlansState, type PlansStore, type PlansStoreOptions } from "../../wix/pricing-plans/plans-store";

export type UsePlansOptions = PlansStoreOptions;

export type UsePlans = PlansState;

export function usePlans(options: UsePlansOptions = {}): UsePlans {
  const ref = useRef<PlansStore | null>(null);
  if (!ref.current) ref.current = createPlansStore(options);
  const store = ref.current;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
