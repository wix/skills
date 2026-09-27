// React binding of the project-detail store (wix/portfolio/project-detail-store.ts) — slug →
// project + media gallery lives there, framework-free; this hook subscribes to one instance per
// (slug, mount) and recreates it when the slug changes. SSR-friendly: pass both `initial*` and no
// client fetch happens. `notFound` is the real not-found signal (project stays null while loading).
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  createProjectDetailStore,
  type ProjectDetailState,
  type ProjectDetailStore,
  type ProjectDetailStoreOptions,
} from "../../wix/portfolio/project-detail-store";

export type UseProjectDetailOptions = ProjectDetailStoreOptions;

export type UseProjectDetail = ProjectDetailState;

export function useProjectDetail(
  slug: string,
  { initialProject, initialItems }: UseProjectDetailOptions = {},
): UseProjectDetail {
  const ref = useRef<{ slug: string; store: ProjectDetailStore } | null>(null);
  if (!ref.current || ref.current.slug !== slug) {
    ref.current = { slug, store: createProjectDetailStore(slug, { initialProject, initialItems }) };
  }
  const store = ref.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
