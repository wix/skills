// Events listing + category filter. SSR-friendly: pass server-fetched data as `initialEvents`
// (Astro frontmatter / server component) and no client fetch happens; a SPA passes nothing.
// The category menu is DERIVED from the loaded events (the categories management API is
// admin-scope — visitors can't query it); filtering is client-side.
import { useEffect, useMemo, useState } from "react";
import { fetchEvents } from "../../wix/events/events";
import type { EventSummary } from "../../wix/events/types";

export interface UseEventsOptions {
  initialEvents?: EventSummary[];
}

export interface UseEvents {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  events: EventSummary[] | null;
  /** Unique assigned categories in listing order — render a filter bar only when > 1. */
  categories: { id: string; name: string }[];
  activeCategoryId: string | null;
  setActiveCategoryId: (id: string | null) => void;
  error: string | null;
}

export function useEvents({ initialEvents }: UseEventsOptions = {}): UseEvents {
  const [all, setAll] = useState<EventSummary[] | null>(initialEvents ?? null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!initialEvents) {
      fetchEvents()
        .then((e) => alive && setAll(e))
        .catch((e) => {
          if (!alive) return;
          setAll([]);
          setError(e instanceof Error ? e.message : String(e));
        });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of all ?? []) for (const c of e.categories) if (!seen.has(c.id)) seen.set(c.id, c.name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [all]);

  const events = useMemo(() => {
    if (all === null) return null;
    return activeCategoryId
      ? all.filter((e) => e.categories.some((c) => c.id === activeCategoryId))
      : all;
  }, [all, activeCategoryId]);

  return { events, categories, activeCategoryId, setActiveCategoryId, error };
}
