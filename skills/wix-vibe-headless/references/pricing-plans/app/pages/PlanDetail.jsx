// Plan detail page — thin view over usePlanDetail (all logic lives in the hook). Shows the full
// price/billing summary, perks, terms & conditions if present, and a Subscribe button (only when
// plan.buyable). Not-found state on a bad slug — never invent a plan. Styled with base44 design
// tokens (shadcn Tailwind classes). termsAndConditions is plain text; render as-is.
import { useParams } from "react-router-dom";
import { usePlanDetail } from "@/hooks/usePlanDetail";
import PlanPrice from "@/components/PlanPrice";

export default function PlanDetail() {
  const { slug } = useParams();
  const { plan, notFound, subscribe } = usePlanDetail(slug);

  if (notFound) return <Centered>Plan not found.</Centered>;
  if (!plan) return <Centered>Loading…</Centered>;

  return (
    <main className="max-w-[720px] mx-auto py-8 px-4">
      <h1 className="font-display m-0 mb-2">{plan.name}</h1>
      {plan.description && (
        <p className="text-muted-foreground leading-[1.6] m-0 mb-4">{plan.description}</p>
      )}

      <div className="my-4"><PlanPrice plan={plan} /></div>

      {(plan.perks || []).length > 0 && (
        <ul className="my-4 p-0 list-none flex flex-col gap-2.5">
          {plan.perks.map((perk) => (
            <li key={perk.id} className="flex gap-2 leading-[1.4]">
              <span className="text-primary" aria-hidden>✓</span>
              <span>{perk.description}</span>
            </li>
          ))}
        </ul>
      )}

      {plan.buyable && (
        <button onClick={subscribe}
          className="py-3 px-8 cursor-pointer bg-primary text-primary-foreground rounded-sm text-[15px] font-semibold">Subscribe</button>
      )}

      {plan.termsAndConditions && (
        <div className="mt-8 pt-4 border-t border-border">
          <h2 className="font-display text-base">Terms &amp; conditions</h2>
          <p className="text-muted-foreground leading-[1.6] whitespace-pre-wrap">{plan.termsAndConditions}</p>
        </div>
      )}
    </main>
  );
}

function Centered({ children }) {
  return <div className="p-12 text-center text-muted-foreground">{children}</div>;
}
