// One item — by `_id` or by a field match (slug routing). SSR-friendly: pass the
// server-fetched item as `initialItem` and no client fetch happens; a SPA passes nothing.
import { useEffect, useState } from "react";
import { getItemBy, getItemById } from "../../wix/cms/items";
import type { CmsItem } from "../../wix/cms/types";

/** Exactly one of `id` / `by`. */
export interface UseItemRef {
  id?: string;
  by?: { field: string; value: string | number };
}

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
  const [item, setItem] = useState<CmsItem | null>(initialItem ?? null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialItem) return;
    let alive = true;
    const fetching = ref.id
      ? getItemById(collectionId, ref.id, { include })
      : ref.by
        ? getItemBy(collectionId, ref.by.field, ref.by.value, { include })
        : Promise.reject(new Error("useItem: pass ref.id or ref.by"));
    fetching
      .then((found) => {
        if (!alive) return;
        setItem(found);
        setNotFound(found === null);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, ref.id, ref.by?.field, ref.by?.value]);

  return { item, notFound, error };
}
