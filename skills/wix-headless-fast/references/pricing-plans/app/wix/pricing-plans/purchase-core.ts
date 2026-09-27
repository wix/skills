// Purchase rules — transport-agnostic, imported by both ./purchase.ts (SDK) and the REST twin in
// references/pricing-plans/rest/purchase.ts (fetch). The redirect-session body for a plan and the
// reading of its result live HERE, once. Type-only imports: a strip to JS emits none.
import type { Raw } from "./plans-core";

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

/**
 * The Create Redirect Session body for a plan: `paidPlansCheckout: { planId }` plus the callbacks.
 * postFlowUrl defaults to the current page (browser); a server caller passes it explicitly.
 * The return origin must be the site's real https origin as registered on the OAuth app's allowed
 * domains — an unlisted or http origin 403s on return.
 */
export function purchaseBody(planId: string, { thankYouPageUrl, postFlowUrl }: PurchaseOptions = {}): Raw {
  if (!planId) throw new Error("A plan id is required to start checkout.");
  const href = typeof window !== "undefined" ? window.location.href : "";
  return {
    paidPlansCheckout: { planId },
    callbacks: {
      postFlowUrl: postFlowUrl ?? (href || undefined),
      ...(thankYouPageUrl ? { thankYouPageUrl } : {}),
    },
  };
}

/** The hosted checkout URL out of a redirect-session response; throws when there is none. */
export function redirectUrl(session: Raw | null | undefined): string {
  const url = session?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start — please try again.");
  return url;
}
