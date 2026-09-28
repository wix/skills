// What the site sells as plans: public pricing plans.
//   node <SKILL_ROOT>/templates/pricing-plans/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const PRICING_PLANS_APP_ID = "1522827f-c56c-a5c9-2ac9-00f9e6ae12d3";
const D = "https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans";

await runReader({
  vertical: "pricing-plans",
  appId: PRICING_PLANS_APP_ID,
  async read(api, { limit }) {
    const r = await api.call({ path: "/pricing-plans/v3/plans/query", body: { query: { filter: { visibility: "PUBLIC" }, cursorPaging: { limit } } }, docs: `${D}/plans-v3/query-plans` });
    return {
      planCount: r.pagingMetadata?.total ?? (r.plans ?? []).length,
      plans: (r.plans ?? []).map((p) => {
        const v = p.pricingVariants?.[0]; const s = v?.pricingStrategies?.[0];
        // perks is an ARRAY of { id, description } (not { values }); fees[].fixedAmountOptions.amount is the setup-fee surface.
        return { name: p.name, slug: p.slug ?? null, visibility: p.visibility, price: s?.flatRate?.amount ?? null, currency: p.currency ?? null, billing: v?.billingTerms?.billingCycle ? `${v.billingTerms.billingCycle.count} ${v.billingTerms.billingCycle.period}` : (v?.billingTerms?.startType ?? null), freeTrialDays: v?.freeTrialDays || null, fees: (v?.fees ?? []).map((f) => ({ name: f.name, amount: f.fixedAmountOptions?.amount ?? null })), perks: (p.perks ?? []).length };
      }),
    };
  },
});
