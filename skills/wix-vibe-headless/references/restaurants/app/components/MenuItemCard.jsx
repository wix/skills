// One dish/drink tile. Styled with base44 design tokens (shadcn Tailwind classes) — re-skin via the
// app's design tokens (src/index.css :root/.dark), not this JSX. The load-bearing bits: item.image is
// an OBJECT (render .url, never the object) with a `//`-protocol fix; price is EITHER item.price
// (single) OR item.variants[] (one-of, each { name, price }); MENU prices carry NO currency symbol
// (formatPrice adds one — swap it for the site's currency). Clicking the card opens the item dialog
// (add-to-cart lives there).
function imageUrl(img) {
  const url = img?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

// Restaurants MENU prices are plain decimal strings with NO currency symbol ("12.50").
function formatPrice(price) {
  return price == null ? "" : `$${price}`; // swap "$" for the site's currency
}

export default function MenuItemCard({ item, onOpen }) {
  const image = imageUrl(item.image);
  const soldOut = item.orderSettings?.inStock === false;

  return (
    <article
      onClick={() => onOpen?.(item)}
      className={`flex flex-col text-foreground bg-card border border-border rounded-lg overflow-hidden shadow-sm ${onOpen ? "cursor-pointer" : "cursor-default"}`}>
      {image && (
        <div className="relative aspect-[4/3] bg-background">
          <img src={image} alt={item.name} loading="lazy"
            className="w-full h-full object-cover" />
          {soldOut && (
            <span className="absolute top-2 left-2 py-0.5 px-2 text-xs bg-destructive text-destructive-foreground rounded-sm">Sold out</span>
          )}
        </div>
      )}
      <div className="p-3 flex flex-col gap-1.5">
        <div className="flex justify-between items-baseline gap-2">
          {/* Clamped like the storefront tile: the same title-beside-price row turns a long name
              into three ragged lines. */}
          <h3 className="m-0 font-display text-base font-semibold line-clamp-2">
            {item.name}{item.featured && <span className="text-primary"> ★</span>}
          </h3>
          {/* price: single string, OR one-of variants — render one label per variant */}
          {item.price != null
            ? <span className="font-semibold whitespace-nowrap">{formatPrice(item.price)}</span>
            : null}
        </div>
        {item.description && (
          <p className="m-0 text-muted-foreground text-sm leading-[1.45]">{item.description}</p>
        )}
        {item.price == null && item.variants?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {item.variants.map((v) => (
              <span key={v.variantId} className="text-[13px] text-foreground">
                {v.name}: <strong>{formatPrice(v.price)}</strong>
              </span>
            ))}
          </div>
        )}
        {item.labels?.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-0.5">
            {item.labels.map((label) => (
              <span key={label.id} className="inline-flex items-center gap-1 text-xs text-muted-foreground border border-border rounded-full py-0.5 px-2">
                {imageUrl(label.icon) && <img src={imageUrl(label.icon)} alt="" className="w-3 h-3" />}
                {label.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
