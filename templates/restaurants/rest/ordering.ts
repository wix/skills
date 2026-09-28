// Online ordering over REST (Restaurants Orders + Wix eCom Cart V2) — the twin of
// app/wix/restaurants/ordering.ts. Same exports, same OrderCart/OrderLine DTOs; rules and mappers
// from ordering-core (the SAME file the SDK transport uses, deployed flat next to this one). The
// request shapes are exact and rewriting them is how carts break: the Orders app id, options
// { operationId, menuId, sectionId } — all three — and the visitor's choices in
// options.priceVariant / options.modifierGroups / options.specialRequests, the keys Wix's own
// ordering sends. Failures are loud: a missing or paused operation, an invalid selection, an
// unavailable line, an empty order at checkout all throw — surface the message.
// All calls run with the visitor token: the cart is the token's (see ./client).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/list-operations.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/menu-ordering-settings/query-menu-ordering-settings.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/fulfillment-methods/list-fulfillment-methods.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/add-line-items-to-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { WixApiError, wixRequest } from "./client.js";
import { imgSrc } from "./media.js";
import { fetchSiteMoney } from "./menu.js";
import { initialSelection, nextCursor, validateSelection, type Raw } from "./menu-core.js";
import {
  RESTAURANTS_ORDERS_APP_ID,
  assertOrderAdded,
  assertOrderCheckoutable,
  assertOrderContext,
  assertOrderable,
  estimateSubtotal,
  orderCatalogItem,
  rawId,
  resolveOperation,
  toFulfillmentMethods,
  toMenuOrderingMap,
  toOrderCart,
} from "./ordering-core.js";
import type { FulfillmentMethodInfo, MenuItem, MenuOrderingInfo, OrderCart, OrderSelection, OrderingStatus } from "./types.js";

export { RESTAURANTS_ORDERS_APP_ID };

const CART = "/ecom/v2/carts/current";

// The ordering operation is site config — resolve once, reuse for every add.
// GET /restaurants-operations/v1/operations
let orderingPromise: Promise<OrderingStatus> | null = null;

/**
 * The operation to order through and its state (ENABLED, else the default, else the first).
 * `status` "NONE" when the site has no online ordering; DISABLED / PAUSED_UNTIL refuse every add.
 */
export function resolveOrdering(): Promise<OrderingStatus> {
  orderingPromise ??= wixRequest<Raw>("/restaurants-operations/v1/operations", { method: "GET" })
    .then((res) => resolveOperation(res?.operations ?? []))
    .catch(() => {
      orderingPromise = null; // transient failure — allow a retry on the next call
      return resolveOperation([]);
    });
  return orderingPromise;
}

/** The id of the operation to order through — null when the site has none. */
export function resolveOperationId(): Promise<string | null> {
  return resolveOrdering().then((s) => s.operationId);
}

/**
 * Every menu's ordering settings under the operation, keyed by menuId (which menus take online
 * orders and when). A menu absent from the map is not orderable. {} when there is no operation.
 * POST /menu-ordering-settings/v1/menu-ordering-settings/query  { query: { filter: { operationId }, cursorPaging: { cursor? } } }
 */
export async function fetchMenuOrdering(): Promise<Record<string, MenuOrderingInfo>> {
  const { operationId } = await resolveOrdering();
  if (!operationId) return {};
  const raws: Raw[] = [];
  let cursor: string | null = null;
  do {
    const res: Raw = await wixRequest<Raw>("/menu-ordering-settings/v1/menu-ordering-settings/query", {
      body: { query: { filter: { operationId }, ...(cursor ? { cursorPaging: { cursor } } : {}) } },
    });
    raws.push(...((res?.menuOrderingSettings ?? []) as Raw[]));
    cursor = nextCursor(res);
  } while (cursor);
  return toMenuOrderingMap(raws);
}

/**
 * The operation's enabled pickup/delivery methods (operation.fulfillmentIds only), fees and
 * minimums formatted in the site currency — for display.
 * GET /fulfillment-methods/v1/fulfillment-methods[?cursorPaging.cursor=…]
 */
export async function fetchFulfillmentMethods(): Promise<FulfillmentMethodInfo[]> {
  try {
    const [status, money] = await Promise.all([resolveOrdering(), fetchSiteMoney()]);
    if (!status.fulfillmentIds.length) return [];
    const raws: Raw[] = [];
    let cursor: string | null = null;
    do {
      const res: Raw = await wixRequest<Raw>("/fulfillment-methods/v1/fulfillment-methods", { method: "GET", query: cursor ? { "cursorPaging.cursor": cursor } : {} });
      raws.push(...((res?.fulfillmentMethods ?? []) as Raw[]));
      cursor = nextCursor(res);
    } while (cursor);
    return toFulfillmentMethods(raws, status.fulfillmentIds, money);
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
 * Add a dish to the current order. `item` is the MenuItem DTO as rendered; `menuId` and `sectionId`
 * are the ids of the menu and section it is RENDERED UNDER (the fetchMenus tree); `selection` is
 * what the visitor chose (start from initialSelection(item)). Throws when ordering isn't accepting,
 * the dish can't be ordered, a modifier rule fails, or the line is refused (a refused add still returns 200).
 * POST /ecom/v2/carts/current/add-line-items
 *   { catalogItems: [{ quantity, catalogReference: { catalogItemId, appId: <Orders app>, options: {
 *       operationId, menuId, sectionId, priceVariant?: { id, formattedPrice },
 *       modifierGroups?: [{ id, modifiers: [{ id, price, formattedPrice? }] }], specialRequests? } } }] }
 */
export async function addToOrder(
  item: MenuItem,
  { menuId, sectionId }: { menuId: string; sectionId: string },
  quantity = 1,
  selection: OrderSelection = initialSelection(item),
): Promise<OrderCart> {
  const { operationId, status } = await resolveOrdering();
  if (!operationId || status !== "ENABLED") throw new Error("Online ordering isn't available right now.");
  assertOrderContext(item.id, menuId, sectionId);
  assertOrderable(item);
  const check = validateSelection(item, selection);
  if (!check.ok) throw new Error(Object.values(check.errors)[0]);
  const res = await wixRequest<Raw>(`${CART}/add-line-items`, {
    body: { catalogItems: [orderCatalogItem(item, { operationId, menuId, sectionId }, quantity, selection)] },
  });
  assertOrderAdded(res?.cart, item.id);
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
