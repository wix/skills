// The donation flow over REST — the twin of app/wix/donations/donate.ts. Same exports, same
// signatures; the bodies and result readers come from donations-core (the SAME file the SDK
// transport uses). A donation is an eCom checkout with one catalog line; the hosted checkout takes
// payment and donor details. Never create the order yourself, never hand-build a checkout URL.
// Two routes to a checkout id, both kept: Create Checkout directly (default), and the Wix widget's
// Create Cart → Create Checkout from the cart (the fallback when the direct route is refused).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/checkout/create-checkout.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/orders/get-order.md
import { wixRequest } from "./client.js";
import {
  cartBody,
  checkoutBody,
  checkoutError,
  checkoutIdOf,
  rawId,
  redirectBody,
  redirectUrl,
  toReceipt,
  type DonatePaths,
  type Raw,
} from "./donations-core.js";
import type { DonationInput, DonationReceipt } from "./types.js";

export type { DonatePaths };

export interface DonateOptions {
  /** The site's public https origin (default: window.location.origin — call from the browser). */
  origin?: string;
  /** Where the hosted checkout returns to; a static site passes its file paths. */
  paths?: DonatePaths;
}

/**
 * Create Checkout with the donation line → checkout id.
 * POST /ecom/v1/checkouts  { lineItems: [{ quantity: 1, catalogReference: { appId, catalogItemId, options: { amount, frequency, donorCoveringFees? } } }], channelType: "WEB", checkoutInfo?: { buyerNote } }  → { checkout: { id } }
 */
export async function createDonationCheckout(campaignId: string, input: DonationInput): Promise<string> {
  const res = await wixRequest<Raw>("/ecom/v1/checkouts", { body: checkoutBody(campaignId, input) });
  return checkoutIdOf(res);
}

/**
 * The Wix widget's route → checkout id.
 * POST /ecom/v1/carts  { lineItems, cartInfo?: { buyerNote } }  → { cart: { id } }
 * POST /ecom/v1/carts/{id}/create-checkout  { channelType: "OTHER_PLATFORM" }  → { checkoutId }
 */
export async function createDonationCheckoutViaCart(campaignId: string, input: DonationInput): Promise<string> {
  const created = await wixRequest<Raw>("/ecom/v1/carts", { body: cartBody(campaignId, input) });
  const cartId = rawId(created?.cart);
  if (!cartId) throw new Error("Checkout couldn't start: no cart id returned.");
  const res = await wixRequest<Raw>(`/ecom/v1/carts/${cartId}/create-checkout`, { body: { channelType: "OTHER_PLATFORM" } });
  return checkoutIdOf(res);
}

/**
 * Start the hosted checkout for a donation; resolves to the URL to navigate the FULL document to.
 * `origin` must be the site's real https origin as registered on the OAuth app's allowed domains.
 * POST /headless/v1/redirect-session  { ecomCheckout: { checkoutId }, callbacks: { postFlowUrl, thankYouPageUrl } }  → { redirectSession: { fullUrl } }
 */
export async function donationCheckoutUrl(campaignId: string, input: DonationInput, { origin, paths }: DonateOptions = {}): Promise<string> {
  const site = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  let checkoutId: string;
  try {
    checkoutId = await createDonationCheckout(campaignId, input);
  } catch (direct) {
    try {
      checkoutId = await createDonationCheckoutViaCart(campaignId, input);
    } catch {
      throw checkoutError(direct);
    }
  }
  const session = await wixRequest<Raw>("/headless/v1/redirect-session", { body: redirectBody(checkoutId, campaignId, site, paths) });
  return redirectUrl(session);
}

/**
 * The order behind a completed donation, for the thank-you page; null on any failure (the order may
 * not be readable with the visitor's token — thank without order facts then).
 * GET /ecom/v1/orders/{id}  → { order }
 */
export async function fetchDonationReceipt(orderId: string): Promise<DonationReceipt | null> {
  if (!orderId) return null;
  try {
    const res = await wixRequest<Raw>(`/ecom/v1/orders/${orderId}`, { method: "GET" });
    return res?.order ? toReceipt(res.order) : null;
  } catch {
    return null;
  }
}
