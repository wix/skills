// Grid tile — a REFERENCE implementation over the ProductSummary DTO. It's correct and
// complete (badges, sale price, hover image, quick-add), but the layout is deliberately
// plain: designing your own card that fits the brand is encouraged — build it on the same
// ProductSummary fields and keep quick-add wired through useCart().
import type { ComponentType, ReactNode } from "react";
import type { ProductSummary } from "../../wix/storefront/types";
import { useCart } from "../../hooks/storefront/useCart";

export interface LinkLikeProps {
  href: string;
  className?: string;
  children?: ReactNode;
}

export interface ProductCardProps {
  product: ProductSummary;
  /** Route pattern for detail pages; default matches the shipped /products/[slug] page. */
  productHref?: (slug: string) => string;
  /** Router-specific link (react-router Link, next/link); defaults to a plain <a>. */
  LinkComponent?: ComponentType<LinkLikeProps>;
}

const PlainLink = ({ href, className, children }: LinkLikeProps) => (
  <a href={href} className={className}>
    {children}
  </a>
);

export default function ProductCard({
  product,
  productHref = (slug) => `/products/${slug}`,
  LinkComponent = PlainLink,
}: ProductCardProps) {
  const { addToCart, busy } = useCart();
  const soldOut = product.availability === "OUT_OF_STOCK" && !product.preorder;
  const priceLabel =
    product.maxPrice && product.maxPrice !== product.price
      ? `${product.price} – ${product.maxPrice}`
      : product.price;

  return (
    <div className="sf-card">
      <LinkComponent href={productHref(product.slug)}>
        <div className="sf-card-media">
          {product.imageUrl && <img src={product.imageUrl} alt={product.name} loading="lazy" />}
          {product.hoverImageUrl && (
            <img className="sf-hover" src={product.hoverImageUrl} alt="" loading="lazy" aria-hidden="true" />
          )}
          {product.ribbon && <span className="sf-badge">{product.ribbon}</span>}
          {soldOut && <span className="sf-badge sf-badge-right">Sold out</span>}
          {product.preorder && <span className="sf-badge sf-badge-right">Pre-order</span>}
        </div>
        <p className="sf-card-name">{product.name}</p>
        <p className="sf-card-price">
          <span>{priceLabel}</span>
          {product.compareAtPrice && <span className="sf-compare">{product.compareAtPrice}</span>}
        </p>
        {product.optionsSummary && <p className="sf-card-options">{product.optionsSummary}</p>}
      </LinkComponent>
      {product.quickAddable && (
        <button
          type="button"
          className="sf-chip"
          disabled={busy}
          onClick={() => addToCart(product.id).catch(() => {})}
        >
          Add to cart
        </button>
      )}
    </div>
  );
}
