import { wixApiRequest } from "./wix-client.js";

// Data model reference: see INSTRUCTIONS.md
// Product shape (for addToCart): see wix-store-catalog.js

// Stores app id — required inside catalogReference for store products.
const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

/**
 * Wix eCom Cart — key fields for building a cart UI.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart/get-cart.md
 *
 *   id {string}, currency {string},
 *   lineItems[].id {string} — lineItemId for update/remove (NOT catalogItemId),
 *   lineItems[].quantity {number},
 *   lineItems[].catalogReference.catalogItemId {string},
 *   lineItems[].productName.original {string},
 *   lineItems[].price.formattedAmount {string} — after discounts with currency symbol,
 *   lineItems[].fullPrice.formattedAmount {string} — before discount (strikethrough),
 *   lineItems[].descriptionLines {array} — human-readable option/modifier labels:
 *     [{ name: { original }, plainText: { original } OR colorInfo: { original, code } }],
 *   lineItems[].image.url {string},
 *   lineItems[].availability.status {string} — "AVAILABLE"|"NOT_AVAILABLE"|"PARTIALLY_AVAILABLE"|"NOT_FOUND"
 */

/**
 * Add a product to the visitor's current cart.
 *
 * For products with options (variants), pass the chosen variantId — resolve it from
 * product.variantsInfo.variants (from getProductBySlug) by matching the buyer's selected
 * option choices to variant.choices[].optionChoiceIds.
 *
 * For products with modifiers:
 *   - TEXT_CHOICES: pass modifierChoices: { [modifier.key]: choiceKey }
 *   - FREE_TEXT: pass customTextFields: { [modifier.freeTextSettings.key]: userInput }
 *   Mandatory modifiers (modifier.mandatory === true) MUST be included.
 *
 * Throws on out-of-stock so the buyer can't reach checkout with an unbuyable line.
 * Full catalogReference reference: https://dev.wix.com/docs/api-reference/business-solutions/stores/catalog-v3/e-commerce-integration.md
 *
 * @param {string} catalogItemId    Product GUID (product.id).
 * @param {string} [variantId]      variantsInfo.variants[].id — required for products with variants.
 * @param {number} [quantity]
 * @param {{ modifierChoices?: Record<string,string>, customTextFields?: Record<string,string> }} [extras]
 * @returns {Promise<object>} Updated cart.
 */
export async function addToCart(catalogItemId, variantId, quantity = 1, { modifierChoices, customTextFields } = {}) {
  const catalogReferenceOptions = {};
  if (variantId) catalogReferenceOptions.variantId = variantId;
  if (modifierChoices && Object.keys(modifierChoices).length) catalogReferenceOptions.options = modifierChoices;
  if (customTextFields && Object.keys(customTextFields).length) catalogReferenceOptions.customTextFields = customTextFields;

  const catalogReference = { appId: STORES_APP_ID, catalogItemId };
  if (Object.keys(catalogReferenceOptions).length) catalogReference.options = catalogReferenceOptions;
  const res = await wixApiRequest("/ecom/v1/carts/current/add-to-cart", {
    method: "POST",
    body: { lineItems: [{ catalogReference, quantity }] },
  });
  const line = (res?.cart?.lineItems ?? []).find(
    (l) => l.catalogReference?.catalogItemId === catalogItemId && (!variantId || l.catalogReference?.options?.variantId === variantId),
  );
  // Wix returns 200 even when the line is silently rejected — guard both signals:
  // 1. availability.status set to something other than AVAILABLE
  // 2. no matching line at all (quantity 0 / line absent)
  if (line?.availability?.status && line.availability.status !== "AVAILABLE") {
    throw new Error(`Item not available for sale (status: ${line.availability.status}). Is it in stock?`);
  }
  if (!line || line.quantity === 0) {
    // A missing line usually means a required selection wasn't sent — a mandatory modifier
    // (pass modifierChoices/customTextFields) or the variantId for a product with options —
    // not necessarily out of stock. Verify every required choice is included in this call.
    throw new Error(
      "Item could not be added to the cart. Check that every required selection was sent: " +
        "the variantId for a product with options, and all mandatory modifiers " +
        "(modifierChoices for TEXT_CHOICES, customTextFields for FREE_TEXT). It may also be out of stock.",
    );
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
 * Create a checkout from the current cart and return the hosted checkout URL.
 * Throws on empty cart, unavailable lines, or a missing redirect URL.
 * Usage: window.location.href = await checkout()
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

/**
 * Update the quantity of a cart line. lineItemId is cart.lineItems[].id, not catalogItemId.
 * Wix caps the result at remaining stock — returned quantity may be lower than requested.
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
 * @param {string} lineItemId
 * @returns {Promise<object>} Updated cart.
 */
export async function removeFromCart(lineItemId) {
  const res = await wixApiRequest("/ecom/v1/carts/current/remove-line-items", {
    method: "POST",
    body: { lineItemIds: [lineItemId] },
  });
  return res?.cart;
}
