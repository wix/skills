// Grid tile — a REFERENCE implementation over the ProductSummary DTO. Complete and correct
// (badges, sale price, hover image, quick-add); styled entirely from the @theme tokens via
// Tailwind utilities. Designing your own card on the same DTO is encouraged.
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
    <div className="group">
      <LinkComponent href={productHref(product.slug)} className="block no-underline">
        <div className="relative aspect-square overflow-hidden rounded-lg bg-secondary">
          {product.imageUrl && (
            <img
              src={product.imageUrl}
              alt={product.name}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          )}
          {product.hoverImageUrl && (
            <img
              src={product.hoverImageUrl}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            />
          )}
          {product.ribbon && (
            <span className="absolute left-3 top-3 rounded-full bg-background/90 px-3 py-1 text-xs font-semibold text-foreground backdrop-blur">
              {product.ribbon}
            </span>
          )}
          {soldOut && (
            <span className="absolute right-3 top-3 rounded-full bg-background/90 px-3 py-1 text-xs font-semibold text-muted-foreground backdrop-blur">
              Sold out
            </span>
          )}
          {product.preorder && (
            <span className="absolute right-3 top-3 rounded-full bg-background/90 px-3 py-1 text-xs font-semibold text-foreground backdrop-blur">
              Pre-order
            </span>
          )}
        </div>
        <p className="mt-3 text-sm font-medium text-foreground">{product.name}</p>
        <p className="mt-0.5 flex items-baseline gap-2 text-sm">
          <span className="text-foreground">{priceLabel}</span>
          {product.compareAtPrice && (
            <span className="text-muted-foreground line-through">{product.compareAtPrice}</span>
          )}
        </p>
        {product.optionsSummary && (
          <p className="mt-0.5 text-xs text-muted-foreground">{product.optionsSummary}</p>
        )}
      </LinkComponent>
      {product.quickAddable && (
        <button
          type="button"
          disabled={busy}
          onClick={() => addToCart(product.id).catch(() => {})}
          className="mt-2 rounded-full border border-border px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
        >
          Add to cart
        </button>
      )}
    </div>
  );
}
