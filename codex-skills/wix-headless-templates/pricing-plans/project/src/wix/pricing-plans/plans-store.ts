// The plans listing as a framework-free store — the logic behind usePlans, usable from React
// (usePlans wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and
// render), or as the specification for a port. State, subscribe/getState, start/stop, emit after
// every change.
//
// SSR-friendly: seed with `initialPlans` and they render at once with no client fetch; without a
// seed `start()` fetches the public plans. A failed load leaves `plans: []` with the message in
// `error`, so the surface renders its empty state and the message, never a skeleton forever.
//
// One store per mounted listing (a pricing page and a home-page strip can coexist): createPlansStore(),
// not a singleton. It imports the data layer by names the REST twin exports identically, so the
// same file runs over the SDK in Astro and over REST on a static page.
import { fetchPlans } from "./plans";
import type { PlanSummary } from "./types";

export interface PlansStoreOptions {
  initialPlans?: PlanSummary[];
}

/** Everything a pricing grid renders from. Read it with getState() or through a subscription. */
export interface PlansState {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  plans: PlanSummary[] | null;
  error: string | null;
}

export interface PlansStore {
  getState(): PlansState;
  subscribe(listener: () => void): () => void;
  /** Fetch the plans when no `initialPlans` were given. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop a late response. */
  stop(): void;
}

export function createPlansStore({ initialPlans }: PlansStoreOptions = {}): PlansStore {
  let state: PlansState = { plans: initialPlans ?? null, error: null };
  let started = false;
  const listeners = new Set<() => void>();

  function setState(patch: Partial<PlansState>): void {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      if (started) return;
      started = true;
      if (initialPlans) return;
      fetchPlans()
        .then((plans) => { if (started) setState({ plans }); })
        .catch((e) => { if (started) setState({ plans: [], error: e instanceof Error ? e.message : String(e) }); });
    },
    stop() {
      started = false;
    },
  };
}
