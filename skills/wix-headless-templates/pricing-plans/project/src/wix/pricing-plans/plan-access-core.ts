// Plan-access (paywall) rules — transport-agnostic, imported by BOTH transports: ./plan-access.ts
// (the SDK) and the REST twin in templates/pricing-plans/rest/plan-access.ts (fetch). What "has
// access" MEANS and what the member-orders read asks for live HERE, once. Type-only imports: a
// strip to JS emits none.
import type { Raw } from "./plans-core";

/** The one order status that grants access: purchased, started, not paused/ended/canceled. */
export const ACCESS_ORDER_STATUSES = ["ACTIVE"] as const;

/** The Member List Orders filter both transports send. */
export interface MemberOrdersQuery {
  planIds: string[];
  orderStatuses: readonly ("ACTIVE")[];
}

/** The filter for "the current member's ACTIVE orders for these plans"; throws on an empty plan list. */
export function memberOrdersQuery(requiredPlanIds: string[]): MemberOrdersQuery {
  if (!requiredPlanIds.length) throw new Error("At least one required plan id is needed to check access.");
  return { planIds: requiredPlanIds, orderStatuses: ACCESS_ORDER_STATUSES };
}

/**
 * Access = the member has at least one order with status ACTIVE whose planId is one of the required
 * plans. Re-checked here even though the query already filtered (a caller may pass orders it read
 * for another reason). Visitors never reach this: they have no orders to list.
 */
export function hasPlanAccess(orders: Raw[] | null | undefined, requiredPlanIds: string[]): boolean {
  return (orders ?? []).some((o) => o?.status === "ACTIVE" && requiredPlanIds.includes(o?.planId));
}
