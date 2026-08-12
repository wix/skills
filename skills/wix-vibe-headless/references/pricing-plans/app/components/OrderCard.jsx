// Member plan-order row — pure UI for the "My plans" screen. Renders only fields the Order object
// actually returns (planName, status, start/end dates); for anything else (amount paid, next-billing)
// look it up in the Orders API reference (wix-docs) — never invent it. Styled with base44 design
// tokens (shadcn Tailwind classes).

// Each status carries its OWN text colour: a shared `text-primary-foreground` over a varying
// background is unreadable the moment the two tokens are close in value — on the default light
// palette --primary-foreground (98%) over --muted (96.1%) is white on white, so PAUSED and ENDED
// vanished. A background token and its foreground token always travel together.
const STATUS_STYLE = {
  ACTIVE: "bg-primary text-primary-foreground",
  PAUSED: "bg-muted text-foreground",
  ENDED: "bg-muted text-foreground",
  CANCELED: "bg-destructive text-destructive-foreground",
};
const STATUS_FALLBACK = "bg-muted text-foreground";

export default function OrderCard({ order }) {
  return (
    <li className="list-none flex flex-wrap items-center gap-3 bg-card text-foreground border border-border rounded-lg shadow-sm p-4">
      <span className="font-display font-semibold flex-1">{order.planName}</span>
      <span className={`text-[13px] font-semibold px-2.5 py-0.5 rounded-full ${STATUS_STYLE[order.status] || STATUS_FALLBACK}`}>{order.status}</span>
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
