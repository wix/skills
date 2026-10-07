// React binding of the suggest store (wix/site-search/suggest-store.ts) — the debounce, the request
// and the keyboard state live there, framework-free; this hook subscribes to one instance per mounted
// search box. Browser-only (a header box is a client:only island).
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createSuggestStore, type SuggestState, type SuggestStore, type SuggestStoreOptions } from "../../wix/site-search/suggest-store";

export type UseSuggestOptions = SuggestStoreOptions;

export type UseSuggest = SuggestState & Pick<SuggestStore, "setInput" | "show" | "hide" | "moveActive" | "setActive" | "submit">;

export function useSuggest(options: UseSuggestOptions = {}): UseSuggest {
  const ref = useRef<SuggestStore | null>(null);
  if (!ref.current) ref.current = createSuggestStore(options);
  const store = ref.current;
  useEffect(() => () => store.stop(), [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    ...state,
    setInput: store.setInput,
    show: store.show,
    hide: store.hide,
    moveActive: store.moveActive,
    setActive: store.setActive,
    submit: store.submit,
  };
}
