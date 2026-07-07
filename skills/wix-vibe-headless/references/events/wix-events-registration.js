import { wixApiRequest } from "./wix-client.js";

// Data model reference: see INSTRUCTIONS.md
// Event shape (for getEventBySlug): see wix-events-browse.js

/**
 * Wix Events Ticket Definition — a ticket type returned by the checkout/available-tickets endpoint.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/list-available-tickets
 *
 *   id {string}, eventId {string}, name {string}, description {string},
 *   free {boolean} — true when the ticket is free,
 *   price { amount, currency } — the display price (use pricing.* for full detail),
 *   pricing ONE-OF:
 *     fixedPrice { amount, currency } — same price for everyone,
 *     minPrice { amount, currency } — minimum for "pay what you want" (donation); pass chosen amount as ticketInfo.guestPrice,
 *     pricingOptions.options [{ id, name, price { amount, currency } }] — tiered; pass chosen option id as ticketInfo.pricingOptionId,
 *   pricingType {string} — "STANDARD" | "DONATION" | "OPTIONS",
 *   saleStatus {string} — "SALE_STARTED" is the only buyable state,
 *   limitPerCheckout {number},
 *   orderIndex {number} — display order
 *
 * RSVP: { id, eventId, status ("YES"|"NO"|"WAITLIST"), totalGuests, firstName, lastName, email }
 *   status "WAITLIST" when the event is full and waitlist is enabled.
 * Order: { orderNumber, status, totalPrice, ticketsPdf, tickets[] }
 *   status "FREE" → confirmed. status "INITIATED" → redirect to getTicketCheckoutUrl.
 */

/**
 * Submit an RSVP for an RSVP-type event (registration.type === "RSVP"). Completes client-side.
 *
 * Pass status "NO" only when event.registration.rsvp.responseType is "YES_AND_NO".
 * If the event is full with a waitlist enabled, the RSVP comes back with status "WAITLIST".
 * Throws on closed registration, guest-limit exceeded, duplicate email, or invalid form.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/create-rsvp.md
 *
 * @param {string} eventId
 * @param {{ firstName: string, lastName: string, email: string, status?: "YES"|"NO",
 *           additionalGuestNames?: string[], extraFields?: Record<string,string|string[]> }} guest
 * @returns {Promise<object>} The created RSVP.
 */
export async function createRsvp(eventId, { firstName, lastName, email, status = "YES", additionalGuestNames = [], extraFields = {} } = {}) {
  if (!firstName || !lastName || !email) throw new Error("createRsvp requires firstName, lastName, and email.");

  // The built-in fields go TOP-LEVEL on rsvp — the API rejects them inside form.inputValues
  // (400 "rsvp.firstName must not be empty"). form.inputValues is ONLY for the event's extra
  // custom fields; sending a built-in-only form, or additionalGuestDetails when the event has no
  // guest fields, throws INVALID_FORM_RESPONSE ("input additionalGuests/guestNames is unexpected").
  const rsvp = { eventId, firstName, lastName, email, status };

  const inputValues = [];
  for (const [inputName, value] of Object.entries(extraFields)) {
    inputValues.push(Array.isArray(value) ? { inputName, values: value } : { inputName, value });
  }
  if (inputValues.length) rsvp.form = { inputValues };
  if (additionalGuestNames.length) {
    rsvp.additionalGuestDetails = { guestCount: additionalGuestNames.length, guestNames: additionalGuestNames };
  }

  const res = await wixApiRequest("/events/v2/rsvps", { method: "POST", body: { rsvp } });
  return res?.rsvp;
}

/**
 * Query the buyable ticket definitions for a ticketed event (with availability).
 *
 * Uses GET /events/v1/checkout/available-tickets (WIX_EVENTS.READ_CHECKOUT) — the visitor-facing
 * checkout endpoint. The V3 /ticket-definitions/query endpoint requires WIX_EVENTS.READ_TICKET_DEFINITIONS
 * (scope SCOPE.DC-EVENTS.MANAGE-TICKET-DEF), an admin-only scope that anonymous visitor tokens do
 * not carry, so it 403s in a headless SPA context.
 *
 * This endpoint already filters to non-hidden, SALE_STARTED tickets, so the result is ready to
 * render directly. Pass includeSoldOut: false to additionally drop sold-out tiers.
 *
 * https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/list-available-tickets
 * @param {string} eventId
 * @param {{ includeSoldOut?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
export async function queryTicketDefinitions(eventId, { includeSoldOut = true } = {}) {
  const res = await wixApiRequest("/events/v1/checkout/available-tickets", {
    method: "GET",
    query: { eventId, limit: "100" },
  });
  let defs = res?.definitions ?? [];
  if (!includeSoldOut) defs = defs.filter((d) => !d.salesDetails?.soldOut);
  return defs;
}

/**
 * Reserve tickets for a limited time (typically 5–30 min) while the buyer completes checkout.
 * Returns a reservation with status "PENDING" and an expirationDate.
 * Throws if the reservation doesn't come back PENDING (e.g. tickets unavailable).
 * https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/ticket-reservations/create-ticket-reservation.md
 *
 * @param {Array<{ ticketDefinitionId: string, quantity: number, guestPrice?: string, pricingOptionId?: string }>} tickets
 * @returns {Promise<object>} The created reservation (id, expirationDate, tickets[], status).
 */
export async function reserveTickets(tickets) {
  if (!Array.isArray(tickets) || !tickets.length) throw new Error("reserveTickets requires at least one ticket line.");

  const lines = tickets.map(({ ticketDefinitionId, quantity, guestPrice, pricingOptionId }) => {
    if (!ticketDefinitionId || !quantity) throw new Error("Each ticket line needs a ticketDefinitionId and quantity.");
    const ticketInfo = {};
    if (guestPrice !== undefined) ticketInfo.guestPrice = String(guestPrice);
    if (pricingOptionId) ticketInfo.pricingOptionId = pricingOptionId;
    const line = { ticketDefinitionId, quantity };
    if (Object.keys(ticketInfo).length) line.ticketInfo = ticketInfo;
    return line;
  });

  const res = await wixApiRequest("/events/v1/ticket-reservations", {
    method: "POST",
    body: { ticketReservation: { tickets: lines } },
  });
  const reservation = res?.ticketReservation;
  if (!reservation?.id || reservation.status !== "PENDING") {
    throw new Error(`Could not reserve tickets (status: ${reservation?.status ?? "unknown"}). They may be sold out.`);
  }
  return reservation;
}

/**
 * Build the URL of the Wix-hosted ticket form for a reservation. Use this for ALL paid tickets
 * (and free tickets too). The buyer fills in guest details and pays on Wix's page, then returns.
 * Redirect with: window.location.href = getTicketCheckoutUrl(event, reservation.id)
 *
 * event must have been fetched with the URLS fieldset (getEventBySlug already does this).
 * https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/checkout.md
 *
 * @param {object} event          Event from getEventBySlug (needs eventPageUrl).
 * @param {string} reservationId  From reserveTickets.
 * @returns {string} Absolute hosted ticket-form URL.
 */
export function getTicketCheckoutUrl(event, reservationId) {
  const base = event?.eventPageUrl?.base;
  const path = event?.eventPageUrl?.path;
  if (!base || !path) throw new Error("Event is missing eventPageUrl — fetch it with getEventBySlug (URLS fieldset).");
  if (!reservationId) throw new Error("getTicketCheckoutUrl requires a reservationId from reserveTickets.");
  return `${base}${path}/ticket-form?reservationId=${encodeURIComponent(reservationId)}`;
}

/**
 * Check out a reservation via REST — creates the order and assigns guests.
 * Use this ONLY for FREE ticket orders (no redirect needed): the returned order has
 * status "FREE", a ticketsPdf, and generated tickets[].
 *
 * For PAID tickets, this throws and tells you to redirect to getTicketCheckoutUrl instead.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/checkout.md
 *
 * @param {string} eventId
 * @param {{ reservationId: string,
 *           buyer?: { firstName: string, lastName: string, email: string },
 *           guests: Array<{ firstName: string, lastName: string, email: string, extraFields?: Record<string,string|string[]> }> }} details
 * @returns {Promise<object>} The created order (orderNumber, status, ticketsPdf, tickets[]).
 */
export async function checkoutTickets(eventId, { reservationId, buyer, guests } = {}) {
  if (!eventId || !reservationId) throw new Error("checkoutTickets requires eventId and reservationId.");
  if (!Array.isArray(guests) || !guests.length) throw new Error("checkoutTickets requires at least one guest.");

  const toForm = ({ firstName, lastName, email, extraFields = {} }) => {
    const inputValues = [
      { inputName: "firstName", value: firstName },
      { inputName: "lastName", value: lastName },
      { inputName: "email", value: email },
    ];
    for (const [inputName, value] of Object.entries(extraFields)) {
      inputValues.push(Array.isArray(value) ? { inputName, values: value } : { inputName, value });
    }
    return { form: { inputValues } };
  };

  const body = { reservationId, guests: guests.map(toForm) };
  if (buyer) body.buyer = buyer;

  const res = await wixApiRequest(`/events/v1/events/${encodeURIComponent(eventId)}/tickets/checkout`, {
    method: "POST",
    body,
  });
  const order = res?.order;
  const status = order?.status;
  if (status === "INITIATED" || status === "PENDING") {
    throw new Error(
      `Order ${order?.orderNumber ?? ""} needs payment (status: ${status}). Redirect the buyer to getTicketCheckoutUrl(event, reservationId) to pay on the hosted ticket form.`,
    );
  }
  return order;
}
