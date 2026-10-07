// React binding of the blog feed store (wix/blog/blog-feed-store.ts) — the feed state machine
// (taxonomy filter, cursor paging) lives there, framework-free; this hook subscribes to one
// instance per mounted feed and exposes its state and actions under one name. Astro islands and
// React SPAs use this; a static page, Vue, or Svelte uses the store directly.
//
// SSR-friendly: pass server-fetched data as `initial*` (Astro frontmatter / server component) and
// no client fetch happens; a SPA passes nothing. Category/tag filtering fetches live
// (server-side-filtered); the two filters are mutually exclusive — setting one clears the other.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createBlogFeedStore, type BlogFeedState, type BlogFeedStore, type BlogFeedStoreOptions } from "../../wix/blog/blog-feed-store";

export type UseBlogFeedOptions = BlogFeedStoreOptions;

export type UseBlogFeed = BlogFeedState & Pick<BlogFeedStore, "setActiveCategoryId" | "setActiveTagId" | "loadMore">;

export function useBlogFeed(options: UseBlogFeedOptions = {}): UseBlogFeed {
  const ref = useRef<BlogFeedStore | null>(null);
  if (!ref.current) ref.current = createBlogFeedStore(options);
  const store = ref.current;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    ...state,
    setActiveCategoryId: store.setActiveCategoryId,
    setActiveTagId: store.setActiveTagId,
    loadMore: store.loadMore,
  };
}
