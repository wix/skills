import { wixApiRequest } from "./wix-client.js";

/**
 * Wix Pricing Plans V3 Plan — key fields for a Plans & Pricing page.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/plan-object.md
 *
 *   id {string}, name {string}, description {string}, slug {string},
 *   image {object} — { id, width, height, altText } (id is a WixMedia id),
 *   currency {string} — ISO-4217 e.g. "USD", termsAndConditions {string},
 *   visibility "PUBLIC"|"PRIVATE" — queryPlans returns PUBLIC only,
 *   buyable {boolean} — hide buy button when false, buyerCanCancel {boolean},
 *   perks {array} — [{ id, description }] feature bullets,
 *   pricingVariants {array} — 1 variant per plan:
 *     [{ id, name, freeTrialDays, pricingStrategies[0].flatRate.amount (decimal string, "0" = free),
 *        billingTerms: { billingCycle: { period "DAY"|"WEEK"|"MONTH"|"YEAR", count },
 *        startType "ON_PURCHASE"|"CUSTOM", endType "UNTIL_CANCELLED"|"CYCLES_COMPLETED" } }]
 * Display price: amount = v.pricingStrategies[0].flatRate.amount + plan.currency.
 * Never compute a final charge — Wix settles price, tax, and schedule at hosted checkout.
 *
 * Order (member's purchase) — key fields for "My plans" screen.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/order-object.md
 *   id {string}, planId {string}, planName {string},
 *   status "DRAFT"|"PENDING"|"ACTIVE"|"PAUSED"|"ENDED"|"CANCELED",
 *   lastPaymentStatus "PAID"|"REFUNDED"|"FAILED"|"UNPAID"|"NOT_APPLICABLE",
 *   startDate {string}, endDate {string}, freeTrialDays {number},
 *   currentCycle { index, startedDate, endedDate }, autoRenewCanceled {boolean}
 */

const REDIRECT_SESSION_URL = "/headless/v1/redirect-session";

/**
 * Query public, listable pricing plans (one page).
 * Returns only PUBLIC plans (the ones meant for the Plans & Pricing page). Some plans may have
 * `buyable: false` (merchant-assigned only) — keep them for display but hide the buy button.
 *
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/query-plans.md
 *
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ plans: object[], nextCursor: string|null }>}
 */
export async function queryPlans({ limit = 100, cursor } = {}) {
  const res = await wixApiRequest("/pricing-plans/v3/plans/query", {
    method: "POST",
    body: {
      query: {
        ...(cursor ? {} : { filter: { visibility: "PUBLIC" } }),
        cursorPaging: cursor ? { limit, cursor } : { limit },
      },
    },
  });
  return {
    plans: res?.plans ?? [],
    nextCursor: res?.pagingMetadata?.cursors?.next ?? null,
  };
}

/**
 * Fetch a single plan by its GUID. Returns null if not found.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/get-plan.md
 *
 * @param {string} planId  Plan GUID (`plan.id`).
 * @returns {Promise<object|null>}
 */
export async function getPlanById(planId) {
  try {
    const res = await wixApiRequest(`/pricing-plans/v3/plans/${encodeURIComponent(planId)}`, {
      method: "GET",
    });
    return res?.plan ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch a single PUBLIC plan by its URL slug. Returns null if not found.
 * There is no get-by-slug endpoint, so this queries with a slug filter and returns the first match.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/query-plans.md
 *
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getPlanBySlug(slug) {
  const res = await wixApiRequest("/pricing-plans/v3/plans/query", {
    method: "POST",
    body: {
      query: {
        filter: { visibility: "PUBLIC", slug },
        cursorPaging: { limit: 1 },
      },
    },
  });
  return res?.plans?.[0] ?? null;
}

/**
 * Start a purchase for a plan and return the Wix-hosted checkout URL.
 *
 * Pricing Plans purchases are MEMBERS-ONLY: the hosted flow handles member login (or signup),
 * the order form, and payment, then returns the visitor to your site. Redirect the browser to the
 * returned URL — do NOT create the order yourself; Wix settles price, tax, and the subscription.
 *
 * On return:
 *   - postFlowUrl is hit when the flow completes, is abandoned, or is interrupted.
 *   - thankYouPageUrl (if given) is hit only on success, with a `?planOrderId=<GUID>` query param.
 *   - Both callbacks also carry `wixMemberLoggedIn` (true if a member logged in during the flow).
 * After a successful purchase the visitor is a logged-in member — call getMyPlanOrders() to confirm.
 *
 * Reference: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
 *
 * @param {string} planId  Plan GUID (`plan.id`). Must be a buyable plan.
 * @param {{ thankYouPageUrl?: string, postFlowUrl?: string }} [options]
 * @returns {Promise<string>} The hosted checkout URL to redirect to.
 */
export async function checkout(planId, { thankYouPageUrl, postFlowUrl } = {}) {
  if (!planId) throw new Error("Cannot check out: a planId is required.");
  const callbacks = { postFlowUrl: postFlowUrl ?? window.location.href };
  if (thankYouPageUrl) callbacks.thankYouPageUrl = thankYouPageUrl;

  const redirect = await wixApiRequest(REDIRECT_SESSION_URL, {
    method: "POST",
    body: { paidPlansCheckout: { planId }, callbacks },
  });
  const url = redirect?.redirectSession?.fullUrl;
  if (!url) throw new Error("Failed to create the pricing-plan checkout redirect session.");
  return url;
}

/**
 * List the currently logged-in member's own plan orders (their purchases / subscriptions).
 * Use for a "My plans" screen and to confirm a purchase after returning from checkout.
 *
 * Requires a MEMBER identity. For an anonymous visitor (not logged in) Wix returns no member
 * context — this resolves to `[]` rather than throwing, so the UI can show a "log in to see your
 * plans" state. Up to 50 orders are returned per call.
 *
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/member-orders-service-list-orders.md
 *
 * @param {{ orderStatuses?: string[], limit?: number, offset?: number }} [options]
 *        orderStatuses: filter, e.g. ["ACTIVE"] | ["ACTIVE","PENDING","PAUSED"].
 * @returns {Promise<object[]>} The member's orders (empty array if none / not a member).
 */
export async function getMyPlanOrders({ orderStatuses, limit, offset } = {}) {
  try {
    const res = await wixApiRequest("/pricing-plans/v2/member/orders", {
      method: "GET",
      query: {
        orderStatuses,
        limit: limit !== undefined ? String(limit) : undefined,
        offset: offset !== undefined ? String(offset) : undefined,
      },
    });
    return res?.orders ?? [];
  } catch {
    return [];
  }
}
