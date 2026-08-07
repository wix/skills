// Responsive plans grid + empty state. Token-styled; re-skin via theme.css.
// Renders the shipped empty state when there are no plans — never invent plans.
import PlanCard from "./PlanCard";

export default function PlanGrid({ plans, onSubscribe, empty = "No plans yet." }) {
  if (!plans?.length) {
    return (
      <p style={{ color: "var(--color-muted)", padding: "var(--space)", textAlign: "center" }}>{empty}</p>
    );
  }
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      gap: "var(--space)",
      alignItems: "stretch",
    }}>
      {plans.map((plan) => <PlanCard key={plan.id} plan={plan} onSubscribe={onSubscribe} />)}
    </div>
  );
}
