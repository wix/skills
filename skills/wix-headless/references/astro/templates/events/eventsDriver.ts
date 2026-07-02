// eventsDriver.ts — the events registration sequence in plain @wix SDK calls.
// Framework-agnostic: no React, no UI. Any framework's ticket picker / RSVP form
// imports buyTickets()/rsvp() and drives them.
//
// TICKETING = reserve → redirect to Wix's hosted checkout (it collects guest
// details + payment and emails the PDF/QR ticket). RSVP = createRsvp directly,
// confirmation shown inline. BOTH run as the anonymous VISITOR — no server route,
// no auth.elevate(). On @wix/astro the calls run ambiently (the visitor client is
// provided by @wix/essentials, like the ecom CartView island) — no
// createClient/OAuthStrategy. On an own/static SPA, acquire a visitor client with
// createClient({ modules, auth: OAuthStrategy({ clientId }) }) and call the same
// functions through it. Keep the SDK calls, payload shapes, and the sequence;
// adapt only brand copy/styling in the UI that drives this module.

import { ticketReservations, rsvp as rsvpModule } from "@wix/events";
import { redirects } from "@wix/redirects";

// ── Types ───────────────────────────────────────────────────────────────────
export interface TicketSelection {
  ticketDefinitionId: string;
  quantity: number; // ≥ 1
}

export interface BuyTicketsParams {
  eventSlug: string; // the seeded event slug — Wix's hosted checkout needs it
  selections: TicketSelection[]; // one entry per chosen tier (quantity ≥ 1)
}

export interface RsvpParams {
  eventId: string;
  firstName: string;
  lastName: string;
  email: string;
  status?: "YES" | "NO"; // default "YES"; "NO" only for YES_AND_NO events
}

// A reservation/payments setup error reads as "No payment method configured" when
// the site has no payment method for paid tickets. Surface it softly.
export function isPaymentSetupError(err: any): boolean {
  const msg = (err?.message || err?.details?.applicationError?.description || "").toString();
  return /payment method|not configured|premium/i.test(msg);
}

// ── buyTickets — reserve, then hand off to Wix's hosted checkout ──────────────
// Throws on failure; the caller catches and shows a friendly message (use
// isPaymentSetupError to special-case the "ticket sales not switched on" case).
export async function buyTickets(params: BuyTicketsParams): Promise<void> {
  const tickets = params.selections
    .filter((s) => s.quantity > 0)
    .map((s) => ({ ticketDefinitionId: s.ticketDefinitionId, quantity: s.quantity }));
  if (tickets.length === 0) throw new Error("Select at least one ticket.");

  // 1. Reserve (PENDING; auto-expires after the event's reservation window).
  const reservation = await ticketReservations.createTicketReservation({ tickets });
  const reservationId = reservation._id;
  if (!reservationId) throw new Error("Failed to reserve tickets.");

  // 2. Mint the hosted-checkout redirect (VISITOR context — never elevated; an
  //    admin token fails with "client Id does not correspond to a headless oauth
  //    app"). Wix collects guest details + payment, emails the ticket, and returns
  //    the visitor to thankYouPageUrl with ?orderNumber=&eventId=.
  const origin = window.location.origin;
  const { redirectSession } = await redirects.createRedirectSession({
    eventsCheckout: { reservationId, eventSlug: params.eventSlug },
    callbacks: {
      thankYouPageUrl: `${origin}/event-confirmation`,
      postFlowUrl: `${origin}/events/${params.eventSlug}`,
    },
  });
  if (!redirectSession?.fullUrl) throw new Error("Failed to start checkout.");
  window.location.href = redirectSession.fullUrl; // hand off to Wix
}

// ── rsvp — free events. Built-in form is name + email. ────────────────────────
export async function rsvp(params: RsvpParams): Promise<void> {
  await rsvpModule.createRsvp({
    eventId: params.eventId,
    firstName: params.firstName,
    lastName: params.lastName,
    email: params.email,
    status: params.status ?? "YES",
  });
}
