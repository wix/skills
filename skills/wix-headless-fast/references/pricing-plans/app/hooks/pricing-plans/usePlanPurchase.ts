// React binding of the purchase store (wix/pricing-plans/plan-purchase-store.ts) — the purchase
// action for any surface (grid card, detail CTA, home strip). All correctness (the hosted redirect
// session, member login/signup, payment) lives in the data layer; the store tracks in-flight state;
// you own how it looks.
import { useRef, useSyncExternalStore } from "react";
import { createPlanPurchaseStore, type PlanPurchaseState, type PlanPurchaseStore } from "../../wix/pricing-plans/plan-purchase-store";

export type UsePlanPurchase = PlanPurchaseState & Pick<PlanPurchaseStore, "purchase">;

export function usePlanPurchase(): UsePlanPurchase {
  const ref = useRef<PlanPurchaseStore | null>(null);
  if (!ref.current) ref.current = createPlanPurchaseStore();
  const store = ref.current;
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { ...state, purchase: store.purchase };
}
