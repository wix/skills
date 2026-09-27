// Plan reads (Wix Pricing Plans, Plans V3) over the SDK — the only file that touches raw plan
// entities on this transport. Everything it returns is a plain DTO from ./types. The rules and
// mappers live in ./plans-core (shared with the REST twin in references/pricing-plans/rest/);
// this file is the transport only. Copy as-is; extend by adding functions, not by editing these.
//
// The read module is plansV3 — NOT `plans` (that's the V2 namespace; it has no queryPlans).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/query-plans.md
import { plansV3 } from "@wix/pricing-plans";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { toDetail, toSummary, type Raw } from "./plans-core";
import type { PlanDetail, PlanSummary } from "./types";

const plans = wixModule(plansV3);

/** List the public plans for the pricing grid, as card-ready DTOs. */
export async function fetchPlans({ limit = 100 } = {}): Promise<PlanSummary[]> {
  const res = await plans.queryPlans().eq("visibility", "PUBLIC").limit(limit).find();
  return (res.items ?? []).map((p) => toSummary(p as Raw, imgSrc));
}

/** Fetch one public plan by its URL slug. Null when not found. */
export async function fetchPlanBySlug(slug: string): Promise<PlanDetail | null> {
  const res = await plans.queryPlans().eq("visibility", "PUBLIC").eq("slug", slug).limit(1).find();
  const raw = res.items?.[0];
  return raw ? toDetail(raw as Raw, imgSrc) : null;
}
