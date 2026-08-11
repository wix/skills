// Responsive product grid + empty state. Styled with base44 design tokens (shadcn Tailwind classes).
import ProductCard from "./ProductCard";

export default function ProductGrid({ products, empty = "No products yet." }) {
  if (!products?.length) {
    return (
      <p className="text-muted-foreground p-4 text-center">{empty}</p>
    );
  }
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
      {products.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  );
}
