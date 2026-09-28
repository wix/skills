// The donation flow over the SDK: a visitor's choice → an eCom checkout with one donation line →
// the Wix-hosted checkout URL; and the thank-you page's order read. Payment, donor details and
// receipts are Wix's hosted checkout and the eCom order — nothing here creates an order or builds
// a URL by hand. Bodies and result readers live in ./donations-core (shared with the REST twin);
// this file is the transport only. Copy as-is.
//
// Two routes to a checkout id, both kept:
//   createDonationCheckout        — Create Checkout with the line (a donation never merges into a
//                                   storefront visitor's current cart). The default.
//   createDonationCheckoutViaCart — the Wix widget's own sequence: Create Cart → Create Checkout
//                                   from the cart, channelType OTHER_PLATFORM. The fallback when
//                                   the direct route is refused; also reachable by name.
// Whether the Donations catalog plugin prices a line created directly is not yet verified live,
// hence the automatic fallback.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/checkout/create-checkout.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/orders/get-order.md
import { cart as cartModule, checkout as checkoutModule, orders as ordersModule } from "@wix/ecom";
import { redirects as redirectsModule } from "@wix/redirects";
import { wixModule } from "../sdk";
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
} from "./donations-core";
import type { DonationInput, DonationReceipt } from "./types";

export type { DonatePaths };

const checkoutApi = wixModule(checkoutModule);
const cartApi = wixModule(cartModule);
const ordersApi = wixModule(ordersModule);
const redirects = wixModule(redirectsModule);

export interface DonateOptions {
  /** The site's public https origin (default: window.location.origin — call from the browser). */
  origin?: string;
  /** Where the hosted checkout returns to; defaults are the Astro routes. */
  paths?: DonatePaths;
}

/** Create Checkout with the donation line → checkout id. */
export async function createDonationCheckout(campaignId: string, input: DonationInput): Promise<string> {
  const checkout: Raw = await checkoutApi.createCheckout(checkoutBody(campaignId, input) as any);
  return checkoutIdOf(checkout);
}

/** The Wix widget's route: Create Cart (the note as buyerNote) → Create Checkout from the cart → checkout id. */
export async function createDonationCheckoutViaCart(campaignId: string, input: DonationInput): Promise<string> {
  const cart: Raw = await cartApi.createCart(cartBody(campaignId, input) as any);
  const res: Raw = await cartApi.createCheckout(rawId(cart), { channelType: "OTHER_PLATFORM" });
  return checkoutIdOf(res);
}

/**
 * Start the hosted checkout for a donation; resolves to the URL to navigate the FULL document to.
 * Direct Create Checkout first, the cart route when that is refused, then one redirect session
 * whose thank-you callback lands on `/donate/thank-you?orderId=`.
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
  const session: Raw = await redirects.createRedirectSession(redirectBody(checkoutId, campaignId, site, paths) as any);
  return redirectUrl(session);
}

/**
 * The order behind a completed donation, for the thank-you page. Null on any failure: the order
 * may not be readable with the visitor's token — the page then thanks without order facts.
 */
export async function fetchDonationReceipt(orderId: string): Promise<DonationReceipt | null> {
  if (!orderId) return null;
  try {
    const order: Raw = await ordersApi.getOrder(orderId);
    return order ? toReceipt(order) : null;
  } catch {
    return null;
  }
}
