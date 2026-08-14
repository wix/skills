// Responsive product grid, with the two states a fresh store spends most of its life in: loading and
// empty. Styled with base44 design tokens (shadcn Tailwind classes).
//
// Two columns on phones — a 220px minmax leaves room for only one, and a one-up catalog scrolls
// forever — then auto-fill from md up.
//
// The empty state carries weight here — a catalog is seeded separately from the build, so it is
// routinely empty when the merchant first opens the page. Say why, rather than showing a bare line.
import ProductCard from "./ProductCard";

// Skeleton tiles match ProductCard's aspect-square + two text lines, so nothing shifts when the real
// products land.
export function ProductGridSkeleton({ count = 8 }) {
  return (
    <div className="grid gap-4 grid-cols-2 md:[grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="aspect-square bg-muted animate-pulse" />
          <div className="p-3 flex flex-col gap-2">
            <div className="flex justify-between gap-3">
              <div className="h-3.5 w-1/2 bg-muted rounded-sm animate-pulse" />
              <div className="h-3.5 w-1/5 bg-muted rounded-sm animate-pulse" />
            </div>
            <div className="h-3 w-1/3 bg-muted rounded-sm animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ProductGrid({ products, loading, empty = "No products yet.", emptyHint }) {
  if (loading) return <ProductGridSkeleton />;

  if (!products?.length) {
    return (
      <div className="flex flex-col items-center justify-center text-center gap-3 py-16 px-4">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
          className="text-muted-foreground/40" aria-hidden="true">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
        <h2 className="font-display m-0 text-lg font-semibold">{empty}</h2>
        {emptyHint && <p className="m-0 text-muted-foreground max-w-[46ch]">{emptyHint}</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-2 md:[grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
      {products.map((p) => <ProductCard key={p.id} product={p} />)}
    </div>
  );
}
