// Plan card — pure UI. Styled entirely from theme.css tokens (var(--...)) — re-skin via those
// tokens, not this JSX. Renders name, description, price, perks as feature bullets, and a
// Subscribe button ONLY when plan.buyable is true (otherwise the plan is merchant-assigned).
// The card links to the plan detail route by slug. `onSubscribe(plan)` runs the hosted checkout.
//
// plan.image is a WixMedia object { id, width, height, altText } with NO .url — its id must be
// resolved to a URL before it can render. Rendering plan text only here avoids that trap; see
// INSTRUCTIONS ("Plan image") for the resolve-or-omit fallback if you want the image.
import { Link } from "react-router-dom";
import PlanPrice from "./PlanPrice";

export default function PlanCard({ plan, onSubscribe, featured = false }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: "var(--space)",
      background: "var(--color-surface)", color: "var(--color-text)",
      border: `1px solid ${featured ? "var(--color-accent)" : "var(--color-border)"}`,
      borderRadius: "var(--radius)", overflow: "hidden", boxShadow: "var(--shadow)",
      padding: "calc(var(--space) * 1.5)",
    }}>
      <div>
        <h3 style={{ margin: "0 0 4px", fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 700 }}>
          {plan.name}
        </h3>
        {plan.description && (
          <p style={{ margin: 0, color: "var(--color-muted)", lineHeight: 1.5 }}>{plan.description}</p>
        )}
      </div>

      <PlanPrice plan={plan} />

      {(plan.perks || []).length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {plan.perks.map((perk) => (
            <li key={perk.id} style={{ display: "flex", gap: 8, color: "var(--color-text)", lineHeight: 1.4 }}>
              <span style={{ color: "var(--color-accent)" }} aria-hidden>✓</span>
              <span>{perk.description}</span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {plan.buyable && (
          <button onClick={() => onSubscribe?.(plan)} style={{
            padding: "12px 24px", cursor: "pointer",
            background: "var(--color-primary)", color: "var(--color-on-primary)",
            border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
          }}>Subscribe</button>
        )}
        <Link to={`/plans/${plan.slug}`} style={{
          textAlign: "center", padding: "10px 24px", textDecoration: "none",
          color: "var(--color-text)", border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)", fontSize: 14, fontWeight: 600,
        }}>View details</Link>
      </div>
    </div>
  );
}
