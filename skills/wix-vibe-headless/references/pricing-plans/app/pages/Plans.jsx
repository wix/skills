// Plans / pricing page — thin view over usePlans (all logic lives in the hook). Lists PUBLIC plans
// with an empty state, pages through with the cursor, and subscribes via the members-only hosted
// checkout. Styled with base44 design tokens (shadcn Tailwind classes).
import { usePlans } from "@/hooks/usePlans";
import PlanGrid from "@/components/PlanGrid";

export default function Plans() {
  const { plans, cursor, loaded, loadMore, subscribe } = usePlans();

  return (
    <main className="max-w-[1200px] mx-auto p-4">
      <h1 className="font-display mb-4">Plans &amp; Pricing</h1>
      {!loaded
        ? <p className="text-muted-foreground">Loading…</p>
        : <PlanGrid
            plans={plans}
            onSubscribe={subscribe}
            empty="No plans yet — create plans from your Wix dashboard."
          />}
      {cursor && (
        <div className="text-center mt-6">
          <button onClick={loadMore}
            className="py-2.5 px-6 cursor-pointer bg-card text-foreground border border-border rounded-sm font-semibold">Load more</button>
        </div>
      )}
    </main>
  );
}
