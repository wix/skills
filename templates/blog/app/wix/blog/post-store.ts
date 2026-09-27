// One post as a framework-free store — the logic behind usePost, usable from React (usePost wraps
// it), from a static page's post view, from Vue/Svelte, or as the specification for a port. Loads
// the post by slug (unless seeded) and the FULL taxonomy lists (blog taxonomies are small, fetched
// once), and resolves the post's category/tag chips from them — never per-id lookups in a render.
//
// SSR-friendly: pass the server-fetched PostDetail as `initialPost` (and the taxonomy) and no client
// fetch happens; a SPA passes only the slug. One store per post surface: createPostStore().
import { fetchPostBySlug } from "./posts";
import { fetchBlogCategories, fetchBlogTags } from "./taxonomy";
import type { BlogCategory, BlogTag, PostDetail } from "./types";

export interface PostStoreOptions {
  slug: string;
  initialPost?: PostDetail;
  initialCategories?: BlogCategory[];
  initialTags?: BlogTag[];
}

export interface PostState {
  /** null while loading (render a skeleton) AND when not found — disambiguate via notFound. */
  post: PostDetail | null;
  /** True once the slug definitively resolved to nothing — render a not-found state. */
  notFound: boolean;
  /** This post's categories/tags, resolved to full objects (display .label, route by .slug). */
  categories: BlogCategory[];
  tags: BlogTag[];
  error: string | null;
}

export interface PostStore {
  getState(): PostState;
  subscribe(listener: () => void): () => void;
  /** Fetch the post (unless `initialPost` matches the slug) and the taxonomy (unless seeded). Call once when mounted. */
  start(): void;
  stop(): void;
}

export function createPostStore({ slug, initialPost, initialCategories, initialTags }: PostStoreOptions): PostStore {
  let post: PostDetail | null = initialPost ?? null;
  let notFound = false;
  let allCategories: BlogCategory[] = initialCategories ?? [];
  let allTags: BlogTag[] = initialTags ?? [];
  let error: string | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  let snapshot: PostState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  function getState(): PostState {
    if (snapshot) return snapshot;
    snapshot = {
      post,
      notFound,
      categories: post ? allCategories.filter((c) => post!.categoryIds.includes(c.id)) : [],
      tags: post ? allTags.filter((t) => post!.tagIds.includes(t.id)) : [],
      error,
    };
    return snapshot;
  }

  return {
    getState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      if (!initialPost || initialPost.slug !== slug) {
        post = null; notFound = false; emit();
        fetchPostBySlug(slug)
          .then((p) => { if (!started) return; if (p) post = p; else notFound = true; emit(); })
          .catch((e) => { if (started) { error = e instanceof Error ? e.message : String(e); emit(); } });
      }
      if (!initialCategories) fetchBlogCategories().then((c) => { if (started) { allCategories = c; emit(); } });
      if (!initialTags) fetchBlogTags().then((t) => { if (started) { allTags = t; emit(); } });
    },
    stop() { started = false; },
  };
}
