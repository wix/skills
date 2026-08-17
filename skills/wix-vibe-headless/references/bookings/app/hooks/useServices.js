// useServices — the services-list data, no markup: load one page of visitor-visible services, page
// with the returned offset, and expose the categories those services belong to so the page can offer
// a filter. queryServices returns an OBJECT ({ services, total, nextOffset }), NOT a bare array —
// destructure it (calling .map on the object throws). `total === 0` is the empty-state signal;
// `services === null` means still loading.
//
// The category menu is built from the first unfiltered page, so it lists only categories that have
// something bookable in them. Switching category re-queries server-side rather than filtering the
// loaded page, so a category whose services sit on page 2 still fills in.
import { useCallback, useEffect, useMemo, useState } from "react";
import { categoriesOf, queryServices, queryServicesByCategory } from "@/rest/wix-bookings-services";

export function useServices({ limit = 24 } = {}) {
  const [services, setServices] = useState(null);
  const [total, setTotal] = useState(null);
  const [nextOffset, setNextOffset] = useState(null);
  const [allCategories, setAllCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);   // null = every service
  const [error, setError] = useState(null);

  const load = useCallback(async (categoryId) => {
    setServices(null);
    setError(null);
    try {
      const res = categoryId
        ? await queryServicesByCategory(categoryId, { limit })
        : await queryServices({ limit });
      setServices(res.services);
      setTotal(res.total);
      setNextOffset(res.nextOffset);
      // Only the unfiltered page can describe the whole menu; a filtered one lists one category.
      if (!categoryId) setAllCategories(categoriesOf(res.services));
    } catch (e) {
      setError(e?.message || "Couldn't load services.");
      setServices([]);
    }
  }, [limit]);

  useEffect(() => { load(activeCategory?.id ?? null); }, [activeCategory, load]);

  const loadMore = useCallback(async () => {
    if (nextOffset == null) return;                            // null on the last page
    const res = activeCategory
      ? await queryServicesByCategory(activeCategory.id, { limit, offset: nextOffset })
      : await queryServices({ limit, offset: nextOffset });
    setServices((s) => [...(s || []), ...res.services]);
    setNextOffset(res.nextOffset);
  }, [activeCategory, limit, nextOffset]);

  // One category is not a choice — hide the menu rather than show a single chip that does nothing.
  const categories = useMemo(() => (allCategories.length > 1 ? allCategories : []), [allCategories]);

  return {
    services, total, nextOffset, loadMore, error,
    categories, activeCategory, setActiveCategory,
    retry: () => load(activeCategory?.id ?? null),
  };
}
