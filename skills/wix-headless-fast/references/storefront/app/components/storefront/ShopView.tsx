// The full shop surface: live category filter bar + product grid, styled from the @theme
// tokens. Mount as-is (Astro: one island with server-fetched initial data; SPA: no props).
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

const pill = (active: boolean) =>
  `rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
    active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border text-foreground hover:bg-secondary"
  }`;

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
        <div className="mb-8 flex flex-wrap gap-2" role="group" aria-label="Categories">
          <button type="button" className={pill(activeCategoryId === null)} onClick={() => setActiveCategoryId(null)}>
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={pill(activeCategoryId === c.id)}
              onClick={() => setActiveCategoryId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
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
