// Listing grid with loading skeletons and an honest empty state — a REFERENCE layout on the
// @theme tokens. Keep the states (they're correct); choosing a grid arrangement that fits the
// brand is encouraged. Never mock products: empty catalog → the empty state.
import type { ComponentType } from "react";
import type { ProductSummary } from "../../wix/storefront/types";
import ProductCard, { type ProductCardProps } from "./ProductCard";

export interface ProductGridProps {
  /** null → loading skeletons; [] → the empty state. */
  products: ProductSummary[] | null;
  emptyMessage?: string;
  productHref?: ProductCardProps["productHref"];
  LinkComponent?: ProductCardProps["LinkComponent"];
  /** Swap in your own tile (built on ProductSummary) without re-doing the states. */
  CardComponent?: ComponentType<ProductCardProps>;
}

export default function ProductGrid({
  products,
  emptyMessage = "No products yet — check back soon.",
  productHref,
  LinkComponent,
  CardComponent = ProductCard,
}: ProductGridProps) {
  if (products === null) {
    return (
      <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i}>
            <div className="aspect-square animate-pulse rounded-lg bg-secondary" />
            <div className="mt-3 h-3.5 w-3/4 animate-pulse rounded bg-secondary" />
            <div className="mt-2 h-3.5 w-1/3 animate-pulse rounded bg-secondary" />
          </div>
        ))}
      </div>
    );
  }
  if (products.length === 0) {
    return <p className="py-16 text-center text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <CardComponent key={p.id} product={p} productHref={productHref} LinkComponent={LinkComponent} />
      ))}
    </div>
  );
}
