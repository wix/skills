// Listing grid with loading skeletons and an honest empty state — a REFERENCE layout.
// Keep the states (they're correct); choosing a grid arrangement that fits the brand is
// encouraged. Never mock products: empty catalog → the empty state.
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
      <div className="sf-grid" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <div className="sf-skeleton" key={i} />
        ))}
      </div>
    );
  }
  if (products.length === 0) {
    return <p className="sf-empty">{emptyMessage}</p>;
  }
  return (
    <div className="sf-grid">
      {products.map((p) => (
        <CardComponent key={p.id} product={p} productHref={productHref} LinkComponent={LinkComponent} />
      ))}
    </div>
  );
}
