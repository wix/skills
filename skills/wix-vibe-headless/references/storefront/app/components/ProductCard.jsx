// Reference implementation of a product grid tile built on useProductCard.
// Styled with base44 design tokens (shadcn Tailwind classes: bg-card / text-foreground / border-border).
// Build your own card on useProductCard instead — read this for inspiration, don't use it directly.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useCart } from "@/context/CartContext";
import { useProductCard } from "@/hooks/useProductCard";

const badge = "px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide rounded-full";
const badgePromo    = `${badge} bg-primary text-primary-foreground`;
const badgeInfo     = `${badge} bg-card text-foreground border border-border`;
const badgeBlocked  = `${badge} bg-destructive text-destructive-foreground`;

const badgeClass = { "pre-order": badgeInfo, "sold-out": badgeBlocked, "limited-stock": badgeInfo };

export default function ProductCard({ product }) {
  const { addToCart } = useCart();
  const [adding, setAdding] = useState(false);

  const {
    isSoldOut, isPreorder, leftBadges, promoBadge,
    priceDisplay, compareAtDisplay,
    colors, optionLabel,
    isQuickAddable, image, hoverImage,
  } = useProductCard(product);

  const quickAdd = async () => {
    setAdding(true);
    await addToCart(product.id);
    setAdding(false);
  };

  return (
    <div className="group relative flex flex-col bg-card border border-border rounded-lg overflow-hidden shadow-sm">
      <div className="relative aspect-square bg-background">
        <Link to={`/product/${product.slug}`} aria-label={product.name} className="block w-full h-full">
          {image ? (
            <>
              <img src={image} alt={product.name} loading="lazy"
                className={`w-full h-full object-cover ${hoverImage ? "transition-opacity duration-300 md:group-hover:opacity-0" : ""}`} />
              {hoverImage && (
                <img src={hoverImage} alt="" aria-hidden="true" loading="lazy"
                  className="hidden md:block absolute inset-0 w-full h-full object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              )}
            </>
          ) : (
            <div className="w-full h-full bg-muted flex items-center justify-center" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="w-8 h-8 text-muted-foreground/40" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
              </svg>
            </div>
          )}
        </Link>

        <div className="absolute top-2 left-2 flex flex-col items-start gap-1 pointer-events-none">
          {leftBadges.map((b) => (
            <span key={b.type} className={badgeClass[b.type]}>{b.label}</span>
          ))}
        </div>
        <div className="absolute top-2 right-2 pointer-events-none">
          {promoBadge && <span className={badgePromo}>{promoBadge.label}</span>}
        </div>

        {(!isSoldOut || isPreorder) && (
          <div className="absolute inset-x-2 bottom-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            {isQuickAddable ? (
              <button onClick={quickAdd} disabled={adding}
                className="w-full py-2.5 px-4 rounded-full bg-primary text-primary-foreground border-none text-sm font-semibold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-wait">
                {adding ? "Adding…" : "Quick add"}
              </button>
            ) : (
              <Link to={`/product/${product.slug}`}
                className="block w-full text-center py-2.5 px-4 rounded-full bg-primary text-primary-foreground no-underline text-sm font-semibold">
                {isSoldOut ? "Pre-order" : "Choose options"}
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-1">
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-3">
          <h3 className="m-0 font-display text-[15px] font-semibold line-clamp-2">
            <Link to={`/product/${product.slug}`} className="no-underline text-foreground">{product.name}</Link>
          </h3>
          <div className="flex gap-2 items-baseline flex-wrap md:justify-end">
            <span className="font-semibold whitespace-nowrap">{priceDisplay}</span>
            {compareAtDisplay && (
              <span className="text-muted-foreground line-through text-[13px] whitespace-nowrap">{compareAtDisplay}</span>
            )}
          </div>
        </div>

        {(colors.length > 0 || optionLabel) && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground min-h-[18px]">
            {colors.length > 0 && (
              <span className="flex items-center gap-1" aria-label={`${colors.length} colors available`}>
                {colors.slice(0, 5).map((c, i) => (
                  <span key={`${c}-${i}`} className="w-3 h-3 rounded-full ring-1 ring-inset ring-black/20" style={{ backgroundColor: c }} />
                ))}
                {colors.length > 5 && <span>+{colors.length - 5}</span>}
              </span>
            )}
            {optionLabel && <span>{optionLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
