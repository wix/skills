// The full shop surface: live category filter bar + product grid. Mount as-is (Astro:
// one island with server-fetched initial data; SPA: no props needed).
import { useShop } from "../../hooks/storefront/useShop";
import type { Category, ProductSummary } from "../../wix/storefront/types";
import ProductGrid, { type ProductGridProps } from "./ProductGrid";

export interface ShopViewProps {
  /** Server-fetched data (Astro/Next SSR) — omit in a SPA and it fetches client-side. */
  initialProducts?: ProductSummary[];
  initialCategories?: Category[];
  emptyMessage?: string;
  productHref?: ProductGridProps["productHref"];
  LinkComponent?: ProductGridProps["LinkComponent"];
  CardComponent?: ProductGridProps["CardComponent"];
}

export default function ShopView({
  initialProducts,
  initialCategories,
  emptyMessage,
  productHref,
  LinkComponent,
  CardComponent,
}: ShopViewProps) {
  const { products, categories, activeCategoryId, setActiveCategoryId, loading, error } = useShop({
    initialProducts,
    initialCategories,
  });

  return (
    <div>
      {categories.length > 1 && (
        <div className="sf-cats" role="group" aria-label="Categories">
          <button
            type="button"
            className={activeCategoryId === null ? "sf-cat sf-on" : "sf-cat"}
            onClick={() => setActiveCategoryId(null)}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={activeCategoryId === c.id ? "sf-cat sf-on" : "sf-cat"}
              onClick={() => setActiveCategoryId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="sf-error">{error}</p>}
      <ProductGrid
        products={loading ? null : products}
        emptyMessage={emptyMessage}
        productHref={productHref}
        LinkComponent={LinkComponent}
        CardComponent={CardComponent}
      />
    </div>
  );
}
