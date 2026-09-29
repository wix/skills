// React binding of the FAQ store (wix/faq/faq-store.ts) — the state machine (category filter, search,
// accordion, URL state, the load) lives there, framework-free and module-scoped; this hook seeds it
// with the island's SSR props during render and subscribes with useSyncExternalStore. Every island on
// the page calls it and they all see one state. Astro islands and React SPAs use this; a static page,
// Vue, or Svelte uses the store directly.
import { useMemo, useSyncExternalStore } from "react";
import {
  collapseAll,
  expandQuestion,
  getFaqState,
  retry,
  seedFaq,
  selectCategory,
  setQuery,
  subscribeFaq,
  toggleQuestion,
  type FaqState,
  type FaqStoreOptions,
} from "../../wix/faq/faq-store";
import { groupByCategory } from "../../wix/faq/faq-core";
import type { FaqSection } from "../../wix/faq/types";

export type UseFaqOptions = FaqStoreOptions;

export interface UseFaq extends FaqState {
  /** The visible questions grouped by category in owner order (one section when a category is active). */
  sections: FaqSection[];
  isExpanded(id: string): boolean;
  selectCategory: typeof selectCategory;
  setQuery: typeof setQuery;
  toggleQuestion: typeof toggleQuestion;
  expandQuestion: typeof expandQuestion;
  collapseAll: typeof collapseAll;
  retry: typeof retry;
}

export function useFaq(options: UseFaqOptions = {}): UseFaq {
  // Idempotent in the browser (the first island seeds); on the server it makes this request's data current.
  seedFaq(options);
  const state = useSyncExternalStore(subscribeFaq, getFaqState, getFaqState);
  const sections = useMemo(() => groupByCategory(state.data?.categories ?? [], state.visible), [state.data, state.visible]);
  return {
    ...state,
    sections,
    isExpanded: (id) => state.expandedIds.includes(id),
    selectCategory,
    setQuery,
    toggleQuestion,
    expandQuestion,
    collapseAll,
    retry,
  };
}
