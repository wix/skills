// The donation flow over the SDK: a visitor's choice → an eCom cart with one donation line → the
// Wix-hosted checkout URL; and the thank-you page's order read. In Cart V2 there is no separate
// checkout entity: the cart IS the checkout, so its id is the id the redirect session takes.
// Payment, donor details and receipts are Wix's hosted checkout and the eCom order — nothing here
// creates an order or builds a URL by hand. Bodies and result readers live in ./donations-core
// (shared with the REST twin); this file is the transport only. Copy as-is.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/orders/get-order.md
import { cartV2 as cartV2Module, orders as ordersModule } from "@wix/ecom";
import { redirects as redirectsModule } from "@wix/redirects";
import { wixModule } from "../sdk";
import {
  cartBody,
  cartIdOf,
  checkoutError,
  redirectBody,
  redirectUrl,
  toReceipt,
  type DonatePaths,
  type Raw,
} from "./donations-core";
import type { DonationInput, DonationReceipt } from "./types";

export type { DonatePaths };

const cartV2Api = wixModule(cartV2Module);
const ordersApi = wixModule(ordersModule);
const redirects = wixModule(redirectsModule);

export interface DonateOptions {
  /** The site's public https origin (default: window.location.origin — call from the browser). */
  origin?: string;
  /** Where the hosted checkout returns to; defaults are the Astro routes. */
  paths?: DonatePaths;
}

/**
 * Start the hosted checkout for a donation; resolves to the URL to navigate the FULL document to.
 * One Create Cart (the cart is the checkout) → one redirect session whose thank-you callback lands
 * on `/donate/thank-you?orderId=`.
 */
export async function donationCheckoutUrl(campaignId: string, input: DonationInput, { origin, paths }: DonateOptions = {}): Promise<string> {
  const site = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  let cartId: string;
  try {
    const cart: Raw = await cartV2Api.createCart(cartBody(campaignId, input) as any);
    cartId = cartIdOf(cart);
  } catch (e) {
    throw checkoutError(e);
  }
  const session: Raw = await redirects.createRedirectSession(redirectBody(cartId, campaignId, site, paths) as any);
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
