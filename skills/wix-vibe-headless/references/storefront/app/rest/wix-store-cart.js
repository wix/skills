import { wixApiRequest } from "./wix-client.js";

// Data model reference: see INSTRUCTIONS.md
// Product shape (for addToCart): see wix-store-catalog.js

// Stores app id — required inside catalogReference for store products.
const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

/**
 * Wix eCom Cart V2 — key fields for building a cart UI.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/get-current-cart.md
 *
 *   id {string} — the cart id IS the checkout id (currency lives under businessInfo.currencyCode / customerInfo.currencyCode, not at the cart root),
 *   lineItems[].id {string} — lineItemId for update/remove (NOT catalogItemId),
 *   lineItems[].quantityInfo.confirmedQuantity {number},
 *   lineItems[].source.catalogReference.catalogItemId {string} — NOT top-level in V2,
 *   lineItems[].name.original {string},
 *   lineItems[].pricing.unitPrice {ConvertedMoney} — per-unit price after discounts,
 *   lineItems[].pricing.totalPrice {ConvertedMoney} — line total after discounts,
 *     ConvertedMoney is { amount, convertedAmount } with NO formatted string — `amount` is in the
 *     site currency, `convertedAmount` in the display currency; format the number client-side.
 *   lineItems[].attributes.descriptionLines {array} — human-readable option/modifier labels:
 *     [{ name: { original }, plainText: { original } OR colorInfo: { original, code } }],
 *   lineItems[].attributes.image {object} — { id, url, height, width, altText } (use .url),
 *   lineItems[].status {string} — "IN_STOCK"|"PARTIALLY_IN_STOCK"|"OUT_OF_STOCK"|"REMOVED_FROM_CATALOG"
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
  const res = await wixApiRequest("/ecom/v2/carts/current/add-line-items", {
    method: "POST",
    body: { catalogItems: [{ catalogReference, quantity }] },
  });
  // V2 nests the reference under `source` — a top-level lineItem.catalogReference no longer exists.
  const line = (res?.cart?.lineItems ?? []).find(
    (l) => l.source?.catalogReference?.catalogItemId === catalogItemId && (!variantId || l.source?.catalogReference?.options?.variantId === variantId),
  );
  // Cart V2 rejects an unbuyable line with an explicit error rather than silently dropping it, but
  // guard both signals defensively:
  // 1. status set to something other than IN_STOCK
  // 2. no matching line at all (confirmed quantity 0 / line absent)
  if (line?.status && line.status !== "IN_STOCK") {
    throw new Error(`Item not available for sale (status: ${line.status}). Is it in stock?`);
  }
  if (!line || line.quantityInfo?.confirmedQuantity === 0) {
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
    const res = await wixApiRequest("/ecom/v2/carts/current", { method: "GET" });
    return res?.cart ?? null;
  } catch {
    return null;
  }
}

/**
 * Start the hosted checkout for the current cart and return its URL.
 * In Cart V2 the cart id IS the checkout id — there is no separate checkout-creation call; the
 * redirect session is created straight from the current cart's id.
 * Throws on empty cart, unavailable lines, or a missing redirect URL.
 * Usage: window.location.href = await checkout()
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

  const redirect = await wixApiRequest("/headless/v1/redirect-session", {
    method: "POST",
    body: { ecomCheckout: { checkoutId: cart.id }, callbacks: { postFlowUrl: window.location.href } },
  });
  const url = redirect?.redirectSession?.fullUrl;
  if (!url) throw new Error("Failed to create the checkout redirect session.");
  return url;
}

/**
 * Update the quantity of a cart line. lineItemId is cart.lineItems[].id, not catalogItemId.
 * Cart V2 rejects an over-stock quantity with an explicit error rather than clamping it.
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
 * @param {string} lineItemId
 * @returns {Promise<object>} Updated cart.
 */
export async function removeFromCart(lineItemId) {
  const res = await wixApiRequest("/ecom/v2/carts/current/remove-line-items", {
    method: "POST",
    body: { lineItemIds: [lineItemId] },
  });
  return res?.cart;
}
