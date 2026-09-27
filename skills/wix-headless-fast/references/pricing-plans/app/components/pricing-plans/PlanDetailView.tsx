// REFERENCE detail surface: price/billing block + perks + terms + the shipped SubscribeButton, on
// the @theme tokens. Correct and complete; per the skill's model you design and build your own
// (the plan itself arrives as an SSR-fetched DTO prop; the purchase control is SubscribeButton).
import SubscribeButton from "./SubscribeButton";
import type { PlanDetail } from "../../wix/pricing-plans/types";

export default function PlanDetailView({ plan }: { plan: PlanDetail }) {
  return (
    <div>
      <p>
        <span className="text-4xl font-bold tracking-tight text-foreground">{plan.price}</span>
        {plan.billing && <span className="ml-2 text-muted-foreground">{plan.billing}</span>}
      </p>
      {plan.freeTrialDays !== null && (
        <p className="mt-1 text-sm text-muted-foreground">{plan.freeTrialDays}-day free trial</p>
      )}

      {plan.perks.length > 0 && (
        <ul className="mt-6 space-y-2.5">
          {plan.perks.map((perk) => (
            <li key={perk} className="flex gap-2 text-sm text-foreground">
              <span className="text-muted-foreground" aria-hidden="true">
                ✓
              </span>
              <span>{perk}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <SubscribeButton plan={plan} className="rounded-full bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
          {plan.free ? "Get this plan" : `Subscribe · ${plan.price}`}
        </SubscribeButton>
      </div>

      {plan.termsAndConditions && (
        <div className="mt-10 border-t border-border pt-5">
          <p className="eyebrow">Terms &amp; conditions</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
            {plan.termsAndConditions}
          </p>
        </div>
      )}
    </div>
  );
}
