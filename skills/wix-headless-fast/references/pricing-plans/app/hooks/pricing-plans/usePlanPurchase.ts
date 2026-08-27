// The purchase action for any surface (grid card, detail CTA, home strip). All correctness
// (the hosted redirect session, member login/signup, payment) lives in the data layer —
// this hook tracks in-flight state; you own how it looks.
import { useState } from "react";
import { purchasePlan } from "../../wix/pricing-plans/purchase";
import type { PurchaseOptions } from "../../wix/pricing-plans/purchase";

export interface UsePlanPurchase {
  /**
   * Starts the hosted checkout — when it resolves the browser is already navigating away.
   * Rejects with a visitor-facing message otherwise — surface it, don't swallow it.
   */
  purchase: (planId: string, options?: PurchaseOptions) => Promise<void>;
  /** The plan id a purchase is in flight for (null when idle) — key CTA spinners off it. */
  purchasingId: string | null;
  error: string | null;
}

export function usePlanPurchase(): UsePlanPurchase {
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function purchase(planId: string, options?: PurchaseOptions): Promise<void> {
    setPurchasingId(planId);
    setError(null);
    try {
      window.location.href = await purchasePlan(planId, options);
      // stays "purchasing" — the browser is leaving for the hosted checkout
    } catch (e) {
      setPurchasingId(null);
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  return { purchase, purchasingId, error };
}
