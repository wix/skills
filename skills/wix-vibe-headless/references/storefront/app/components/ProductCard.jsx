// Grid tile. Styled with base44 design tokens (shadcn Tailwind classes: bg-card / text-foreground /
// border-border) — re-skin via the app's design tokens (src/index.css :root/.dark), not this JSX.
// The price / stock / ribbon field paths are load-bearing; image URLs go through lib/storeImage so the
// grid, the PDP gallery and the cart all normalise them the same way.
//
// Everything here comes from the list query — the tile costs no extra request. What the list query
// does NOT carry is a stock COUNT (inventory has availabilityStatus only), so "Limited stock" is as
// precise as a tile can honestly get; "Only 2 left" would need per-variant inventory per product.
import { useState } from "react";
import { Link } from "react-router-dom";
import { productGallery, productImage } from "@/lib/storeImage";
import { useCart } from "@/context/CartContext";

// Percent off, from the raw amounts — the formatted strings ("€129.00") can't be subtracted.
function discountPercent(product) {
  const now = Number(product?.actualPriceRange?.minValue?.amount);
  const was = Number(product?.compareAtPriceRange?.minValue?.amount);
  if (!now || !was || was <= now) return null;
  return Math.round(((was - now) / was) * 100);
}

// What the buyer gets to choose, previewed on the tile: colour options become real dots (the colours
// say more than "3 colors" could), everything else becomes "4 sizes". Pluralised from the option's own
// name, so the wording follows the merchant's catalogue rather than a hardcoded English word.
function optionsPreview(product) {
  const labels = [], colors = [];
  for (const o of product?.options || []) {
    const choices = (o.choicesSettings?.choices || []).filter((c) => c.visible !== false);
    if (!choices.length) continue;
    const swatches = choices.map((c) => c.colorCode).filter(Boolean);
    if (swatches.length) { colors.push(...swatches); continue; }
    const n = o.name.toLowerCase();
    labels.push(`${choices.length} ${choices.length === 1 || n.endsWith("s") ? n : `${n}s`}`);
  }
  return { label: labels.join(" · "), colors };
}

// One rule for every chip on the tile, so a new badge has an obvious home instead of a fresh colour:
// promotional shouts in the brand colour, informational sits quietly on a card surface, and only a
// blocking state is destructive. Each background travels with its own foreground token.
const badge = "px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide rounded-full";
const badgePromo = `${badge} bg-primary text-primary-foreground`;
const badgeInfo = `${badge} bg-card text-foreground border border-border`;
const badgeBlocked = `${badge} bg-destructive text-destructive-foreground`;

export default function ProductCard({ product }) {
  const { addToCart } = useCart();
  const [adding, setAdding] = useState(false);

  const image = productImage(product);
  const hoverImage = productGallery(product)[1]?.url;
  const price = product?.actualPriceRange?.minValue?.formattedAmount;
  const priceMax = product?.actualPriceRange?.maxValue?.formattedAmount;
  const compareAt = product?.compareAtPriceRange?.minValue?.formattedAmount;

  const status = product?.inventory?.availabilityStatus;
  const soldOut = status === "OUT_OF_STOCK";
  const preorder = product?.inventory?.preorderStatus === "ENABLED";
  const discount = discountPercent(product);
  // A merchant-set ribbon ("New", "Best Seller") is the catalogue's own badge, so it beats anything
  // derived here — a "new" label computed from createdDate would flag the whole catalogue at once
  // right after seeding. Suppressed when a discount badge is showing, since that ribbon is "Sale".
  const ribbon = product?.ribbon?.name;
  const { label: optionLabel, colors } = optionsPreview(product);
  const hasOptions = (product?.options?.length || 0) > 0;

  // No options means a single variant, which the cart resolves from the product id alone — so the
  // tile can add straight to the cart with no extra request. The drawer opening is the confirmation
  // (and carries the reason when it fails), which is why there's no "Added ✓" state to fake here.
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
              {/* Fade out only when there IS a second shot behind it — a one-photo product would
                  otherwise hover to an empty frame. */}
              <img src={image} alt={product.name} loading="lazy"
                className={`w-full h-full object-cover ${hoverImage ? "transition-opacity duration-300 md:group-hover:opacity-0" : ""}`} />
              {/* Second catalogue shot on hover. `hidden` below md so phones never fetch it. */}
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
          {soldOut && preorder && <span className={badgeInfo}>Pre-order</span>}
          {soldOut && !preorder && <span className={badgeBlocked}>Sold out</span>}
          {status === "PARTIALLY_OUT_OF_STOCK" && <span className={badgeInfo}>Limited stock</span>}
        </div>
        {/* Discount and ribbon are mutually exclusive, so both can claim the promotional slot. */}
        <div className="absolute top-2 right-2 pointer-events-none">
          {discount ? <span className={badgePromo}>−{discount}%</span>
            : ribbon ? <span className={badgePromo}>{ribbon}</span> : null}
        </div>

        {/* Sold out with no pre-order has nothing to offer, so no control appears at all. */}
        {(!soldOut || preorder) && (
          <div className="absolute inset-x-2 bottom-2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            {/* Same tokens as the PDP's Add-to-cart button: one action, one treatment, so the tile's
                CTA is the brand colour rather than "whatever the text colour is". */}
            {hasOptions || soldOut ? (
              <Link to={`/product/${product.slug}`}
                className="block w-full text-center py-2.5 px-4 rounded-full bg-primary text-primary-foreground no-underline text-sm font-semibold">
                {soldOut ? "Pre-order" : "Choose options"}
              </Link>
            ) : (
              <button onClick={quickAdd} disabled={adding}
                className="w-full py-2.5 px-4 rounded-full bg-primary text-primary-foreground border-none text-sm font-semibold cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-wait">
                {adding ? "Adding…" : "Quick add"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-1">
        {/* Side by side once the tile is wide enough; stacked on a phone's two-up grid, where a long
            name wrapping to three lines against a top-right price reads as broken. */}
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-3">
          {/* Clamped to two lines: a 220px tile turns a long product name into three or four ragged
              lines beside a top-right price. The full name is on the tile's link and the PDP. */}
          <h3 className="m-0 font-display text-[15px] font-semibold line-clamp-2">
            <Link to={`/product/${product.slug}`} className="no-underline text-foreground">{product.name}</Link>
          </h3>
          <div className="flex gap-2 items-baseline flex-wrap md:justify-end">
            {/* A product whose variants differ in price spans a range — showing only minValue reads as
                the price of everything, then the PDP appears to raise it once a variant is picked. */}
            <span className="font-semibold whitespace-nowrap">{priceMax && priceMax !== price ? `${price} – ${priceMax}` : price}</span>
            {compareAt && compareAt !== price && (
              <span className="text-muted-foreground line-through text-[13px] whitespace-nowrap">{compareAt}</span>
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
