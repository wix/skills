// Member plan-order row — pure UI for the "My plans" screen. Renders only fields the Order object
// actually returns (planName, status, start/end dates); for anything else (amount paid, next-billing)
// look it up in the Orders API reference (wix-docs) — never invent it. Styled with base44 design
// tokens (shadcn Tailwind classes).

const STATUS_BG = {
  ACTIVE: "bg-primary",
  PAUSED: "bg-muted",
  ENDED: "bg-muted",
  CANCELED: "bg-destructive",
};

export default function OrderCard({ order }) {
  return (
    <li className="list-none flex flex-wrap items-center gap-3 bg-card text-foreground border border-border rounded-lg shadow-sm p-4">
      <span className="font-display font-semibold flex-1">{order.planName}</span>
      <span className={`text-[13px] font-semibold px-2.5 py-0.5 rounded-full text-primary-foreground ${STATUS_BG[order.status] || "bg-muted"}`}>{order.status}</span>
      {order.startDate && (
        <span className="text-muted-foreground text-[13px]">
          from {new Date(order.startDate).toLocaleDateString()}
        </span>
      )}
      {order.endDate && (
        <span className="text-muted-foreground text-[13px]">
          until {new Date(order.endDate).toLocaleDateString()}
        </span>
      )}
    </li>
  );
}
