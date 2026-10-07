// Rentals DTOs — the serializable shapes every hook, component, and page consumes. Plain JSON:
// safe as Astro island props and across server/client boundaries. Images are resolved https URLs;
// every displayable price is a ready formatted string ("" when the site sent no currency — the
// surface omits it, never guesses one).
//
// A rental is a Wix Bookings service with rentals-specific values (there is no Rentals API of its
// own): the thing rented is a RESOURCE (a room, a vehicle, a piece of gear), the customer picks the
// START and the LENGTH, and the price is per unit — per hour or per day.

/** How a rental is measured and priced: one of the two, never both on one rental. */
export type RentalUnit = "HOUR" | "DAY";

/** Where the rental is handed over. BUSINESS locations have an id; CUSTOM/CUSTOMER don't. */
export interface RentalLocation {
  id: string | null;
  name: string;
  type: "BUSINESS" | "CUSTOM" | "CUSTOMER";
}

/** A rental as a listing tile needs it. */
export interface RentalSummary {
  id: string;
  slug: string;
  name: string;
  tagLine: string;
  unit: RentalUnit;
  /** Display-ready price per unit: "$40" ("" when unknown). */
  ratePerUnit: string;
  /** "$40 / hour" or "$40 / day" ("" when unknown). */
  rateLabel: string;
  /** The per-unit amount as a number with its currency — for running totals only; never render these. */
  rateAmount: number;
  currency: string;
  /** Shortest and longest length the customer may pick, in the rental's unit (hours may be fractional: 0.5). */
  minUnits: number;
  maxUnits: number;
  /** "1 to 8 hours" / "1 to 5 days" ("" when unknown). */
  rangeLabel: string;
  /** Resolved https URL ("" when the rental has no image). */
  imageUrl: string;
  /** The resource type the rental books from, and the concrete resources behind it. */
  resourceTypeId: string | null;
  resourceCount: number;
  locations: RentalLocation[];
  onlineBookingEnabled: boolean;
  /** The owner approves each rental by hand: the CTA is "Request to rent". */
  requiresManualApproval: boolean;
  /** NO_FEE (or a rate of 0): rents without a checkout. */
  free: boolean;
}

/** A rental as the booking page needs it. */
export interface RentalDetail extends RentalSummary {
  /** Description text as stored. */
  description: string;
  /** The booking form id (the Rentals default form on a seeded site; null → the contact-basics fallback). */
  formId: string | null;
  /** Derived payment option the booking must send. */
  paymentOption: "ONLINE" | "OFFLINE";
  /** True → checkout is always required regardless of price (cancellation-fee policy). */
  cancellationFeeEnabled: boolean;
  scheduleId: string | null;
}

/** A start the customer can pick: a time (hourly) or a day at midnight (daily). */
export interface StartOption {
  /** Identity for React keys: start|location. */
  key: string;
  /** Local wall-clock "YYYY-MM-DDThh:mm:ss" (no Z) in the response's time zone. */
  startLocal: string;
  /** "YYYY-MM-DD" — for grouping and the daily walk. */
  dayKey: string;
  /** "9:00 AM" for hourly; "Mon, Oct 5" for daily. */
  label: string;
  bookable: boolean;
  location: RentalLocation | null;
  /** The resource this start books (from the slot's available resources); null when the server named none. */
  resource: { id: string; name: string } | null;
  scheduleId: string | null;
}

/** A length the customer can pick for the chosen start. */
export interface EndOption {
  /** Local wall-clock end; for a daily rental midnight on the day AFTER the last day. */
  endLocal: string;
  /** Length in the rental's unit (hours may be fractional). */
  units: number;
  /** "2 hours" / "3 days" / "Until Fri, Oct 9". */
  label: string;
}

/** The server's price for a chosen start and length. */
export interface RentalQuote {
  /** Formatted total ("" when the currency is unknown). */
  total: string;
  totalAmount: number;
  units: number;
  unit: RentalUnit;
}

/** A booking-form field (flat; values are keyed by `target`). */
export interface RentalFormField {
  target: string;
  label: string;
  type: "STRING" | "EMAIL" | "PHONE" | "NUMBER" | "URL";
  options?: string[];
  required: boolean;
}

/** The outcome of rent(): either the browser is being redirected, or it's done. */
export type RentalResult =
  | { kind: "redirect"; url: string }
  | { kind: "confirmed"; bookingId: string; orderId: string | null };
