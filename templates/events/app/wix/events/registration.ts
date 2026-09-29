// Ticket tiers, the reserve → hosted-checkout redirect, and RSVP over the SDK. Rules and mappers
// live in ./registration-core (shared with the REST twin in templates/events/rest/); this file is
// the transport only. The payload shapes are exact and easy to get subtly wrong — copy as-is;
// extend by calling these exports, never by editing them. Failures are loud. Everything runs as
// the anonymous VISITOR — no server route, no elevation, anywhere.
// Query Available Ticket Definitions: wix.events.ticketdef.v3.TicketDefinitionManagement.QueryAvailableTicketDefinitions
//   (POST /events/v3/ticket-definitions/available/query, as the @wix/events SDK issues it; the V3 family's reference:)
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/event-management/ticket-definitions-v3/create-ticket-definition.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/ticket-reservations/create-ticket-reservation.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/create-rsvp.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { rsvpV2, ticketDefinitionsV2, ticketReservations } from "@wix/events";
import { redirects as redirectsModule } from "@wix/redirects";
import { wixModule } from "../sdk";
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
} from "./registration-core";
import type { Raw } from "./events-core";
import type { EventDetail, RegistrationResult, TicketSelection, TicketTier } from "./types";

export { type CheckoutPaths, type RsvpValues, type TierEvent };

const ticketDefinitions = wixModule(ticketDefinitionsV2);
const reservations = wixModule(ticketReservations);
const rsvps = wixModule(rsvpV2);
const redirects = wixModule(redirectsModule);

/**
 * Ticket tiers for a TICKETING event, in the organizer's order, with pricing method, availability,
 * sale period and the tax/fee lines checkout adds. Reads the VISITOR-public Query Available Ticket
 * Definitions (V3; hidden tiers excluded server-side) — never queryTicketDefinitions: that is the
 * management read and 403s the anonymous visitor (auth.elevate() is the wrong fix — wrong axis,
 * SSR-only). Pass the EventDetail: the sale dates format in its zone and its tax settings price
 * the notes.
 */
export async function fetchTicketTiers(event: TierEvent): Promise<TicketTier[]> {
  const res: Raw = await ticketDefinitions.queryAvailableTicketDefinitions(availableTiersQuery(event.id) as any);
  return toTiers(res.ticketDefinitions, event);
}

/**
 * RSVP to a free (RSVP-type) event — completes fully client-side: no reservation, no redirect, no
 * payment. `values` are the answers to the ORGANIZER'S form (event.rsvpForm — the FORM fieldset),
 * keyed by input name; the built-in name + email inputs are part of it. Create RSVP rejects a
 * missing mandatory answer, an unknown input name, or a value outside the predefined options
 * (INVALID_FORM_RESPONSE). `guests` only matters when the form has a guest control. Send "NO" only
 * when the event's rsvpResponseType is "YES_AND_NO". Throws on closed registration, a guest limit,
 * or an invalid email — surface the message (a repeat email is accepted by default; the organizer's
 * settings decide). A full event with a waitlist returns status "WAITLIST" — tell the guest they're
 * waitlisted, not confirmed.
 */
export async function submitRsvp(
  event: Pick<EventDetail, "id" | "rsvpForm">,
  values: RsvpValues,
  status: "YES" | "NO" = "YES",
  guests: { guestCount: number; guestNames: string[] } = { guestCount: 0, guestNames: [] },
): Promise<RegistrationResult> {
  // rsvpV2 takes the rsvp object DIRECTLY as the first arg (never wrapped in { rsvp: … }),
  // and only rsvpV2 works for visitors — the legacy v1 `rsvp` module 400s on these fields.
  const res: Raw = await rsvps.createRsvp(rsvpBody(event.id, rsvpFormOf(event), values, status, guests) as any);
  return rsvpResult(res, status);
}

/**
 * Ticketed checkout, the exact sequence: reserve the selected tiers (holds them, PENDING,
 * auto-expires), then mint the Wix-hosted checkout redirect and return its URL — the caller
 * navigates to it; Wix collects guest details + payment and emails the tickets. Selections carry
 * the pricing option or the guest's price where the tier needs one (`ticketInfo` on the line
 * item); pass `tiers` so a missing guest price is refused before the request. Call from the
 * browser: it needs window.location.origin (the published https host — an http or server-derived
 * origin isn't on the redirect allowlist and 403s the return), and createRedirectSession must run
 * as the visitor (it embeds the headless OAuth client and rejects admin/elevated tokens). Never
 * hand-build the checkout URL — the Wix-site `…/ticket-form?reservationId=` path 404s on a headless
 * site. `paths` overrides the return routes (a static site's `event-confirmation.html`).
 */
export async function startTicketCheckout(
  event: CheckoutEvent,
  selections: TicketSelection[],
  paths: CheckoutPaths = {},
  tiers: TicketTier[] = [],
): Promise<RegistrationResult> {
  const tickets = reservationTickets(event.id, selections, tiers);
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
