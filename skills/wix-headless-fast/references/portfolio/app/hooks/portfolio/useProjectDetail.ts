// Project detail + media gallery, by slug. SSR-friendly: pass both `initial*` and no client
// fetch happens. `notFound` is the real not-found signal (project stays null while loading).
import { useEffect, useState } from "react";
import { fetchProjectBySlug, fetchProjectGallery } from "../../wix/portfolio/portfolio";
import type { GalleryItem, ProjectDetail } from "../../wix/portfolio/types";

export interface UseProjectDetailOptions {
  initialProject?: ProjectDetail;
  initialItems?: GalleryItem[];
}

export interface UseProjectDetail {
  /** null while loading AND when not found — check `notFound` to tell them apart. */
  project: ProjectDetail | null;
  notFound: boolean;
  /** null while the gallery load is in flight — render skeletons, not an empty state. */
  items: GalleryItem[] | null;
  error: string | null;
}

export function useProjectDetail(
  slug: string,
  { initialProject, initialItems }: UseProjectDetailOptions = {},
): UseProjectDetail {
  const [project, setProject] = useState<ProjectDetail | null>(initialProject ?? null);
  const [notFound, setNotFound] = useState(false);
  const [items, setItems] = useState<GalleryItem[] | null>(initialItems ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialProject && initialItems) return;
    let alive = true;
    (async () => {
      try {
        const proj = initialProject ?? (await fetchProjectBySlug(slug));
        if (!alive) return;
        if (!proj) {
          setNotFound(true);
          setItems([]);
          return;
        }
        setProject(proj);
        const gallery = await fetchProjectGallery(proj.id);
        if (alive) setItems(gallery);
      } catch (e) {
        if (!alive) return;
        setItems([]);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return { project, notFound, items, error };
}
