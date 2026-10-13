// The purchase action as a framework-free store — the logic behind usePlanPurchase, usable from
// React (usePlanPurchase wraps it), from a static page's card or detail CTA, from Vue/Svelte, or
// as the specification for a port. All correctness (the hosted redirect session, member
// login/signup, payment) lives in the data layer; this store tracks the in-flight plan and the
// last failure, and navigates the FULL document to the hosted checkout.
//
// One store per purchase surface (a grid and a detail CTA each key their own spinner):
// createPlanPurchaseStore(), not a singleton. No async work on mount, so no start/stop.
import { purchasePlan, type PurchaseOptions } from "./purchase";

export interface PlanPurchaseState {
  /** The plan id a purchase is in flight for (null when idle) — key CTA spinners off it. */
  purchasingId: string | null;
  /** The last failed purchase's visitor-facing message; a new purchase clears it. */
  error: string | null;
}

export interface PlanPurchaseStore {
  getState(): PlanPurchaseState;
  subscribe(listener: () => void): () => void;
  /**
   * Starts the hosted checkout — when it resolves the browser is already navigating away, and
   * `purchasingId` stays set. Rejects (and records `error`) otherwise — surface it, don't swallow it.
   */
  purchase(planId: string, options?: PurchaseOptions): Promise<void>;
}

export function createPlanPurchaseStore(): PlanPurchaseStore {
  let state: PlanPurchaseState = { purchasingId: null, error: null };
  const listeners = new Set<() => void>();

  function setState(patch: Partial<PlanPurchaseState>): void {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async purchase(planId, options) {
      setState({ purchasingId: planId, error: null });
      try {
        window.location.href = await purchasePlan(planId, options);
        // stays "purchasing" — the browser is leaving for the hosted checkout
      } catch (e) {
        setState({ purchasingId: null, error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },
  };
}
