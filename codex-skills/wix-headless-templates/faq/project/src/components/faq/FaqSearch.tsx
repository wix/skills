// REFERENCE search box: a labelled <input type="search"> debounced 250 ms into the store's query (Enter
// and clearing flush at once), with the results count announced to assistive tech. Correct and
// complete; per the skill's model you design and build your own on useFaq. Search runs client-side over
// the loaded questions and answers (the API has no substring search) — nothing here fetches.
import { useEffect, useRef, useState } from "react";
import { useFaq, type UseFaqOptions } from "../../hooks/faq/useFaq";

export interface FaqSearchProps extends UseFaqOptions {
  label?: string;
  placeholder?: string;
  /** Debounce in ms (default 250). */
  delay?: number;
}

export default function FaqSearch({ label = "Search questions", placeholder = "Search…", delay = 250, ...options }: FaqSearchProps) {
  const { query, setQuery, resultsCount, data } = useFaq(options);
  const [draft, setDraft] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The store's query can change from elsewhere (the accordion's "Clear search") — mirror it.
  useEffect(() => setDraft(query), [query]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flush = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setQuery(value);
  };
  const onChange = (value: string) => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) return flush("");
    timer.current = setTimeout(() => flush(value), delay);
  };

  const active = query.trim().length > 0 && data !== null;
  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); flush(draft); }} className="mb-6">
      <label htmlFor="faq-search" className="eyebrow mb-2 block">
        {label}
      </label>
      <input
        id="faq-search"
        type="search"
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-background px-4 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <p aria-live="polite" className="mt-2 min-h-5 text-sm text-muted-foreground">
        {active ? `${resultsCount} ${resultsCount === 1 ? "result" : "results"}` : ""}
      </p>
    </form>
  );
}
