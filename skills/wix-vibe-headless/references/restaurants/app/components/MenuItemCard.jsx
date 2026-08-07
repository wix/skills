// One dish/drink tile. Styled entirely from theme.css tokens (var(--...)) — re-skin via those
// tokens, not this JSX. The load-bearing bits: item.image is an OBJECT (render .url, never the
// object) with a `//`-protocol fix; price is EITHER item.price (single) OR item.variants[] (one-of,
// each { name, price }); MENU prices carry NO currency symbol (formatPrice adds one — swap it for
// the site's currency). Clicking the card opens the item dialog (add-to-cart lives there).
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
      style={{
        display: "flex", flexDirection: "column", cursor: onOpen ? "pointer" : "default",
        color: "var(--color-text)", background: "var(--color-surface)",
        border: "1px solid var(--color-border)", borderRadius: "var(--radius)",
        overflow: "hidden", boxShadow: "var(--shadow)",
      }}>
      {image && (
        <div style={{ position: "relative", aspectRatio: "4 / 3", background: "var(--color-bg)" }}>
          <img src={image} alt={item.name} loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          {soldOut && (
            <span style={{
              position: "absolute", top: 8, left: 8, padding: "2px 8px", fontSize: 12,
              background: "var(--color-danger)", color: "#fff", borderRadius: "var(--radius-sm)",
            }}>Sold out</span>
          )}
        </div>
      )}
      <div style={{ padding: "calc(var(--space) * 0.75)", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600 }}>
            {item.name}{item.featured && <span style={{ color: "var(--color-accent)" }}> ★</span>}
          </h3>
          {/* price: single string, OR one-of variants — render one label per variant */}
          {item.price != null
            ? <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{formatPrice(item.price)}</span>
            : null}
        </div>
        {item.description && (
          <p style={{ margin: 0, color: "var(--color-muted)", fontSize: 14, lineHeight: 1.45 }}>{item.description}</p>
        )}
        {item.price == null && item.variants?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {item.variants.map((v) => (
              <span key={v.variantId} style={{ fontSize: 13, color: "var(--color-text)" }}>
                {v.name}: <strong>{formatPrice(v.price)}</strong>
              </span>
            ))}
          </div>
        )}
        {item.labels?.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 2 }}>
            {item.labels.map((label) => (
              <span key={label.id} style={{
                display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12,
                color: "var(--color-muted)", border: "1px solid var(--color-border)",
                borderRadius: 999, padding: "2px 8px",
              }}>
                {imageUrl(label.icon) && <img src={imageUrl(label.icon)} alt="" style={{ width: 12, height: 12 }} />}
                {label.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
