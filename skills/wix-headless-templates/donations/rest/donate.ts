// The donation flow over REST — the twin of app/wix/donations/donate.ts. Same exports, same
// signatures; the bodies and result readers come from donations-core (the SAME file the SDK
// transport uses). A donation is an eCom cart with one catalog line; the hosted checkout takes
// payment and donor details. In Cart V2 the cart IS the checkout — its id is the id the redirect
// session takes, so there is one route and no separate Create Checkout call. Never create the
// order yourself, never hand-build a checkout URL.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/orders/get-order.md
import { wixRequest } from "./client.js";
import {
  cartBody,
  cartIdOf,
  checkoutError,
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
 * Start the hosted checkout for a donation; resolves to the URL to navigate the FULL document to.
 * `origin` must be the site's real https origin as registered on the OAuth app's allowed domains.
 * POST /ecom/v2/carts  { cart: { source: { channelType: "WEB" }, note? }, catalogItems: [{ quantity: 1, catalogReference: { appId, catalogItemId, options: { amount, frequency, donorCoveringFees? } } }] }  → { cart: { id } } (the cart is the checkout)
 * POST /headless/v1/redirect-session  { ecomCheckout: { checkoutId }, callbacks: { postFlowUrl, thankYouPageUrl } }  → { redirectSession: { fullUrl } }
 */
export async function donationCheckoutUrl(campaignId: string, input: DonationInput, { origin, paths }: DonateOptions = {}): Promise<string> {
  const site = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  let cartId: string;
  try {
    const res = await wixRequest<Raw>("/ecom/v2/carts", { body: cartBody(campaignId, input) });
    cartId = cartIdOf(res);
  } catch (e) {
    throw checkoutError(e);
  }
  const session = await wixRequest<Raw>("/headless/v1/redirect-session", { body: redirectBody(cartId, campaignId, site, paths) });
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
