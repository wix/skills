// Plans / pricing page — thin view over usePlans (all logic lives in the hook). Lists PUBLIC plans
// with an empty state, pages through with the cursor, and subscribes via the members-only hosted
// checkout. Token-styled; re-skin via theme.css.
import { usePlans } from "@/hooks/usePlans";
import PlanGrid from "@/components/PlanGrid";

export default function Plans() {
  const { plans, cursor, loaded, loadMore, subscribe } = usePlans();

  return (
    <main style={{ maxWidth: "var(--maxw)", margin: "0 auto", padding: "var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>Plans &amp; Pricing</h1>
      {!loaded
        ? <p style={{ color: "var(--color-muted)" }}>Loading…</p>
        : <PlanGrid
            plans={plans}
            onSubscribe={subscribe}
            empty="No plans yet — create plans from your Wix dashboard."
          />}
      {cursor && (
        <div style={{ textAlign: "center", marginTop: "calc(var(--space) * 1.5)" }}>
          <button onClick={loadMore} style={{
            padding: "10px 24px", cursor: "pointer",
            background: "var(--color-surface)", color: "var(--color-text)",
            border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)", fontWeight: 600,
          }}>Load more</button>
        </div>
      )}
    </main>
  );
}
