// Plan price label — display only. The price is a decimal STRING at
// pricingVariants[0].pricingStrategies[0].flatRate.amount ("0" = free); the recurring cycle is
// nested at billingTerms.billingCycle; free-trial length at pricingVariants[0].freeTrialDays. These
// exact paths are load-bearing — keep them. Never compute a final charge (Wix settles price, tax,
// and schedule at hosted checkout). Token-styled; re-skin via theme.css.

function readPrice(plan) {
  const v = plan?.pricingVariants?.[0];
  const amount = v?.pricingStrategies?.[0]?.flatRate?.amount;   // decimal STRING e.g. "20.00"; "0" = free
  if (amount == null) return null;
  const cycle = v?.billingTerms?.billingCycle;                  // { period, count } for recurring; absent otherwise
  return { amount, isFree: amount === "0", cycle, freeTrialDays: v?.freeTrialDays };
}

export default function PlanPrice({ plan }) {
  const p = readPrice(plan);
  if (!p) return null;
  if (p.isFree) {
    return <span style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700 }}>Free</span>;
  }
  const per = p.cycle ? ` / ${p.cycle.count} ${p.cycle.period.toLowerCase()}` : "";   // e.g. "/ 1 month"
  return (
    <span>
      <span style={{ fontFamily: "var(--font-display)", fontSize: 28, fontWeight: 700 }}>
        {p.amount} {plan.currency}
      </span>
      {per && <span style={{ color: "var(--color-muted)", fontSize: 14 }}>{per}</span>}
      {p.freeTrialDays ? (
        <span style={{ display: "block", color: "var(--color-accent)", fontSize: 13, marginTop: 4 }}>
          {p.freeTrialDays}-day free trial
        </span>
      ) : null}
    </span>
  );
}
