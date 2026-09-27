// React binding of the item store (wix/cms/item-store.ts) — one item by `_id` or by a field match
// (slug routing), the loader lives there, framework-free. SSR-friendly: pass the server-fetched
// item as `initialItem` and no client fetch happens; a SPA passes nothing.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createItemStore, type ItemRef, type ItemStore } from "../../wix/cms/item-store";
import type { CmsItem } from "../../wix/cms/types";

/** Exactly one of `id` / `by`. */
export type UseItemRef = ItemRef;

export interface UseItemOptions {
  initialItem?: CmsItem;
  /** Reference field keys to inline as full items. */
  include?: string[];
}

export interface UseItem {
  /** null while loading OR when not found — branch on notFound for the miss state. */
  item: CmsItem | null;
  notFound: boolean;
  error: string | null;
}

export function useItem(collectionId: string, ref: UseItemRef, options: UseItemOptions = {}): UseItem {
  const { initialItem, include } = options;
  // A new ref (another id or slug) is another item — a fresh store, as useProductDetail does per slug.
  const key = JSON.stringify([collectionId, ref.id ?? null, ref.by?.field ?? null, ref.by?.value ?? null]);
  const holder = useRef<{ key: string; store: ItemStore } | null>(null);
  if (!holder.current || holder.current.key !== key) holder.current = { key, store: createItemStore({ collectionId, ref, initialItem, include }) };
  const store = holder.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { item: state.item, notFound: state.notFound, error: state.error };
}
