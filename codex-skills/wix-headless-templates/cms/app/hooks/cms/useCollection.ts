// React binding of the collection store (wix/cms/collection-store.ts) — the list state machine
// lives there, framework-free; this hook subscribes to one instance per mounted listing. SSR-friendly:
// pass server-fetched items as `initialItems` (Astro frontmatter / server component) and no client
// fetch happens for the first page; a SPA passes nothing. Changing filters/sort (by value) refetches
// behind the items on screen (`fetching`); loadMore() appends the next page, goToPage(n) replaces
// it, refresh() re-reads after a write. Astro islands and React SPAs use this; a static page, Vue,
// or Svelte uses the store directly.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createCollectionStore, type CollectionStore } from "../../wix/cms/collection-store";
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
  /** true → every query asks for the total; `total`/`pageCount` fill in (a numbered pager). */
  withTotal?: boolean;
  /** The server fetch's total (it queried withTotal). */
  initialTotal?: number | null;
}

export interface UseCollection {
  /** null while the FIRST load is in flight — render skeletons, not an empty state. Never null again after. */
  items: CmsItem[] | null;
  hasNext: boolean;
  /** A page before the one shown exists. */
  hasPrev: boolean;
  /** 0-based index of the first page on screen. */
  page: number;
  /** Matching items across the collection — only with `withTotal`, else null. */
  total: number | null;
  /** ceil(total / limit) — only with `withTotal`, else null. */
  pageCount: number | null;
  /** A new query, page, or refresh runs behind the items on screen — dim them, keep them. */
  fetching: boolean;
  loadMore: () => void;
  loadingMore: boolean;
  /** Replace the list with page n (0-based). */
  goToPage: (n: number) => void;
  /** Re-read what is on screen — after insertItem / patchItemFields / linkItems. */
  refresh: () => void;
  error: string | null;
}

export function useCollection(collectionId: string, options: UseCollectionOptions = {}): UseCollection {
  const { filters, sort, limit = 20, include, initialItems, initialHasNext, withTotal, initialTotal } = options;
  const ref = useRef<CollectionStore | null>(null);
  if (!ref.current) ref.current = createCollectionStore({ collectionId, filters, sort, limit, include, initialItems, initialHasNext, withTotal, initialTotal });
  const store = ref.current;
  // Query identity by value — Dates in filters serialize to ISO, so this is stable.
  const key = JSON.stringify([collectionId, filters ?? null, sort ?? null, limit, include ?? null]);
  useEffect(() => {
    store.setQuery({ collectionId, filters, sort, limit, include });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key]);
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    items: state.items,
    hasNext: state.hasNext,
    hasPrev: state.hasPrev,
    page: state.page,
    total: state.total,
    pageCount: state.pageCount,
    fetching: state.fetching,
    loadMore: store.loadMore,
    loadingMore: state.loadingMore,
    goToPage: store.goToPage,
    refresh: store.refresh,
    error: state.error,
  };
}
