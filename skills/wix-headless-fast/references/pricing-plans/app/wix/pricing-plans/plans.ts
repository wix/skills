// Plan reads (Wix Pricing Plans, Plans V3) — the only file that touches raw plan entities.
// Everything it returns is a plain DTO from ./types. Copy as-is; extend by adding functions,
// not by editing these.
//
// The read module is plansV3 — NOT `plans` (that's the V2 namespace; it has no queryPlans).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/query-plans.md
import { plansV3 } from "@wix/pricing-plans";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import type { PlanDetail, PlanSummary } from "./types";

const plans = wixModule(plansV3);

type Raw = Record<string, any>;

function formatPrice(value: string | undefined, currency: string | undefined): string {
  if (value == null || value === "" || Number(value) === 0) return "Free";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(Number(value));
  } catch {
    return `${value} ${currency ?? ""}`.trim();
  }
}

// billingTerms → a display label. billingCycle.count comes back as a STRING in SDK reads
// ("1") — Number() it. endType CYCLES_COMPLETED with billingCycleCount 1 bills once.
function billingLabel(terms: Raw | undefined): string {
  const cycle = terms?.billingCycle;
  if (!cycle) return "one-time";
  const cyclesTotal = Number(terms?.cyclesCompletedDetails?.billingCycleCount ?? 0);
  if (terms?.endType === "CYCLES_COMPLETED" && cyclesTotal === 1) return "one-time";
  const count = Number(cycle.count ?? 1) || 1;
  const period = String(cycle.period ?? "MONTH").toLowerCase();
  const base = count === 1 ? `per ${period}` : `every ${count} ${period}s`;
  return terms?.endType === "CYCLES_COMPLETED" && cyclesTotal > 1 ? `${base} × ${cyclesTotal}` : base;
}

// The price is DISPLAY-ONLY: a decimal string at pricingVariants[0].pricingStrategies[0]
// .flatRate.amount ("0" = free), paired with plan.currency (site-derived — never assume
// USD). Wix settles the actual charge, tax, and schedule at the hosted checkout.
function toSummary(raw: Raw): PlanSummary {
  const variant: Raw = raw.pricingVariants?.[0] ?? {};
  const amount: string | undefined = variant.pricingStrategies?.[0]?.flatRate?.amount;
  const free = amount == null || Number(amount) === 0;
  return {
    id: raw._id ?? "", // SDK entity id is _id, never id (that's the REST view)
    slug: raw.slug ?? "",
    name: raw.name ?? "",
    description: raw.description ?? "",
    price: free ? "Free" : formatPrice(amount, raw.currency),
    free,
    billing: free ? "" : billingLabel(variant.billingTerms),
    freeTrialDays: variant.freeTrialDays || null,
    perks: (raw.perks ?? []).map((p: Raw) => p.description ?? "").filter((d: string) => d),
    buyable: raw.buyable === true,
    imageUrl: imgSrc(raw.image, 800, 800),
  };
}

function toDetail(raw: Raw): PlanDetail {
  return { ...toSummary(raw), termsAndConditions: raw.termsAndConditions ?? "" };
}

/** List the public plans for the pricing grid, as card-ready DTOs. */
export async function fetchPlans({ limit = 100 } = {}): Promise<PlanSummary[]> {
  const res = await plans.queryPlans().eq("visibility", "PUBLIC").limit(limit).find();
  return (res.items ?? []).map((p: Raw) => toSummary(p));
}

/** Fetch one public plan by its URL slug. Null when not found. */
export async function fetchPlanBySlug(slug: string): Promise<PlanDetail | null> {
  const res = await plans.queryPlans().eq("visibility", "PUBLIC").eq("slug", slug).limit(1).find();
  const raw = res.items?.[0];
  return raw ? toDetail(raw as Raw) : null;
}
