import { wixApiRequest } from "./wix-client.js";

/**
 * Wix Pricing Plans V3 Plan — key fields for building a "Plans & Pricing" page.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/plan-object.md
 *
 *   id                                      {string}   Plan GUID. Pass to getPlanById / checkout.
 *   name                                    {string}   Plan name shown to customers.
 *   description                             {string}   Short explanation of what the plan offers.
 *   slug                                    {string}   URL slug for plan-detail routing.
 *   image                                   {object}   Plan image: { id, width, height, altText }.
 *                                                      `id` is a WixMedia id — resolve to a URL via your media handling.
 *   termsAndConditions                      {string}   T&C text buyers agree to at checkout (may be empty).
 *   currency                                {string}   ISO-4217 currency code for the plan's prices (e.g. "USD").
 *   visibility                              {string}   "PUBLIC"  — listed and buyable by anyone.
 *                                                      "PRIVATE" — hidden; only reachable via a direct link.
 *                                                      queryPlans returns PUBLIC plans only.
 *   buyable                                 {boolean}  Whether a customer can purchase it themselves. When false the
 *                                                      merchant assigns it manually in the dashboard — hide the buy button.
 *   buyerCanCancel                          {boolean}  Whether buyers may cancel their own subscription.
 *   perks                                   {array}    What the plan includes, for display only:
 *                                                      [{ id, description }]   // render description as a feature bullet
 *   pricingVariants                         {array}    Billing/pricing options. Currently exactly 1 variant per plan.
 *     [].id                                 {string}   Pricing variant GUID.
 *     [].name                               {string}   Variant label, e.g. "Monthly".
 *     [].freeTrialDays                      {number}   Free days before the first charge. 0 = no trial. Recurring plans only.
 *     [].promotion                          {string}   Optional promo message to show with the price.
 *     [].pricingStrategies[].flatRate.amount {string}  The price as a decimal string, e.g. "9.99" (no currency symbol —
 *                                                      pair it with the plan-level `currency`). "0" / "0.00" = free plan.
 *     [].billingTerms.billingCycle          {object}   Length of one cycle: { period: "DAY"|"WEEK"|"MONTH"|"YEAR", count }.
 *                                                      Present for recurring (subscription) plans; omitted for single-payment plans.
 *     [].billingTerms.startType             {string}   "ON_PURCHASE" | "CUSTOM" (buyer picks a start date).
 *     [].billingTerms.endType               {string}   "UNTIL_CANCELLED" — recurs until canceled.
 *                                                      "CYCLES_COMPLETED" — ends after a fixed number of cycles
 *                                                        (count in billingTerms.cyclesCompletedDetails.billingCycleCount).
 *     [].fees                               {array}    Extra fees: [{ id, name, priceType:"FIXED_AMOUNT",
 *                                                      fixedAmountOptions.amount, appliedAt:"FIRST_PAYMENT" }].
 *
 * Reading the price for display, per variant `v = plan.pricingVariants[0]`:
 *   - amount   = v.pricingStrategies[0].flatRate.amount     (decimal string; "0" means free)
 *   - currency = plan.currency
 *   - recurring? = Boolean(v.billingTerms?.billingCycle)
 *       → e.g. `${currency} ${amount} / ${cycle.count} ${cycle.period.toLowerCase()}`
 *   - one-time? = no billingCycle → single payment (for a duration, or unlimited/lifetime)
 *   - trial = v.freeTrialDays > 0 → "Includes a {n}-day free trial"
 * The plan object is display-only. Never compute or fake a final charge — the real price, tax,
 * proration, and schedule are settled by Wix during the hosted checkout (see `checkout`).
 */

/**
 * Wix Pricing Plans Order (a member's purchase/subscription) — key fields for a "My plans" screen.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/order-object.md
 *
 *   id                                      {string}  Order GUID.
 *   planId                                  {string}  GUID of the purchased plan.
 *   planName                                {string}  Plan name captured at purchase time.
 *   planDescription                         {string}  Plan description captured at purchase time.
 *   status                                  {string}  "DRAFT" (payment not processed) | "PENDING" (starts in the future) |
 *                                                     "ACTIVE" (usable now) | "PAUSED" | "ENDED" | "CANCELED".
 *   lastPaymentStatus                       {string}  "PAID" | "REFUNDED" | "FAILED" | "UNPAID" | "PENDING" |
 *                                                     "NOT_APPLICABLE" (free plan / free trial).
 *   startDate                               {string}  ISO date-time the plan starts.
 *   endDate                                 {string}  ISO date-time it ends. Omitted for until-canceled plans still ACTIVE.
 *   freeTrialDays                           {number}  Free-trial length for this order, if any (recurring plans).
 *   currentCycle                            {object}  { index, startedDate, endedDate }. index is 0 during a free trial,
 *                                                     1+ otherwise. Omitted if CANCELED/ENDED or not yet started.
 *   pricing                                 {object}  Settled pricing model + amounts (see Order Object reference):
 *                                                     one of subscription / singlePaymentForDuration / singlePaymentUnlimited,
 *                                                     plus prices[].price { subtotal, tax, discount, total, currency }.
 *   autoRenewCanceled                       {boolean} True if the subscription won't renew at the next payment date.
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
