// Member plan-order row — pure UI for the "My plans" screen. Renders only fields the Order object
// actually returns (planName, status, start/end dates); for anything else (amount paid, next-billing)
// look it up in the Orders API reference (wix-docs) — never invent it. Token-styled via theme.css.

const STATUS_COLORS = {
  ACTIVE: "var(--color-accent)",
  PAUSED: "var(--color-muted)",
  ENDED: "var(--color-muted)",
  CANCELED: "var(--color-danger)",
};

export default function OrderCard({ order }) {
  return (
    <li style={{
      listStyle: "none", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12,
      background: "var(--color-surface)", color: "var(--color-text)",
      border: "1px solid var(--color-border)", borderRadius: "var(--radius)",
      boxShadow: "var(--shadow)", padding: "var(--space)",
    }}>
      <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, flex: 1 }}>{order.planName}</span>
      <span style={{
        fontSize: 13, fontWeight: 600, padding: "2px 10px", borderRadius: 999,
        color: "var(--color-on-primary)", background: STATUS_COLORS[order.status] || "var(--color-muted)",
      }}>{order.status}</span>
      {order.startDate && (
        <span style={{ color: "var(--color-muted)", fontSize: 13 }}>
          from {new Date(order.startDate).toLocaleDateString()}
        </span>
      )}
      {order.endDate && (
        <span style={{ color: "var(--color-muted)", fontSize: 13 }}>
          until {new Date(order.endDate).toLocaleDateString()}
        </span>
      )}
    </li>
  );
}
