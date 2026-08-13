// Services / listing page — lists visitor-visible services with a category filter, plus the empty
// and failed states. Thin view over useServices (all data lives in the hook). Styled with base44
// design tokens (shadcn Tailwind classes).
import { useServices } from "@/hooks/useServices";
import ServiceGrid from "@/components/ServiceGrid";

export default function Services() {
  const s = useServices({ limit: 24 });

  if (s.error) {
    return (
      <main className="max-w-[1200px] mx-auto p-4">
        <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="m-0 text-muted-foreground">{s.error}</p>
          <button onClick={s.retry}
            className="border border-border bg-card text-foreground rounded-sm py-2 px-4 cursor-pointer text-sm">
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-[1200px] mx-auto p-4">
      <h1 className="font-display mb-4">{s.activeCategory?.name || "Services"}</h1>

      {s.categories.length > 0 && (
        <nav aria-label="Categories" className="flex flex-wrap gap-2 mb-6">
          <CategoryChip active={!s.activeCategory} onClick={() => s.setActiveCategory(null)}>All</CategoryChip>
          {s.categories.map((c) => (
            <CategoryChip key={c.id} active={s.activeCategory?.id === c.id} onClick={() => s.setActiveCategory(c)}>
              {c.name}
            </CategoryChip>
          ))}
        </nav>
      )}

      {s.services === null
        ? <ServiceGridSkeleton />
        : <>
            <ServiceGrid
              services={s.services}
              empty={s.activeCategory
                ? `Nothing in ${s.activeCategory.name} yet.`
                : "No services yet — add one from your Wix dashboard."}
            />
            {s.nextOffset != null && (
              <div className="text-center mt-6">
                <button onClick={s.loadMore}
                  className="px-5 py-2.5 cursor-pointer bg-card text-foreground border border-border rounded-sm">
                  Load more
                </button>
              </div>
            )}
          </>}
    </main>
  );
}

function CategoryChip({ active, onClick, children }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`py-1.5 px-3 cursor-pointer text-sm rounded-sm border ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"
      }`}>{children}</button>
  );
}

// Matches ServiceCard's 4:3 image + three text lines, so nothing shifts when the services land.
function ServiceGridSkeleton({ count = 6 }) {
  return (
    <div className="grid gap-4 grid-cols-2 md:[grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="aspect-[4/3] bg-muted animate-pulse" />
          <div className="p-3 flex flex-col gap-2">
            <div className="flex justify-between gap-3">
              <div className="h-3.5 w-1/2 bg-muted rounded-sm animate-pulse" />
              <div className="h-3.5 w-1/5 bg-muted rounded-sm animate-pulse" />
            </div>
            <div className="h-3 w-3/4 bg-muted rounded-sm animate-pulse" />
            <div className="h-2.5 w-1/3 bg-muted rounded-sm animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
