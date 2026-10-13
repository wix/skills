// One item as a framework-free store — the logic behind useItem: by `_id` or by a field match
// (slug routing), usable from React (useItem wraps it), from a static page's item view, from
// Vue/Svelte, or as the specification for a port.
//
// SSR-friendly: pass the server-fetched item as `initialItem` and start() fetches nothing.
// One store per item surface: createItemStore(), not a singleton.
import { getItemBy, getItemById } from "./items";
import type { CmsItem } from "./types";

/** Exactly one of `id` / `by`. */
export interface ItemRef {
  id?: string;
  by?: { field: string; value: string | number };
}

export interface ItemStoreOptions {
  collectionId: string;
  ref: ItemRef;
  initialItem?: CmsItem;
  /** Reference field keys to inline as full items. */
  include?: string[];
}

export interface ItemState {
  /** null while loading OR when not found — branch on notFound for the miss state. */
  item: CmsItem | null;
  notFound: boolean;
  error: string | null;
  /** True until the fetch settles (false at once with an initialItem). */
  loading: boolean;
}

export interface ItemStore {
  getState(): ItemState;
  subscribe(listener: () => void): () => void;
  /** Fetch by ref when no `initialItem` was given. Call once when mounted. */
  start(): void;
  stop(): void;
  /** Fetch again (after an error, or when the item may have changed). */
  retry(): void;
}

export function createItemStore({ collectionId, ref, initialItem, include }: ItemStoreOptions): ItemStore {
  let item: CmsItem | null = initialItem ?? null;
  let notFound = false;
  let error: string | null = null;
  let loading = !initialItem;
  let started = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  let snapshot: ItemState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  function getState(): ItemState {
    if (snapshot) return snapshot;
    snapshot = { item, notFound, error, loading };
    return snapshot;
  }

  function load(): void {
    const id = ++generation;
    loading = true; error = null; emit();
    const fetching = ref.id
      ? getItemById(collectionId, ref.id, { include })
      : ref.by
        ? getItemBy(collectionId, ref.by.field, ref.by.value, { include })
        : Promise.reject(new Error("useItem: pass ref.id or ref.by"));
    fetching
      .then((found) => {
        if (generation !== id || !started) return;
        item = found; notFound = found === null; loading = false;
        emit();
      })
      .catch((e) => {
        if (generation !== id || !started) return;
        error = e instanceof Error ? e.message : String(e); loading = false;
        emit();
      });
  }

  return {
    getState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      if (initialItem) return;
      load();
    },
    stop() { started = false; generation++; },
    retry() { if (started) load(); },
  };
}
