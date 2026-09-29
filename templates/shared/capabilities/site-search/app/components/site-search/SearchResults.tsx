// The results surface — wire as-is on the search page (pages/search.astro mounts it), or use it as
// the reference for your own on useSearch:
//   <SearchResults client:load q={q} type={type} initialGroups={…} initialIndexed={…} initialPage={…} />
//
// Grouped view (type null): one section per document type with its count and a "Show all" that
// switches to that type. Single-type view: a back link, the type's sorts, the facets the type
// offers (products: collections, availability, price bounds), the rows, "Load more". Skeleton rows
// while the first load is in flight, an honest empty state, an error state with retry. The view is
// mirrored into the query string (`?q=&type=`) with replaceState so a result page is a link a visitor
// can share and reload; `syncUrl={false}` for a surface that isn't the page's subject. Routing-free:
// links are plain <a>; pass `onNavigate` to route client-side. Styled from the @theme tokens.
import { useEffect, useState } from "react";
import { useSearch } from "../../hooks/site-search/useSearch";
import { SORTS } from "../../wix/site-search/search-core";
import type { SearchDocType, SearchFilter, SearchGroup, SearchPage, SearchSort } from "../../wix/site-search/types";
import SearchHit from "./SearchHit";

interface Props {
  q: string;
  type?: SearchDocType | null;
  initialGroups?: SearchGroup[] | null;
  initialIndexed?: boolean | null;
  initialPage?: SearchPage | null;
  syncUrl?: boolean;
  onNavigate?: (href: string) => void;
}

const PRICE_FIELD = "discountedPriceNumeric";

function writeUrl(q: string, type: SearchDocType | null): void {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search);
  p.set("q", q);
  if (type) p.set("type", type);
  else p.delete("type");
  const next = `${window.location.pathname}?${p.toString()}${window.location.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
}

export default function SearchResults({ q, type = null, initialGroups = null, initialIndexed = null, initialPage = null, syncUrl = true, onNavigate }: Props) {
  const search = useSearch({ q, type, initialGroups, initialIndexed, initialPage });
  useEffect(() => {
    if (syncUrl && search.q) writeUrl(search.q, search.type);
  }, [syncUrl, search.q, search.type]);

  const total = search.type ? (search.page?.total ?? null) : search.groups ? search.groups.reduce((n, g) => n + g.total, 0) : null;

  return (
    <section aria-labelledby="search-heading" className="flex flex-col gap-8">
      <header>
        <h1 id="search-heading" className="text-3xl font-bold tracking-tight text-foreground">
          {search.q ? (
            <>
              Results for <span className="text-muted-foreground">“{search.q}”</span>
            </>
          ) : (
            "Search"
          )}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
          {!search.q ? "Type a word or two to search this site." : total != null ? `${total} ${total === 1 ? "result" : "results"}` : ""}
        </p>
      </header>

      {search.type && (
        <TypeToolbar
          type={search.type}
          sorts={search.sorts}
          sort={search.sort}
          onSort={search.setSort}
          onBack={() => search.setType(null)}
          label={search.groups?.find((g) => g.type === search.type)?.label ?? search.page?.hits[0]?.type ?? search.type}
        />
      )}

      {search.error ? (
        <div role="alert" className="rounded-lg border border-border p-6 text-sm">
          <p className="text-foreground">Search isn't available right now. {search.error}</p>
          <button type="button" onClick={search.retry} className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Try again
          </button>
        </div>
      ) : search.loading ? (
        <Skeleton />
      ) : search.type ? (
        <div className="flex flex-col gap-8 md:flex-row">
          {search.type === "products" && search.page && <ProductFacets page={search.page} filter={search.filter} onFilter={search.setFilter} />}
          <div className="flex-1">
            {search.page && search.page.hits.length === 0 ? (
              <Empty q={search.q} indexed={null} />
            ) : (
              <ul className="divide-y divide-border">
                {search.page?.hits.map((hit) => (
                  <li key={hit.id}>
                    <SearchHit hit={hit} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            )}
            {search.hasMore && (
              <div className="mt-6 text-center">
                <button
                  type="button"
                  disabled={search.loadingMore}
                  onClick={() => void search.loadMore()}
                  className="rounded-md border border-border px-5 py-2 text-sm font-medium text-foreground disabled:opacity-60"
                >
                  {search.loadingMore ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : search.groups && search.groups.length === 0 ? (
        search.q ? <Empty q={search.q} indexed={search.indexed} /> : null
      ) : (
        <div className="flex flex-col gap-10">
          {search.groups?.map((group) => (
            <section key={group.type} aria-labelledby={`group-${group.type}`}>
              <div className="mb-2 flex items-baseline justify-between gap-4">
                <h2 id={`group-${group.type}`} className="text-lg font-semibold text-foreground">
                  {group.label} <span className="text-sm font-normal text-muted-foreground">({group.total})</span>
                </h2>
                {group.total > group.hits.length && (
                  <button type="button" onClick={() => search.setType(group.type)} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
                    Show all {group.total}
                  </button>
                )}
              </div>
              <ul className="divide-y divide-border">
                {group.hits.map((hit) => (
                  <li key={hit.id}>
                    <SearchHit hit={hit} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function TypeToolbar({ type, label, sorts, sort, onSort, onBack }: { type: SearchDocType; label: string; sorts: SearchSort[]; sort: SearchSort; onSort: (s: SearchSort) => void; onBack: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
      <button type="button" onClick={onBack} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        ← All results
      </button>
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {sorts.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Sort
            <select value={sort} onChange={(e) => onSort(e.target.value as SearchSort)} aria-label={`Sort ${type}`} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground">
              {sorts.map((s) => (
                <option key={s} value={s}>
                  {SORTS[s].label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

// Products are the one type with facets the index returns: collections and availability as terms,
// the price bounds as min/max aggregations. The price pair commits on blur or Enter, valid only.
function ProductFacets({ page, filter, onFilter }: { page: SearchPage; filter: SearchFilter; onFilter: (f: SearchFilter) => void }) {
  const collections = page.facets.terms.collections ?? [];
  const range = page.facets.ranges[PRICE_FIELD];
  const [min, setMin] = useState(filter.minPrice != null ? String(filter.minPrice) : "");
  const [max, setMax] = useState(filter.maxPrice != null ? String(filter.maxPrice) : "");
  const active = (filter.collections?.length ?? 0) + (filter.inStockOnly ? 1 : 0) + (filter.minPrice != null || filter.maxPrice != null ? 1 : 0);

  const toggle = (name: string) => {
    const current = filter.collections ?? [];
    onFilter({ ...filter, collections: current.includes(name) ? current.filter((c) => c !== name) : [...current, name] });
  };
  const commitPrice = () => {
    const lo = min === "" ? undefined : Number(min);
    const hi = max === "" ? undefined : Number(max);
    if ((lo != null && !Number.isFinite(lo)) || (hi != null && !Number.isFinite(hi)) || (lo != null && hi != null && lo > hi)) return;
    if (lo === filter.minPrice && hi === filter.maxPrice) return;
    onFilter({ ...filter, minPrice: lo, maxPrice: hi });
  };

  if (!collections.length && !range) return null;
  return (
    <aside aria-label="Filters" className="w-full shrink-0 md:w-64">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Filters</h2>
        {active > 0 && (
          <button
            type="button"
            onClick={() => {
              setMin("");
              setMax("");
              onFilter({});
            }}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear
          </button>
        )}
      </div>
      {collections.length > 0 && (
        <fieldset className="mt-4">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Collections</legend>
          <ul className="mt-2 flex flex-col gap-1">
            {collections.map((c) => (
              <li key={c.value}>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={!!filter.collections?.includes(c.value)} onChange={() => toggle(c.value)} />
                  <span className="flex-1">{c.value}</span>
                  <span className="text-xs text-muted-foreground">{c.count}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <fieldset className="mt-4">
        <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Availability</legend>
        <label className="mt-2 flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={!!filter.inStockOnly} onChange={(e) => onFilter({ ...filter, inStockOnly: e.target.checked || undefined })} />
          In stock only
        </label>
      </fieldset>
      {range && (
        <fieldset className="mt-4">
          <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Price{range.min != null && range.max != null ? ` (${range.min} – ${range.max})` : ""}
          </legend>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              inputMode="decimal"
              placeholder={range.min != null ? String(range.min) : "Min"}
              aria-label="Minimum price"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => e.key === "Enter" && commitPrice()}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            />
            <span className="text-muted-foreground">–</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder={range.max != null ? String(range.max) : "Max"}
              aria-label="Maximum price"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => e.key === "Enter" && commitPrice()}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            />
          </div>
        </fieldset>
      )}
    </aside>
  );
}

function Empty({ q, indexed }: { q: string; indexed: boolean | null }) {
  return (
    <div className="rounded-lg border border-border p-8 text-center">
      <p className="text-base font-medium text-foreground">No results for “{q}”</p>
      {indexed === false ? (
        <p className="mt-2 text-sm text-muted-foreground">Search is still being set up on this site. Please try again in a moment.</p>
      ) : (
        <ul className="mt-2 text-sm text-muted-foreground">
          <li>Check the spelling</li>
          <li>Try fewer or more general words</li>
        </ul>
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <ul aria-busy="true" aria-label="Loading results" className="divide-y divide-border">
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="flex gap-4 p-3">
          <div className="h-20 w-20 shrink-0 animate-pulse rounded-md bg-secondary" />
          <div className="flex-1">
            <div className="h-4 w-1/2 animate-pulse rounded bg-secondary" />
            <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-secondary" />
            <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-secondary" />
          </div>
        </li>
      ))}
    </ul>
  );
}
