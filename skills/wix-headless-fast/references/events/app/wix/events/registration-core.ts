// Registration rules and DTO mapping — transport-agnostic, imported by both ./registration.ts
// (SDK) and the REST twin in references/events/rest/registration.ts (fetch). Tier mapping, the
// reservation line items, the payment gate, the checkout callbacks, and the RSVP body live HERE,
// once. Raw ticket definitions carry `_id` (SDK) or `id` (REST). Type-only imports so a strip
// to JS emits none.
import type { EventDetail, RegistrationResult, TicketTier } from "./types";
import type { Raw } from "./events-core";

const tierId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

export function formatTierPrice(price: Raw | undefined): string {
  const value = price?.amount ?? price?.value;
  if (value == null || value === "") return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: price?.currency || "USD" }).format(Number(value));
  } catch {
    return `${value} ${price?.currency ?? ""}`.trim();
  }
}

export function toTier(raw: Raw): TicketTier {
  const free = raw.free === true || Number(raw.price?.amount ?? raw.price?.value ?? 0) === 0;
  return {
    id: tierId(raw),
    name: raw.name ?? "",
    description: raw.description ?? "",
    price: free ? "Free" : formatTierPrice(raw.price),
    free,
    limitPerCheckout: raw.limitPerCheckout ?? 20,
    saleStatus: (raw.saleStatus ?? "SALE_STARTED") as TicketTier["saleStatus"],
  };
}

/** Tiers in display order (orderIndex), skipping any without an id. */
export function toTiers(definitions: Raw[] | undefined): TicketTier[] {
  return (definitions ?? [])
    .slice()
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    .map(toTier)
    .filter((t) => t.id);
}

/** The reservation's line items from the picker's selections; throws when nothing is picked. */
export function reservationTickets(selections: { tierId: string; quantity: number }[]): { ticketDefinitionId: string; quantity: number }[] {
  const tickets = selections
    .filter((s) => s.quantity > 0)
    .map((s) => ({ ticketDefinitionId: s.tierId, quantity: s.quantity }));
  if (!tickets.length) throw new Error("Pick at least one ticket first.");
  return tickets;
}

/**
 * The real gate on paid tickets: until the site has a premium plan AND a configured payment
 * method, reserving fails 403 NO_PAYMENT_METHOD_CONFIGURED. Not a permissions bug — don't
 * elevate (that just creates an unpayable order); surface it softly.
 */
export function reservationError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/payment method|not configured|premium/i.test(msg)) {
    return new Error("Ticket sales aren't switched on yet — the organizer needs to connect a payment method in the dashboard.");
  }
  return e instanceof Error ? e : new Error(msg);
}

/** The reservation id out of either transport's response; throws when the hold didn't happen. */
export function reservationId(reservation: Raw | null | undefined): string {
  const id = tierId(reservation);
  if (!id) throw new Error("Those tickets couldn't be reserved — they may have just sold out.");
  return id;
}

/** Where the hosted checkout returns to. Defaults are the Astro routes; a static site passes its file paths. */
export interface CheckoutPaths {
  /** Success landing — Wix appends `?orderNumber=&eventId=`. Default `/event-confirmation`. */
  confirmation?: string;
  /** Back here on abandon. Default `/events/<slug>`. */
  event?: string;
}

/**
 * The redirect session's callbacks. `origin` is the published https host (window.location.origin
 * in a browser) — an http or server-derived origin isn't on the redirect allowlist and 403s the
 * return; {} when unknown (SSR).
 */
export function checkoutCallbacks(origin: string, slug: string, paths: CheckoutPaths = {}): Raw {
  if (!origin) return {};
  return {
    thankYouPageUrl: `${origin}${paths.confirmation ?? "/event-confirmation"}`,
    postFlowUrl: `${origin}${paths.event ?? `/events/${slug}`}`,
  };
}

/** The redirect result; throws when Wix returned no URL. */
export function redirectResult(session: Raw | null | undefined): RegistrationResult {
  const url = session?.redirectSession?.fullUrl;
  if (!url) throw new Error("Checkout couldn't start — please try again.");
  return { kind: "redirect", url };
}

/**
 * The RSVP body: the built-in form is exactly firstName + lastName + email — never a fetched
 * schema, never extra fields. "NO" only when the event's rsvpResponseType is "YES_AND_NO".
 */
export function rsvpBody(eventId: string, guest: { firstName: string; lastName: string; email: string }, status: "YES" | "NO"): Raw {
  return { eventId, firstName: guest.firstName, lastName: guest.lastName, email: guest.email, status };
}

/** A full event with a waitlist answers status "WAITLIST" — tell the guest they're waitlisted, not confirmed. */
export function rsvpResult(rsvp: Raw | null | undefined, sent: "YES" | "NO"): RegistrationResult {
  return { kind: "rsvpConfirmed", status: (rsvp?.status ?? sent) as "YES" | "NO" | "WAITLIST" };
}

export type CheckoutEvent = Pick<EventDetail, "id" | "slug">;
