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
 * Cart (Wix eCom) — restaurant orders use the same visitor cart as the storefront.
 *   id {string}, currency {string},
 *   lineItems[].id {string} — lineItemId for update/remove (NOT the item id),
 *   lineItems[].quantity {number},
 *   lineItems[].catalogReference.catalogItemId {string} — the ordered item's GUID,
 *   lineItems[].productName.original {string},
 *   lineItems[].price.formattedAmount {string},
 *   lineItems[].availability.status {string} — "AVAILABLE"|"NOT_AVAILABLE"|"PARTIALLY_AVAILABLE"|"NOT_FOUND"
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/cart/cart-object.md
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
 * Requires operationId (from listOperations/getDefaultOperation), menuId, and sectionId.
 * Throws if any is missing, or if the added line is not AVAILABLE.
 *
 * Variant selection and modifier up-charges on the cart line are not covered here — the
 * restaurants catalogReference.options shape for those is not documented for client add-to-cart.
 * Confirm the shape before extending:
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/sample-flows.md
 *
 * POST https://www.wixapis.com/ecom/v1/carts/current/add-to-cart
 * @param {string} itemId  Menu item GUID (item.id).
 * @param {{ operationId: string, menuId: string, sectionId: string, onlineOrderingPageUrl?: string, quantity?: number }} opts
 * @returns {Promise<object>} Updated cart.
 */
export async function addItemToCart(itemId, { operationId, menuId, sectionId, onlineOrderingPageUrl, quantity = 1 } = {}) {
  if (!itemId) throw new Error("addItemToCart: itemId is required.");
  if (!operationId || !menuId || !sectionId) {
    throw new Error("addItemToCart: operationId, menuId and sectionId are all required for a restaurant line item.");
  }
  const options = { operationId, menuId, sectionId };
  if (onlineOrderingPageUrl) options.onlineOrderingPageUrl = onlineOrderingPageUrl;

  const res = await wixApiRequest("/ecom/v1/carts/current/add-to-cart", {
    method: "POST",
    body: {
      lineItems: [{ catalogReference: { appId: RESTAURANTS_ORDERS_APP_ID, catalogItemId: itemId, options }, quantity }],
    },
  });
  const line = (res?.cart?.lineItems ?? []).find((l) => l.catalogReference?.catalogItemId === itemId);
  if (line?.availability?.status && line.availability.status !== "AVAILABLE") {
    throw new Error(`Item not available to order (status: ${line.availability.status}).`);
  }
  return res?.cart;
}

/** Read the visitor's current cart. Returns null if no cart exists yet. */
export async function getCurrentCart() {
  try {
    const res = await wixApiRequest("/ecom/v1/carts/current", { method: "GET" });
    return res?.cart ?? null;
  } catch {
    return null;
  }
}

/**
 * Update the quantity of a cart line. lineItemId is cart.lineItems[].id, not the item id.
 * POST https://www.wixapis.com/ecom/v1/carts/current/update-line-items-quantity
 * @returns {Promise<object>} Updated cart.
 */
export async function updateCartItemQuantity(lineItemId, quantity) {
  const res = await wixApiRequest("/ecom/v1/carts/current/update-line-items-quantity", {
    method: "POST",
    body: { lineItems: [{ id: lineItemId, quantity }] },
  });
  return res?.cart;
}

/**
 * Remove a line from the current cart by its cart.lineItems[].id.
 * POST https://www.wixapis.com/ecom/v1/carts/current/remove-line-items
 * @returns {Promise<object>} Updated cart.
 */
export async function removeFromCart(lineItemId) {
  const res = await wixApiRequest("/ecom/v1/carts/current/remove-line-items", {
    method: "POST",
    body: { lineItemIds: [lineItemId] },
  });
  return res?.cart;
}

/**
 * Create a checkout from the current cart and return the Wix-hosted checkout URL.
 * Throws on empty cart, unavailable lines, or a missing redirect URL.
 * Redirect with: window.location.href = await checkout()
 * @returns {Promise<string>}
 */
export async function checkout() {
  const cart = await getCurrentCart();
  const lines = cart?.lineItems ?? [];
  if (!lines.length) throw new Error("Cannot check out: the cart is empty.");
  const unavailable = lines.filter((l) => l.availability?.status && l.availability.status !== "AVAILABLE");
  if (unavailable.length) {
    const names = unavailable.map((l) => l.productName?.original ?? l.catalogReference?.catalogItemId).join(", ");
    throw new Error(`Cannot check out: ${unavailable.length} item(s) not available — ${names}.`);
  }

  const checkoutRes = await wixApiRequest("/ecom/v1/carts/current/create-checkout", {
    method: "POST",
    body: { channelType: "WEB" },
  });
  const checkoutId = checkoutRes?.checkoutId;
  if (!checkoutId) throw new Error("Failed to create checkout from the current cart.");

  const redirect = await wixApiRequest("/headless/v1/redirect-session", {
    method: "POST",
    body: { ecomCheckout: { checkoutId }, callbacks: { postFlowUrl: window.location.href } },
  });
  const url = redirect?.redirectSession?.fullUrl;
  if (!url) throw new Error("Failed to create the checkout redirect session.");
  return url;
}
