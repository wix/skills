// Plan card — pure UI. Styled with base44 design tokens (shadcn Tailwind classes) — re-skin via the
// app's design tokens (src/index.css :root/.dark), not this JSX. Renders name, description, price,
// perks as feature bullets, and a Subscribe button ONLY when plan.buyable is true (otherwise the
// plan is merchant-assigned). The card links to the plan detail route by slug. `onSubscribe(plan)`
// runs the hosted checkout.
//
// plan.image is a WixMedia object { id, width, height, altText } with NO .url — its id must be
// resolved to a URL before it can render. Rendering plan text only here avoids that trap; see
// INSTRUCTIONS ("Plan image") for the resolve-or-omit fallback if you want the image.
import { Link } from "react-router-dom";
import PlanPrice from "./PlanPrice";

export default function PlanCard({ plan, onSubscribe, featured = false }) {
  return (
    <div className={`flex flex-col gap-4 bg-card text-foreground border ${featured ? "border-primary" : "border-border"} rounded-lg overflow-hidden shadow-sm p-6`}>
      <div>
        <h3 className="m-0 mb-1 font-display text-[20px] font-bold">
          {plan.name}
        </h3>
        {plan.description && (
          <p className="m-0 text-muted-foreground leading-[1.5]">{plan.description}</p>
        )}
      </div>

      <PlanPrice plan={plan} />

      {(plan.perks || []).length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {plan.perks.map((perk) => (
            <li key={perk.id} className="flex gap-2 text-foreground leading-[1.4]">
              <span className="text-primary" aria-hidden>✓</span>
              <span>{perk.description}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {plan.buyable && (
          <button onClick={() => onSubscribe?.(plan)}
            className="py-3 px-6 cursor-pointer bg-primary text-primary-foreground rounded-sm text-[15px] font-semibold">Subscribe</button>
        )}
        <Link to={`/plans/${plan.slug}`}
          className="text-center py-2.5 px-6 no-underline text-foreground border border-border rounded-sm text-sm font-semibold">View details</Link>
      </div>
    </div>
  );
}
