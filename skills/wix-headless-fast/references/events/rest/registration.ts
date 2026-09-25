// Ticket tiers, the reserve → hosted-checkout redirect, and RSVP over REST — the twin of
// app/wix/events/registration.ts. Same exports, same DTOs; rules and mappers from
// registration-core (the SAME file the SDK transport uses, deployed flat next to this one). The
// request shapes are exact and rewriting them is how registrations break. Failures are loud.
// All calls run with the visitor token — the reservation and the RSVP are the token's.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/query-available-tickets.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/ticket-reservations/create-ticket-reservation.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/create-rsvp.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { wixRequest } from "./client.js";
import {
  checkoutCallbacks,
  redirectResult,
  reservationError,
  reservationId,
  reservationTickets,
  rsvpBody,
  rsvpResult,
  toTiers,
  type CheckoutEvent,
  type CheckoutPaths,
} from "./registration-core.js";
import type { Raw } from "./events-core.js";
import type { RegistrationResult, TicketTier } from "./types.js";

export { type CheckoutPaths };

/**
 * Ticket tiers for a TICKETING event, in display order — the VISITOR-public storefront read, never
 * the ticket-definitions management API (403 for a visitor). `limit` is REQUIRED: it defaults to 0
 * and returns metadata only.  POST /events/v1/checkout/available-tickets/query  { filter: { eventId }, limit }
 */
export async function fetchTicketTiers(eventId: string): Promise<TicketTier[]> {
  const res = await wixRequest<Raw>("/events/v1/checkout/available-tickets/query", { body: { filter: { eventId }, limit: 100 } });
  return toTiers(res?.definitions);
}

/**
 * RSVP to a free (RSVP-type) event — completes fully client-side: no reservation, no redirect, no
 * payment. The form is BUILT-IN: exactly firstName + lastName + email. "NO" only when the event's
 * rsvpResponseType is "YES_AND_NO". Throws on closed registration, a guest limit, or an invalid
 * email — surface the message (a repeat email is accepted by default). A full event with a waitlist
 * answers "WAITLIST".
 * POST /events/v2/rsvps  { rsvp: { eventId, firstName, lastName, email, status } }  → { rsvp: { id, status } }
 */
export async function submitRsvp(
  eventId: string,
  guest: { firstName: string; lastName: string; email: string },
  status: "YES" | "NO" = "YES",
): Promise<RegistrationResult> {
  const res = await wixRequest<Raw>("/events/v2/rsvps", { body: { rsvp: rsvpBody(eventId, guest, status) } });
  return rsvpResult(res?.rsvp, status);
}

/**
 * Ticketed checkout, the exact sequence: reserve the selected tiers (a PENDING hold that
 * auto-expires), then mint the Wix-hosted checkout redirect and return its URL — the caller
 * navigates the FULL document to it; Wix collects guest details + payment and emails the tickets.
 * `origin` must be the site's real https origin as registered on the OAuth app's allowed domains
 * (browser: window.location.origin). Never hand-build the checkout URL. `paths` overrides the
 * return routes — a static site passes `{ confirmation: "/event-confirmation.html", event: "/event.html?slug=…" }`.
 * POST /events/v1/ticket-reservations  { ticketReservation: { tickets: [{ ticketDefinitionId, quantity }] } }  → { ticketReservation: { id, status: "PENDING", expirationDate } }
 * POST /headless/v1/redirect-session   { eventsCheckout: { reservationId, eventSlug }, callbacks: { thankYouPageUrl, postFlowUrl } }
 */
export async function startTicketCheckout(
  event: CheckoutEvent,
  selections: { tierId: string; quantity: number }[],
  paths: CheckoutPaths = {},
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): Promise<RegistrationResult> {
  const tickets = reservationTickets(selections);
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
