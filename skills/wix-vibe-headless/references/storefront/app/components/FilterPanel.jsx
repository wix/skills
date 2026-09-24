// Gallery filters — result count, sort, price bounds, in-stock, option facets (colour swatches /
// pills), active chips. Mount once in your Shop with the useShop() result:  <FilterPanel shop={s} />
// On wide screens the controls sit inline above the grid and every change commits at once (results
// stay visible). Under md they live in a bottom sheet: changes are staged and commit on Apply;
// dismissing keeps the current results. Styled with base44 design tokens (shadcn Tailwind classes).
import { useEffect, useRef, useState } from "react";
import { SORTS } from "@/hooks/useShop";

export default function FilterPanel({ shop }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Price is one logical draft (min + max): commit a valid pair on blur/Enter, never per keystroke.
  const [minDraft, setMinDraft] = useState(String(shop.filters.minPrice ?? ""));
  const [maxDraft, setMaxDraft] = useState(String(shop.filters.maxPrice ?? ""));
  const [stagedChoices, setStagedChoices] = useState(shop.selectedChoiceIds);
  const [stagedStock, setStagedStock] = useState(!!shop.filters.inStockOnly);
  const panelRef = useRef(null);

  useEffect(() => {
    setMinDraft(String(shop.filters.minPrice ?? ""));
    setMaxDraft(String(shop.filters.maxPrice ?? ""));
  }, [shop.filters.minPrice, shop.filters.maxPrice]);

  // The sheet is an overlay: root-level, scrim, scroll lock, Escape, focus in and back.
  useEffect(() => {
    if (!sheetOpen) return;
    setStagedChoices(shop.selectedChoiceIds);
    setStagedStock(!!shop.filters.inStockOnly);
    const opener = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && setSheetOpen(false);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen]);

  const commitPrice = () => {
    const min = minDraft.trim(), max = maxDraft.trim();
    if (min && !Number.isFinite(Number(min))) return;
    if (max && !Number.isFinite(Number(max))) return;
    if (min && max && Number(min) > Number(max)) return;
    const next = { ...shop.filters, minPrice: min || undefined, maxPrice: max || undefined };
    if (next.minPrice !== shop.filters.minPrice || next.maxPrice !== shop.filters.maxPrice) shop.setFilters(next);
  };
  const applySheet = () => {
    for (const id of stagedChoices) if (!shop.selectedChoiceIds.includes(id)) shop.toggleChoice(id);
    for (const id of shop.selectedChoiceIds) if (!stagedChoices.includes(id)) shop.toggleChoice(id);
    commitPrice();
    if (stagedStock !== !!shop.filters.inStockOnly) shop.setFilters({ ...shop.filters, inStockOnly: stagedStock });
    setSheetOpen(false);
  };
  const activeCount = shop.selectedChoiceIds.length + (shop.filters.inStockOnly ? 1 : 0) + (shop.filters.minPrice || shop.filters.maxPrice ? 1 : 0);
  const choiceName = (id) => shop.facets.flatMap((f) => f.choices).find((c) => c.id === id)?.name ?? id;

  const facetGroups = (selected, onToggle) => shop.facets.map((facet) => (
    <fieldset key={facet.name} className="min-w-0">
      <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{facet.name}</legend>
      <div className="flex flex-wrap gap-1.5">
        {facet.choices.map((c) => {
          const on = selected.includes(c.id);
          return facet.isColor && c.colorCode ? (
            <button key={c.id} type="button" aria-pressed={on} aria-label={c.name} title={c.name} onClick={() => onToggle(c.id)}
              className={`h-7 w-7 rounded-full border-2 ${on ? "border-foreground" : "border-border"}`} style={{ backgroundColor: c.colorCode }} />
          ) : (
            <button key={c.id} type="button" aria-pressed={on} onClick={() => onToggle(c.id)}
              className={`rounded-full border px-3 py-1 text-sm ${on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground"}`}>
              {c.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  ));

  const priceInputs = (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="filter-min">Min price</label>
      <input id="filter-min" inputMode="decimal" placeholder="Min" value={minDraft} onChange={(e) => setMinDraft(e.target.value)}
        onBlur={commitPrice} onKeyDown={(e) => e.key === "Enter" && commitPrice()}
        className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
      <span className="text-muted-foreground">–</span>
      <label className="sr-only" htmlFor="filter-max">Max price</label>
      <input id="filter-max" inputMode="decimal" placeholder="Max" value={maxDraft} onChange={(e) => setMaxDraft(e.target.value)}
        onBlur={commitPrice} onKeyDown={(e) => e.key === "Enter" && commitPrice()}
        className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm" />
    </div>
  );

  const chips = shop.hasActiveFilters && (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {shop.selectedChoiceIds.map((id) => (
        <button key={id} type="button" onClick={() => shop.toggleChoice(id)} className="rounded-full bg-secondary px-2.5 py-1 text-xs text-foreground">{choiceName(id)} ×</button>
      ))}
      {shop.filters.inStockOnly && (
        <button type="button" onClick={() => shop.setFilters({ ...shop.filters, inStockOnly: false })} className="rounded-full bg-secondary px-2.5 py-1 text-xs">In stock ×</button>
      )}
      {(shop.filters.minPrice || shop.filters.maxPrice) && (
        <button type="button" onClick={() => shop.setFilters({ ...shop.filters, minPrice: undefined, maxPrice: undefined })} className="rounded-full bg-secondary px-2.5 py-1 text-xs">
          Price {shop.filters.minPrice ?? "…"}–{shop.filters.maxPrice ?? "…"} ×
        </button>
      )}
      <button type="button" onClick={shop.clearFilters} className="text-xs text-muted-foreground underline">Clear all</button>
    </div>
  );

  return (
    <div className="mb-6 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {shop.total != null ? `${shop.total} ${shop.total === 1 ? "product" : "products"}` : ""}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setSheetOpen(true)} className="rounded-md border border-border px-3 py-1.5 text-sm md:hidden">
            Filters{activeCount ? ` (${activeCount})` : ""}
          </button>
          <label className="sr-only" htmlFor="shop-sort">Sort by</label>
          <select id="shop-sort" value={shop.sort} onChange={(e) => shop.setSort(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm">
            {Object.entries(SORTS).map(([key, { label }]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </div>

      {/* Inline controls — wide screens; every change commits immediately, results stay visible. */}
      <div className="hidden flex-wrap items-end gap-6 md:flex">
        {facetGroups(shop.selectedChoiceIds, shop.toggleChoice)}
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Price</legend>
          {priceInputs}
        </fieldset>
        <label className="flex items-center gap-2 pb-1.5 text-sm">
          <input type="checkbox" checked={!!shop.filters.inStockOnly} onChange={(e) => shop.setFilters({ ...shop.filters, inStockOnly: e.target.checked })} />
          In stock only
        </label>
      </div>
      {chips}

      {/* Sheet — small screens; staged until Apply. */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-foreground/40 md:hidden" onClick={() => setSheetOpen(false)}>
          <section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Filters" onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-background p-5 text-foreground outline-none">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">Filters</h2>
              <button type="button" aria-label="Close filters" onClick={() => setSheetOpen(false)} className="text-xl leading-none">×</button>
            </div>
            <div className="flex flex-col gap-5">
              {facetGroups(stagedChoices, (id) => setStagedChoices((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])))}
              <fieldset>
                <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Price</legend>
                {priceInputs}
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={stagedStock} onChange={(e) => setStagedStock(e.target.checked)} /> In stock only
              </label>
            </div>
            <div className="sticky bottom-0 mt-5 flex gap-2 bg-background pt-3">
              <button type="button" onClick={() => { setStagedChoices([]); setStagedStock(false); setMinDraft(""); setMaxDraft(""); }}
                className="flex-1 rounded-full border border-border py-2.5 text-sm">Clear</button>
              <button type="button" onClick={applySheet} className="flex-1 rounded-full bg-primary py-2.5 text-sm font-semibold text-primary-foreground">Apply</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
