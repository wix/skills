// Online ordering (Restaurants Orders + Wix eCom Cart V2) over the SDK — the only file that
// touches the raw cart, operation, and settings entities on this transport. Rules and mappers
// live in ./ordering-core (shared with the REST twin in templates/restaurants/rest/); this file is
// the transport only. Copy as-is; extend by calling these exports, never by editing them. The
// request shapes are exact and rewriting them is how carts break:
//   - the catalogReference appId is the ORDERS app (9a5d83fd-…), never the Stores id;
//   - options MUST carry operationId + menuId + sectionId (all three);
//   - the visitor's choices ride in options.priceVariant / options.modifierGroups /
//     options.specialRequests, the keys Wix's own ordering code sends (built in ordering-core).
// Failures are loud: throws on a missing or paused ordering operation, an invalid selection,
// unavailable lines, and an empty order at checkout — surface the message, don't swallow it.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/list-operations.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/menu-ordering-settings/query-menu-ordering-settings.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/fulfillment-methods/list-fulfillment-methods.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/list-items.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/get-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/add-line-items-to-current-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/update-line-items.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import {
  operations as operationsModule,
  fulfillmentMethods as fulfillmentModule,
  menuOrderingSettings as menuSettingsModule,
  items as itemsModule,
} from "@wix/restaurants";
import { currentCartV2 } from "@wix/ecom";
import { redirects as redirectsModule } from "@wix/redirects";
import { wixModule } from "../sdk";
import { imgSrc } from "../media";
import { fetchSiteMoney } from "./menu";
import { initialSelection, nextCursor, validateSelection, type Raw } from "./menu-core";
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
} from "./ordering-core";
import type { FulfillmentMethodInfo, MenuItem, MenuOrderingInfo, OrderCart, OrderSelection, OrderingStatus } from "./types";

export { RESTAURANTS_ORDERS_APP_ID };

const operationsApi = wixModule(operationsModule);
const fulfillmentApi = wixModule(fulfillmentModule);
const menuSettingsApi = wixModule(menuSettingsModule);
const itemsApi = wixModule(itemsModule);
const cartApi = wixModule(currentCartV2);
const redirects = wixModule(redirectsModule);

// The ordering operation is site config — resolve once, reuse for every add.
let orderingPromise: Promise<OrderingStatus> | null = null;

/**
 * The operation to order through and its state (ENABLED, else the default, else the first).
 * `status` "NONE" when the site has no online ordering configured; DISABLED / PAUSED_UNTIL refuse
 * every add — the add control reads the reason from it.
 */
export function resolveOrdering(): Promise<OrderingStatus> {
  orderingPromise ??= operationsApi
    .listOperations()
    .then((res: Raw) => resolveOperation(res.operations ?? []))
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
 * Every menu's ordering settings under the operation, keyed by menuId: which menus take online
 * orders and when (availability windows in their own timezone). A menu absent from the map is
 * not orderable. {} when there is no operation.
 */
export async function fetchMenuOrdering(): Promise<Record<string, MenuOrderingInfo>> {
  const { operationId } = await resolveOrdering();
  if (!operationId) return {};
  const raws: Raw[] = [];
  let page = await menuSettingsApi.queryMenuOrderingSettings().eq("operationId", operationId).find();
  raws.push(...(page.items as Raw[]));
  while (page.hasNext()) {
    page = await page.next();
    raws.push(...(page.items as Raw[]));
  }
  return toMenuOrderingMap(raws);
}

/**
 * The operation's enabled pickup/delivery methods (operation.fulfillmentIds only), fees and
 * minimums formatted in the site currency — for display; the buyer picks one on the hosted checkout.
 */
export async function fetchFulfillmentMethods(): Promise<FulfillmentMethodInfo[]> {
  try {
    const [status, money] = await Promise.all([resolveOrdering(), fetchSiteMoney()]);
    if (!status.fulfillmentIds.length) return [];
    const raws: Raw[] = [];
    let cursor: string | null = null;
    do {
      const res: Raw = await fulfillmentApi.listFulfillmentMethods(cursor ? { cursorPaging: { cursor } } : {});
      raws.push(...((res.fulfillmentMethods ?? []) as Raw[]));
      cursor = nextCursor(res);
    } while (cursor);
    return toFulfillmentMethods(raws, status.fulfillmentIds, money);
  } catch {
    return []; // display nicety — ordering still works without the list
  }
}

// A line's attributes.image may come back absent — join the menu items' images by the line's
// catalogItemId and cache for the session.
const lineImageCache = new Map<string, string>();
async function fillLineImages(cart: OrderCart, raws: Raw[]): Promise<void> {
  const wanted = new Map<string, number[]>(); // itemId -> line indexes
  raws.forEach((raw, i) => {
    if (cart.lines[i].imageUrl) return;
    const itemId = raw.source?.catalogReference?.catalogItemId;
    if (!itemId) return;
    const cached = lineImageCache.get(itemId);
    if (cached !== undefined) {
      cart.lines[i].imageUrl = cached;
      return;
    }
    wanted.set(itemId, [...(wanted.get(itemId) ?? []), i]);
  });
  if (!wanted.size) return;
  try {
    const res: Raw = await itemsApi.listItems({ itemIds: [...wanted.keys()] });
    for (const item of (res.items ?? []) as Raw[]) {
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
  // The authoritative after-discount subtotal comes from the cart estimate, never from
  // hand-summing line items (fees, tax, and delivery resolve at checkout).
  let subtotal = "";
  try {
    subtotal = estimateSubtotal(await cartApi.estimateCurrentCart(), raw);
  } catch {
    /* estimate is a display nicety — the cart itself is still valid */
  }
  const cart = toOrderCart(raw, subtotal, imgSrc);
  await fillLineImages(cart, raw.lineItems as Raw[]);
  return cart;
}

/** Read the visitor's current order cart. An empty cart (not an error) when none exists yet. */
export async function fetchOrderCart(): Promise<OrderCart> {
  try {
    const { cart } = await cartApi.getCurrentCart();
    return readCartWithSubtotal(cart as Raw);
  } catch {
    return toOrderCart(null, "", imgSrc);
  }
}

/**
 * Add a dish to the current order. `item` is the MenuItem DTO as rendered; `menuId` and
 * `sectionId` are the ids of the menu and section it is RENDERED UNDER — thread them from the
 * render context (the fetchMenus tree), never re-derive them. `selection` is what the visitor
 * chose (start from initialSelection(item)); omitted → the item's defaults. Throws when ordering
 * isn't accepting, the dish can't be ordered, a modifier rule fails, or the line is refused.
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
  const { cart } = await cartApi.addLineItemsToCurrentCart({
    catalogItems: [orderCatalogItem(item, { operationId, menuId, sectionId }, quantity, selection)],
  });
  assertOrderAdded(cart as Raw, item.id);
  return readCartWithSubtotal(cart as Raw);
}

/** Change a line's quantity. `lineItemId` is OrderLine.lineItemId, never the menu item id. */
export async function updateOrderQuantity(lineItemId: string, quantity: number): Promise<OrderCart> {
  const { cart } = await cartApi.updateLineItemsInCurrentCart({
    lineItems: [{ lineItemId, quantity: { newQuantity: quantity } }],
  });
  return readCartWithSubtotal(cart as Raw);
}

/** Remove a line from the order by OrderLine.lineItemId. */
export async function removeOrderLine(lineItemId: string): Promise<OrderCart> {
  const { cart } = await cartApi.removeLineItemsFromCurrentCart([lineItemId]);
  return readCartWithSubtotal(cart as Raw);
}

/**
 * Start the Wix-hosted checkout for the current order and return the URL to navigate to.
 * The cart's id IS the checkout id — no separate checkout-creation call. Fulfillment
 * (pickup/delivery + time) and payment are collected on the hosted page. Call from the
 * browser: the return origin must be window.location.origin (https), never a server-derived
 * request origin (http behind the proxy → the return redirect 403s).
 */
export async function orderCheckoutUrl(): Promise<string> {
  const { cart } = await cartApi.getCurrentCart();
  const raw = cart as Raw;
  assertOrderCheckoutable(raw);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const session = await redirects.createRedirectSession({
    ecomCheckout: { checkoutId: rawId(raw) },
    callbacks: {
      postFlowUrl: origin ? `${origin}/` : undefined,
      thankYouPageUrl: origin ? `${origin}/` : undefined,
    },
  });
  const url = session?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start: no redirect URL returned.");
  return url;
}
