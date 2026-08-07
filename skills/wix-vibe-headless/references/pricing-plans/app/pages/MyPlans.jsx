// My plans page — thin view over useMyPlans (all logic lives in the hook). Shows the logged-in
// member's active memberships and doubles as the post-checkout confirmation (re-syncs on
// visibilitychange). getMyPlanOrders() resolves to [] for anonymous visitors, so the empty branch
// covers both "not a member → log in" and "member with no active plans". Token-styled via theme.css.
import { useMyPlans } from "@/hooks/useMyPlans";
import OrderCard from "@/components/OrderCard";

export default function MyPlans() {
  const { orders, loaded } = useMyPlans({ orderStatuses: ["ACTIVE"] });

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "calc(var(--space) * 2) var(--space)" }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space)" }}>My plans</h1>
      {!loaded ? (
        <p style={{ color: "var(--color-muted)" }}>Loading…</p>
      ) : orders.length === 0 ? (
        // [] = anonymous visitor OR a member with no active plans. Wire log-in via the members
        // vertical (references/members/) so a member can sign in on your own UI, then re-check.
        <p style={{ color: "var(--color-muted)" }}>
          No active plans. Log in to see your plans, or choose one from the pricing page.
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space)" }}>
          {orders.map((order) => <OrderCard key={order.id} order={order} />)}
        </ul>
      )}
    </main>
  );
}
