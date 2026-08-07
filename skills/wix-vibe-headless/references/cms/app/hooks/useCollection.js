// useCollection — all list-page data logic, no markup: count for the empty state, load the first
// page (with the configured sort + optional filter), and paginate by cursor. The wiring here is the
// load-bearing part — queryDataItems resolves to { items, nextCursor }, cursor follow-ups reuse the
// first request's filter/sort (pass ONLY the cursor) — keep it verbatim; the page just renders what
// this returns.
import { useState, useEffect, useCallback } from "react";
import { queryDataItems, countDataItems } from "@/rest/wix-cms";
import { COLLECTION_ID, SORT } from "@/collection.config";

export function useCollection({ filter, limit = 24 } = {}) {
  const [items, setItems] = useState(null);   // null = loading, [] = empty
  const [cursor, setCursor] = useState(null);
  const [total, setTotal] = useState(null);

  useEffect(() => {
    countDataItems(COLLECTION_ID).then(setTotal);
    queryDataItems(COLLECTION_ID, {
      ...(SORT ? { sort: SORT } : {}),
      ...(filter ? { filter } : {}),
      limit,
    }).then(({ items, nextCursor }) => { setItems(items); setCursor(nextCursor); });
  }, [limit]);   // filter changes are rare; re-mount the page to refetch

  const loadMore = useCallback(() => {
    if (!cursor) return;
    // cursor follow-ups reuse the first request's filter/sort — pass ONLY the cursor
    queryDataItems(COLLECTION_ID, { cursor, limit }).then(({ items: more, nextCursor }) => {
      setItems((prev) => [...(prev || []), ...more]);
      setCursor(nextCursor);
    });
  }, [cursor, limit]);

  return { items, total, loadMore, hasMore: Boolean(cursor) };
}
