// Ticket tiers, the reserve → hosted-checkout redirect, and RSVP over the SDK. Rules and mappers
// live in ./registration-core (shared with the REST twin in references/events/rest/); this file is
// the transport only. The payload shapes are exact and easy to get subtly wrong — copy as-is;
// extend by calling these exports, never by editing them. Failures are loud. Everything runs as
// the anonymous VISITOR — no server route, no elevation, anywhere.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/query-available-tickets.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/ticket-reservations/create-ticket-reservation.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/create-rsvp.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { orders, rsvpV2, ticketReservations } from "@wix/events";
import { redirects as redirectsModule } from "@wix/redirects";
import { wixModule } from "../sdk";
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
} from "./registration-core";
import type { Raw } from "./events-core";
import type { RegistrationResult, TicketTier } from "./types";

export { type CheckoutPaths };

const availableTickets = wixModule(orders);
const reservations = wixModule(ticketReservations);
const rsvps = wixModule(rsvpV2);
const redirects = wixModule(redirectsModule);

/**
 * Ticket tiers for a TICKETING event, in display order. Reads the VISITOR-public storefront
 * endpoint (orders.queryAvailableTickets) — never ticketDefinitions*.queryTicketDefinitions:
 * those are the management API and 403 the anonymous visitor (auth.elevate() is the wrong
 * fix — wrong axis, SSR-only).
 */
export async function fetchTicketTiers(eventId: string): Promise<TicketTier[]> {
  // limit is REQUIRED: it defaults to 0, which returns metadata only — zero tiers, no error.
  const res: Raw = await availableTickets.queryAvailableTickets({ filter: { eventId }, limit: 100 });
  return toTiers(res.definitions);
}

/**
 * RSVP to a free (RSVP-type) event — completes fully client-side: no reservation, no
 * redirect, no payment. The registration form is BUILT-IN: exactly firstName + lastName +
 * email; never fetch a form schema or add fields. Send "NO" only when the event's
 * rsvpResponseType is "YES_AND_NO". Throws on closed registration, a guest limit, or an
 * invalid email — surface the message (a repeat email is accepted by default; the organizer's
 * settings decide). A full event with a waitlist returns status "WAITLIST" — tell the guest
 * they're waitlisted, not confirmed.
 */
export async function submitRsvp(
  eventId: string,
  guest: { firstName: string; lastName: string; email: string },
  status: "YES" | "NO" = "YES",
): Promise<RegistrationResult> {
  // rsvpV2 takes the rsvp object DIRECTLY as the first arg (never wrapped in { rsvp: … }),
  // and only rsvpV2 works for visitors — the legacy v1 `rsvp` module 400s on these fields.
  const res: Raw = await rsvps.createRsvp(rsvpBody(eventId, guest, status) as any);
  return rsvpResult(res, status);
}

/**
 * Ticketed checkout, the exact sequence: reserve the selected tiers (holds them, PENDING,
 * auto-expires), then mint the Wix-hosted checkout redirect and return its URL — the caller
 * navigates to it; Wix collects guest details + payment and emails the tickets. Call from
 * the browser: it needs window.location.origin (the published https host — an http or
 * server-derived origin isn't on the redirect allowlist and 403s the return), and
 * createRedirectSession must run as the visitor (it embeds the headless OAuth client and
 * rejects admin/elevated tokens). Never hand-build the checkout URL — the Wix-site
 * `…/ticket-form?reservationId=` path 404s on a headless site. `paths` overrides the return
 * routes (a static site's `event-confirmation.html`).
 */
export async function startTicketCheckout(
  event: CheckoutEvent,
  selections: { tierId: string; quantity: number }[],
  paths: CheckoutPaths = {},
): Promise<RegistrationResult> {
  const tickets = reservationTickets(selections);
  let reservation: Raw;
  try {
    reservation = await reservations.createTicketReservation({ tickets } as any);
  } catch (e) {
    throw reservationError(e);
  }
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const session: Raw = await redirects.createRedirectSession({
    eventsCheckout: { reservationId: reservationId(reservation), eventSlug: event.slug },
    // Wix appends ?orderNumber=&eventId= to the thank-you URL — the shipped /event-confirmation page reads them.
    callbacks: checkoutCallbacks(origin, event.slug, paths),
  });
  return redirectResult(session);
}
