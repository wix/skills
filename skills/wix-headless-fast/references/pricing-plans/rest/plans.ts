// Plan reads over REST — the twin of app/wix/pricing-plans/plans.ts. Same exports, same DTOs; the
// rules and mappers come from plans-core (the SAME file the SDK transport uses, deployed flat next
// to this one by deploy.mjs --stack static), so this file is only the transport: one fetch with a
// literal body per function. Every call here is safe from a browser with a visitor token.
// Porting: keep the path, keep the body, port the core once.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/query-plans.md
import { wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { plansQuery, toDetail, toSummary, type Raw } from "./plans-core.js";
import type { PlanDetail, PlanSummary } from "./types.js";

const QUERY = "/pricing-plans/v3/plans/query";

/**
 * The public plans for the pricing grid, as card-ready DTOs.
 * POST /pricing-plans/v3/plans/query  { query: { filter: { visibility: "PUBLIC" }, cursorPaging: { limit } } }
 */
export async function fetchPlans({ limit = 100 } = {}): Promise<PlanSummary[]> {
  const res = await wixRequest<Raw>(QUERY, { body: { query: plansQuery({ limit }) } });
  return ((res?.plans ?? []) as Raw[]).map((p) => toSummary(p, imgSrc));
}

/**
 * One public plan by its URL slug; null when the slug doesn't resolve (an empty `plans`, not a 404).
 * POST /pricing-plans/v3/plans/query  { query: { filter: { visibility: "PUBLIC", slug }, cursorPaging: { limit: 1 } } }
 */
export async function fetchPlanBySlug(slug: string): Promise<PlanDetail | null> {
  const res = await wixRequest<Raw>(QUERY, { body: { query: plansQuery({ limit: 1, slug }) } });
  const raw: Raw | undefined = res?.plans?.[0];
  return raw ? toDetail(raw, imgSrc) : null;
}
