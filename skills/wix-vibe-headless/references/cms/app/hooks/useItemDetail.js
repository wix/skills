// useItemDetail — detail-page data logic, no markup: resolve one item from the route key. When a
// slug field is mapped it routes by that (getDataItemBy); otherwise by the item's `_id`
// (getDataItem). A miss sets notFound so the page shows a not-found state — it never invents an
// item. The detail page only renders what this returns.
import { useState, useEffect } from "react";
import { getDataItem, getDataItemBy } from "@/rest/wix-cms";
import { COLLECTION_ID, FIELDS } from "@/collection.config";

export function useItemDetail(key) {
  const [item, setItem] = useState(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!key) return;
    setItem(null);
    setNotFound(false);
    const load = FIELDS.slug
      ? getDataItemBy(COLLECTION_ID, FIELDS.slug, key)
      : getDataItem(COLLECTION_ID, key);
    load.then((it) => (it ? setItem(it) : setNotFound(true)));
  }, [key]);

  return { item, notFound };
}
