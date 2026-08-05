import { wixApiRequest } from "./wix-client.js";

// Data model reference: see INSTRUCTIONS.md
// Product shape (for addToCart): see wix-store-catalog.js

// Stores app id — required inside catalogReference for store products.
const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

/**
 * Wix eCom Cart V2 — key fields for building a cart UI.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/get-cart.md
 *
 *   id {string}, businessInfo.currencyCode {string} (site currency), customerInfo.currencyCode {string} (display currency),
 *   lineItems[].id {string} — lineItemId for update/remove (NOT catalogItemId),
 *   lineItems[].quantityInfo.confirmedQuantity {number} — quantity that will actually be purchased,
 *   lineItems[].quantityInfo.requestedQuantity {number}, lineItems[].quantityInfo.availableQuantity {number},
 *   lineItems[].source.catalogReference.catalogItemId {string},
 *   lineItems[].name.original {string} (name.translated for buyer's language),
 *   lineItems[].pricing.unitPrice.amount {string} — raw decimal, after discounts (NO currency symbol in V2 — format client-side),
 *   lineItems[].pricing.totalPrice.amount {string} — line total (unit x qty),
 *   lineItems[].pricing.breakdown.fullPrice.amount {string} — before discount (strikethrough),
 *   lineItems[].attributes.descriptionLines {array} — human-readable option/modifier labels:
 *     [{ name: { original }, plainText: { original } OR colorInfo: { original, code } }],
 *   lineItems[].attributes.image.url {string},
 *   lineItems[].status {string} — "IN_STOCK"|"PARTIALLY_IN_STOCK"|"OUT_OF_STOCK"|"REMOVED_FROM_CATALOG"
 *
 * Note: display totals (subtotal, tax, formatted amounts) are NOT stored on the cart in V2.
 * Call Calculate/Estimate Cart to get a summary — see checkout() for the flow.
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
  const line = (res?.cart?.lineItems ?? []).find(
    (l) => l.source?.catalogReference?.catalogItemId === catalogItemId && (!variantId || l.source?.catalogReference?.options?.variantId === variantId),
  );
  // Cart V2 reports invalid items as explicit errors, but partial stock still returns a
  // reduced confirmedQuantity — guard both signals:
  // 1. status set to something other than IN_STOCK
  // 2. no matching line at all (confirmedQuantity 0 / line absent)
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
 * Send the current cart to the hosted Wix checkout and return the redirect URL.
 * Throws on empty cart, unavailable lines, or a missing redirect URL.
 * Usage: window.location.href = await checkout()
 *
 * Cart V2 has no separate checkout entity — the cart id IS the checkout id, so there is no
 * "create checkout" step. We still create a redirect session so the visitor/member session
 * carries across to the Wix-hosted checkout page on its own domain.
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
 * Wix caps the result at remaining stock — returned confirmedQuantity may be lower than requested.
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
