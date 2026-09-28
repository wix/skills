// Plan access (paywall) over the SDK — does the CURRENT MEMBER hold an active order for one of the
// required plans? Member List Orders is a MEMBER call: it lists the caller's own orders and is
// refused for a visitor, so callers check the session first (the store does) and never call for a
// visitor. The rule lives in ./plan-access-core (shared with the REST twin); this file is the
// transport only.
//
// The session it needs comes from the `members` vertical (custom login), which this vertical does
// not ship — so the call path is injectable:
//   default — the shared seam (../sdk `wixModule`). On managed Astro that is ambient auth, which
//             runs as the member once the members vertical's login has written the wixSession
//             cookie (its client.ts does), in islands and in frontmatter alike.
//   manual client (React SPA, lib) — the shared seam holds a VISITOR token; pass a call bound to the
//             member's client instead, e.g. from templates/members' client.ts strategy:
//             `createClient({ auth: membersAuth, modules: { orders } }).orders.memberListOrders`.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/member-list-orders.md
import { orders as ordersModule } from "@wix/pricing-plans";
import { wixModule } from "../sdk";
import { hasPlanAccess, memberOrdersQuery, type MemberOrdersQuery } from "./plan-access-core";
import type { Raw } from "./plans-core";

export type { MemberOrdersQuery };

/** An already-authenticated Member List Orders call: the query in, the raw `{ orders }` response out. */
export type MemberOrdersCall = (query: MemberOrdersQuery) => Promise<Raw>;

const orders = wixModule(ordersModule);
const sharedSeam: MemberOrdersCall = (query) => orders.memberListOrders({ planIds: query.planIds, orderStatuses: [...query.orderStatuses] }) as Promise<Raw>;

/**
 * True when the current member has an ACTIVE order for one of `requiredPlanIds`. Member-only —
 * throws when the call is refused (a visitor, an expired session); the store shields that.
 * `call` defaults to the shared seam; pass one bound to the member's client on a manual-client stack.
 */
export async function hasActiveOrderFor(requiredPlanIds: string[], call: MemberOrdersCall = sharedSeam): Promise<boolean> {
  const res = await call(memberOrdersQuery(requiredPlanIds));
  return hasPlanAccess(res?.orders as Raw[] | undefined, requiredPlanIds);
}
