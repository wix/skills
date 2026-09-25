// The purchase control for one plan — wire as-is on every card, detail page, and home strip.
// It owns the rules a CTA gets wrong when rewritten: rendered only for a `buyable` plan (a PUBLIC
// plan can be merchant-assigned — `assignedText` shows instead, or nothing when null), the label
// from the DTO ("Get this plan" for a free plan, "Subscribe" otherwise, your children override it),
// "Redirecting…" while the hosted checkout is starting, the failure inline. The redirect itself is
// usePlanPurchase → purchasePlan; nothing here builds a URL or marks anything paid.
import type { ReactNode } from "react";
import { usePlanPurchase } from "../../hooks/pricing-plans/usePlanPurchase";
import type { PurchaseOptions } from "../../wix/pricing-plans/purchase";
import type { PlanSummary } from "../../wix/pricing-plans/types";

export interface SubscribeButtonProps {
  plan: PlanSummary;
  /** thankYouPageUrl / postFlowUrl for the hosted flow — see purchase.ts; omit for the defaults. */
  options?: PurchaseOptions;
  /** Replaces the default label ("Get this plan" / "Subscribe"). */
  children?: ReactNode;
  className?: string;
  /** Shown for a plan that isn't buyable; null renders nothing (a grid card). */
  assignedText?: string | null;
}

export default function SubscribeButton({
  plan,
  options,
  children,
  className = "rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50",
  assignedText = "This plan is assigned by the site owner.",
}: SubscribeButtonProps) {
  const { purchase, purchasingId, error } = usePlanPurchase();
  if (!plan.buyable) return assignedText ? <p className="text-sm text-muted-foreground">{assignedText}</p> : null;
  const purchasing = purchasingId === plan.id;
  return (
    <div className="grid gap-2">
      <button type="button" disabled={purchasing} onClick={() => void purchase(plan.id, options).catch(() => {})} className={className}>
        {purchasing ? "Redirecting…" : children ?? (plan.free ? "Get this plan" : "Subscribe")}
      </button>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
