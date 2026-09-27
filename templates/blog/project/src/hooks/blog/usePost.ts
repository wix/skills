// React binding of the post store (wix/blog/post-store.ts) — post-by-slug loading and the resolved
// category/tag chips live there, framework-free; this hook subscribes to one instance per slug.
//
// SSR-friendly: pass the server-fetched post (and taxonomy) as `initial*` and no client fetch
// happens; a SPA passes only the slug. A slug change creates a fresh store and refetches.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPostStore, type PostState, type PostStore, type PostStoreOptions } from "../../wix/blog/post-store";

export type UsePostOptions = PostStoreOptions;

export type UsePost = PostState;

export function usePost({ slug, initialPost, initialCategories, initialTags }: UsePostOptions): UsePost {
  const ref = useRef<{ slug: string; store: PostStore } | null>(null);
  if (!ref.current || ref.current.slug !== slug) ref.current = { slug, store: createPostStore({ slug, initialPost, initialCategories, initialTags }) };
  const store = ref.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
