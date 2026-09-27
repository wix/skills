// Cart + checkout (Wix eCom Cart V2) over the SDK — the only file that touches raw cart entities
// on this transport. Rules and mappers live in ./cart-core (shared with the REST twin in
// references/storefront/rest/); this file is the transport only. Copy as-is; extend by calling
// these exports, never by editing them. The request shapes are exact (catalogItems wrapper,
// options.variantId, the redirect-session body) and rewriting them is how carts break.
//
// Failures are loud: these throw on out-of-stock lines, an empty cart at checkout, and a
// missing required selection — surface the message to the buyer, don't swallow it.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/get-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/add-line-items-to-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/update-line-items.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { currentCartV2 } from "@wix/ecom";
import { redirects as redirectsModule } from "@wix/redirects";
import { productsV3 } from "@wix/stores";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { WIX_STORES_APP_ID, addOptions, assertAdded, assertCheckoutable, rawId, summaryTotals, toCart } from "./cart-core";
import type { Raw } from "./catalog-core";
import type { Cart } from "./types";

const cartApi = wixModule(currentCartV2);
const redirects = wixModule(redirectsModule);
const productsApi = wixModule(productsV3);

export interface AddToCartExtras {
  /** TEXT_CHOICES modifier selections: modifier key -> choice key (options.options — MODIFIERS only, never Size/Color). */
  modifierChoices?: Record<string, string>;
  /** FREE_TEXT modifier inputs: freeTextSettings key -> the buyer's text. */
  customTextFields?: Record<string, string>;
  /** The variant is out of stock but pre-orderable — sends preOrderRequested. */
  preorder?: boolean;
  /** A chosen recurring plan (subscriptionPricesInfo); omit for a one-time purchase. */
  subscriptionOptionId?: string;
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

async function readCartWithSubtotal(raw: Raw | null): Promise<Cart> {
  // Only estimate a cart WITH lines — on an absent/empty cart the endpoint returns 404.
  if (!raw?.lineItems?.length) return toCart(raw, "", "", imgSrc);
  // The authoritative after-discount subtotal and the CART-level discount come from the cart
  // estimate, never from hand-summing lines. Its delivery/tax/fees read "0" when nothing was
  // calculated — never render those as "Free"; shipping and tax resolve at checkout.
  let totals = { subtotal: "", discount: "" };
  try {
    totals = summaryTotals(await cartApi.estimateCurrentCart(), raw);
  } catch {
    /* estimate is a display nicety — the cart itself is still valid */
  }
  const cart = toCart(raw, totals.subtotal, totals.discount, imgSrc);
  await fillLineImages(cart, raw.lineItems as Raw[]);
  return cart;
}

/** Read the visitor's current cart. An empty Cart (not an error) when none exists yet. */
export async function fetchCart(): Promise<Cart> {
  try {
    const { cart } = await cartApi.getCurrentCart();
    return readCartWithSubtotal(cart as Raw);
  } catch {
    return toCart(null, "", "", imgSrc);
  }
}

/**
 * Add a product to the current cart. For a product WITH options, `variantId` is mandatory —
 * resolve it with `resolveVariant()` from ./catalog first. Mandatory modifiers must be included.
 * A refused add still returns 200, so the returned line is checked.
 */
export async function addToCart(productId: string, variantId?: string | null, quantity = 1, extras: AddToCartExtras = {}): Promise<Cart> {
  const options = addOptions({ variantId, ...extras });
  const { cart } = await cartApi.addLineItemsToCurrentCart({
    catalogItems: [{ quantity, catalogReference: { catalogItemId: productId, appId: WIX_STORES_APP_ID, ...(Object.keys(options).length ? { options } : {}) } }],
  });
  assertAdded(cart as Raw, productId, variantId);
  return readCartWithSubtotal(cart as Raw);
}

/** Change a line's quantity. `lineItemId` is CartLine.lineItemId, never the product id. */
export async function updateQuantity(lineItemId: string, quantity: number): Promise<Cart> {
  const { cart } = await cartApi.updateLineItemsInCurrentCart({ lineItems: [{ lineItemId, quantity: { newQuantity: quantity } }] });
  return readCartWithSubtotal(cart as Raw);
}

/** Remove a line from the cart by CartLine.lineItemId. */
export async function removeLine(lineItemId: string): Promise<Cart> {
  const { cart } = await cartApi.removeLineItemsFromCurrentCart([lineItemId]);
  return readCartWithSubtotal(cart as Raw);
}

/**
 * Start the Wix-hosted checkout for the current cart and return the URL to navigate to.
 * The cart's id IS the checkout id — no separate checkout-creation call.
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
