// usePortfolioGallery — collections-gallery data, no markup: first page + count for the empty
// state + cursor paging. queryCollections returns { collections, nextCursor } (an OBJECT, not an
// array) and countCollections returns a number — those shapes are the bug-prone part; keep them.
import { useState, useEffect } from "react";
import { queryCollections, countCollections } from "@/rest/wix-portfolio";

export function usePortfolioGallery({ limit = 24 } = {}) {
  const [collections, setCollections] = useState(null); // null = loading
  const [cursor, setCursor] = useState(null);
  const [total, setTotal] = useState(null);             // 0 → empty state

  useEffect(() => {
    countCollections().then(setTotal);
    queryCollections({ limit }).then(({ collections, nextCursor }) => {
      setCollections(collections);
      setCursor(nextCursor);
    });
  }, [limit]);

  const loadMore = () =>
    queryCollections({ limit, cursor }).then(({ collections: more, nextCursor }) => {
      setCollections((c) => [...(c ?? []), ...more]);
      setCursor(nextCursor);
    });

  return { collections, total, cursor, loadMore };
}
