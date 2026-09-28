// Events DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. Images are
// resolved https URLs; every displayable price is a ready formatted string.

/** The current registration flavor — every registration surface branches on this. */
export type RegistrationType = "RSVP" | "TICKETING" | "EXTERNAL" | "NONE";

/** An event as a listing/grid tile needs it. */
export interface EventSummary {
  id: string;
  slug: string;
  title: string;
  /** Plain-text teaser, safe to render directly (the rich description never leaves the data layer). */
  shortDescription: string;
  /** Human-formatted date/time from Wix, e.g. "Sep 26, 2026, 7:00 PM" ("" when the date is TBD). */
  dateLabel: string;
  /** ISO start instant for custom formatting/grouping ("" when the date is TBD). */
  startDateIso: string;
  locationName: string;
  locationType: "VENUE" | "ONLINE" | "TBD";
  /** Resolved https URL ("" when the event has no image). */
  imageUrl: string;
  registrationType: RegistrationType;
  /** "From €25.00" (ticketed), "Free" (RSVP / free tickets), "" when nothing applies. */
  priceLabel: string;
  soldOut: boolean;
  /** Assigned category names (the seeded format/track grouping) — filter client-side. */
  categories: { id: string; name: string }[];
}

/** An event as the detail/registration page needs it. */
export interface EventDetail extends EventSummary {
  /** Long description as plain paragraphs (extracted from the rich content; may be empty). */
  aboutParagraphs: string[];
  /** False → registration is closed (sold out / closed / ended) — show a closed state, no form. */
  registrationOpen: boolean;
  /** RSVP events: "YES_AND_NO" also allows a "can't make it" reply. */
  rsvpResponseType: "YES_ONLY" | "YES_AND_NO";
  /** EXTERNAL events: the outbound registration URL ("" otherwise). */
  externalUrl: string;
  addToCalendar: { google: string; ics: string };
}

/** A purchasable ticket tier (TICKETING events). */
export interface TicketTier {
  id: string;
  name: string;
  description: string;
  /** Formatted price (e.g. "€45.00"); "Free" for free tiers. */
  price: string;
  free: boolean;
  /** Max quantity per order for this tier. */
  limitPerCheckout: number;
  /** Only "SALE_STARTED" is buyable — gate the picker on this. */
  saleStatus: "SALE_SCHEDULED" | "SALE_STARTED" | "SALE_ENDED";
}

/** The outcome of a registration: the browser is redirecting to Wix checkout, or the RSVP is in. */
export type RegistrationResult =
  | { kind: "redirect"; url: string }
  | { kind: "rsvpConfirmed"; status: "YES" | "NO" | "WAITLIST" };
