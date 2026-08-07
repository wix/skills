// Responsive product grid + empty state. Token-styled; re-skin via theme.css.
import ProductCard from "./ProductCard";

export default function ProductGrid({ products, empty = "No products yet." }) {
  if (!products?.length) {
    return (
      <p style={{ color: "var(--color-muted)", padding: "var(--space)", textAlign: "center" }}>{empty}</p>
    );
  }
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
      gap: "var(--space)",
    }}>
      {products.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  );
}
