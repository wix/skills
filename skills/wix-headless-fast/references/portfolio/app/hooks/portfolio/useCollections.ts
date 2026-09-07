// Collections gallery. SSR-friendly: pass server-fetched data as `initialCollections`
// (Astro frontmatter / server component) and no client fetch happens; a SPA passes nothing.
import { useEffect, useState } from "react";
import { fetchCollections } from "../../wix/portfolio/portfolio";
import type { CollectionSummary } from "../../wix/portfolio/types";

export interface UseCollectionsOptions {
  initialCollections?: CollectionSummary[];
}

export interface UseCollections {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  collections: CollectionSummary[] | null;
  error: string | null;
}

export function useCollections({ initialCollections }: UseCollectionsOptions = {}): UseCollections {
  const [collections, setCollections] = useState<CollectionSummary[] | null>(initialCollections ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!initialCollections) {
      fetchCollections()
        .then((c) => alive && setCollections(c))
        .catch((e) => {
          if (!alive) return;
          setCollections([]);
          setError(e instanceof Error ? e.message : String(e));
        });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { collections, error };
}
