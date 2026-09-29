// Project detail + media gallery, by slug, as a framework-free store — the logic behind
// useProjectDetail, usable from React (the hook wraps it), from a static page's project view,
// from Vue/Svelte, or as the specification for a port.
//
// SSR-friendly: pass BOTH `initialProject` and `initialItems` and nothing is fetched. With only
// the project seeded, `start()` fetches its gallery; with nothing seeded it resolves the slug
// first. `notFound` is the real not-found signal (project stays null while loading). One store
// per (slug, mount): createProjectDetailStore(slug, options), not a singleton.
import { fetchProjectBySlug, fetchProjectGallery } from "./portfolio";
import type { GalleryItem, ProjectDetail } from "./types";

export interface ProjectDetailStoreOptions {
  initialProject?: ProjectDetail;
  initialItems?: GalleryItem[];
}

export interface ProjectDetailState {
  /** null while loading AND when not found — check `notFound` to tell them apart. */
  project: ProjectDetail | null;
  notFound: boolean;
  /** null while the gallery load is in flight — render skeletons, not an empty state. */
  items: GalleryItem[] | null;
  error: string | null;
}

export interface ProjectDetailStore {
  getState(): ProjectDetailState;
  subscribe(listener: () => void): () => void;
  /** Resolve the slug and load its gallery unless both were seeded. Call once when mounted. */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
}

export function createProjectDetailStore(
  slug: string,
  { initialProject, initialItems }: ProjectDetailStoreOptions = {},
): ProjectDetailStore {
  let project: ProjectDetail | null = initialProject ?? null;
  let notFound = false;
  let items: GalleryItem[] | null = initialItems ?? null;
  let error: string | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  let snapshot: ProjectDetailState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  return {
    getState() {
      return (snapshot ??= { project, notFound, items, error });
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      if (initialProject && initialItems) return;
      (async () => {
        try {
          const proj = initialProject ?? (await fetchProjectBySlug(slug));
          if (!started) return;
          if (!proj) {
            notFound = true;
            items = [];
            emit();
            return;
          }
          project = proj;
          emit();
          const gallery = await fetchProjectGallery(proj.id);
          if (started) { items = gallery; emit(); }
        } catch (e) {
          if (!started) return;
          items = [];
          error = e instanceof Error ? e.message : String(e);
          emit();
        }
      })();
    },
    stop() { started = false; },
  };
}
