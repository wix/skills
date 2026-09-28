// Ticket tiers, the reserve → hosted-checkout redirect, and RSVP over REST — the twin of
// app/wix/events/registration.ts. Same exports, same DTOs; rules and mappers from
// registration-core (the SAME file the SDK transport uses, deployed flat next to this one). The
// request shapes are exact and rewriting them is how registrations break. Failures are loud.
// All calls run with the visitor token — the reservation and the RSVP are the token's.
// Query Available Ticket Definitions: wix.events.ticketdef.v3.TicketDefinitionManagement.QueryAvailableTicketDefinitions
//   (POST /events/v3/ticket-definitions/available/query, as the @wix/events SDK issues it; the V3 family's reference:)
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/create-ticket-definition.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/ticket-reservations/create-ticket-reservation.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/create-rsvp.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { wixRequest } from "./client.js";
import {
  availableTiersQuery,
  checkoutCallbacks,
  redirectResult,
  reservationError,
  reservationId,
  reservationTickets,
  rsvpBody,
  rsvpFormOf,
  rsvpResult,
  toTiers,
  type CheckoutEvent,
  type CheckoutPaths,
  type RsvpValues,
  type TierEvent,
} from "./registration-core.js";
import type { Raw } from "./events-core.js";
import type { EventDetail, RegistrationResult, TicketSelection, TicketTier } from "./types.js";

export { type CheckoutPaths, type RsvpValues, type TierEvent };

/**
 * Ticket tiers for a TICKETING event, in the organizer's order — the VISITOR-public V3 read (hidden
 * tiers excluded server-side), never the ticket-definitions management query (403 for a visitor).
 * Pass the EventDetail: sale dates format in its zone, its tax settings price the notes.
 * POST /events/v3/ticket-definitions/available/query  { query: { filter: { eventId }, sort: [{ fieldName: "sortIndex", order: "ASC" }] } }  → { ticketDefinitions }
 */
export async function fetchTicketTiers(event: TierEvent): Promise<TicketTier[]> {
  const res = await wixRequest<Raw>("/events/v3/ticket-definitions/available/query", { body: { query: availableTiersQuery(event.id) } });
  return toTiers(res?.ticketDefinitions, event);
}

/**
 * RSVP to a free (RSVP-type) event — completes fully client-side: no reservation, no redirect, no
 * payment. `values` answer the ORGANIZER'S form (event.rsvpForm), keyed by input name; the body
 * carries the built-in identity at the top level, the answers as `form.inputValues`, and
 * `additionalGuestDetails` when the form has a guest control. "NO" only when the event's
 * rsvpResponseType is "YES_AND_NO". Throws on closed registration, a guest limit, a missing
 * mandatory answer (INVALID_FORM_RESPONSE), or an invalid email — surface the message. A full
 * event with a waitlist answers "WAITLIST".
 * POST /events/v2/rsvps  { rsvp: { eventId, status, firstName, lastName, email, form: { inputValues: [{ inputName, value | values }] }, additionalGuestDetails?: { guestCount, guestNames } } }  → { rsvp: { id, status } }
 */
export async function submitRsvp(
  event: Pick<EventDetail, "id" | "rsvpForm">,
  values: RsvpValues,
  status: "YES" | "NO" = "YES",
  guests: { guestCount: number; guestNames: string[] } = { guestCount: 0, guestNames: [] },
): Promise<RegistrationResult> {
  const res = await wixRequest<Raw>("/events/v2/rsvps", { body: { rsvp: rsvpBody(event.id, rsvpFormOf(event), values, status, guests) } });
  return rsvpResult(res?.rsvp, status);
}

/**
 * Ticketed checkout, the exact sequence: reserve the selected tiers (a PENDING hold that
 * auto-expires), then mint the Wix-hosted checkout redirect and return its URL — the caller
 * navigates the FULL document to it; Wix collects guest details + payment and emails the tickets.
 * Selections carry the pricing option or the guest's price where the tier needs one (`ticketInfo`);
 * pass `tiers` so a missing guest price is refused before the request. `origin` must be the site's
 * real https origin as registered on the OAuth app's allowed domains (browser:
 * window.location.origin). Never hand-build the checkout URL. `paths` overrides the return routes —
 * a static site passes `{ confirmation: "/event-confirmation.html", event: "/event.html?slug=…" }`.
 * POST /events/v1/ticket-reservations  { ticketReservation: { tickets: [{ eventId, ticketDefinitionId, quantity, ticketInfo?: { pricingOptionId?, guestPrice? } }] } }  → { ticketReservation: { id, status: "PENDING", expirationDate } }
 * POST /headless/v1/redirect-session   { eventsCheckout: { reservationId, eventSlug }, callbacks: { thankYouPageUrl, postFlowUrl } }
 */
export async function startTicketCheckout(
  event: CheckoutEvent,
  selections: TicketSelection[],
  paths: CheckoutPaths = {},
  tiers: TicketTier[] = [],
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): Promise<RegistrationResult> {
  const tickets = reservationTickets(event.id, selections, tiers);
  let reservation: Raw | undefined;
  try {
    // Until the site has a premium plan AND a payment method this is a 403 NO_PAYMENT_METHOD_CONFIGURED — a business gate, not a bug.
    reservation = (await wixRequest<Raw>("/events/v1/ticket-reservations", { body: { ticketReservation: { tickets } } }))?.ticketReservation;
  } catch (e) {
    throw reservationError(e);
  }
  const session = await wixRequest<Raw>("/headless/v1/redirect-session", {
    body: { eventsCheckout: { reservationId: reservationId(reservation), eventSlug: event.slug }, callbacks: checkoutCallbacks(origin, event.slug, paths) },
  });
  return redirectResult(session);
}
