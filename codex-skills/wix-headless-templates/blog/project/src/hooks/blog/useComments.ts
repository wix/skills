// React binding of the comments store (wix/blog/comments-store.ts) — the thread state machine
// (cursor paging, replies on demand, create/delete as the current identity) lives there,
// framework-free; this hook subscribes to one instance per thread and exposes its state and actions.
//
// Mount the surface only when `post.commentingEnabled && post.referenceId`; pass the referenceId.
// Client-side by nature (the thread is read as the viewer) — in Astro, a `client:load` island.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createCommentsStore, type CommentsState, type CommentsStore, type CommentsStoreOptions } from "../../wix/blog/comments-store";

export type UseCommentsOptions = CommentsStoreOptions;

export type UseComments = CommentsState & Pick<CommentsStore, "loadMore" | "loadReplies" | "setSort" | "create" | "remove">;

export function useComments(options: UseCommentsOptions): UseComments {
  const ref = useRef<{ referenceId: string; store: CommentsStore } | null>(null);
  if (!ref.current || ref.current.referenceId !== options.referenceId) {
    ref.current = { referenceId: options.referenceId, store: createCommentsStore(options) };
  }
  const store = ref.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { ...state, loadMore: store.loadMore, loadReplies: store.loadReplies, setSort: store.setSort, create: store.create, remove: store.remove };
}
