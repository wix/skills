// Online ordering over REST (Restaurants Orders + Wix eCom Cart V2) — the twin of
// app/wix/restaurants/ordering.ts. Same exports, same OrderCart/OrderLine DTOs; rules and mappers
// from ordering-core (the SAME file the SDK transport uses, deployed flat next to this one). The
// request shapes are exact and rewriting them is how carts break: the Orders app id, options
// { operationId, menuId, menuSectionId } (sectionId rides along) and the visitor's choices in
// options.priceVariant / options.modifierGroups / options.specialRequests, the keys Wix's own
// ordering sends; and the fulfillment (pickup/delivery + time) as the cart's delivery method code,
// set BEFORE the checkout redirect — the hosted checkout has no picker for it and refuses the order
// without it. Failures are loud: a missing or paused operation, an invalid selection, an
// unavailable line, an undeliverable address, an empty order at checkout all throw — surface the message.
// All calls run with the visitor token: the cart is the token's (see ./client).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/list-operations.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/menu-ordering-settings/query-menu-ordering-settings.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/fulfillment-methods/list-fulfillment-methods.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/add-line-items-to-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/set-delivery-method-for-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/update-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/calculate-available-time-slots-for-date.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/calculate-first-available-time-slot-per-fulfillment-type.md
import { WixApiError, wixRequest } from "../../shared/rest/client.js";
import { imgSrc } from "../../shared/rest/media.js";
import { fetchSiteMoney } from "./menu.js";
import { initialSelection, nextCursor, validateSelection, type Raw } from "../app/wix/restaurants/menu-core.js";
import {
  NOT_DELIVERABLE,
  RESTAURANTS_ORDERS_APP_ID,
  assertOrderAdded,
  assertOrderCheckoutable,
  assertOrderContext,
  assertOrderable,
  estimateSubtotal,
  fulfillmentAddress,
  fulfillmentCode,
  orderCatalogItem,
  rawId,
  resolveOperation,
  restaurantToday,
  slotsAddressQuery,
  slotsDateQuery,
  toFulfillmentMethods,
  toFulfillmentTimes,
  toMenuOrderingMap,
  toOrderCart,
  toRestaurantRegion,
} from "../app/wix/restaurants/ordering-core.js";
import type { DeliveryAddress, FulfillmentChoice, FulfillmentMethodInfo, FulfillmentTime, MenuItem, MenuOrderingInfo, OrderCart, OrderSelection, OrderingStatus } from "../app/wix/restaurants/types.js";

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
    const [status, money, raws] = await Promise.all([resolveOrdering(), fetchSiteMoney(), listFulfillmentRaws()]);
    return toFulfillmentMethods(raws, status.fulfillmentIds, money);
  } catch {
    return []; // ordering still works without the list (pickup ASAP)
  }
}

// The operation's raw fulfillment methods (operation.fulfillmentIds only), read once per session.
let fulfillmentRawsPromise: Promise<Raw[]> | null = null;
function listFulfillmentRaws(): Promise<Raw[]> {
  fulfillmentRawsPromise ??= (async () => {
    const status = await resolveOrdering();
    if (!status.fulfillmentIds.length) return [];
    const wanted = new Set(status.fulfillmentIds);
    const raws: Raw[] = [];
    let cursor: string | null = null;
    do {
      const res: Raw = await wixRequest<Raw>("/fulfillment-methods/v1/fulfillment-methods", { method: "GET", query: cursor ? { "cursorPaging.cursor": cursor } : {} });
      raws.push(...((res?.fulfillmentMethods ?? []) as Raw[]));
      cursor = nextCursor(res);
    } while (cursor);
    return raws.filter((m) => wanted.has(rawId(m)));
  })().catch((e) => {
    fulfillmentRawsPromise = null; // transient failure — allow a retry on the next call
    throw e;
  });
  return fulfillmentRawsPromise;
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
 *       operationId, menuId, menuSectionId, sectionId, priceVariant?: { id, formattedPrice },
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
 * The times the order can be fulfilled at: ASAP for each type, then the scheduled slots of `dayKey`
 * ("YYYY-MM-DD" at the restaurant; default today), ASAP first. Pass the delivery `address` once the
 * visitor has entered it: the delivery times are then those of the methods that deliver there (none
 * when no method does). [] when there is no operation. Pass the chosen entry to setOrderFulfillment as `time`.
 * GET /restaurants-operations/v1/operations/{id}/first-available-time-slot-per-fulfillment-type[?deliveryAddress.*]
 * GET /restaurants-operations/v1/operations/{id}/available-time-slots-per-date?date.day=&date.month=&date.year=[&deliveryAddress.*]
 *   deliveryAddress.addressLine / .city / .postalCode / .country / .subdivision
 */
export async function fetchFulfillmentTimes(dayKey?: string, address?: DeliveryAddress): Promise<FulfillmentTime[]> {
  const { operationId, timeZone } = await resolveOrdering();
  if (!operationId) return [];
  const base = `/restaurants-operations/v1/operations/${operationId}`;
  const where = slotsAddressQuery(address, address ? toRestaurantRegion(await listFulfillmentRaws()) : { country: "", subdivision: "" });
  const [asap, slots] = await Promise.all([
    wixRequest<Raw>(`${base}/first-available-time-slot-per-fulfillment-type`, { method: "GET", query: where }),
    wixRequest<Raw>(`${base}/available-time-slots-per-date`, { method: "GET", query: { ...slotsDateQuery(dayKey ?? restaurantToday(timeZone)), ...where } }),
  ]);
  return toFulfillmentTimes(asap, slots);
}

/**
 * Set how and when the order is fulfilled: pickup or delivery, a time from fetchFulfillmentTimes
 * (omitted → ASAP), and for delivery the address (street, city; country and subdivision default to
 * the restaurant's). Pickup puts the restaurant's country on the cart, which Wix requires before
 * any delivery method. Throws NOT_DELIVERABLE when the address is outside every delivery area.
 * PATCH /ecom/v2/carts/current  { cart: { deliveryInfo: { address: { addressLine, city, postalCode, country, subdivision } } } }
 *   (the street field is addressLine; addressLine1 is dropped)
 * POST  /ecom/v2/carts/current/set-delivery-method  { deliveryMethod: { code: "PICKUP|ASAP" | "<TYPE>|<startMs>|<endMs>" } }
 */
export async function setOrderFulfillment(choice: FulfillmentChoice): Promise<OrderCart> {
  const address = fulfillmentAddress(choice, toRestaurantRegion(await listFulfillmentRaws()));
  await wixRequest<Raw>(CART, { method: "PATCH", body: { cart: { deliveryInfo: { address } } } });
  try {
    const res = await wixRequest<Raw>(`${CART}/set-delivery-method`, { body: { deliveryMethod: { code: fulfillmentCode(choice) } } });
    return readCartWithSubtotal(res?.cart ?? null);
  } catch (e) {
    if (e instanceof WixApiError && e.code === "DELIVERY_METHOD_NOT_FOUND") {
      throw new Error(choice.type === "DELIVERY" ? NOT_DELIVERABLE : "This pickup time isn't available. Choose another time.");
    }
    throw e;
  }
}

/**
 * Start the Wix-hosted checkout for the current order and return the URL to navigate the FULL
 * document to. The cart's id IS the checkout id. The fulfillment must be on the cart first
 * (setOrderFulfillment); a cart with none gets pickup ASAP. Payment is collected on the hosted
 * page. `origin` must be the site's real https origin as registered on the OAuth app's allowed
 * domains (browser: window.location.origin) — an unlisted or http origin 403s on return.
 * POST /headless/v1/redirect-session  { ecomCheckout: { checkoutId }, callbacks: { postFlowUrl, thankYouPageUrl } }
 */
export async function orderCheckoutUrl(origin: string = typeof window !== "undefined" ? window.location.origin : ""): Promise<string> {
  const raw = await getCurrentCartRaw();
  assertOrderCheckoutable(raw);
  if (!raw?.deliveryInfo?.method?.code) {
    await setOrderFulfillment({ type: "PICKUP" }).catch(() => {
      throw new Error("Choose pickup or delivery before checkout.");
    });
  }
  const res = await wixRequest<Raw>("/headless/v1/redirect-session", {
    body: { ecomCheckout: { checkoutId: rawId(raw) }, callbacks: origin ? { postFlowUrl: `${origin}/`, thankYouPageUrl: `${origin}/` } : {} },
  });
  const url = res?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start: no redirect URL returned.");
  return url;
}
