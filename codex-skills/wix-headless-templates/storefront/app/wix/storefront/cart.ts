// Cart + checkout (Wix eCom Cart V2) over the SDK — the only file that touches raw cart entities
// on this transport. Rules and mappers live in ./cart-core (shared with the REST twin in
// templates/storefront/rest/); this file is the transport only. Copy as-is; extend by calling
// these exports, never by editing them. The request shapes are exact (catalogItems wrapper,
// options.variantId, the redirect-session body) and rewriting them is how carts break.
//
// Failures are loud: these throw on out-of-stock lines, an empty cart at checkout, a missing
// required selection, a bad coupon — with buyer copy (cartErrorMessage) — surface the message to
// the buyer, don't swallow it.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/get-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/add-line-items-to-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/update-line-items.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { currentCartV2 } from "@wix/ecom";
import { redirects as redirectsModule } from "@wix/redirects";
import { productsV3 } from "@wix/stores";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { EMPTY_TOTALS, WIX_STORES_APP_ID, addOptions, assertAdded, assertCheckoutable, cartErrorMessage, rawId, summaryTotals, toCart } from "./cart-core";
import type { Raw } from "./catalog-core";
import type { Cart } from "./types";

const cartApi = wixModule(currentCartV2);
const redirects = wixModule(redirectsModule);
const productsApi = wixModule(productsV3);

export interface AddToCartExtras {
  /** The resolved variant's option selections: option key -> choice key (what Wix's own storefront sends beside variantId). */
  optionChoices?: Record<string, string>;
  /** TEXT_CHOICES modifier selections: modifier key -> choice key. */
  modifierChoices?: Record<string, string>;
  /** FREE_TEXT modifier inputs: the modifier's free-text key -> the buyer's text. */
  customTextFields?: Record<string, string>;
  /** The variant is out of stock but pre-orderable — sends preOrderRequested. */
  preorder?: boolean;
  /** A chosen recurring plan (SubscriptionPlan.id); omit for a one-time purchase. */
  subscriptionOptionId?: string;
}

// Every cart call fails with buyer copy: Wix's error codes (ITEM_NOT_FOUND_IN_CATALOG, coupon
// codes…) mapped, anything else with its own message.
async function loud<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (e) {
    throw new Error(cartErrorMessage(e));
  }
}

// The V2 cart does NOT return line-item images (attributes.image is typed but comes back
// absent — verified against a live cart), so images are joined from the catalog by the
// line's catalogItemId and cached for the session.
const lineImageCache = new Map<string, string>();
async function fillLineImages(cart: Cart, raws: Raw[]): Promise<void> {
  const wanted = new Map<string, number[]>(); // productId -> line indexes
  raws.forEach((raw, i) => {
    if (cart.lines[i].imageUrl) return;
    const pid = raw.source?.catalogReference?.catalogItemId;
    if (!pid) return;
    const cached = lineImageCache.get(pid);
    if (cached !== undefined) {
      cart.lines[i].imageUrl = cached;
      return;
    }
    wanted.set(pid, [...(wanted.get(pid) ?? []), i]);
  });
  if (!wanted.size) return;
  try {
    const res = await productsApi.queryProducts().in("_id", [...wanted.keys()]).find();
    for (const p of (res.items ?? []) as Raw[]) {
      const url = imgSrc(p.media?.main, 300, 300);
      lineImageCache.set(rawId(p), url);
      for (const i of wanted.get(rawId(p)) ?? []) cart.lines[i].imageUrl = url;
    }
  } catch {
    /* images are a nicety — the cart stays correct without them */
  }
}

async function readCart(raw: Raw | null): Promise<Cart> {
  // Only estimate a cart WITH lines — on an absent/empty cart the endpoint returns 404.
  if (!raw?.lineItems?.length) return toCart(raw, EMPTY_TOTALS, imgSrc);
  // The authoritative totals come from the cart estimate, never from hand-summing lines: the
  // after-discount subtotal, every named discount, additional fees and taxes (calculated when
  // asked), and the total before delivery. Delivery resolves at checkout — never render it as
  // "Free" here.
  let totals = EMPTY_TOTALS;
  try {
    totals = summaryTotals(await cartApi.estimateCurrentCart({ calculateTax: true, calculateAdditionalFees: true }), raw);
  } catch {
    /* estimate is a display nicety — the cart itself is still valid */
  }
  const cart = toCart(raw, totals, imgSrc);
  await fillLineImages(cart, raw.lineItems as Raw[]);
  return cart;
}

/** Read the visitor's current cart. An empty Cart (not an error) when none exists yet. */
export async function fetchCart(): Promise<Cart> {
  try {
    const { cart } = await cartApi.getCurrentCart();
    return readCart(cart as Raw);
  } catch {
    return toCart(null, EMPTY_TOTALS, imgSrc);
  }
}

/**
 * Add a product to the current cart. For a product WITH options, `variantId` is mandatory —
 * resolve it with `resolveVariant()` from ./catalog first. Mandatory modifiers must be included.
 * A refused add still returns 200, so the returned line is checked.
 */
export async function addToCart(productId: string, variantId?: string | null, quantity = 1, extras: AddToCartExtras = {}): Promise<Cart> {
  return loud(async () => {
    const options = addOptions({ variantId, ...extras });
    const { cart } = await cartApi.addLineItemsToCurrentCart({
      catalogItems: [{ quantity, catalogReference: { catalogItemId: productId, appId: WIX_STORES_APP_ID, ...(Object.keys(options).length ? { options } : {}) } }],
    });
    assertAdded(cart as Raw, productId, variantId);
    return readCart(cart as Raw);
  });
}

/** Change a line's quantity. `lineItemId` is CartLine.lineItemId, never the product id. */
export async function updateQuantity(lineItemId: string, quantity: number): Promise<Cart> {
  return loud(async () => {
    const { cart } = await cartApi.updateLineItemsInCurrentCart({ lineItems: [{ lineItemId, quantity: { newQuantity: quantity } }] });
    return readCart(cart as Raw);
  });
}

/** Remove a line from the cart by CartLine.lineItemId. */
export async function removeLine(lineItemId: string): Promise<Cart> {
  return loud(async () => {
    const { cart } = await cartApi.removeLineItemsFromCurrentCart([lineItemId]);
    return readCart(cart as Raw);
  });
}

/** Apply a coupon code (one per cart). Throws buyer copy for an unknown, expired, or inapplicable code. */
export async function applyCoupon(code: string): Promise<Cart> {
  return loud(async () => {
    const { cart } = await cartApi.addCouponToCurrentCart({ code: code.trim() });
    return readCart(cart as Raw);
  });
}

/** Remove the applied coupon (a no-op when none is applied). */
export async function removeCoupon(): Promise<Cart> {
  return loud(async () => {
    const current = (await cartApi.getCurrentCart()).cart as Raw;
    const couponId = rawId((current?.coupons ?? [])[0]);
    if (!couponId) return readCart(current);
    const { cart } = await cartApi.removeCouponFromCurrentCart(couponId);
    return readCart(cart as Raw);
  });
}

/** Save the buyer's note to the merchant on the cart (it travels to checkout and the order). */
export async function setNote(note: string): Promise<Cart> {
  return loud(async () => {
    const { cart } = await cartApi.updateCurrentCart({ note: note.trim() || null });
    return readCart(cart as Raw);
  });
}

/**
 * Start the Wix-hosted checkout for the current cart and return the URL to navigate to.
 * The cart's id IS the checkout id — no separate checkout-creation call (Wix's own storefront
 * does the same).
 * Call from the browser: the return origin must be the site's real https origin
 * (window.location.origin), never a server-derived request origin.
 */
export async function checkoutUrl(): Promise<string> {
  const { cart } = await cartApi.getCurrentCart();
  const raw = cart as Raw;
  assertCheckoutable(raw);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const session = await redirects.createRedirectSession({
    ecomCheckout: { checkoutId: rawId(raw) },
    callbacks: { postFlowUrl: origin ? `${origin}/` : undefined, thankYouPageUrl: origin ? `${origin}/` : undefined },
  });
  const url = session?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start: no redirect URL returned.");
  return url;
}
