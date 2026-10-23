import { wixApiRequest } from "./wix-client.js";

// Data model reference: see INSTRUCTIONS.md

/**
 * Operation — online-ordering context (fulfillment + scheduling). Every cart line item must
 * reference an operationId. Pick the default / first enabled one for a simple flow.
 *   id {string}, name {string}, default {boolean},
 *   onlineOrderingStatus {string} — "ENABLED"|"DISABLED"|"PAUSED_UNTIL"|UNDEFINED,
 *   defaultFulfillmentType {string} — "PICKUP"|"DELIVERY",
 *   fulfillmentIds {string[]}, businessLocationId {string}
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/operation-object.md
 *
 * Cart (Wix eCom V2) — restaurant orders use the same visitor cart as the storefront.
 *   id {string} — the cart id IS the checkout id,
 *   lineItems[].id {string} — lineItemId for update/remove (NOT the item id),
 *   lineItems[].quantityInfo.confirmedQuantity {number},
 *   lineItems[].source.catalogReference.catalogItemId {string} — the ordered item's GUID (NOT top-level in V2),
 *   lineItems[].name.original {string},
 *   lineItems[].pricing.unitPrice / lineItems[].pricing.totalPrice {ConvertedMoney} —
 *     { amount, convertedAmount } with NO formatted string; format the number client-side,
 *   lineItems[].status {string} — "IN_STOCK"|"PARTIALLY_IN_STOCK"|"OUT_OF_STOCK"|"REMOVED_FROM_CATALOG"
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/get-current-cart.md
 */

// Wix Restaurants Orders app id — required in catalogReference when adding menu items to the eCom cart.
const RESTAURANTS_ORDERS_APP_ID = "9a5d83fd-8570-482e-81ab-cfa88942ee60";

/**
 * List the restaurant's online-ordering operations.
 * GET https://www.wixapis.com/restaurants-operations/v1/operations
 * @returns {Promise<object[]>}
 */
export async function listOperations() {
  const res = await wixApiRequest("/restaurants-operations/v1/operations", { method: "GET" });
  return res?.operations ?? [];
}

/**
 * Pick the operation to order through — the default, else the first ENABLED, else the first.
 * Returns null when no operation is configured (show an "ordering unavailable" state).
 * @returns {Promise<object|null>}
 */
export async function getDefaultOperation() {
  const operations = await listOperations();
  return (
    operations.find((o) => o.default) ??
    operations.find((o) => o.onlineOrderingStatus === "ENABLED") ??
    operations[0] ??
    null
  );
}

/**
 * Add a restaurant menu item to the visitor's current eCom cart.
 *
 * Requires operationId (from listOperations/getDefaultOperation), menuId, and sectionId. The section
 * is sent as options.menuSectionId (what Restaurants' checkout validates the dish against — a line
 * without it is refused at checkout as "no longer available") and as sectionId.
 * Throws if any is missing, or if the added line is not AVAILABLE.
 *
 * Variant selection and modifier up-charges on the cart line are not covered here — the
 * restaurants catalogReference.options shape for those is not documented for client add-to-cart.
 * Confirm the shape before extending:
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/sample-flows.md
 *
 * POST https://www.wixapis.com/ecom/v2/carts/current/add-line-items
 * @param {string} itemId  Menu item GUID (item.id).
 * @param {{ operationId: string, menuId: string, sectionId: string, onlineOrderingPageUrl?: string, quantity?: number }} opts
 * @returns {Promise<object>} Updated cart.
 */
export async function addItemToCart(itemId, { operationId, menuId, sectionId, onlineOrderingPageUrl, quantity = 1 } = {}) {
  if (!itemId) throw new Error("addItemToCart: itemId is required.");
  if (!operationId || !menuId || !sectionId) {
    throw new Error("addItemToCart: operationId, menuId and sectionId are all required for a restaurant line item.");
  }
  const options = { operationId, menuId, menuSectionId: sectionId, sectionId };
  if (onlineOrderingPageUrl) options.onlineOrderingPageUrl = onlineOrderingPageUrl;

  const res = await wixApiRequest("/ecom/v2/carts/current/add-line-items", {
    method: "POST",
    body: {
      catalogItems: [{ catalogReference: { appId: RESTAURANTS_ORDERS_APP_ID, catalogItemId: itemId, options }, quantity }],
    },
  });
  // V2 nests the reference under `source` — a top-level lineItem.catalogReference no longer exists.
  const line = (res?.cart?.lineItems ?? []).find((l) => l.source?.catalogReference?.catalogItemId === itemId);
  if (line?.status && line.status !== "IN_STOCK") {
    throw new Error(`Item not available to order (status: ${line.status}).`);
  }
  return res?.cart;
}

/** Read the visitor's current cart. Returns null if no cart exists yet. */
export async function getCurrentCart() {
  try {
    const res = await wixApiRequest("/ecom/v2/carts/current", { method: "GET" });
    return res?.cart ?? null;
  } catch {
    return null;
  }
}

/**
 * Update the quantity of a cart line. lineItemId is cart.lineItems[].id, not the item id.
 * POST https://www.wixapis.com/ecom/v2/carts/current/update-line-items
 * @returns {Promise<object>} Updated cart.
 */
export async function updateCartItemQuantity(lineItemId, quantity) {
  const res = await wixApiRequest("/ecom/v2/carts/current/update-line-items", {
    method: "POST",
    body: { lineItems: [{ lineItemId, quantity: { newQuantity: quantity } }] },
  });
  return res?.cart;
}

/**
 * Remove a line from the current cart by its cart.lineItems[].id.
 * POST https://www.wixapis.com/ecom/v2/carts/current/remove-line-items
 * @returns {Promise<object>} Updated cart.
 */
export async function removeFromCart(lineItemId) {
  const res = await wixApiRequest("/ecom/v2/carts/current/remove-line-items", {
    method: "POST",
    body: { lineItemIds: [lineItemId] },
  });
  return res?.cart;
}

/**
 * The restaurant's country and subdivision ("US-CA") from its pickup address (or a delivery
 * area's center). The cart needs a country before any delivery method is accepted, pickup
 * included (DELIVERY_METHOD_MISSING_ADDRESS); Wix pre-fills one only from the visitor's location.
 * GET https://www.wixapis.com/fulfillment-methods/v1/fulfillment-methods
 */
async function restaurantRegion() {
  const res = await wixApiRequest("/fulfillment-methods/v1/fulfillment-methods", { method: "GET" });
  for (const m of res?.fulfillmentMethods ?? []) {
    if (!m.enabled) continue;
    const a = m.pickupOptions?.address ?? m.deliveryOptions?.deliveryArea?.radiusOptions?.centerPointAddress;
    if (!a?.country) continue;
    const sub = a.subdivision ?? "";
    return { country: a.country, subdivision: sub && !sub.includes("-") ? `${a.country}-${sub}` : sub };
  }
  return { country: "", subdivision: "" };
}

/**
 * Set how and when the order is fulfilled — the cart's delivery method. The hosted checkout has no
 * pickup/delivery or time picker for restaurant orders and refuses the order without one.
 *   code: "PICKUP|ASAP" · "DELIVERY|ASAP" · "<TYPE>|<startEpochMs>|<endEpochMs>" for a scheduled slot
 *         (slots: GET /restaurants-operations/v1/operations/{operationId}/available-time-slots-per-date
 *          ?date.day=&date.month=&date.year= → timeslotsPerFulfillmentType[].timeSlot.startTime/endTime,
 *          AVAILABLE only).
 *   address: for delivery, { addressLine, city, postalCode?, country?, subdivision? } — the street goes in
 *          addressLine (addressLine1 is dropped); country/subdivision default to the restaurant's.
 * Throws "We don't deliver to this address…" when a delivery address is outside every delivery area.
 * PATCH https://www.wixapis.com/ecom/v2/carts/current  { cart: { deliveryInfo: { address } } }
 * POST  https://www.wixapis.com/ecom/v2/carts/current/set-delivery-method  { deliveryMethod: { code } }
 * @returns {Promise<object>} Updated cart.
 */
export async function setOrderFulfillment(code, address) {
  const region = await restaurantRegion();
  const isDelivery = code.startsWith("DELIVERY|");
  if (isDelivery && (!address?.addressLine?.trim() || !address?.city?.trim())) {
    throw new Error("Enter a delivery address: street and city.");
  }
  const country = (isDelivery && address?.country) || region.country;
  if (!country) throw new Error("The restaurant's country is unknown: set a pickup address in Restaurants settings.");
  const subdivision = (isDelivery && address?.subdivision) || (country === region.country ? region.subdivision : "");
  const cartAddress = isDelivery ? { ...address, country, ...(subdivision ? { subdivision } : {}) } : { country, ...(subdivision ? { subdivision } : {}) };
  await wixApiRequest("/ecom/v2/carts/current", { method: "PATCH", body: { cart: { deliveryInfo: { address: cartAddress } } } });
  try {
    const res = await wixApiRequest("/ecom/v2/carts/current/set-delivery-method", { method: "POST", body: { deliveryMethod: { code } } });
    return res?.cart;
  } catch (e) {
    if (e?.body?.details?.applicationError?.code === "DELIVERY_METHOD_NOT_FOUND") {
      throw new Error(isDelivery ? "We don't deliver to this address. Choose pickup or another address." : "This pickup time isn't available. Choose another time.");
    }
    throw e;
  }
}

/**
 * Start the hosted checkout for the current cart and return the Wix-hosted checkout URL.
 * In Cart V2 the cart id IS the checkout id — there is no separate checkout-creation call; the
 * redirect session is created straight from the current cart's id. The fulfillment must be on the
 * cart first (setOrderFulfillment); a cart with none gets pickup ASAP.
 * Throws on empty cart, unavailable lines, or a missing redirect URL.
 * Redirect with: window.location.href = await checkout()
 * @returns {Promise<string>}
 */
export async function checkout() {
  const cart = await getCurrentCart();
  const lines = cart?.lineItems ?? [];
  if (!lines.length) throw new Error("Cannot check out: the cart is empty.");
  const unavailable = lines.filter((l) => l.status && l.status !== "IN_STOCK");
  if (unavailable.length) {
    const names = unavailable.map((l) => l.name?.original ?? l.source?.catalogReference?.catalogItemId).join(", ");
    throw new Error(`Cannot check out: ${unavailable.length} item(s) not available — ${names}.`);
  }
  if (!cart.id) throw new Error("Failed to check out: the current cart has no id.");
  if (!cart.deliveryInfo?.method?.code) {
    await setOrderFulfillment("PICKUP|ASAP").catch(() => {
      throw new Error("Choose pickup or delivery before checkout.");
    });
  }

  const redirect = await wixApiRequest("/headless/v1/redirect-session", {
    method: "POST",
    body: { ecomCheckout: { checkoutId: cart.id }, callbacks: { postFlowUrl: window.location.href } },
  });
  const url = redirect?.redirectSession?.fullUrl;
  if (!url) throw new Error("Failed to create the checkout redirect session.");
  return url;
}
