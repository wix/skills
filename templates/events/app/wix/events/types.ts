// Events DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. Images are
// resolved https URLs; every displayable price is a ready formatted string; every date label is
// formatted in the EVENT's time zone (a venue event shown in the browser's zone is wrong).

/** The current registration flavor — every registration surface branches on this. */
export type RegistrationType = "RSVP" | "TICKETING" | "EXTERNAL" | "NONE";

/** Event lifecycle (Events V3 `status`) — only UPCOMING/STARTED are listed by default. */
export type EventStatus = "UPCOMING" | "STARTED" | "ENDED" | "CANCELED" | "DRAFT";

/**
 * Events V3 `registration.status`. Closed means exactly CLOSED_MANUALLY / CLOSED_AUTOMATICALLY;
 * SCHEDULED_RSVP opens later; OPEN_RSVP_WAITLIST_ONLY accepts registrations onto a waitlist.
 */
export type RegistrationStatus =
  | "OPEN_RSVP"
  | "OPEN_RSVP_WAITLIST_ONLY"
  | "OPEN_TICKETS"
  | "OPEN_EXTERNAL"
  | "SCHEDULED_RSVP"
  | "CLOSED_MANUALLY"
  | "CLOSED_AUTOMATICALLY"
  | "UNKNOWN_REGISTRATION_STATUS";

/** An event as a listing/grid tile needs it. */
export interface EventSummary {
  id: string;
  slug: string;
  title: string;
  /** Plain-text teaser, safe to render directly (the rich description never leaves the data layer). */
  shortDescription: string;
  status: EventStatus;
  /**
   * Human-formatted date/time from Wix in the event's zone, e.g. "Sep 26, 2026, 7:00 PM"; the
   * organizer's TBD message when the date is TBD ("" only when both are missing).
   */
  dateLabel: string;
  /** ISO start/end instants for custom formatting/grouping ("" when the date is TBD). */
  startDateIso: string;
  endDateIso: string;
  /** IANA zone of the event ("" when unknown) — pass as `timeZone` to Intl for any date you format yourself. */
  timeZoneId: string;
  /** True when the organizer marked the schedule TBD; `dateTbdMessage` is their copy for it. */
  dateTbd: boolean;
  dateTbdMessage: string;
  /** Organizer display flags for the schedule. */
  hideEndDate: boolean;
  showTimeZone: boolean;
  locationName: string;
  locationType: "VENUE" | "ONLINE" | "TBD";
  /** Resolved https URL ("" when the event has no image). */
  imageUrl: string;
  registrationType: RegistrationType;
  /** "From €25.00" (ticketed), "Free" (RSVP / free tickets), "" when nothing applies. */
  priceLabel: string;
  soldOut: boolean;
  /** Manual categories only (the per-series RECURRING_EVENT and hidden ones are dropped). */
  categories: { id: string; name: string }[];
  /** "RECURRING" / "RECURRING_UPCOMING" for one date of a series; "ONE_TIME" otherwise. */
  recurrenceStatus: string;
  /** Every date of a recurring series shares this id ("" for a one-time event) — `fetchOccurrences(id)` lists them. */
  recurringCategoryId: string;
}

/** A category as the filter pills need it. */
export interface EventCategory {
  id: string;
  name: string;
}

/** One field of the organizer's RSVP form (Events V3 `form.controls[].inputs[]`). */
export interface RsvpFormInput {
  /** The `inputName` to submit under. */
  name: string;
  label: string;
  mandatory: boolean;
  /** Wix value type: TEXT (also DROPDOWN/RADIO values), NUMBER, TEXT_ARRAY (CHECKBOX), DATE_TIME, ADDRESS. */
  type: "TEXT" | "NUMBER" | "TEXT_ARRAY" | "DATE_TIME" | "ADDRESS";
  /** Predefined choices (DROPDOWN / RADIO / CHECKBOX); the submitted value must be one of them. */
  options: string[];
  /** Max characters for text inputs (0 = unlimited). */
  maxLength: number;
}

/** One control of the organizer's RSVP form; the built-in name and email controls carry `system: true`. */
export interface RsvpFormControl {
  id: string;
  type:
    | "INPUT"
    | "TEXTAREA"
    | "DROPDOWN"
    | "RADIO"
    | "CHECKBOX"
    | "NAME"
    | "GUEST_CONTROL"
    | "ADDRESS_SHORT"
    | "ADDRESS_FULL"
    | "DATE";
  system: boolean;
  inputs: RsvpFormInput[];
}

/** The organizer's RSVP form: controls in display order, plus the "+guests" control when enabled. */
export interface RsvpForm {
  /** Every non-deleted control except GUEST_CONTROL, in `orderIndex` order. */
  controls: RsvpFormControl[];
  /** Present when the organizer lets a guest bring others — rendered as a 0..maxGuests picker plus names. */
  guestControl: { label: string; maxGuests: number; namesLabel: string } | null;
}

/** Event-level tax settings (`registration.tickets.taxSettings`) — what the hosted checkout charges. */
export interface TaxSettings {
  name: string;
  /** e.g. 21 for "21%". */
  ratePercent: number;
  /** INCLUDED_IN_PRICE → prices already contain it; else it is added at checkout. */
  includedInPrice: boolean;
  appliedToDonations: boolean;
}

/** An event as the detail/registration page needs it. */
export interface EventDetail extends EventSummary {
  /** Long description as plain paragraphs (extracted from the rich content; may be empty). */
  aboutParagraphs: string[];
  /** Wix's formatted schedule parts ("" for a TBD schedule; end parts "" when the end date is hidden). */
  formatted: { startDate: string; startTime: string; endDate: string; endTime: string };
  /** Full formatted street address ("" for ONLINE/TBD). */
  address: string;
  /** Venue coordinates when Wix geocoded the address — for a map embed. */
  coordinates: { lat: number; lng: number } | null;
  /** The raw Wix registration status — branch on the booleans below, keep this for copy. */
  registrationStatus: RegistrationStatus;
  /** Accepting registrations RIGHT NOW (an OPEN_* status, not paused) — the form/picker renders only then. */
  registrationOpen: boolean;
  /** CLOSED_MANUALLY / CLOSED_AUTOMATICALLY — the honest closed state (sold out when `soldOut`). */
  registrationClosed: boolean;
  /** SCHEDULED_RSVP: when registration opens ("" otherwise), raw and formatted in the event's zone. */
  registrationOpensAtIso: string;
  registrationOpensAtLabel: string;
  /** The organizer paused registration — open status, but nothing is accepted. */
  registrationPaused: boolean;
  /** OPEN_RSVP_WAITLIST_ONLY: the guest list is full; an RSVP joins the waitlist. */
  waitlistOnly: boolean;
  /** `allowedGuestTypes === "MEMBER"`: only signed-in site members may register. */
  membersOnly: boolean;
  /** RSVP events: "YES_AND_NO" also allows a "can't make it" reply. */
  rsvpResponseType: "YES_ONLY" | "YES_AND_NO";
  /** RSVP events: the organizer's form (from the FORM fieldset); null for other types. */
  rsvpForm: RsvpForm | null;
  /** EXTERNAL events: the outbound registration URL ("" otherwise). */
  externalUrl: string;
  /** The event's page on the organizer's Wix site ("" when unavailable). */
  eventPageUrl: string;
  addToCalendar: { google: string; ics: string };
  /** TICKETING: tax the hosted checkout applies (null when none is configured). */
  taxSettings: TaxSettings | null;
  /** TICKETING: max tickets in one order (Wix default 20, max 50) — the picker caps the total here. */
  ticketLimitPerOrder: number;
}

/** A purchasable ticket tier (TICKETING events, Ticket Definitions V3). */
export interface TicketTier {
  id: string;
  name: string;
  description: string;
  /**
   * FIXED: one price. FREE: no charge. GUEST: the guest names the amount (a donation, at least
   * `minPrice`). OPTIONS: several named prices, each picked with its own quantity.
   */
  pricingType: "FIXED" | "FREE" | "GUEST" | "OPTIONS";
  /** Formatted: "€45.00" (FIXED), "Free" (FREE), "€10.00 – €25.00" (OPTIONS range), "" (GUEST). */
  price: string;
  /** FIXED: the raw decimal ("45.00") behind `price` — for totals only, never displayed ("0" otherwise). */
  priceValue: string;
  free: boolean;
  /** GUEST: formatted minimum ("€5.00") and its raw decimal ("5.00") for validation; "" otherwise. */
  minPrice: string;
  minPriceValue: string;
  /** ISO currency of the tier ("" when unknown). */
  currency: string;
  /** OPTIONS: the named prices (`value` is the raw decimal for totals, never displayed); `notes` are that option's tax/fee lines. Empty for other types. */
  options: { id: string; name: string; price: string; value: string; notes: string[] }[];
  /** Tax and Wix fee lines the checkout adds, e.g. ["+€9.45 VAT", "+€1.36 ticket service fee"] or ["VAT included"]. */
  notes: string[];
  /** Max quantity per order for this tier RIGHT NOW; 0 means sold out (Wix lowers it to the unsold count). */
  limitPerCheckout: number;
  soldOut: boolean;
  /** "SALE_STARTED" is the only buyable status. */
  saleStatus: "SALE_SCHEDULED" | "SALE_STARTED" | "SALE_ENDED";
  /** Buyable now: on sale and not sold out — enable the controls on this. */
  available: boolean;
  /** SALE_SCHEDULED: "Goes on sale" moment, formatted in the event's zone ("" otherwise). */
  saleStartsLabel: string;
  /** Sale end moment, formatted in the event's zone ("" when there is none or the sale hasn't started). */
  saleEndsLabel: string;
  /** Wix fee handling: FEE_ADDED_AT_CHECKOUT adds 2.5% at checkout; FEE_INCLUDED/NO_FEE add nothing. */
  feeType: "FEE_INCLUDED" | "FEE_ADDED_AT_CHECKOUT" | "NO_FEE" | "";
}

/** One line of the picker's selection: a tier, optionally one of its pricing options, and for GUEST tiers the named price. */
export interface TicketSelection {
  tierId: string;
  quantity: number;
  optionId?: string;
  /** GUEST tiers: the decimal the guest typed ("25.00"). */
  guestPrice?: string;
}

/** The picker's running totals, mirroring Wix's own picker; the hosted checkout is authoritative. */
export interface SelectionTotals {
  subtotal: string;
  tax: string;
  fee: string;
  total: string;
}

/** The outcome of a registration: the browser is redirecting to Wix checkout, or the RSVP is in. */
export type RegistrationResult =
  | { kind: "redirect"; url: string }
  | { kind: "rsvpConfirmed"; status: "YES" | "NO" | "WAITLIST" };

/** A ticket order as the confirmation page shows it (Orders `getOrder`, TICKETS + DETAILS + INVOICE). */
export interface OrderSummary {
  number: string;
  /** Wix order status: FREE, PAID, PENDING, OFFLINE_PENDING, INITIATED, CANCELED, DECLINED, … */
  status: string;
  /** Visitor copy for the status ("Paid", "Awaiting payment", …). */
  statusLabel: string;
  /** FREE or PAID — the order is settled. */
  settled: boolean;
  email: string;
  /** "Sep 26, 2026" — the order date. */
  createdLabel: string;
  items: { name: string; price: string; quantity: number; total: string }[];
  subtotal: string;
  /** "" when no coupon applied. */
  couponDiscount: string;
  paidPlanDiscount: { amount: string; ratePercent: number } | null;
  tax: { name: string; ratePercent: number; amount: string } | null;
  /** The Wix ticket service fee when it was added at checkout. */
  fee: { amount: string; ratePercent: number } | null;
  total: string;
  /** Download link for the ticket PDF ("" until the tickets are generated). */
  ticketsPdfUrl: string;
  ticketCount: number;
  /** Tickets are generated asynchronously after payment — true once every ticket exists. */
  ticketsReady: boolean;
}
