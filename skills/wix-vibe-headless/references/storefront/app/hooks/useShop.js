// useShop — all catalog-listing logic, no markup: load the category menu, load a page of products for
// the active category, append the next page on demand, sort client-side, and surface a failure instead
// of leaving the page on a spinner. The Shop page only renders what this returns.
//
// Load-bearing:
// • paging is CURSOR-based. Keep the cursor from the previous response and pass it back; a cursor
//   follow-up reuses the original filter, so the category is fixed for the life of that cursor.
//   Changing category starts a fresh query, never a cursor continuation.
// • queryCategories returns the auto-created "all-products" system category alongside real ones, and
//   `visible` does not flag it — filter it by slug or the menu shows a duplicate of everything.
// • sorting is done here on the loaded page, not by the API: with cursor paging the server would
//   re-sort per page, so a sort applied across pages already fetched is the honest option. Say so in
//   the UI if the catalog is larger than one page.
import { useCallback, useEffect, useMemo, useState } from "react";
import { queryProducts, queryProductsByCategory, queryCategories } from "@/rest/wix-store-catalog";

const SYSTEM_CATEGORY_SLUG = "all-products";
export const SORTS = {
  featured: { label: "Featured" },
  priceAsc: { label: "Price: low to high" },
  priceHigh: { label: "Price: high to low" },
  name: { label: "Name: A–Z" },
};

// Prices arrive formatted for display ("$12.00"), so read the numeric value for sorting from the
// amount when it's there and fall back to digits in the formatted string.
function priceOf(product) {
  const min = product?.actualPriceRange?.minValue;
  const n = Number(min?.amount ?? String(min?.formattedAmount || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function useShop({ pageSize = 24 } = {}) {
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null); // null = everything
  const [products, setProducts] = useState(null);             // null = first load
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState("featured");

  useEffect(() => {
    queryCategories({ limit: 100 })
      .then(({ categories: list }) =>
        setCategories((list || []).filter((c) => c.visible !== false && c.slug !== SYSTEM_CATEGORY_SLUG)))
      .catch(() => setCategories([]));   // a store without categories is normal, not an error
  }, []);

  const load = useCallback(async (categoryId) => {
    setProducts(null);
    setCursor(null);
    setError(null);
    try {
      const res = categoryId
        ? await queryProductsByCategory(categoryId, { limit: pageSize })
        : await queryProducts({ limit: pageSize });
      setProducts(res.products);
      setCursor(res.nextCursor);
    } catch (e) {
      setError(e?.message || "Couldn't load products.");
      setProducts([]);
    }
  }, [pageSize]);

  useEffect(() => { load(activeCategory?.id ?? null); }, [activeCategory, load]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = activeCategory
        ? await queryProductsByCategory(activeCategory.id, { limit: pageSize, cursor })
        : await queryProducts({ limit: pageSize, cursor });
      setProducts((prev) => [...(prev || []), ...res.products]);
      setCursor(res.nextCursor);
    } catch (e) {
      setError(e?.message || "Couldn't load more products.");
    } finally {
      setLoadingMore(false);
    }
  };

  const sorted = useMemo(() => {
    if (!products) return null;
    const copy = [...products];
    if (sort === "priceAsc") copy.sort((a, b) => priceOf(a) - priceOf(b));
    else if (sort === "priceHigh") copy.sort((a, b) => priceOf(b) - priceOf(a));
    else if (sort === "name") copy.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    return copy;
  }, [products, sort]);

  return {
    categories, activeCategory, setActiveCategory,
    products: sorted, loading: products === null, error,
    hasMore: !!cursor, loadMore, loadingMore,
    sort, setSort, retry: () => load(activeCategory?.id ?? null),
  };
}
