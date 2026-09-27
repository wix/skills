// Cart + checkout over REST (Wix eCom Cart V2) — the twin of app/wix/storefront/cart.ts. Same
// exports, same Cart/CartLine DTOs; rules and mappers from cart-core (the SAME file the SDK
// transport uses, deployed flat next to this one). The request shapes are
// exact and rewriting them is how carts break. Failures are loud: out-of-stock lines, an empty cart
// at checkout, a missing required selection all throw — surface the message to the buyer.
// All calls run with the visitor token: the cart is the token's (see ../shared/client).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/add-line-items-to-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { WixApiError, wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { WIX_STORES_APP_ID, addOptions, assertAdded, assertCheckoutable, rawId, summaryTotals, toCart } from "./cart-core.js";
import type { Raw } from "./catalog-core.js";
import type { Cart } from "./types.js";

const CART = "/ecom/v2/carts/current";

export interface AddToCartExtras {
  /** Choice modifiers: modifier key → chosen choice key (options.options — MODIFIERS only, never Size/Color). */
  modifierChoices?: Record<string, string>;
  /** Free-text modifiers: freeTextSettings.key → the buyer's text. */
  customTextFields?: Record<string, string>;
  /** A chosen recurring plan; omit for a one-time purchase. */
  subscriptionOptionId?: string;
  /** The resolved variant is out of stock but pre-orderable → preOrderRequested. */
  preorder?: boolean;
}

// A line's attributes.image comes back absent right after an add (verified live) — join the
// products' main images by catalogItemId, once per product, cached for the session.
// POST /stores/v3/products/query  { query: { filter: { id: { $in: [...] } } } }
const lineImageCache = new Map<string, string>();
async function fillLineImages(cart: Cart, raws: Raw[]): Promise<void> {
  const wanted = new Map<string, number[]>();
  raws.forEach((raw, i) => {
    if (cart.lines[i].imageUrl) return;
    const pid = raw.source?.catalogReference?.catalogItemId;
    if (!pid) return;
    const cached = lineImageCache.get(pid);
    if (cached !== undefined) { cart.lines[i].imageUrl = cached; return; }
    wanted.set(pid, [...(wanted.get(pid) ?? []), i]);
  });
  if (!wanted.size) return;
  try {
    const res = await wixRequest<Raw>("/stores/v3/products/query", { body: { query: { filter: { id: { $in: [...wanted.keys()] } }, cursorPaging: { limit: 100 } } } });
    for (const p of (res?.products ?? []) as Raw[]) {
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
  // The after-discount subtotal and the CART-level discount come from the estimate, never from
  // hand-summing lines. Its delivery/tax/fees read "0" when nothing was calculated — never render
  // those as "Free"; shipping and tax resolve at checkout.   POST /ecom/v2/carts/current/estimate
  let totals = { subtotal: "", discount: "" };
  try {
    totals = summaryTotals(await wixRequest<Raw>(`${CART}/estimate`, { body: {} }), raw);
  } catch {
    /* the estimate is a display nicety — the cart itself is still valid */
  }
  const cart = toCart(raw, totals.subtotal, totals.discount, imgSrc);
  await fillLineImages(cart, raw.lineItems as Raw[]);
  return cart;
}

// GET /ecom/v2/carts/current — a 404 (CURRENT_CART_NOT_FOUND / OWNED_CART_NOT_FOUND) means no cart yet.
async function getCurrentCartRaw(): Promise<Raw | null> {
  try {
    return (await wixRequest<Raw>(CART, { method: "GET" }))?.cart ?? null;
  } catch (e) {
    if (e instanceof WixApiError && e.status === 404) return null;
    throw e;
  }
}

/** The visitor's current cart. An empty Cart (not an error) when none exists yet. */
export async function fetchCart(): Promise<Cart> {
  return readCartWithSubtotal(await getCurrentCartRaw());
}

/**
 * Add a product. `variantId` is REQUIRED for any product with options — resolve it first
 * (resolveVariant); a refused add still returns 200, so the returned line is checked.
 * POST /ecom/v2/carts/current/add-line-items  { catalogItems: [{ quantity, catalogReference: { appId, catalogItemId, options } }] }
 */
export async function addToCart(productId: string, variantId?: string | null, quantity = 1, extras: AddToCartExtras = {}): Promise<Cart> {
  const options = addOptions({ variantId, ...extras });
  const res = await wixRequest<Raw>(`${CART}/add-line-items`, {
    body: { catalogItems: [{ quantity, catalogReference: { catalogItemId: productId, appId: WIX_STORES_APP_ID, ...(Object.keys(options).length ? { options } : {}) } }] },
  });
  assertAdded(res?.cart, productId, variantId);
  return readCartWithSubtotal(res?.cart ?? null);
}

/**
 * Change a line's quantity. `lineItemId` is CartLine.lineItemId, never the product id; a flat
 * { id, quantity } is a 400.  POST /ecom/v2/carts/current/update-line-items  { lineItems: [{ lineItemId, quantity: { newQuantity } }] }
 */
export async function updateQuantity(lineItemId: string, quantity: number): Promise<Cart> {
  const res = await wixRequest<Raw>(`${CART}/update-line-items`, { body: { lineItems: [{ lineItemId, quantity: { newQuantity: quantity } }] } });
  return readCartWithSubtotal(res?.cart ?? null);
}

/** Remove a line by CartLine.lineItemId.  POST /ecom/v2/carts/current/remove-line-items  { lineItemIds } */
export async function removeLine(lineItemId: string): Promise<Cart> {
  const res = await wixRequest<Raw>(`${CART}/remove-line-items`, { body: { lineItemIds: [lineItemId] } });
  return readCartWithSubtotal(res?.cart ?? null);
}

/**
 * Start the Wix-hosted checkout and return the URL to navigate the FULL document to. The cart's id
 * IS the checkout id. `origin` must be the site's real https origin as registered on the OAuth
 * app's allowed domains (browser: window.location.origin; server: the public https host, never
 * the request's internal origin) — an unlisted or http origin 403s on return.
 * POST /headless/v1/redirect-session  { ecomCheckout: { checkoutId }, callbacks: { postFlowUrl, thankYouPageUrl } }
 */
export async function checkoutUrl(origin: string = typeof window !== "undefined" ? window.location.origin : ""): Promise<string> {
  const raw = await getCurrentCartRaw();
  assertCheckoutable(raw);
  const res = await wixRequest<Raw>("/headless/v1/redirect-session", {
    body: { ecomCheckout: { checkoutId: rawId(raw) }, callbacks: origin ? { postFlowUrl: `${origin}/`, thankYouPageUrl: `${origin}/` } : {} },
  });
  const url = res?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start: no redirect URL returned.");
  return url;
}
