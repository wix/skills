// The purchase flow: one call that turns a plan id into a Wix-hosted checkout URL.
// Purchasing a plan is a MEMBER action, but the hosted flow handles member login/signup,
// the order form, and payment itself — so this works from an anonymous visitor session.
// Never create the order yourself (orders.createOnlineOrder needs a logged-in member and
// still leaves payment unhandled); never hand-build a checkout URL. Copy as-is.
import { redirects as redirectsModule } from "@wix/redirects";
import { wixModule } from "../sdk";

const redirects = wixModule(redirectsModule);

type Raw = Record<string, any>;

export interface PurchaseOptions {
  /**
   * Success-only return URL — Wix appends `?planOrderId=<GUID>` to it. Omit → Wix shows its
   * hosted thank-you page, then returns to postFlowUrl. Point it at a page of yours only if
   * that page reads the param and renders a real confirmation.
   */
  thankYouPageUrl?: string;
  /**
   * Where a completed, abandoned, or interrupted flow returns (default: the current page).
   * Landing here is NOT a success signal — only thankYouPageUrl carries one.
   */
  postFlowUrl?: string;
}

/** Start the hosted purchase for a plan; resolves to the URL to send the browser to. */
export async function purchasePlan(
  planId: string,
  { thankYouPageUrl, postFlowUrl }: PurchaseOptions = {},
): Promise<string> {
  if (!planId) throw new Error("A plan id is required to start checkout.");
  const href = typeof window !== "undefined" ? window.location.href : "";
  const session: Raw = await redirects.createRedirectSession({
    paidPlansCheckout: { planId },
    callbacks: {
      postFlowUrl: postFlowUrl ?? (href || undefined),
      ...(thankYouPageUrl ? { thankYouPageUrl } : {}),
    },
  });
  const url = session?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start — please try again.");
  return url;
}
