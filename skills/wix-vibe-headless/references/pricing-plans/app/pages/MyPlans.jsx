// My plans page — thin view over useMyPlans (all logic lives in the hook). Shows the logged-in
// member's active memberships and doubles as the post-checkout confirmation (re-syncs on
// visibilitychange). getMyPlanOrders() resolves to [] for anonymous visitors, so the empty branch
// covers both "not a member → log in" and "member with no active plans". Styled with base44 design
// tokens (shadcn Tailwind classes).
import { useMyPlans } from "@/hooks/useMyPlans";
import OrderCard from "@/components/OrderCard";

export default function MyPlans() {
  const { orders, loaded } = useMyPlans({ orderStatuses: ["ACTIVE"] });

  return (
    <main className="max-w-[720px] mx-auto py-8 px-4">
      <h1 className="font-display mb-4">My plans</h1>
      {!loaded ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : orders.length === 0 ? (
        // [] = anonymous visitor OR a member with no active plans. Wire log-in via the members
        // vertical (references/members/) so a member can sign in on your own UI, then re-check.
        <p className="text-muted-foreground">
          No active plans. Log in to see your plans, or choose one from the pricing page.
        </p>
      ) : (
        <ul className="m-0 p-0 flex flex-col gap-4">
          {orders.map((order) => <OrderCard key={order.id} order={order} />)}
        </ul>
      )}
    </main>
  );
}
