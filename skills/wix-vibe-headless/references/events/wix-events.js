import { wixApiRequest } from "./wix-client.js";

/**
 * Wix Events V3 — key fields for building a visitor-facing events site.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/event-object.md
 *
 * Most fields below are only returned when you request the matching `fields`/fieldset
 * (the helpers here already request DETAILS, REGISTRATION, URLS, and — for the detail
 * page — TEXTS and FORM). Query events: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events.md
 *
 *   id                              {string}   Event GUID.
 *   title                           {string}   Event title.
 *   slug                            {string}   URL slug for detail-page routing (kebab-case).
 *   status                          {string}   "UPCOMING" | "STARTED" | "ENDED" | "CANCELED" | "DRAFT".
 *                                              Only UPCOMING/STARTED are live for visitors.
 *   shortDescription                {string}   Teaser under the title (DETAILS fieldset).
 *   description                     {object}   Rich-content body (TEXTS fieldset). Ricos node tree — render
 *                                              its text nodes, or show shortDescription if you don't render Ricos.
 *   mainImage                       {object}   Hero image (DETAILS fieldset): { id, url, width, height, altText }.
 *   dateAndTimeSettings             {object}   Schedule (always returned):
 *     dateAndTimeTbd                {boolean}    When true, startDate/endDate are absent — show dateAndTimeTbdMessage.
 *     startDate, endDate            {string}     ISO-8601 datetimes.
 *     timeZoneId                    {string}     IANA tz, e.g. "America/New_York".
 *     formatted.dateAndTime         {string}     Ready-to-render human string (e.g. "June 15, 2024, 9:00 – 11:00 AM PDT").
 *     formatted.startDate/startTime/endDate/endTime {string} Individual formatted parts.
 *   location                        {object}   Where (always returned):
 *     type                          {string}     "VENUE" | "ONLINE".
 *     name                          {string}     Venue/location name (also shown when locationTbd is true).
 *     address                       {object}     { city, country, subdivision, postalCode, addressLine, streetAddress }.
 *     locationTbd                   {boolean}    When true, show `name` instead of an address.
 *   registration                    {object}   Registration config (REGISTRATION fieldset). Drives the whole flow:
 *     type                          {string}     "RSVP" | "TICKETING" | "EXTERNAL" | "NONE".
 *     status                        {string}     "OPEN_RSVP" | "OPEN_RSVP_WAITLIST_ONLY" | "OPEN_TICKETS" |
 *                                                "OPEN_EXTERNAL" | "CLOSED_MANUALLY" | "CLOSED_AUTOMATICALLY" |
 *                                                "SCHEDULED_RSVP". Only OPEN_* states accept new registrations.
 *     rsvp                          {object}     RSVP config: { responseType, limit, waitlistEnabled, startDate, endDate }.
 *                                                responseType "YES_AND_NO" allows a "NO" reply; otherwise YES-only.
 *     tickets                       {object}     Ticketing config: { currency, lowestPrice:{value,currency},
 *                                                highestPrice, soldOut, ticketLimitPerOrder, guestsAssignedSeparately }.
 *                                                guestsAssignedSeparately === true → collect a form per ticket at checkout.
 *     external.url                  {string}     External registration URL (type === "EXTERNAL" — link out, don't build a form).
 *   eventPageUrl                    {object}   Live page URL parts (URLS fieldset): { base, path }.
 *                                              Needed to build the hosted ticket-checkout redirect — see getTicketCheckoutUrl.
 *   form                            {object}   Registration form (FORM fieldset). `form.controls[]` is the ordered field list:
 *                                              [{ id, type, system, inputs:[{ name, label, ... }] }].
 *                                              `system` controls are mandatory (name, email). Use control inputs' `name`
 *                                              as the `inputName` when submitting createRsvp / checkoutTickets form values.
 *   calendarUrls                    {object}   { google, ics } add-to-calendar links (DETAILS fieldset).
 */

/**
 * Wix Events Ticket Definition (V3) — a ticket type for a ticketed event.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/ticket-definition-object.md
 *
 *   id                              {string}   Ticket definition GUID — pass to reserveTickets.
 *   eventId                         {string}   Event this ticket belongs to.
 *   name                            {string}   Display name (e.g. "General Admission", "VIP").
 *   description                     {string}   Short description.
 *   hidden                          {boolean}  When true the ticket is not sellable to visitors — exclude it.
 *   pricingMethod                   {object}   ONE-OF:
 *     fixedPrice                    {object}     { value, currency } — same price for everyone.
 *     guestPrice                    {object}     { value, currency } — "pay what you want" / donation; value is the minimum.
 *                                                Pass the buyer's chosen amount as ticketInfo.guestPrice to reserveTickets.
 *     pricingOptions.optionDetails  {array}      Tiered prices [{ optionId, name, price:{value,currency} }].
 *                                                Pass the chosen optionId as ticketInfo.pricingOptionId to reserveTickets.
 *     pricingType                   {string}     "STANDARD" | "DONATION".
 *     free                          {boolean}    Whether the ticket is free.
 *   salePeriod                      {object}   { startDate, endDate, displayNotOnSale }.
 *   saleStatus                      {string}   "SALE_SCHEDULED" | "SALE_STARTED" | "SALE_ENDED".
 *                                              Only SALE_STARTED is buyable now.
 *   salesDetails                    {object}   Availability (SALES_DETAILS fieldset, requested by queryTicketDefinitions):
 *                                              { unsoldCount, soldCount, reservedCount, soldOut }.
 *                                              unsoldCount is null for unlimited tickets.
 *   limitPerCheckout                {number}   Max quantity buyable per checkout.
 */

/**
 * Wix Events RSVP / Order — what the registration calls return.
 *   RSVP   full model: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/rsvp-object.md
 *   Order  full model: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/order-object.md
 *
 *   RSVP:   { id, eventId, status ("YES"|"NO"|"WAITLIST"), totalGuests, firstName, lastName, email }.
 *           status comes back "WAITLIST" when the event is full and a waitlist is enabled.
 *   Order:  { orderNumber, status, totalPrice:{value,currency}, ticketsQuantity, ticketsPdf, tickets[] }.
 *           status "FREE" → confirmed, no payment needed (free tickets).
 *           status "INITIATED" → payment still required at the Wix cashier — redirect to the hosted
 *           ticket form (getTicketCheckoutUrl) instead of trying to settle payment client-side.
 */

const EVENTS_API = "https://www.wixapis.com";

/** Fieldsets for list views (grid cards) and the single-event detail view. */
const LIST_FIELDS = ["DETAILS", "REGISTRATION", "URLS"];
const DETAIL_FIELDS = ["DETAILS", "TEXTS", "REGISTRATION", "URLS", "FORM"];

/**
 * Query live (UPCOMING/STARTED) events for a listing grid, one page.
 * Sorted by start date ascending (soonest first). Uses offset paging, so the response
 * carries `total` — use it for the empty state and "load more" math.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/query-events.md
 *
 * @param {{ limit?: number, offset?: number, status?: string[] }} [options]
 * @returns {Promise<{ events: object[], total: number, offset: number, nextOffset: number|null }>}
 */
export async function queryEvents({ limit = 50, offset = 0, status = ["UPCOMING", "STARTED"] } = {}) {
  const res = await wixApiRequest("/events/v3/events/query", {
    method: "POST",
    body: {
      query: {
        filter: { status: { $in: status } },
        sort: [{ fieldName: "dateAndTimeSettings.startDate", order: "ASC" }],
        paging: { limit, offset }, // limit MUST be > 0 — the API returns 0 results for limit 0
      },
      fields: LIST_FIELDS,
    },
  });
  const events = res?.events ?? [];
  const total = res?.pagingMetadata?.total ?? events.length;
  const nextOffset = offset + events.length < total ? offset + events.length : null;
  return { events, total, offset, nextOffset };
}

/**
 * Fetch a single event by its URL slug, with everything the detail page needs
 * (description, registration, page URL, and the registration form). Returns null if not found.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/get-event-by-slug.md
 *
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getEventBySlug(slug) {
  try {
    const res = await wixApiRequest(`/events/v3/events/slug/${encodeURIComponent(slug)}`, {
      method: "GET",
      query: { fields: DETAIL_FIELDS },
    });
    return res?.event ?? null;
  } catch {
    return null; // 404 / not-found → show a not-found state, never invent an event
  }
}

/**
 * Total number of live events. Used for empty-state logic (0 → prompt the user to
 * publish events in their Wix dashboard). Reads the query's pagingMetadata.total.
 * @param {string[]} [status]
 * @returns {Promise<number>}
 */
export async function countUpcomingEvents(status = ["UPCOMING", "STARTED"]) {
  const res = await wixApiRequest("/events/v3/events/query", {
    method: "POST",
    body: { query: { filter: { status: { $in: status } }, paging: { limit: 1, offset: 0 } } },
  });
  return res?.pagingMetadata?.total ?? 0;
}

/**
 * Query event categories for a category menu/filter. `counts.assignedEventsCount`
 * (COUNTS fieldset) tells you how many events are in each category.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/categories/query-categories.md
 *
 * @param {{ limit?: number, offset?: number }} [options]
 * @returns {Promise<{ categories: object[], total: number }>}
 */
export async function queryEventCategories({ limit = 100, offset = 0 } = {}) {
  const res = await wixApiRequest("/events/v1/categories/query", {
    method: "POST",
    body: { query: { paging: { limit, offset } }, fieldset: ["COUNTS"] },
  });
  return {
    categories: res?.categories ?? [],
    total: res?.metaData?.total ?? (res?.categories?.length ?? 0),
  };
}

/**
 * List live events assigned to a category, one page. Same card fields as queryEvents.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/events-v3/list-events-by-category.md
 *
 * @param {string} categoryId  Category GUID from queryEventCategories.
 * @param {{ limit?: number, offset?: number }} [options]
 * @returns {Promise<{ events: object[], total: number, offset: number, nextOffset: number|null }>}
 */
export async function listEventsByCategory(categoryId, { limit = 50, offset = 0 } = {}) {
  const res = await wixApiRequest(`/events/v3/events/category/${encodeURIComponent(categoryId)}`, {
    method: "GET",
    query: {
      fields: LIST_FIELDS,
      "paging.limit": String(limit),
      "paging.offset": String(offset),
    },
  });
  const events = res?.events ?? [];
  const total = res?.pagingMetadata?.total ?? events.length;
  const nextOffset = offset + events.length < total ? offset + events.length : null;
  return { events, total, offset, nextOffset };
}

/**
 * Submit an RSVP for an RSVP-type event (registration.type === "RSVP").
 * Completes fully client-side — no payment, no redirect.
 *
 * `status` defaults to "YES". Only pass "NO" when the event's
 * `registration.rsvp.responseType` is "YES_AND_NO". If the event is full and a waitlist
 * is enabled, Wix returns the created RSVP with status "WAITLIST" — surface that to the guest.
 *
 * For extra guests on one RSVP, pass `additionalGuestNames` (one name per extra guest).
 * Any custom form fields the event defines (see `event.form.controls`) go in `extraFields`,
 * keyed by the control input's `name`.
 *
 * Throws on closed/started-not-yet registration, guest-limit/RSVP-limit exceeded, an email
 * already registered, or an invalid form — so a green path means the guest is really registered.
 * Error codes: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/create-rsvp.md
 *
 * @param {string} eventId
 * @param {{ firstName: string, lastName: string, email: string, status?: "YES"|"NO",
 *           additionalGuestNames?: string[], extraFields?: Record<string,string|string[]> }} guest
 * @returns {Promise<object>} The created RSVP.
 */
export async function createRsvp(eventId, { firstName, lastName, email, status = "YES", additionalGuestNames = [], extraFields = {} } = {}) {
  if (!firstName || !lastName || !email) throw new Error("createRsvp requires firstName, lastName, and email.");

  const inputValues = [
    { inputName: "firstName", value: firstName },
    { inputName: "lastName", value: lastName },
    { inputName: "email", value: email },
  ];
  if (additionalGuestNames.length) {
    inputValues.push({ inputName: "additionalGuests", value: String(additionalGuestNames.length) });
    inputValues.push({ inputName: "guestNames", values: additionalGuestNames });
  }
  for (const [inputName, value] of Object.entries(extraFields)) {
    inputValues.push(Array.isArray(value) ? { inputName, values: value } : { inputName, value });
  }

  const res = await wixApiRequest("/events/v2/rsvps", {
    method: "POST",
    body: {
      rsvp: {
        eventId,
        firstName,
        lastName,
        email,
        status,
        form: { inputValues },
        additionalGuestDetails: { guestCount: additionalGuestNames.length, guestNames: additionalGuestNames },
      },
    },
  });
  return res?.rsvp;
}

/**
 * Query the buyable ticket definitions for a ticketed event (with availability).
 * Filters out hidden tickets; pass `includeSoldOut: false` to also drop sold-out ones.
 * Request includes the SALES_DETAILS fieldset so `salesDetails.soldOut`/`unsoldCount` are populated.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/query-ticket-definitions.md
 *
 * @param {string} eventId
 * @param {{ includeSoldOut?: boolean }} [options]
 * @returns {Promise<object[]>} Ticket definitions (see the TicketDefinition typedef above).
 */
export async function queryTicketDefinitions(eventId, { includeSoldOut = true } = {}) {
  const res = await wixApiRequest("/events/v3/ticket-definitions/query", {
    method: "POST",
    body: {
      query: { filter: { eventId, hidden: false } },
      fields: ["SALES_DETAILS"],
    },
  });
  let defs = res?.ticketDefinitions ?? [];
  if (!includeSoldOut) defs = defs.filter((d) => !d.salesDetails?.soldOut);
  return defs;
}

/**
 * Reserve tickets for a limited time (the event's reservation window, typically 5–30 min)
 * while the buyer completes checkout. Reserving deducts from inventory so two buyers can't
 * grab the same tickets. The returned reservation has status "PENDING" and an `expirationDate`.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/ticket-reservations/create-ticket-reservation.md
 *
 * Pass one entry per ticket type. For each:
 *   - ticketDefinitionId  (required) and quantity (required).
 *   - guestPrice          for "pay what you want"/donation tickets (pricingMethod.guestPrice) — the chosen amount as a string.
 *   - pricingOptionId     for tiered tickets (pricingMethod.pricingOptions) — the chosen option's optionId.
 *
 * Throws if the reservation doesn't come back PENDING (e.g. tickets unavailable) so the
 * buyer can't proceed to checkout with nothing actually held.
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
 * Build the URL of the Wix-hosted ticket form for a reservation. THIS is the official,
 * complete way to finish a ticketed purchase: the buyer fills in guest details and pays
 * on Wix's PCI-compliant page, then lands back on the event. Use it for all paid tickets
 * (and it works for free tickets too). Redirect with `window.location.href = url`.
 *
 * The path format is documented on the Checkout page:
 * https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/checkout.md
 *   {eventPageUrl.base}{eventPageUrl.path}/ticket-form?reservationId={reservationId}
 *
 * `event` must have been fetched with the URLS fieldset (getEventBySlug already does this),
 * so `event.eventPageUrl.base` and `.path` are present. Throws if they're missing.
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
 * Check out a reservation via REST — creates the order and assigns guests. Use this to
 * complete FREE ticket orders entirely in-app (no payment, no redirect): the response order
 * comes back with status "FREE", a `ticketsPdf`, and generated `tickets[]`.
 *
 * For PAID tickets this returns an order with status "INITIATED" (payment still owed at the
 * Wix cashier) — this helper throws in that case and tells you to redirect to
 * getTicketCheckoutUrl instead, which handles payment. Don't try to settle payment yourself.
 * https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/checkout.md
 *
 * Provide one `guests[]` entry per ticket (each is a { inputValues } form response). When the
 * event has `registration.tickets.guestsAssignedSeparately`, every ticket needs its own guest
 * form; otherwise one guest (the buyer) is enough. `buyer` is the order contact.
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
