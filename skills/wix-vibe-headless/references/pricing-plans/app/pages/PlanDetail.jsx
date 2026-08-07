// Plan detail page — thin view over usePlanDetail (all logic lives in the hook). Shows the full
// price/billing summary, perks, terms & conditions if present, and a Subscribe button (only when
// plan.buyable). Not-found state on a bad slug — never invent a plan. Token-styled; re-skin via
// theme.css. termsAndConditions is plain text; render as-is.
import { useParams } from "react-router-dom";
import { usePlanDetail } from "@/hooks/usePlanDetail";
import PlanPrice from "@/components/PlanPrice";

export default function PlanDetail() {
  const { slug } = useParams();
  const { plan, notFound, subscribe } = usePlanDetail(slug);

  if (notFound) return <Centered>Plan not found.</Centered>;
  if (!plan) return <Centered>Loading…</Centered>;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "calc(var(--space) * 2) var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", margin: "0 0 8px" }}>{plan.name}</h1>
      {plan.description && (
        <p style={{ color: "var(--color-muted)", lineHeight: 1.6, margin: "0 0 var(--space)" }}>{plan.description}</p>
      )}

      <div style={{ margin: "var(--space) 0" }}><PlanPrice plan={plan} /></div>

      {(plan.perks || []).length > 0 && (
        <ul style={{ margin: "var(--space) 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {plan.perks.map((perk) => (
            <li key={perk.id} style={{ display: "flex", gap: 8, lineHeight: 1.4 }}>
              <span style={{ color: "var(--color-accent)" }} aria-hidden>✓</span>
              <span>{perk.description}</span>
            </li>
          ))}
        </ul>
      )}

      {plan.buyable && (
        <button onClick={subscribe} style={{
          padding: "12px 32px", cursor: "pointer",
          background: "var(--color-primary)", color: "var(--color-on-primary)",
          border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
        }}>Subscribe</button>
      )}

      {plan.termsAndConditions && (
        <div style={{ marginTop: "calc(var(--space) * 2)", paddingTop: "var(--space)", borderTop: "1px solid var(--color-border)" }}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 16 }}>Terms &amp; conditions</h2>
          <p style={{ color: "var(--color-muted)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{plan.termsAndConditions}</p>
        </div>
      )}
    </main>
  );
}

function Centered({ children }) {
  return <div style={{ padding: "calc(var(--space) * 3)", textAlign: "center", color: "var(--color-muted)" }}>{children}</div>;
}
