// React binding of the events store (wix/events/events-store.ts) — the listing state machine
// lives there, framework-free; this hook subscribes to one instance per mounted listing and
// exposes its state and actions under one name. SSR-friendly: pass server-fetched data as
// `initialEvents` (Astro frontmatter / server component) and no client fetch happens; a SPA
// passes nothing. Astro islands and React SPAs use this; a static page, Vue, or Svelte uses the
// store directly.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createEventsStore, type EventsState, type EventsStore, type EventsStoreOptions } from "../../wix/events/events-store";

export type UseEventsOptions = EventsStoreOptions;

export type UseEvents = EventsState & Pick<EventsStore, "setActiveCategoryId">;

export function useEvents(options: UseEventsOptions = {}): UseEvents {
  const ref = useRef<EventsStore | null>(null);
  if (!ref.current) ref.current = createEventsStore(options);
  const store = ref.current;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { ...state, setActiveCategoryId: store.setActiveCategoryId };
}
