// Grid tile. Styled entirely from theme.css tokens (var(--...)) — re-skin via those tokens, not
// this JSX. The image `//`-protocol fix and the price / out-of-stock field paths are load-bearing.
import { Link } from "react-router-dom";

function productImage(product) {
  const url = product?.media?.main?.image?.url;
  return url ? (url.startsWith("//") ? `https:${url}` : url) : null;
}

export default function ProductCard({ product }) {
  const image = productImage(product);
  const price = product?.actualPriceRange?.minValue?.formattedAmount;
  const compareAt = product?.compareAtPriceRange?.minValue?.formattedAmount;
  const soldOut = product?.inventory?.availabilityStatus === "OUT_OF_STOCK";

  return (
    <Link to={`/product/${product.slug}`} style={{
      display: "flex", flexDirection: "column", textDecoration: "none",
      color: "var(--color-text)", background: "var(--color-surface)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius)",
      overflow: "hidden", boxShadow: "var(--shadow)",
    }}>
      <div style={{ position: "relative", aspectRatio: "1 / 1", background: "var(--color-bg)" }}>
        {image
          ? <img src={image} alt={product.name} loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <div style={{ width: "100%", height: "100%" }} />}
        {soldOut && (
          <span style={{
            position: "absolute", top: 8, left: 8, padding: "2px 8px", fontSize: 12,
            background: "var(--color-danger)", color: "#fff", borderRadius: "var(--radius-sm)",
          }}>Sold out</span>
        )}
      </div>
      <div style={{ padding: "calc(var(--space) * 0.75)", display: "flex", flexDirection: "column", gap: 4 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600 }}>{product.name}</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600 }}>{price}</span>
          {compareAt && compareAt !== price && (
            <span style={{ color: "var(--color-muted)", textDecoration: "line-through", fontSize: 13 }}>{compareAt}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
