// Catalog listing + category filter for a shop/listing surface.
//
// SSR-friendly: when the host fetched the data already (Astro frontmatter, a server
// component), pass it as `initial` and no client fetch happens for it. In a pure SPA,
// pass nothing and the hook fetches on mount. Category switches always fetch live
// (server-side-filtered by the category id).
import { useEffect, useState } from "react";
import {
  fetchCategories,
  fetchProducts,
  fetchProductsByCategory,
} from "../../wix/storefront/catalog";
import type { Category, ProductSummary } from "../../wix/storefront/types";

export interface UseShopOptions {
  initialProducts?: ProductSummary[];
  initialCategories?: Category[];
  limit?: number;
}

export interface UseShop {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  products: ProductSummary[] | null;
  categories: Category[];
  /** null = "all products". */
  activeCategoryId: string | null;
  setActiveCategoryId: (id: string | null) => void;
  loading: boolean;
  error: string | null;
}

export function useShop({ initialProducts, initialCategories, limit = 100 }: UseShopOptions = {}): UseShop {
  const [products, setProducts] = useState<ProductSummary[] | null>(initialProducts ?? null);
  const [categories, setCategories] = useState<Category[]>(initialCategories ?? []);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialCategories) return;
    let alive = true;
    fetchCategories().then((c) => alive && setCategories(c));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // The initial all-products data may have come from the server; only fetch when it
    // didn't, or when the buyer picked a category.
    if (activeCategoryId === null && initialProducts) {
      setProducts(initialProducts);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    const load = activeCategoryId
      ? fetchProductsByCategory(activeCategoryId, { limit })
      : fetchProducts({ limit });
    load
      .then((items) => {
        if (!alive) return;
        setProducts(items);
      })
      .catch((e) => {
        if (!alive) return;
        setProducts([]);
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategoryId, limit]);

  return { products, categories, activeCategoryId, setActiveCategoryId, loading, error };
}
