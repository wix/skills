// One collection as list state. SSR-friendly: pass server-fetched items as `initialItems`
// (Astro frontmatter / server component) and no client fetch happens for the first page; a
// SPA passes nothing. Changing filters/sort (by value) refetches; loadMore() appends the
// next page (skip paging).
import { useCallback, useEffect, useRef, useState } from "react";
import { queryItems } from "../../wix/cms/items";
import type { CmsFilter, CmsItem, CmsSort } from "../../wix/cms/types";

export interface UseCollectionOptions {
  filters?: CmsFilter[];
  sort?: CmsSort[];
  /** Page size (default 20). */
  limit?: number;
  /** Reference field keys to inline as full items. */
  include?: string[];
  /** Server-fetched first page — must come from the SAME query (filters/sort/limit/include). */
  initialItems?: CmsItem[];
  /** The server fetch's hasNext. Omitted → inferred (a full first page ⇒ assume more). */
  initialHasNext?: boolean;
}

export interface UseCollection {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  items: CmsItem[] | null;
  hasNext: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  error: string | null;
}

export function useCollection(collectionId: string, options: UseCollectionOptions = {}): UseCollection {
  const { filters, sort, limit = 20, include, initialItems, initialHasNext } = options;
  // Query identity by value — Dates in filters serialize to ISO, so this is stable.
  const key = JSON.stringify([collectionId, filters ?? null, sort ?? null, limit, include ?? null]);
  const initialKey = useRef<string | null>(initialItems ? key : null);
  const [items, setItems] = useState<CmsItem[] | null>(initialItems ?? null);
  const [hasNext, setHasNext] = useState<boolean>(
    initialHasNext ?? (initialItems ? initialItems.length >= limit : false),
  );
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef<CmsItem[] | null>(items);
  itemsRef.current = items;

  useEffect(() => {
    if (initialKey.current === key) return; // the SSR pass already answered this exact query
    initialKey.current = null;
    let alive = true;
    setItems(null);
    setError(null);
    queryItems(collectionId, { filters, sort, limit, include })
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setHasNext(page.hasNext);
      })
      .catch((e) => {
        if (!alive) return;
        setItems([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadMore = useCallback(() => {
    const current = itemsRef.current;
    if (!current || loadingMore) return;
    setLoadingMore(true);
    queryItems(collectionId, { filters, sort, limit, include, skip: current.length })
      .then((page) => {
        setItems([...(itemsRef.current ?? []), ...page.items]);
        setHasNext(page.hasNext);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoadingMore(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadingMore]);

  return { items, hasNext, loadMore, loadingMore, error };
}
