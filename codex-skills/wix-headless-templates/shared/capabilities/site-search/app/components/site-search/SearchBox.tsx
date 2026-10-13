// The header search box — wire as-is in your SiteLayout header, client:only (browser state):
//   <SearchBox client:only="react" placeholder="Search products, posts…" />
// A search form with a suggestions listbox: grouped rows with the matched words in <mark>, arrows
// move, Enter follows the active row or opens the results page for the phrase, Escape closes. The
// debounce and the request live in the suggest store; this component renders and routes. Routing-
// free: default navigation is `location.assign`; pass `onNavigate` to route client-side. Styled from
// the @theme tokens.
import { useId, useRef } from "react";
import { useSuggest } from "../../hooks/site-search/useSuggest";
import { searchHref } from "../../wix/site-search/search-core";
import { imgAttrs } from "../../wix/media";

interface Props {
  placeholder?: string;
  /** The results page (default "/search"); its `q` and `type` query params are the store's. */
  searchPath?: string;
  onNavigate?: (href: string) => void;
  minChars?: number;
  debounceMs?: number;
  /** Suggestions per type (default 4). */
  limit?: number;
  className?: string;
}

const MARK = "[&_mark]:rounded-sm [&_mark]:bg-secondary [&_mark]:px-0.5 [&_mark]:text-foreground";

export default function SearchBox({ placeholder = "Search", searchPath = "/search", onNavigate, minChars, debounceMs, limit, className = "" }: Props) {
  const s = useSuggest({ minChars, debounceMs, limit });
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = (href: string) => (onNavigate ? onNavigate(href) : window.location.assign(href));

  const go = () => {
    const action = s.submit();
    if (!action) return;
    s.hide();
    navigate(action.kind === "hit" ? action.href : searchHref(action.q, action.type, searchPath));
  };

  let rowIndex = -1;
  return (
    <form
      role="search"
      className={`relative ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={s.input}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={s.open}
        aria-activedescendant={s.open && s.activeIndex >= 0 ? `${listId}-${s.activeIndex}` : undefined}
        onChange={(e) => s.setInput(e.target.value)}
        onFocus={s.show}
        onBlur={s.hide}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            s.moveActive(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            s.moveActive(-1);
          } else if (e.key === "Escape") {
            s.hide();
          }
        }}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {s.loading && <span aria-hidden="true" className="absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 animate-pulse rounded-full bg-muted-foreground/40" />}
      <ul
        id={listId}
        role="listbox"
        aria-label="Suggestions"
        hidden={!s.open}
        className="absolute left-0 right-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-border bg-background p-1 shadow-lg"
      >
        {s.groups.map((group) => (
          <li key={group.type} role="presentation">
            <ul role="group" aria-label={group.label}>
              <li role="presentation" className="px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </li>
              {group.hits.map((hit) => {
                const index = ++rowIndex;
                const active = index === s.activeIndex;
                const img = imgAttrs(hit.imageUrl, "32px");
                return (
                  <li
                    key={hit.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => s.setActive(index)}
                    // mousedown, not click: the input blurs (and the list closes) before a click lands.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      s.setActive(index);
                      go();
                    }}
                    className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-foreground ${active ? "bg-secondary" : ""}`}
                  >
                    {"src" in img ? <img {...img} alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded object-cover" /> : <span aria-hidden="true" className="h-8 w-8 shrink-0 rounded bg-secondary" />}
                    <span className={`truncate ${MARK}`} dangerouslySetInnerHTML={{ __html: hit.titleHtml }} />
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
        {s.input.trim() && (
          <li
            role="option"
            aria-selected={false}
            onMouseDown={(e) => {
              e.preventDefault();
              s.setActive(-1);
              go();
            }}
            className="mt-1 cursor-pointer rounded-md border-t border-border px-2 py-2 text-sm text-muted-foreground"
          >
            See all results for “{s.input.trim()}”
          </li>
        )}
      </ul>
    </form>
  );
}
