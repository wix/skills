// Responsive plans grid + empty state. Styled with base44 design tokens (shadcn Tailwind classes).
// Renders the shipped empty state when there are no plans — never invent plans.
import PlanCard from "./PlanCard";

export default function PlanGrid({ plans, onSubscribe, empty = "No plans yet." }) {
  if (!plans?.length) {
    return (
      <p className="text-muted-foreground p-4 text-center">{empty}</p>
    );
  }
  return (
    <div className="grid gap-4 items-stretch [grid-template-columns:repeat(auto-fill,minmax(280px,1fr))]">
      {plans.map((plan) => <PlanCard key={plan.id} plan={plan} onSubscribe={onSubscribe} />)}
    </div>
  );
}
