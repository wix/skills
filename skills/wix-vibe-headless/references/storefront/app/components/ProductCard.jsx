// Grid tile. Styled with base44 design tokens (shadcn Tailwind classes: bg-card / text-foreground /
// border-border) — re-skin via the app's design tokens (src/index.css :root/.dark), not this JSX.
// The price / out-of-stock field paths are load-bearing; image URLs go through lib/storeImage so the
// grid, the PDP gallery and the cart all normalise them the same way.
import { Link } from "react-router-dom";
import { productImage } from "@/lib/storeImage";

export default function ProductCard({ product }) {
  const image = productImage(product);
  const price = product?.actualPriceRange?.minValue?.formattedAmount;
  const priceMax = product?.actualPriceRange?.maxValue?.formattedAmount;
  const compareAt = product?.compareAtPriceRange?.minValue?.formattedAmount;
  const soldOut = product?.inventory?.availabilityStatus === "OUT_OF_STOCK";

  return (
    <Link to={`/product/${product.slug}`}
      className="flex flex-col no-underline text-foreground bg-card border border-border rounded-lg overflow-hidden shadow-sm">
      <div className="relative aspect-square bg-background">
        {image
          ? <img src={image} alt={product.name} loading="lazy" className="w-full h-full object-cover" />
          : <div className="w-full h-full bg-muted flex items-center justify-center" aria-hidden="true"><svg viewBox="0 0 24 24" className="w-8 h-8 text-muted-foreground/40" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg></div>}
        {soldOut && (
          <span className="absolute top-2 left-2 px-2 py-0.5 text-xs bg-destructive text-white rounded-sm">Sold out</span>
        )}
      </div>
      <div className="p-3 flex flex-col gap-1">
        <h3 className="m-0 font-display text-[15px] font-semibold">{product.name}</h3>
        <div className="flex gap-2 items-baseline flex-wrap">
          {/* A product whose variants differ in price spans a range — showing only minValue reads as
              the price of everything, then the PDP appears to raise it once a variant is picked. */}
          <span className="font-semibold">{priceMax && priceMax !== price ? `${price} – ${priceMax}` : price}</span>
          {compareAt && compareAt !== price && (
            <span className="text-muted-foreground line-through text-[13px]">{compareAt}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
