// Shop / catalog page — thin view over useShop (all logic lives in the hook). Category menu, sort,
// cursor paging, plus the loading / empty / failed states a seeded-separately catalog needs.
// Styled with base44 design tokens (shadcn Tailwind classes).
import { useShop, SORTS } from "@/hooks/useShop";
import ProductGrid from "@/components/ProductGrid";

export default function Shop() {
  const s = useShop();
  const showCategories = s.categories.length > 0;

  return (
    <main className="max-w-[1200px] mx-auto p-4">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <h1 className="font-display m-0">{s.activeCategory?.name || "Shop"}</h1>
        {s.products?.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Sort
            <select value={s.sort} onChange={(e) => s.setSort(e.target.value)}
              className="py-1.5 px-2 border border-input rounded-sm bg-background text-foreground text-sm">
              {Object.entries(SORTS).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        )}
      </div>

      {showCategories && (
        <nav aria-label="Categories" className="flex flex-wrap gap-2 mb-6">
          <CategoryChip active={!s.activeCategory} onClick={() => s.setActiveCategory(null)}>All</CategoryChip>
          {s.categories.map((c) => (
            <CategoryChip key={c.id} active={s.activeCategory?.id === c.id} onClick={() => s.setActiveCategory(c)}>
              {c.name}
            </CategoryChip>
          ))}
        </nav>
      )}

      {s.error ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="m-0 text-muted-foreground">{s.error}</p>
          <button onClick={s.retry}
            className="border border-border bg-card text-foreground rounded-sm py-2 px-4 cursor-pointer text-sm">Try again</button>
        </div>
      ) : (
        <>
          <ProductGrid
            products={s.products}
            loading={s.loading}
            empty={s.activeCategory ? `Nothing in ${s.activeCategory.name} yet.` : "No products yet."}
            emptyHint={s.activeCategory
              ? "Pick another category, or add products to this one from your Wix dashboard."
              : "Add products in your Wix dashboard and they'll appear here — no redeploy needed."}
          />

          {s.hasMore && (
            <div className="flex justify-center mt-8">
              <button onClick={s.loadMore} disabled={s.loadingMore}
                className="border border-border bg-card text-foreground rounded-sm py-2.5 px-6 cursor-pointer text-sm font-semibold disabled:opacity-60 disabled:cursor-wait">
                {s.loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
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
