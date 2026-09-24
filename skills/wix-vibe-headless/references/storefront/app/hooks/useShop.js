// Catalog queries run on Wix before pagination. A changed selection starts a fresh cursor chain.
// Pass `initialCategory` (a category object, or { id } resolved from a /category/:slug route) to
// start scoped; the hook's facets follow the active category.
import { useCallback, useEffect, useRef, useState } from "react";
import { searchProducts, countProducts, fetchFacets, queryCategories, CATALOG_SORTS } from "@/rest/wix-store-catalog";

export const SORTS = CATALOG_SORTS;
const SYSTEM_CATEGORY_SLUG = "all-products";

export function useShop({ pageSize = 24, initialCategory = null } = {}) {
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState(initialCategory);
  const [sort, setSort] = useState("featured");
  const [filters, setFilters] = useState({});
  const [selectedChoiceIds, setSelectedChoiceIds] = useState([]);
  const [facets, setFacets] = useState([]);
  const [attempt, setAttempt] = useState(0);
  const [page, setPage] = useState({ key: null, products: null, total: null, cursor: null, error: null, loadingMore: false });
  const generation = useRef(0);
  const pendingMore = useRef(null);
  const key = JSON.stringify([pageSize, activeCategory?.id ?? null, sort, filters.minPrice ?? null,
    filters.maxPrice ?? null, !!filters.inStockOnly, filters.search ?? "", [...selectedChoiceIds].sort(), attempt]);
  const currentKey = useRef(key);
  currentKey.current = key;

  useEffect(() => {
    let alive = true;
    queryCategories({ limit: 100 })
      .then(({ categories: list }) => {
        if (alive) setCategories((list || []).filter(c => c.visible !== false && c.slug !== SYSTEM_CATEGORY_SLUG));
      })
      .catch(() => { if (alive) setCategories([]); });
    return () => { alive = false; };
  }, []);

  // Facets follow the category scope (a "Size" facet inside "Mugs" is noise).
  const activeCategoryId = activeCategory?.id ?? null;
  useEffect(() => {
    let alive = true;
    fetchFacets({ categoryId: activeCategoryId }).then((f) => { if (alive) setFacets(f); });
    return () => { alive = false; };
  }, [activeCategoryId]);

  useEffect(() => {
    const id = ++generation.current;
    let alive = true;
    pendingMore.current = null;
    setPage({ key, products: null, total: null, cursor: null, error: null, loadingMore: false });
    const [limit, categoryId, selectedSort, minPrice, maxPrice, inStockOnly, search, choiceIds] = JSON.parse(key);
    const selection = { categoryId, minPrice, maxPrice, inStockOnly, choiceIds };
    Promise.all([
      searchProducts({ limit, sort: selectedSort, search, ...selection }),
      // The count is a nicety: a failure leaves total null, the page still renders.
      search ? Promise.resolve(null) : countProducts(selection).catch(() => null),
    ])
      .then(([res, total]) => {
        if (alive && generation.current === id && currentKey.current === key) {
          setPage({ key, products: res.products, total, cursor: res.nextCursor, error: null, loadingMore: false });
        }
      })
      .catch(e => {
        if (alive && generation.current === id && currentKey.current === key) {
          setPage({ key, products: [], total: null, cursor: null, error: e?.message || "Couldn't load products.", loadingMore: false });
        }
      });
    return () => { alive = false; generation.current++; };
  }, [key]);

  const loadMore = useCallback(async () => {
    if (page.key !== key || !page.cursor || pendingMore.current) return;
    const request = { generation: generation.current, key };
    pendingMore.current = request; // blocks repeated clicks before React rerenders
    const isCurrent = () => generation.current === request.generation && currentKey.current === key;
    setPage(p => ({ ...p, loadingMore: true, error: null }));
    try {
      const res = await searchProducts({ limit: pageSize, cursor: page.cursor });
      if (isCurrent()) setPage(p => {
        const seen = new Set((p.products || []).map(product => product.id));
        return { ...p, products: [...(p.products || []), ...res.products.filter(product => {
          if (seen.has(product.id)) return false;
          seen.add(product.id); return true;
        })], cursor: res.nextCursor };
      });
    } catch (e) {
      if (isCurrent()) setPage(p => ({ ...p, error: e?.message || "Couldn't load more products." }));
    } finally {
      if (pendingMore.current === request) pendingMore.current = null;
      if (isCurrent()) setPage(p => ({ ...p, loadingMore: false }));
    }
  }, [key, page.key, page.cursor, pageSize]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  const toggleChoice = useCallback((choiceId) =>
    setSelectedChoiceIds(ids => ids.includes(choiceId) ? ids.filter(x => x !== choiceId) : [...ids, choiceId]), []);
  const clearFilters = useCallback(() => { setFilters({}); setSelectedChoiceIds([]); }, []);
  const hasActiveFilters = selectedChoiceIds.length > 0 || !!filters.inStockOnly ||
    (filters.minPrice != null && filters.minPrice !== "") || (filters.maxPrice != null && filters.maxPrice !== "") ||
    !!(filters.search && String(filters.search).trim());
  const current = page.key === key;
  return {
    categories, activeCategory, setActiveCategory, sort, setSort, filters, setFilters,
    facets, selectedChoiceIds, toggleChoice, clearFilters, hasActiveFilters,
    products: current ? page.products : null, total: current ? page.total : null,
    loading: !current || page.products === null,
    error: current ? page.error : null, retry,
    hasMore: current && !!page.cursor, loadMore, loadingMore: current && page.loadingMore,
  };
}
