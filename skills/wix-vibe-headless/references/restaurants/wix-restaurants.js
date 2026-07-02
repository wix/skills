import { wixApiRequest } from "./wix-client.js";

/**
 * Wix Restaurants Orders app id — required inside `catalogReference` when adding a
 * restaurant menu item to the eCom cart. Constant across all sites.
 * Reference: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/sample-flows.md
 */
const RESTAURANTS_ORDERS_APP_ID = "9a5d83fd-8570-482e-81ab-cfa88942ee60";

/* ===========================================================================
 * INLINED DATA MODEL (the key entities — read these before building the UI)
 * The Restaurants menu model is hierarchical and split across several APIs:
 *
 *   Menu └─ Sections └─ Items ├─ Price Variants
 *                             ├─ Modifier Groups └─ Modifiers
 *                             └─ Labels
 *
 * `getFullMenu()` walks all of these and returns one assembled tree — prefer it
 * over calling the individual list helpers unless you need a single slice.
 * ===========================================================================*/

/**
 * Menu — top of the hierarchy. One per "menu" the restaurant publishes (e.g. Dinner, Drinks).
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/menu-object.md
 *
 *   id                 {string}   Menu GUID.
 *   name               {string}   Display name.
 *   description         {string}   Menu description.
 *   visible            {boolean}  Whether shown to site visitors.
 *   sectionIds         {string[]} Ordered Section GUIDs — render sections in this order.
 *   urlQueryParam      {string}   URL slug fragment for the menu (e.g. "dinner-menu").
 *   businessLocationId {string}   Business location this menu belongs to.
 */

/**
 * Section — a group of items within a menu (e.g. Appetizers, Mains).
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sections/section-object.md
 *
 *   id               {string}   Section GUID.
 *   name             {string}   Display name.
 *   description       {string}  Section description.
 *   image            {object}   { id, url, width, height, altText } — main section image.
 *   additionalImages {object[]} More images.
 *   itemIds          {string[]} Ordered Item GUIDs — render items in this order.
 *   visible          {boolean}  Whether shown to site visitors.
 */

/**
 * Item — a single dish/drink. Has EITHER a single `priceInfo` OR `priceVariants` (one-of).
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/item-object.md
 *
 *   id                          {string}   Item GUID — the `catalogItemId` for ordering.
 *   name                        {string}   Display name.
 *   description                 {string}   Item description.
 *   image                       {object}   { id, url, width, height, altText } — main image.
 *   additionalImages            {object[]} Gallery images.
 *   priceInfo.price             {string}   Price as a DECIMAL STRING, no currency symbol (e.g. "12.50").
 *                                          Present when the item has a single price.
 *   priceVariants.variants      {object[]} Present when the item has multiple priced variants:
 *                                          [{ variantId, priceInfo: { price } }]. Resolve variantId →
 *                                          name via listVariants (getFullMenu does this for you).
 *   labels                      {object[]} [{ id }] — resolve id → { name, icon } via listLabels.
 *   visible                     {boolean}  Whether shown to site visitors.
 *   featured                    {boolean}  Marked as featured / best-seller.
 *   orderSettings.inStock       {boolean}  Whether the item can be ordered. Default true.
 *   orderSettings.acceptSpecialRequests {boolean} Whether a free-text special request is allowed.
 *   modifierGroups              {object[]} [{ id }] — resolve via listModifierGroups.
 *   businessLocationIds         {string[]} Locations where the item is available.
 *
 *   NOTE: Restaurants prices are plain decimal strings WITHOUT a currency symbol. The site's
 *   currency is configured in the Wix dashboard — format prices in the UI accordingly.
 */

/**
 * PriceVariant (from listVariants): { id, name }. The price lives on the item's
 * priceVariants.variants[].priceInfo.price; the name lives here. getFullMenu merges them.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-variants/variant-object.md
 *
 * ModifierGroup (from listModifierGroups): a choice group attached to an item (e.g. "Choose a side").
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifier-groups/modifier-group-object.md
 *   id                       {string}   Modifier group GUID.
 *   name                     {string}   Display name.
 *   modifiers                {object[]} [{ id, preSelected, additionalChargeInfo: { additionalCharge } }]
 *                                       Resolve id → name via listModifiers. additionalCharge is a
 *                                       decimal string ("0" means free).
 *   rule.required            {boolean}  Whether a selection is MANDATORY.
 *   rule.minSelections       {number}   Minimum selections the visitor must make.
 *   rule.maxSelections       {number}   Maximum selections allowed.
 *
 * Modifier (from listModifiers): { id, name, inStock }.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifiers/modifier-object.md
 *
 * Label (from listLabels): { id, name, icon: { url, ... } } — e.g. "Vegan", "Spicy".
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-labels/label-object.md
 */

/**
 * Operation — defines an online-ordering context (fulfillment + scheduling). Every cart line
 * item must reference an `operationId`. Pick the default / first enabled one for a simple flow.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/operation-object.md
 *
 *   id                   {string}  Operation GUID — goes into catalogReference.options.operationId.
 *   name                 {string}  Display name.
 *   default              {boolean} Whether this is the default operation.
 *   onlineOrderingStatus {string}  "ENABLED" | "DISABLED" | "PAUSED_UNTIL" | UNDEFINED.
 *   defaultFulfillmentType {string} "PICKUP" | "DELIVERY".
 *   fulfillmentIds       {string[]} Fulfillment method GUIDs associated with the operation.
 *   businessLocationId   {string}  Business location of this operation.
 */

/**
 * Cart (Wix eCom) — restaurant orders use the SAME visitor cart as the storefront.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/cart/cart-object.md
 *
 *   id                                {string}  Cart GUID.
 *   currency                          {string}  ISO-4217 currency code.
 *   lineItems[].id                    {string}  Line item GUID (lineItemId) — for update/remove.
 *   lineItems[].quantity              {number}
 *   lineItems[].catalogReference.catalogItemId {string} The ordered item's GUID.
 *   lineItems[].productName.original  {string}  Display name.
 *   lineItems[].price.formattedAmount {string}  Line price with currency symbol.
 *   lineItems[].availability.status   {string}  "AVAILABLE" | "NOT_AVAILABLE" | "PARTIALLY_AVAILABLE" | "NOT_FOUND"
 */

/**
 * ReservationLocation — a restaurant location that accepts table reservations.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/reservation-location-object.md
 *
 *   id            {string}  Reservation location GUID — pass to getTimeSlots / createHeldReservation.
 *   location      {object}  Physical location details ({ id, ... }); name/address come from the
 *                           Business Info / Locations API. See the reference for the full shape.
 *   configuration {object}  Online-reservation settings: onlineReservations.approval.mode
 *                           ("AUTOMATIC" | "MANUAL" | "MANUAL_FOR_LARGE_PARTIES"),
 *                           partySize.min/max, timeSlotInterval, businessSchedule, reservationForm
 *                           (lastNameRequired, emailRequired, customFieldDefinitions), etc.
 *   default       {boolean} Whether this is the business's default location.
 *   archived      {boolean} Whether the location is archived.
 *
 * TimeSlot (from getTimeSlots): { startDate, duration, status, manualApproval }.
 *   status is "AVAILABLE" | "UNAVAILABLE" | "NON_WORKING_HOURS". Offer only AVAILABLE slots.
 *
 * Reservation (from createHeldReservation / reserveReservation):
 *   id, revision, status ("HELD" → "RESERVED" or "REQUESTED" after reserve), details
 *   ({ reservationLocationId, startDate, endDate, partySize }), reservee, paymentStatus.
 *   Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/reservation-object.md
 */

/* ============================ MENU (read-only) ============================ */

/**
 * Internal: GET a list endpoint filtered by a set of GUIDs, chunking the ids so the
 * query string never gets too long (each List endpoint accepts up to 500 ids per call).
 */
async function fetchAllByIds(path, idParamName, responseKey, ids, extraQuery = {}) {
  const unique = [...new Set((ids ?? []).filter(Boolean))];
  if (!unique.length) return [];
  const out = [];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await wixApiRequest(path, {
      method: "GET",
      query: { [idParamName]: chunk, ...extraQuery },
    });
    out.push(...(res?.[responseKey] ?? []));
  }
  return out;
}

/**
 * List menus (one page). Pass `onlyVisible: true` for visitor-facing menus.
 * GET https://www.wixapis.com/restaurants/menus/v1/menus
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/menus/list-menus.md
 * @param {{ onlyVisible?: boolean, limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ menus: object[], nextCursor: string|null }>}
 */
export async function listMenus({ onlyVisible = true, limit = 500, cursor } = {}) {
  const res = await wixApiRequest("/restaurants/menus/v1/menus", {
    method: "GET",
    query: {
      onlyVisible: onlyVisible ? "true" : undefined,
      "paging.limit": String(limit),
      "paging.cursor": cursor,
    },
  });
  return { menus: res?.menus ?? [], nextCursor: res?.pagingMetadata?.cursors?.next ?? null };
}

/**
 * List sections by their GUIDs.
 * GET https://www.wixapis.com/restaurants/menus/v1/sections
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/sections/list-sections.md
 * @param {string[]} sectionIds
 * @param {{ onlyVisible?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
export async function listSections(sectionIds, { onlyVisible = true } = {}) {
  return fetchAllByIds("/restaurants/menus/v1/sections", "sectionIds", "sections", sectionIds, {
    onlyVisible: onlyVisible ? "true" : undefined,
  });
}

/**
 * List items by their GUIDs.
 * GET https://www.wixapis.com/restaurants/menus/v1/items
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/items/list-items.md
 * @param {string[]} itemIds
 * @param {{ onlyVisible?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
export async function listItems(itemIds, { onlyVisible = true } = {}) {
  return fetchAllByIds("/restaurants/menus/v1/items", "itemIds", "items", itemIds, {
    onlyVisible: onlyVisible ? "true" : undefined,
  });
}

/**
 * List price variants by their GUIDs (resolves variantId → name).
 * GET https://www.wixapis.com/restaurants/menus/v1/variants
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-variants/list-variants.md
 * @param {string[]} variantIds
 * @returns {Promise<object[]>}
 */
export async function listVariants(variantIds) {
  return fetchAllByIds("/restaurants/menus/v1/variants", "variantIds", "variants", variantIds);
}

/**
 * List modifier groups by their GUIDs.
 * GET https://www.wixapis.com/restaurants/menus/v1/modifier-groups
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifier-groups/list-modifier-groups.md
 * @param {string[]} modifierGroupIds
 * @returns {Promise<object[]>}
 */
export async function listModifierGroups(modifierGroupIds) {
  return fetchAllByIds(
    "/restaurants/menus/v1/modifier-groups",
    "modifierGroupIds",
    "modifierGroups",
    modifierGroupIds,
  );
}

/**
 * List modifiers by their GUIDs (resolves modifierId → name + inStock).
 * GET https://www.wixapis.com/restaurants/item-modifiers/v1/modifiers
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-modifiers/list-modifiers.md
 * @param {string[]} modifierIds
 * @returns {Promise<object[]>}
 */
export async function listModifiers(modifierIds) {
  return fetchAllByIds("/restaurants/item-modifiers/v1/modifiers", "modifierIds", "modifiers", modifierIds);
}

/**
 * List every item label on the site (the API returns all labels; filter client-side by id).
 * GET https://www.wixapis.com/restaurants/menus/v1/labels
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/items/item-labels/list-labels.md
 * @returns {Promise<object[]>}
 */
export async function listLabels() {
  const res = await wixApiRequest("/restaurants/menus/v1/labels", { method: "GET" });
  return res?.labels ?? [];
}

/**
 * Retrieve the COMPLETE, assembled menu tree in a single call. Walks menus → sections →
 * items, then enriches each item with resolved price variants, modifier groups + modifiers,
 * and labels. This is the recommended entry point for the menu screen.
 *
 * Returns:
 *   { menus: [ { ...menu, sections: [ { ...section, items: [ assembledItem ] } ] } ] }
 * where assembledItem adds:
 *   price          {string|null}  Single price (null when the item is variant-priced).
 *   variants       {object[]}      [{ variantId, name, price }]
 *   modifierGroups {object[]}      [{ id, name, rule, modifiers: [{ id, name, preSelected, additionalCharge, inStock }] }]
 *   labels         {object[]}      [{ id, name, icon }]
 *
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/menus/retrieve-a-complete-menu-structure.md
 * @param {{ onlyVisible?: boolean }} [options]
 * @returns {Promise<{ menus: object[] }>}
 */
export async function getFullMenu({ onlyVisible = true } = {}) {
  const { menus } = await listMenus({ onlyVisible });
  if (!menus.length) return { menus: [] };

  const sectionIds = menus.flatMap((m) => m.sectionIds ?? []);
  const sections = await listSections(sectionIds, { onlyVisible });

  const itemIds = sections.flatMap((s) => s.itemIds ?? []);
  const items = await listItems(itemIds, { onlyVisible });

  const variantIds = items.flatMap((i) => (i.priceVariants?.variants ?? []).map((v) => v.variantId));
  const modifierGroupIds = items.flatMap((i) => (i.modifierGroups ?? []).map((g) => g.id));

  // Leaf lookups that don't depend on each other run together.
  const [variants, modifierGroups, labels] = await Promise.all([
    listVariants(variantIds),
    listModifierGroups(modifierGroupIds),
    listLabels(),
  ]);

  const modifierIds = modifierGroups.flatMap((g) => (g.modifiers ?? []).map((m) => m.id));
  const modifiers = await listModifiers(modifierIds);

  const variantMap = new Map(variants.map((v) => [v.id, v]));
  const groupMap = new Map(modifierGroups.map((g) => [g.id, g]));
  const modifierMap = new Map(modifiers.map((m) => [m.id, m]));
  const labelMap = new Map(labels.map((l) => [l.id, l]));

  const assembleItem = (item) => ({
    ...item,
    price: item.priceInfo?.price ?? null,
    variants: (item.priceVariants?.variants ?? []).map((v) => ({
      variantId: v.variantId,
      name: variantMap.get(v.variantId)?.name ?? null,
      price: v.priceInfo?.price ?? null,
    })),
    modifierGroups: (item.modifierGroups ?? [])
      .map((ref) => groupMap.get(ref.id))
      .filter(Boolean)
      .map((group) => ({
        id: group.id,
        name: group.name,
        rule: group.rule ?? null,
        modifiers: (group.modifiers ?? []).map((m) => ({
          id: m.id,
          name: modifierMap.get(m.id)?.name ?? null,
          preSelected: m.preSelected ?? false,
          additionalCharge: m.additionalChargeInfo?.additionalCharge ?? "0",
          inStock: modifierMap.get(m.id)?.inStock ?? true,
        })),
      })),
    labels: (item.labels ?? []).map((ref) => labelMap.get(ref.id)).filter(Boolean),
  });

  const itemMap = new Map(items.map((i) => [i.id, assembleItem(i)]));
  const sectionMap = new Map(
    sections.map((s) => [
      s.id,
      { ...s, items: (s.itemIds ?? []).map((id) => itemMap.get(id)).filter(Boolean) },
    ]),
  );

  return {
    menus: menus.map((m) => ({
      ...m,
      sections: (m.sectionIds ?? []).map((id) => sectionMap.get(id)).filter(Boolean),
    })),
  };
}

/* ===================== ONLINE ORDERING (cart + checkout) ================== */

/**
 * List the restaurant's online-ordering operations.
 * GET https://www.wixapis.com/restaurants-operations/v1/operations
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/operations/list-operations.md
 * @returns {Promise<object[]>}
 */
export async function listOperations() {
  const res = await wixApiRequest("/restaurants-operations/v1/operations", { method: "GET" });
  return res?.operations ?? [];
}

/**
 * Convenience: pick the operation to order through — the default, else the first ENABLED,
 * else the first that exists. Returns null when no operation is configured (show an
 * "ordering unavailable" state rather than inventing one).
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
 * A restaurant line item REQUIRES `operationId` (from listOperations / getDefaultOperation),
 * plus the `menuId` and `sectionId` the item is being ordered from. These travel in
 * `catalogReference.options`. Throws if any is missing, or if the added line is not AVAILABLE,
 * so a visitor can never reach checkout with an un-orderable line.
 *
 * Selecting a specific price variant or applying modifier up-charges on the cart line is NOT
 * covered here — the restaurants catalogReference.options shape for those is not documented
 * for client add-to-cart. Display variants/modifiers in the UI, and look up the exact shape
 * in the reference before extending:
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/online-orders/sample-flows.md
 *
 * POST https://www.wixapis.com/ecom/v1/carts/current/add-to-cart
 * @param {string} itemId  Menu item GUID (`item.id`).
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
 * Update the quantity of a cart line. `lineItemId` is `cart.lineItems[].id`, not the item id.
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
 * Remove a line from the current cart by its `cart.lineItems[].id`.
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
 * Throws on empty cart, unavailable lines, or a missing redirect URL. Redirect with
 * `window.location.href = await checkout()`.
 * https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/checkout/checkout-object.md
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

/* ============================== RESERVATIONS ============================== */

/**
 * List the site's reservation locations (up to 100).
 * GET https://www.wixapis.com/table-reservations/reservation-locations/v1/reservation-locations
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/list-reservation-locations.md
 * @returns {Promise<object[]>}
 */
export async function listReservationLocations() {
  const res = await wixApiRequest(
    "/table-reservations/reservation-locations/v1/reservation-locations",
    { method: "GET" },
  );
  return res?.reservationLocations ?? [];
}

/**
 * Get reservation time slots for a location on a date, with availability for a party size.
 * Use `slotsBefore` / `slotsAfter` to fan out around `date`. Offer only slots whose
 * `status === "AVAILABLE"` (filter applied here).
 * POST https://www.wixapis.com/table-reservations/reservations/v1/time-slots
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/time-slots/get-time-slots.md
 * @param {string} reservationLocationId
 * @param {string} date       ISO-8601 datetime (e.g. "2026-07-01T19:00:00.000Z").
 * @param {number} partySize
 * @param {{ slotsBefore?: number, slotsAfter?: number, duration?: number }} [options]
 * @returns {Promise<{ timeSlots: object[], availableTimeSlots: object[] }>}
 */
export async function getTimeSlots(reservationLocationId, date, partySize, { slotsBefore = 4, slotsAfter = 4, duration } = {}) {
  if (!reservationLocationId || !date || !partySize) {
    throw new Error("getTimeSlots: reservationLocationId, date and partySize are required.");
  }
  const res = await wixApiRequest("/table-reservations/reservations/v1/time-slots", {
    method: "POST",
    body: { reservationLocationId, date, partySize, slotsBefore, slotsAfter, ...(duration ? { duration } : {}) },
  });
  const timeSlots = res?.timeSlots ?? [];
  return { timeSlots, availableTimeSlots: timeSlots.filter((s) => s.status === "AVAILABLE") };
}

/**
 * Hold a reservation for 10 minutes while the visitor fills in their details. Returns a
 * reservation with status "HELD" — keep its `id` and `revision` for reserveReservation.
 * POST https://www.wixapis.com/table-reservations/reservations/v1/reservations/hold
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/create-held-reservation.md
 * @param {string} reservationLocationId
 * @param {string} startDate  ISO-8601 datetime of the chosen time slot.
 * @param {number} partySize
 * @returns {Promise<object>} The held reservation ({ id, revision, status: "HELD", ... }).
 */
export async function createHeldReservation(reservationLocationId, startDate, partySize) {
  if (!reservationLocationId || !startDate || !partySize) {
    throw new Error("createHeldReservation: reservationLocationId, startDate and partySize are required.");
  }
  const res = await wixApiRequest("/table-reservations/reservations/v1/reservations/hold", {
    method: "POST",
    body: { reservationDetails: { reservationLocationId, startDate, partySize } },
  });
  const reservation = res?.reservation;
  if (!reservation?.id) throw new Error("Failed to hold the reservation (the slot may no longer be available).");
  return reservation;
}

/**
 * Confirm a held reservation with the visitor's details. Moves status from "HELD" to
 * "RESERVED" (auto-approval) or "REQUESTED" (location requires manual approval).
 * `reservee.firstName` and `reservee.phone` (E.164, e.g. "+15551234567") are REQUIRED.
 * Pass the `revision` returned by createHeldReservation. Holds expire after 10 minutes.
 * POST https://www.wixapis.com/table-reservations/reservations/v1/reservations/{reservationId}/reserve
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/reserve-reservation.md
 * @param {string} reservationId
 * @param {string} revision
 * @param {{ firstName: string, phone: string, lastName?: string, email?: string, marketingConsent?: boolean }} reservee
 * @returns {Promise<object>} The updated reservation ({ id, status, revision, ... }).
 */
export async function reserveReservation(reservationId, revision, reservee) {
  if (!reservationId || !revision) throw new Error("reserveReservation: reservationId and revision are required.");
  if (!reservee?.firstName || !reservee?.phone) {
    throw new Error("reserveReservation: reservee.firstName and reservee.phone are required.");
  }
  const res = await wixApiRequest(
    `/table-reservations/reservations/v1/reservations/${encodeURIComponent(reservationId)}/reserve`,
    { method: "POST", body: { revision, reservee } },
  );
  const reservation = res?.reservation;
  if (!reservation?.id) throw new Error("Failed to confirm the reservation (the hold may have expired — start over).");
  return reservation;
}
