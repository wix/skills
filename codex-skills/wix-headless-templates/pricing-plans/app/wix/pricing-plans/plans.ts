// Plan reads (Wix Pricing Plans, Plans V3) over the SDK — the only file that touches raw plan
// entities on this transport. Everything it returns is a plain DTO from ./types. The rules and
// mappers live in ./plans-core (shared with the REST twin in templates/pricing-plans/rest/);
// this file is the transport only. Copy as-is; extend by adding functions, not by editing these.
//
// The read module is plansV3 — NOT `plans` (that's the V2 namespace; it has no queryPlans).
// Each function builds the shared query body (plansQuery — the limit rule, the filters) and spells
// it with the SDK builder. A plan without a numeric price is malformed and never returned
// (plans-core `planAmount`).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/query-plans.md
import { plansV3 } from "@wix/pricing-plans";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { plansQuery, toDetail, toSummaries, type FormatOptions, type Raw } from "./plans-core";
import type { PlanDetail, PlanSummary } from "./types";

export type { FormatOptions };

const plans = wixModule(plansV3);

export interface FetchPlansOptions extends FormatOptions {
  /** 1–100, default 100. */
  limit?: number;
}

/** List the public plans for the pricing grid, as card-ready DTOs. */
export async function fetchPlans({ limit = 100, locale }: FetchPlansOptions = {}): Promise<PlanSummary[]> {
  const q = plansQuery({ limit });
  const res = await plans.queryPlans().eq("visibility", "PUBLIC").limit(q.cursorPaging.limit).find();
  return toSummaries((res.items ?? []) as Raw[], imgSrc, { locale });
}

/** Specific public plans by id (a featured strip, the plans a paywall requires), in the API's order. Unknown ids are simply absent. */
export async function fetchPlansByIds(ids: string[], { locale }: FormatOptions = {}): Promise<PlanSummary[]> {
  const q = plansQuery({ ids, limit: Math.min(Math.max(ids.length, 1), 100) });
  const res = await plans.queryPlans().eq("visibility", "PUBLIC").in("_id", ids).limit(q.cursorPaging.limit).find();
  return toSummaries((res.items ?? []) as Raw[], imgSrc, { locale });
}

/** Fetch one public plan by its URL slug. Null when not found (or malformed). */
export async function fetchPlanBySlug(slug: string, { locale }: FormatOptions = {}): Promise<PlanDetail | null> {
  const q = plansQuery({ limit: 1, slug });
  const res = await plans.queryPlans().eq("visibility", "PUBLIC").eq("slug", slug).limit(q.cursorPaging.limit).find();
  const raw = res.items?.[0];
  return raw ? toDetail(raw as Raw, imgSrc, { locale }) : null;
}

/** Fetch one public plan by id. Null when not found (or malformed). */
export async function fetchPlanById(planId: string, { locale }: FormatOptions = {}): Promise<PlanDetail | null> {
  const q = plansQuery({ limit: 1, ids: [planId] });
  const res = await plans.queryPlans().eq("visibility", "PUBLIC").eq("_id", planId).limit(q.cursorPaging.limit).find();
  const raw = res.items?.[0];
  return raw ? toDetail(raw as Raw, imgSrc, { locale }) : null;
}
