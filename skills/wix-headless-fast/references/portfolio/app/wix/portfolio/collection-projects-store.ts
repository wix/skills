// One collection's header + its projects, by slug, as a framework-free store — the logic behind
// useCollectionProjects, usable from React (the hook wraps it), from a static page's collection
// view, from Vue/Svelte, or as the specification for a port.
//
// SSR-friendly: pass BOTH `initialCollection` and `initialProjects` and nothing is fetched. With
// only the collection seeded, `start()` fetches its projects; with nothing seeded it resolves the
// slug first. `notFound` is the real not-found signal (collection stays null while loading too) —
// route a 404 off it, never off a transient null. One store per (slug, mount):
// createCollectionProjectsStore(slug, options), not a singleton.
import { fetchCollectionBySlug, fetchProjects } from "./portfolio";
import type { CollectionSummary, ProjectSummary } from "./types";

export interface CollectionProjectsStoreOptions {
  initialCollection?: CollectionSummary;
  initialProjects?: ProjectSummary[];
}

export interface CollectionProjectsState {
  /** null while loading AND when not found — check `notFound` to tell them apart. */
  collection: CollectionSummary | null;
  notFound: boolean;
  /** null while the first load is in flight — render skeletons, not an empty state. */
  projects: ProjectSummary[] | null;
  error: string | null;
}

export interface CollectionProjectsStore {
  getState(): CollectionProjectsState;
  subscribe(listener: () => void): () => void;
  /** Resolve the slug and load its projects unless both were seeded. Call once when mounted. */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
}

export function createCollectionProjectsStore(
  slug: string,
  { initialCollection, initialProjects }: CollectionProjectsStoreOptions = {},
): CollectionProjectsStore {
  let collection: CollectionSummary | null = initialCollection ?? null;
  let notFound = false;
  let projects: ProjectSummary[] | null = initialProjects ?? null;
  let error: string | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  let snapshot: CollectionProjectsState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  return {
    getState() {
      return (snapshot ??= { collection, notFound, projects, error });
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      if (initialCollection && initialProjects) return;
      (async () => {
        try {
          const col = initialCollection ?? (await fetchCollectionBySlug(slug));
          if (!started) return;
          if (!col) {
            notFound = true;
            projects = [];
            emit();
            return;
          }
          collection = col;
          emit();
          const list = await fetchProjects({ collectionId: col.id });
          if (started) { projects = list; emit(); }
        } catch (e) {
          if (!started) return;
          projects = [];
          error = e instanceof Error ? e.message : String(e);
          emit();
        }
      })();
    },
    stop() { started = false; },
  };
}
