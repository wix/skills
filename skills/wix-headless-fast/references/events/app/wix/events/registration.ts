// Ticket tiers, the reserve → hosted-checkout redirect, and RSVP. The payload shapes here
// are exact and easy to get subtly wrong — copy as-is; extend by calling these exports,
// never by editing them. Failures are loud. Everything runs as the anonymous VISITOR —
// no server route, no elevation, anywhere.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/orders/query-available-tickets.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/ticketing/ticket-reservations/create-ticket-reservation.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/events/registration/rsvp-v2/create-rsvp.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { orders, rsvpV2, ticketReservations } from "@wix/events";
import { redirects as redirectsModule } from "@wix/redirects";
import { wixModule } from "../sdk";
import type { EventDetail, RegistrationResult, TicketTier } from "./types";

const availableTickets = wixModule(orders);
const reservations = wixModule(ticketReservations);
const rsvps = wixModule(rsvpV2);
const redirects = wixModule(redirectsModule);

type Raw = Record<string, any>;

function formatTierPrice(price: Raw | undefined): string {
  const value = price?.amount ?? price?.value;
  if (value == null || value === "") return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: price?.currency || "USD" }).format(Number(value));
  } catch {
    return `${value} ${price?.currency ?? ""}`.trim();
  }
}

function toTier(raw: Raw): TicketTier {
  const free = raw.free === true || Number(raw.price?.amount ?? raw.price?.value ?? 0) === 0;
  return {
    id: raw._id ?? "", // _id, never .id
    name: raw.name ?? "",
    description: raw.description ?? "",
    price: free ? "Free" : formatTierPrice(raw.price),
    free,
    limitPerCheckout: raw.limitPerCheckout ?? 20,
    saleStatus: (raw.saleStatus ?? "SALE_STARTED") as TicketTier["saleStatus"],
  };
}

/**
 * Ticket tiers for a TICKETING event, in display order. Reads the VISITOR-public storefront
 * endpoint (orders.queryAvailableTickets) — never ticketDefinitions*.queryTicketDefinitions:
 * those are the management API and 403 the anonymous visitor (auth.elevate() is the wrong
 * fix — wrong axis, SSR-only).
 */
export async function fetchTicketTiers(eventId: string): Promise<TicketTier[]> {
  // limit is REQUIRED: it defaults to 0, which returns metadata only — zero tiers, no error.
  const res: Raw = await availableTickets.queryAvailableTickets({ filter: { eventId }, limit: 100 });
  return (res.definitions ?? [])
    .slice()
    .sort((a: Raw, b: Raw) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    .map((d: Raw) => toTier(d))
    .filter((t: TicketTier) => t.id);
}

/**
 * RSVP to a free (RSVP-type) event — completes fully client-side: no reservation, no
 * redirect, no payment. The registration form is BUILT-IN: exactly firstName + lastName +
 * email; never fetch a form schema or add fields. Send "NO" only when the event's
 * rsvpResponseType is "YES_AND_NO". Throws on closed registration / duplicate email —
 * surface the message. A full event with a waitlist returns status "WAITLIST" — tell the
 * guest they're waitlisted, not confirmed.
 */
export async function submitRsvp(
  eventId: string,
  guest: { firstName: string; lastName: string; email: string },
  status: "YES" | "NO" = "YES",
): Promise<RegistrationResult> {
  // rsvpV2 takes the rsvp object DIRECTLY as the first arg (never wrapped in { rsvp: … }),
  // and only rsvpV2 works for visitors — the legacy v1 `rsvp` module 400s on these fields.
  const res: Raw = await rsvps.createRsvp({ eventId, ...guest, status } as any);
  return { kind: "rsvpConfirmed", status: (res?.status ?? status) as "YES" | "NO" | "WAITLIST" };
}

/**
 * Ticketed checkout, the exact sequence: reserve the selected tiers (holds them, PENDING,
 * auto-expires), then mint the Wix-hosted checkout redirect and return its URL — the caller
 * navigates to it; Wix collects guest details + payment and emails the tickets. Call from
 * the browser: it needs window.location.origin (the published https host — an http or
 * server-derived origin isn't on the redirect allowlist and 403s the return), and
 * createRedirectSession must run as the visitor (it embeds the headless OAuth client and
 * rejects admin/elevated tokens). Never hand-build the checkout URL — the Wix-site
 * `…/ticket-form?reservationId=` path 404s on a headless site.
 */
export async function startTicketCheckout(
  event: Pick<EventDetail, "id" | "slug">,
  selections: { tierId: string; quantity: number }[],
): Promise<RegistrationResult> {
  const tickets = selections
    .filter((s) => s.quantity > 0)
    .map((s) => ({ ticketDefinitionId: s.tierId, quantity: s.quantity }));
  if (!tickets.length) throw new Error("Pick at least one ticket first.");

  let reservation: Raw;
  try {
    reservation = await reservations.createTicketReservation({ tickets } as any);
  } catch (e) {
    // The real gate on paid tickets: until the site has a premium plan AND a configured
    // payment method, reserving fails 403 "No payment method configured". Not a permissions
    // bug — don't elevate (that just creates an unpayable order); surface it softly.
    const msg = e instanceof Error ? e.message : String(e);
    if (/payment method|not configured|premium/i.test(msg)) {
      throw new Error(
        "Ticket sales aren't switched on yet — the organizer needs to connect a payment method in the dashboard.",
      );
    }
    throw e;
  }
  const reservationId: string | undefined = reservation?._id; // _id, never .id
  if (!reservationId) throw new Error("Those tickets couldn't be reserved — they may have just sold out.");

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const session: Raw = await redirects.createRedirectSession({
    eventsCheckout: { reservationId, eventSlug: event.slug },
    callbacks: {
      // Wix appends ?orderNumber=&eventId= — the shipped /event-confirmation page reads them.
      thankYouPageUrl: origin ? `${origin}/event-confirmation` : undefined,
      postFlowUrl: origin ? `${origin}/events/${event.slug}` : undefined, // back here on abandon
    },
  });
  const url = session?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start — please try again.");
  return { kind: "redirect", url };
}
