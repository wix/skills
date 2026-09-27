// Online ordering over REST (Restaurants Orders + Wix eCom Cart V2) — the twin of
// app/wix/restaurants/ordering.ts. Same exports, same OrderCart/OrderLine DTOs; rules and mappers
// from ordering-core (the SAME file the SDK transport uses, deployed flat next to this one). The
// request shapes are exact and rewriting them is how carts break: the Orders app id, and options
// { operationId, menuId, sectionId } — all three, no variantId. Failures are loud: a missing
// operation, an unavailable line, an empty order at checkout all throw — surface the message.
// All calls run with the visitor token: the cart is the token's (see ./client).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/list-operations.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/fulfillment-methods/list-fulfillment-methods.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/add-line-items-to-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { WixApiError, wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import {
  RESTAURANTS_ORDERS_APP_ID,
  assertOrderAdded,
  assertOrderCheckoutable,
  assertOrderContext,
  estimateSubtotal,
  orderCatalogItem,
  pickOperationId,
  rawId,
  toFulfillmentMethods,
  toOrderCart,
} from "./ordering-core.js";
import type { Raw } from "./menu-core.js";
import type { FulfillmentMethodInfo, OrderCart } from "./types.js";

export { RESTAURANTS_ORDERS_APP_ID };

const CART = "/ecom/v2/carts/current";

// The ordering operation is site config — resolve once, reuse for every add.
// GET /restaurants-operations/v1/operations
let operationIdPromise: Promise<string | null> | null = null;

/** The operation to order through (ENABLED, else default, else first) — null when the site has no online ordering. */
export function resolveOperationId(): Promise<string | null> {
  operationIdPromise ??= wixRequest<Raw>("/restaurants-operations/v1/operations", { method: "GET" })
    .then((res) => pickOperationId(res?.operations ?? []))
    .catch(() => {
      operationIdPromise = null; // transient failure — allow a retry on the next call
      return null;
    });
  return operationIdPromise;
}

/** Enabled pickup/delivery methods, for display.  GET /fulfillment-methods/v1/fulfillment-methods */
export async function fetchFulfillmentMethods(): Promise<FulfillmentMethodInfo[]> {
  try {
    const res = await wixRequest<Raw>("/fulfillment-methods/v1/fulfillment-methods", { method: "GET" });
    return toFulfillmentMethods(res?.fulfillmentMethods ?? []);
  } catch {
    return []; // display nicety — ordering still works without the list
  }
}

// A line's attributes.image may come back absent — join the menu items' images by the line's
// catalogItemId, once per item, cached for the session.  GET /restaurants/menus-item/v1/items?itemIds=…
const lineImageCache = new Map<string, string>();
async function fillLineImages(cart: OrderCart, raws: Raw[]): Promise<void> {
  const wanted = new Map<string, number[]>();
  raws.forEach((raw, i) => {
    if (cart.lines[i].imageUrl) return;
    const itemId = raw.source?.catalogReference?.catalogItemId;
    if (!itemId) return;
    const cached = lineImageCache.get(itemId);
    if (cached !== undefined) { cart.lines[i].imageUrl = cached; return; }
    wanted.set(itemId, [...(wanted.get(itemId) ?? []), i]);
  });
  if (!wanted.size) return;
  try {
    const res = await wixRequest<Raw>("/restaurants/menus-item/v1/items", { method: "GET", query: { itemIds: [...wanted.keys()] } });
    for (const item of (res?.items ?? []) as Raw[]) {
      const url = imgSrc(item.image, 300, 300);
      lineImageCache.set(rawId(item), url);
      for (const i of wanted.get(rawId(item)) ?? []) cart.lines[i].imageUrl = url;
    }
  } catch {
    /* images are a nicety — the cart stays correct without them */
  }
}

async function readCartWithSubtotal(raw: Raw | null): Promise<OrderCart> {
  // Only estimate a cart WITH lines — on an absent/empty cart the endpoint returns 404.
  if (!raw?.lineItems?.length) return toOrderCart(raw, "", imgSrc);
  // The after-discount subtotal comes from the estimate, never from hand-summing lines; fees, tax,
  // and delivery resolve at checkout.   POST /ecom/v2/carts/current/estimate  {}
  let subtotal = "";
  try {
    subtotal = estimateSubtotal(await wixRequest<Raw>(`${CART}/estimate`, { body: {} }), raw);
  } catch {
    /* the estimate is a display nicety — the cart itself is still valid */
  }
  const cart = toOrderCart(raw, subtotal, imgSrc);
  await fillLineImages(cart, raw.lineItems as Raw[]);
  return cart;
}

// GET /ecom/v2/carts/current — a 404 means no cart yet.
async function getCurrentCartRaw(): Promise<Raw | null> {
  try {
    return (await wixRequest<Raw>(CART, { method: "GET" }))?.cart ?? null;
  } catch (e) {
    if (e instanceof WixApiError && e.status === 404) return null;
    throw e;
  }
}

/** The visitor's current order cart. An empty cart (not an error) when none exists yet. */
export async function fetchOrderCart(): Promise<OrderCart> {
  return readCartWithSubtotal(await getCurrentCartRaw());
}

/**
 * Add a menu item to the current order. `menuId` and `sectionId` are the ids of the menu and
 * section the item is RENDERED UNDER — thread them from the render context (the fetchMenus tree).
 * Throws when ordering isn't configured or the line is refused (a refused add still returns 200).
 * POST /ecom/v2/carts/current/add-line-items
 *   { catalogItems: [{ quantity, catalogReference: { catalogItemId, appId: <Orders app>, options: { operationId, menuId, sectionId } } }] }
 */
export async function addToOrder(
  itemId: string,
  { menuId, sectionId }: { menuId: string; sectionId: string },
  quantity = 1,
): Promise<OrderCart> {
  const operationId = await resolveOperationId();
  if (!operationId) throw new Error("Online ordering isn't available right now.");
  assertOrderContext(itemId, menuId, sectionId);
  const res = await wixRequest<Raw>(`${CART}/add-line-items`, {
    body: { catalogItems: [orderCatalogItem(itemId, { operationId, menuId, sectionId }, quantity)] },
  });
  assertOrderAdded(res?.cart, itemId);
  return readCartWithSubtotal(res?.cart ?? null);
}

/**
 * Change a line's quantity. `lineItemId` is OrderLine.lineItemId, never the menu item id.
 * POST /ecom/v2/carts/current/update-line-items  { lineItems: [{ lineItemId, quantity: { newQuantity } }] }
 */
export async function updateOrderQuantity(lineItemId: string, quantity: number): Promise<OrderCart> {
  const res = await wixRequest<Raw>(`${CART}/update-line-items`, { body: { lineItems: [{ lineItemId, quantity: { newQuantity: quantity } }] } });
  return readCartWithSubtotal(res?.cart ?? null);
}

/** Remove a line by OrderLine.lineItemId.  POST /ecom/v2/carts/current/remove-line-items  { lineItemIds } */
export async function removeOrderLine(lineItemId: string): Promise<OrderCart> {
  const res = await wixRequest<Raw>(`${CART}/remove-line-items`, { body: { lineItemIds: [lineItemId] } });
  return readCartWithSubtotal(res?.cart ?? null);
}

/**
 * Start the Wix-hosted checkout for the current order and return the URL to navigate the FULL
 * document to. The cart's id IS the checkout id; fulfillment (pickup/delivery + time) and payment
 * are collected on the hosted page. `origin` must be the site's real https origin as registered on
 * the OAuth app's allowed domains (browser: window.location.origin) — an unlisted or http origin
 * 403s on return.
 * POST /headless/v1/redirect-session  { ecomCheckout: { checkoutId }, callbacks: { postFlowUrl, thankYouPageUrl } }
 */
export async function orderCheckoutUrl(origin: string = typeof window !== "undefined" ? window.location.origin : ""): Promise<string> {
  const raw = await getCurrentCartRaw();
  assertOrderCheckoutable(raw);
  const res = await wixRequest<Raw>("/headless/v1/redirect-session", {
    body: { ecomCheckout: { checkoutId: rawId(raw) }, callbacks: origin ? { postFlowUrl: `${origin}/`, thankYouPageUrl: `${origin}/` } : {} },
  });
  const url = res?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start: no redirect URL returned.");
  return url;
}
