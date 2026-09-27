// The purchase flow over REST — the twin of app/wix/pricing-plans/purchase.ts. Same export, same
// signature; the body and the result reading come from purchase-core (the SAME file the SDK
// transport uses). Purchasing is a MEMBER action, but the hosted flow handles login/signup, the
// order form, and payment itself, so a visitor token starts it. Never create the order yourself,
// never hand-build a checkout URL.
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { wixRequest } from "./client.js";
import { purchaseBody, redirectUrl, type PurchaseOptions } from "./purchase-core.js";
import type { Raw } from "./plans-core.js";

export type { PurchaseOptions };

/**
 * Start the hosted purchase for a plan; resolves to the URL to navigate the FULL document to.
 * POST /headless/v1/redirect-session  { paidPlansCheckout: { planId }, callbacks: { postFlowUrl, thankYouPageUrl? } }
 */
export async function purchasePlan(planId: string, options: PurchaseOptions = {}): Promise<string> {
  const session = await wixRequest<Raw>("/headless/v1/redirect-session", { body: purchaseBody(planId, options) });
  return redirectUrl(session);
}
