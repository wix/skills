// Plan access (paywall) over REST — the twin of app/wix/pricing-plans/plan-access.ts. Same export,
// same signature; the rule comes from plan-access-core (the SAME file the SDK transport uses).
// Member List Orders is a MEMBER call: it runs with whatever token ./client.js holds — a member's
// after the members vertical's rest/auth.ts login (`loggedInHint()` true) — and is refused for a
// visitor, so callers check the session first (the store does) and never call for a visitor.
// Porting: keep the path and the query string; the rule is one line in the core.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/member-list-orders.md
import { wixRequest } from "./client.js";
import { hasPlanAccess, memberOrdersQuery, type MemberOrdersQuery } from "./plan-access-core.js";
import type { Raw } from "./plans-core.js";

export type { MemberOrdersQuery };

/** An already-authenticated Member List Orders call: the query in, the raw `{ orders }` response out. */
export type MemberOrdersCall = (query: MemberOrdersQuery) => Promise<Raw>;

/**
 * The current member's orders for the plans, ACTIVE only. Array filters repeat the key.
 * GET /pricing-plans/v2/member/orders?planIds=<id>&planIds=<id>&orderStatuses=ACTIVE  → { orders: [{ id, planId, status, … }] }
 */
const sharedSeam: MemberOrdersCall = (query) =>
  wixRequest<Raw>("/pricing-plans/v2/member/orders", { method: "GET", query: { planIds: query.planIds, orderStatuses: query.orderStatuses } });

/**
 * True when the current member has an ACTIVE order for one of `requiredPlanIds`. Member-only —
 * throws when the call is refused (a visitor token, an expired session); the store shields that.
 */
export async function hasActiveOrderFor(requiredPlanIds: string[], call: MemberOrdersCall = sharedSeam): Promise<boolean> {
  const res = await call(memberOrdersQuery(requiredPlanIds));
  return hasPlanAccess(res?.orders as Raw[] | undefined, requiredPlanIds);
}
