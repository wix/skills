// The blog feed as a framework-free store — the logic behind useBlogFeed, usable from React
// (useBlogFeed wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and
// render), or as the specification for a port. State, actions, subscribe/getState, emit after every
// change — the same shape as storefront's shop-store.
//
// Category and tag filters are applied by Wix (fetchPosts), never to a page already in hand; the
// two are mutually exclusive — setting one clears the other. A changed filter starts a fresh cursor
// chain; a late response from a superseded query is dropped. Paging appends by cursor.
//
// SSR-friendly: seed with `initialPage` (and `initialCategories`/`initialTags`) and the first,
// unfiltered page renders at once with no client fetch; a SPA passes nothing and `start()` fetches.
// One store per mounted feed (a page can hold a feed and a "latest posts" rail): createBlogFeedStore().
import { fetchPosts } from "./posts";
import { fetchBlogCategories, fetchBlogTags } from "./taxonomy";
import type { BlogCategory, BlogTag, PostPage, PostSummary } from "./types";

export interface BlogFeedStoreOptions {
  initialPage?: PostPage;
  initialCategories?: BlogCategory[];
  initialTags?: BlogTag[];
  pageSize?: number;
}

/** Everything a feed surface renders from. Read it with getState() or through a subscription. */
export interface BlogFeedState {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  posts: PostSummary[] | null;
  categories: BlogCategory[];
  tags: BlogTag[];
  activeCategoryId: string | null;
  activeTagId: string | null;
  /** True when another page exists — render a "load more" control on it. */
  hasMore: boolean;
  loadingMore: boolean;
  error: string | null;
}

export interface BlogFeedStore {
  getState(): BlogFeedState;
  subscribe(listener: () => void): () => void;
  /** Fetch the taxonomy (unless seeded) and the first page (unless seeded and unfiltered). Call once when mounted. */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
  /** Server-side filter; clears the tag filter. */
  setActiveCategoryId(id: string | null): void;
  /** Server-side filter; clears the category filter. */
  setActiveTagId(id: string | null): void;
  loadMore(): Promise<void>;
}

export function createBlogFeedStore({ initialPage, initialCategories, initialTags, pageSize = 20 }: BlogFeedStoreOptions = {}): BlogFeedStore {
  let posts: PostSummary[] | null = initialPage?.posts ?? null;
  let cursor: string | null = initialPage?.nextCursor ?? null;
  let categories: BlogCategory[] = initialCategories ?? [];
  let tags: BlogTag[] = initialTags ?? [];
  let activeCategoryId: string | null = null;
  let activeTagId: string | null = null;
  let loadingMore = false;
  let error: string | null = null;
  let started = false;
  let generation = 0; // bumped by every filter change and stop(); a response from an older generation is dropped
  const listeners = new Set<() => void>();
  let snapshot: BlogFeedState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  function getState(): BlogFeedState {
    if (snapshot) return snapshot;
    snapshot = { posts, categories, tags, activeCategoryId, activeTagId, hasMore: cursor !== null, loadingMore, error };
    return snapshot;
  }

  // The first page for the current filter. The unfiltered page may have come from the server —
  // fetch only when it didn't, or when a filter is active (filters are server-side).
  function query(): void {
    if (!started) return;
    const id = ++generation;
    loadingMore = false;
    if (activeCategoryId === null && activeTagId === null && initialPage) {
      posts = initialPage.posts; cursor = initialPage.nextCursor; error = null;
      emit();
      return;
    }
    posts = null; cursor = null; error = null;
    emit();
    fetchPosts({ limit: pageSize, categoryId: activeCategoryId, tagId: activeTagId })
      .then((page) => {
        if (generation !== id) return; // superseded — drop it
        posts = page.posts; cursor = page.nextCursor;
        emit();
      })
      .catch((e) => {
        if (generation !== id) return;
        posts = []; cursor = null;
        error = e instanceof Error ? e.message : String(e);
        emit();
      });
  }

  return {
    getState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      if (!initialCategories) fetchBlogCategories().then((c) => { if (started) { categories = c; emit(); } });
      if (!initialTags) fetchBlogTags().then((t) => { if (started) { tags = t; emit(); } });
      query();
    },
    stop() { started = false; generation++; },
    setActiveCategoryId(id) {
      if (id === activeCategoryId && activeTagId === null) return;
      activeCategoryId = id; activeTagId = null;
      query();
    },
    setActiveTagId(id) {
      if (id === activeTagId && activeCategoryId === null) return;
      activeTagId = id; activeCategoryId = null;
      query();
    },
    async loadMore() {
      if (!cursor || loadingMore) return;
      const id = generation;
      loadingMore = true; error = null; emit();
      try {
        const page = await fetchPosts({ limit: pageSize, cursor });
        if (generation !== id) return;
        posts = [...(posts ?? []), ...page.posts]; cursor = page.nextCursor;
      } catch (e) {
        if (generation !== id) return;
        error = e instanceof Error ? e.message : String(e);
      } finally {
        if (generation === id) { loadingMore = false; emit(); }
      }
    },
  };
}
