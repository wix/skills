// React binding of the post store (wix/blog/post-store.ts) — post-by-slug loading, the resolved
// category/tag chips, the related strip, and the viewer's like state live there, framework-free;
// this hook subscribes to one instance per slug and exposes its state and the like action.
//
// SSR-friendly: pass the server-fetched post (and taxonomy, related) as `initial*` and no client
// read happens except the personal like state; a SPA passes only the slug. A slug change creates a
// fresh store and refetches.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPostStore, type PostState, type PostStore, type PostStoreOptions } from "../../wix/blog/post-store";

export type UsePostOptions = PostStoreOptions;

export type UsePost = PostState & Pick<PostStore, "toggleLike">;

export function usePost(options: UsePostOptions): UsePost {
  const ref = useRef<{ slug: string; store: PostStore } | null>(null);
  if (!ref.current || ref.current.slug !== options.slug) ref.current = { slug: options.slug, store: createPostStore(options) };
  const store = ref.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { ...state, toggleLike: store.toggleLike };
}
