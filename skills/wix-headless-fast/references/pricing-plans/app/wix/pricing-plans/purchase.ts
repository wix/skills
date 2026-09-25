// The purchase flow over the SDK: one call that turns a plan id into a Wix-hosted checkout URL.
// Purchasing a plan is a MEMBER action, but the hosted flow handles member login/signup,
// the order form, and payment itself — so this works from an anonymous visitor session.
// Never create the order yourself (orders.createOnlineOrder needs a logged-in member and
// still leaves payment unhandled); never hand-build a checkout URL. The body and the result
// reading live in ./purchase-core (shared with the REST twin); this file is the transport only.
// Copy as-is.
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { redirects as redirectsModule } from "@wix/redirects";
import { wixModule } from "../sdk";
import { purchaseBody, redirectUrl, type PurchaseOptions } from "./purchase-core";
import type { Raw } from "./plans-core";

export type { PurchaseOptions };

const redirects = wixModule(redirectsModule);

/** Start the hosted purchase for a plan; resolves to the URL to send the browser to. */
export async function purchasePlan(planId: string, options: PurchaseOptions = {}): Promise<string> {
  const session: Raw = await redirects.createRedirectSession(purchaseBody(planId, options) as any);
  return redirectUrl(session);
}
