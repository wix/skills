// One collection's header + its projects, by slug. SSR-friendly: pass both `initial*` and no
// client fetch happens. `notFound` is the real not-found signal (collection stays null while
// loading too) — route a 404 off it, never off a transient null.
import { useEffect, useState } from "react";
import { fetchCollectionBySlug, fetchProjects } from "../../wix/portfolio/portfolio";
import type { CollectionSummary, ProjectSummary } from "../../wix/portfolio/types";

export interface UseCollectionProjectsOptions {
  initialCollection?: CollectionSummary;
  initialProjects?: ProjectSummary[];
}

export interface UseCollectionProjects {
  /** null while loading AND when not found — check `notFound` to tell them apart. */
  collection: CollectionSummary | null;
  notFound: boolean;
  /** null while the first load is in flight — render skeletons, not an empty state. */
  projects: ProjectSummary[] | null;
  error: string | null;
}

export function useCollectionProjects(
  slug: string,
  { initialCollection, initialProjects }: UseCollectionProjectsOptions = {},
): UseCollectionProjects {
  const [collection, setCollection] = useState<CollectionSummary | null>(initialCollection ?? null);
  const [notFound, setNotFound] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(initialProjects ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialCollection && initialProjects) return;
    let alive = true;
    (async () => {
      try {
        const col = initialCollection ?? (await fetchCollectionBySlug(slug));
        if (!alive) return;
        if (!col) {
          setNotFound(true);
          setProjects([]);
          return;
        }
        setCollection(col);
        const projs = await fetchProjects({ collectionId: col.id });
        if (alive) setProjects(projs);
      } catch (e) {
        if (!alive) return;
        setProjects([]);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return { collection, notFound, projects, error };
}
