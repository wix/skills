// The header search box as a framework-free store — the logic behind useSuggest. Same shape as the
// other stores: state, actions, subscribe/getState, emit after every change.
//
// THE debounce boundary of the capability lives here (the only timer): setInput() waits
// `debounceMs` after the last keystroke, then asks for suggestions when the phrase has at least
// `minChars` (the service's minimum is 3); a shorter phrase clears the list and cancels whatever is
// in flight. A late response from a superseded phrase is dropped. Keyboard state (open, the active
// row) is here too, so the component only renders and routes.
//
// submit() is the widget rule: an active row navigates to the row (a row without an href — a
// product suggestion, whose slug the suggest service cannot return — becomes a search for its title
// in its type); no active row → the results page for the typed phrase. The caller routes.
import { suggest } from "./search";
import { MAX_SUGGEST_QUERY, MIN_SUGGEST_CHARS, SUGGEST_DEBOUNCE_MS, SUGGEST_LIMIT, clampQuery } from "./search-core";
import type { SearchDocType, SuggestGroup, SuggestHit } from "./types";

export interface SuggestStoreOptions {
  minChars?: number;
  debounceMs?: number;
  /** Suggestions per type (default 4). */
  limit?: number;
}

export interface SuggestState {
  /** What the input shows (untrimmed). */
  input: string;
  groups: SuggestGroup[];
  /** The groups' hits flattened — the keyboard walks this. */
  rows: SuggestHit[];
  /** Whether the listbox is shown (rows exist and the box was not closed). */
  open: boolean;
  /** Index into rows; -1 = none. */
  activeIndex: number;
  loading: boolean;
  error: string | null;
}

export type SuggestSubmit =
  | { kind: "hit"; hit: SuggestHit; href: string }
  | { kind: "query"; q: string; type: SearchDocType | null }
  | null;

export interface SuggestStore {
  getState(): SuggestState;
  subscribe(listener: () => void): () => void;
  /** Every keystroke. Schedules the request; clears when under minChars. */
  setInput(value: string): void;
  /** Show the list again after a hide (focus). */
  show(): void;
  /** Hide the list and drop the active row (blur, Escape, a navigation). */
  hide(): void;
  /** Move the active row by ±1, wrapping; opens the list. */
  moveActive(delta: number): void;
  setActive(index: number): void;
  /** What Enter (or the form submit) means right now; null when there is nothing to search. */
  submit(): SuggestSubmit;
  /** Cancel the timer and any in-flight request (unmount). */
  stop(): void;
}

export function createSuggestStore({ minChars = MIN_SUGGEST_CHARS, debounceMs = SUGGEST_DEBOUNCE_MS, limit = SUGGEST_LIMIT }: SuggestStoreOptions = {}): SuggestStore {
  let input = "";
  let groups: SuggestGroup[] = [];
  let rows: SuggestHit[] = [];
  let closed = false;
  let activeIndex = -1;
  let loading = false;
  let error: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();
  let snapshot: SuggestState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  function getState(): SuggestState {
    if (snapshot) return snapshot;
    snapshot = { input, groups, rows, open: !closed && rows.length > 0, activeIndex, loading, error };
    return snapshot;
  }

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  function setResults(next: SuggestGroup[]): void {
    groups = next;
    rows = next.flatMap((g) => g.hits);
    if (activeIndex >= rows.length) activeIndex = -1;
  }

  function fetchNow(phrase: string): void {
    const id = ++generation;
    loading = true;
    error = null;
    emit();
    suggest(phrase, { limit })
      .then((res) => {
        if (generation !== id) return; // superseded — drop it
        setResults(res);
        loading = false;
        emit();
      })
      .catch((e) => {
        if (generation !== id) return;
        setResults([]);
        loading = false;
        error = e instanceof Error ? e.message : String(e);
        emit();
      });
  }

  return {
    getState,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    setInput(value) {
      input = value;
      closed = false;
      activeIndex = -1;
      clearTimer();
      const phrase = clampQuery(value, MAX_SUGGEST_QUERY);
      if (phrase.length < Math.max(minChars, MIN_SUGGEST_CHARS)) {
        generation++; // drop anything in flight
        setResults([]);
        loading = false;
        error = null;
        emit();
        return;
      }
      emit();
      timer = setTimeout(() => {
        timer = null;
        fetchNow(phrase);
      }, debounceMs);
    },
    show() {
      if (!closed) return;
      closed = false;
      emit();
    },
    hide() {
      if (closed && activeIndex === -1) return;
      closed = true;
      activeIndex = -1;
      emit();
    },
    moveActive(delta) {
      if (!rows.length) return;
      closed = false;
      const n = rows.length;
      activeIndex = activeIndex === -1 ? (delta > 0 ? 0 : n - 1) : (((activeIndex + delta) % n) + n) % n;
      emit();
    },
    setActive(index) {
      const next = index >= 0 && index < rows.length ? index : -1;
      if (next === activeIndex) return;
      activeIndex = next;
      emit();
    },
    submit() {
      const hit = !closed && activeIndex >= 0 ? rows[activeIndex] : undefined;
      if (hit) return hit.href ? { kind: "hit", hit, href: hit.href } : { kind: "query", q: hit.title, type: hit.type };
      const q = clampQuery(input);
      return q ? { kind: "query", q, type: null } : null;
    },
    stop() {
      clearTimer();
      generation++;
      loading = false;
    },
  };
}
