// Ticket picker for a TICKETING event. Pure UI over useTicketing — no data logic here. Token-styled;
// re-skin via theme.css.
//   • Ticket-definition price is a plain number at pricing.fixedPrice.amount (+ price.currency here).
//   • FREE-only selection → an in-app buyer form + checkoutTickets (no redirect).
//   • Any PAID ticket → "Continue to checkout", which reserves then redirects to the Wix-hosted form.
import { useState } from "react";
import { useTicketing } from "@/hooks/useTicketing";

const input = {
  width: "100%", padding: "10px 12px", boxSizing: "border-box", fontFamily: "var(--font-body)",
  border: "1px solid var(--color-border)", borderRadius: "var(--radius-sm)",
  background: "var(--color-bg)", color: "var(--color-text)",
};

function ticketPrice(def) {
  if (def.free) return "Free";
  const amount = def.price?.amount ?? def.pricing?.fixedPrice?.amount;
  const currency = def.price?.currency ?? def.pricing?.fixedPrice?.currency ?? "";
  return amount != null ? `${amount} ${currency}`.trim() : "";
}

export default function TicketPicker({ event }) {
  const t = useTicketing(event);
  const [buyer, setBuyer] = useState({ firstName: "", lastName: "", email: "" });
  const setBuyerField = (k, v) => setBuyer((b) => ({ ...b, [k]: v }));

  if (t.order) {
    return (
      <div style={{
        padding: "var(--space)", borderRadius: "var(--radius)",
        background: "var(--color-surface)", border: "1px solid var(--color-border)",
      }}>
        Your tickets are confirmed.{" "}
        {t.order.ticketsPdf && (
          <a href={t.order.ticketsPdf} target="_blank" rel="noopener"
            style={{ color: "var(--color-primary)" }}>Download tickets (PDF)</a>
        )}
      </div>
    );
  }

  if (!t.definitions.length) {
    return <p style={{ color: "var(--color-muted)" }}>No tickets are currently on sale.</p>;
  }

  const buyerReady = buyer.firstName && buyer.lastName && buyer.email;

  return (
    <div>
      {t.definitions.map((def) => (
        <div key={def.id} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space)",
          padding: "12px 0", borderBottom: "1px solid var(--color-border)",
        }}>
          <div>
            <div style={{ fontWeight: 600 }}>{def.name}</div>
            {def.description && <div style={{ color: "var(--color-muted)", fontSize: 14 }}>{def.description}</div>}
            <div style={{ color: "var(--color-accent)", fontWeight: 600, marginTop: 2 }}>{ticketPrice(def)}</div>
          </div>
          <input type="number" min={0} value={t.selection[def.id]?.quantity ?? 0}
            onChange={(e) => t.setQuantity(def.id, Number(e.target.value) || 0)}
            style={{ ...input, width: 72, textAlign: "center" }} />
        </div>
      ))}

      {t.error && <p style={{ color: "var(--color-danger)", marginTop: "var(--space)" }}>{t.error}</p>}

      {t.hasSelection && t.allFree && (
        <div style={{ marginTop: "var(--space)", display: "grid", gap: 8, maxWidth: 440 }}>
          <input style={input} placeholder="First name" value={buyer.firstName}
            onChange={(e) => setBuyerField("firstName", e.target.value)} />
          <input style={input} placeholder="Last name" value={buyer.lastName}
            onChange={(e) => setBuyerField("lastName", e.target.value)} />
          <input style={input} type="email" placeholder="Email" value={buyer.email}
            onChange={(e) => setBuyerField("email", e.target.value)} />
        </div>
      )}

      {t.hasSelection && (
        <button
          disabled={t.submitting || (t.allFree && !buyerReady)}
          onClick={() => (t.allFree ? t.checkoutFree(buyer) : t.checkoutPaid())}
          style={{
            marginTop: "var(--space)", padding: "12px 24px",
            cursor: t.submitting ? "not-allowed" : "pointer",
            background: "var(--color-primary)", color: "var(--color-on-primary)",
            border: "none", borderRadius: "var(--radius-sm)", fontSize: 15, fontWeight: 600,
            opacity: t.submitting || (t.allFree && !buyerReady) ? 0.5 : 1,
          }}>
          {t.submitting ? "Processing…" : t.allFree ? "Get tickets" : "Continue to checkout"}
        </button>
      )}
    </div>
  );
}
