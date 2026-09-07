// REFERENCE pricing surface: plan cards in a grid on the @theme tokens. Correct and
// complete; per the skill's model you design and build your own on usePlans +
// usePlanPurchase.
import type { ComponentType, ReactNode } from "react";
import { usePlans } from "../../hooks/pricing-plans/usePlans";
import { usePlanPurchase } from "../../hooks/pricing-plans/usePlanPurchase";
import type { PlanSummary } from "../../wix/pricing-plans/types";

export interface LinkLikeProps {
  href: string;
  className?: string;
  children?: ReactNode;
}

const PlainLink = ({ href, className, children }: LinkLikeProps) => (
  <a href={href} className={className}>
    {children}
  </a>
);

export interface PlanCardProps {
  plan: PlanSummary;
  onSubscribe: (planId: string) => void;
  purchasing: boolean;
  planHref?: (slug: string) => string;
  LinkComponent?: ComponentType<LinkLikeProps>;
}

export function PlanCard({
  plan,
  onSubscribe,
  purchasing,
  planHref = (slug) => `/plans/${slug}`,
  LinkComponent = PlainLink,
}: PlanCardProps) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-background p-6">
      <p className="text-base font-semibold text-foreground">{plan.name}</p>
      {plan.description && <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>}
      <p className="mt-4">
        <span className="text-3xl font-bold tracking-tight text-foreground">{plan.price}</span>
        {plan.billing && <span className="ml-1.5 text-sm text-muted-foreground">{plan.billing}</span>}
      </p>
      {plan.freeTrialDays !== null && (
        <p className="mt-1 text-xs font-medium text-muted-foreground">{plan.freeTrialDays}-day free trial</p>
      )}
      {plan.perks.length > 0 && (
        <ul className="mt-4 space-y-2">
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
      <div className="mt-auto grid gap-2 pt-6">
        {plan.buyable && (
          <button
            type="button"
            disabled={purchasing}
            onClick={() => onSubscribe(plan.id)}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {purchasing ? "Redirecting…" : "Subscribe"}
          </button>
        )}
        <LinkComponent
          href={planHref(plan.slug)}
          className="rounded-full border border-border px-6 py-2.5 text-center text-sm font-semibold text-foreground no-underline transition-colors hover:bg-secondary"
        >
          View details
        </LinkComponent>
      </div>
    </div>
  );
}

export interface PlansViewProps {
  initialPlans?: PlanSummary[];
  emptyMessage?: string;
  planHref?: PlanCardProps["planHref"];
  LinkComponent?: ComponentType<LinkLikeProps>;
  CardComponent?: ComponentType<PlanCardProps>;
}

export default function PlansView({
  initialPlans,
  emptyMessage = "No plans yet — check back soon.",
  planHref,
  LinkComponent,
  CardComponent = PlanCard,
}: PlansViewProps) {
  const { plans, error } = usePlans({ initialPlans });
  const { purchase, purchasingId, error: purchaseError } = usePlanPurchase();

  return (
    <div>
      {(error ?? purchaseError) && <p className="mb-4 text-sm text-red-600">{error ?? purchaseError}</p>}
      {plans === null ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-80 animate-pulse rounded-lg bg-secondary" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <CardComponent
              key={p.id}
              plan={p}
              onSubscribe={(id) => void purchase(id).catch(() => {})}
              purchasing={purchasingId === p.id}
              planHref={planHref}
              LinkComponent={LinkComponent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
