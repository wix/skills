// React binding of the services store (wix/bookings/services-store.ts) — the listing state lives
// there, framework-free; this hook subscribes to one instance per mounted listing and exposes its
// state and actions under one name. SSR-friendly: pass server-fetched data as `initial*` (Astro
// frontmatter / server component) and no client fetch happens; a SPA passes nothing. Astro islands
// and React SPAs use this; a static page, Vue, or Svelte uses the store directly.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createServicesStore, type ServicesState, type ServicesStore, type ServicesStoreOptions } from "../../wix/bookings/services-store";

export type UseServicesOptions = ServicesStoreOptions;

export type UseServices = ServicesState & Pick<ServicesStore, "setActiveCategoryId">;

export function useServices(options: UseServicesOptions = {}): UseServices {
  const ref = useRef<ServicesStore | null>(null);
  if (!ref.current) ref.current = createServicesStore(options);
  const store = ref.current;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { ...state, setActiveCategoryId: store.setActiveCategoryId };
}
