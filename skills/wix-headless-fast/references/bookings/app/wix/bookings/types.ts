// Bookings DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. Images are
// resolved https URLs; every displayable price is a ready formatted string.

export type ServiceType = "APPOINTMENT" | "CLASS";

/** A service as a listing/grid tile needs it. */
export interface ServiceSummary {
  id: string;
  slug: string;
  name: string;
  tagLine: string;
  type: ServiceType;
  /** Formatted price (e.g. "€75.00"); "Free" when the service has no fee. */
  price: string;
  free: boolean;
  /** Session length in minutes (appointments; classes may have none). */
  durationMinutes: number | null;
  /** Resolved https URL ("" when the service has no image). */
  imageUrl: string;
  categoryId: string | null;
  /** Bookable staff: id is the resource GUID used for filtering and booking. */
  staff: { id: string; name: string }[];
}

/** A service as the booking page needs it. */
export interface ServiceDetail extends ServiceSummary {
  /** Description HTML/text as stored. */
  description: string;
  /** The @wix/forms booking-form id (null → the contact-basics fallback form). */
  formId: string | null;
  /** Derived payment option the booking must send ("ONLINE" | "OFFLINE"). */
  paymentOption: "ONLINE" | "OFFLINE";
  /** True → checkout is always required regardless of price (cancellation-fee policy). */
  cancellationFeeEnabled: boolean;
}

export interface BookingCategory {
  id: string;
  name: string;
}

/** One bookable time slot, appointment or class. */
export interface Slot {
  /** Local wall-clock strings "YYYY-MM-DDThh:mm:ss" (no Z). */
  startLocal: string;
  endLocal: string;
  /** "YYYY-MM-DD" — for grouping slots by day. */
  dayKey: string;
  /** Display label, e.g. "9:00 AM". */
  label: string;
  /** APPOINTMENT slots carry their own scheduleId; CLASS slots carry an eventId instead. */
  scheduleId: string | null;
  eventId: string | null;
  /** Staff able to take this slot (may be empty — ANY_RESOURCE still books). */
  staff: { id: string; name: string }[];
}

/** A booking-form field (flat, from getFormSummary; values are keyed by `target`). */
export interface BookingFormField {
  target: string;
  label: string;
  type: "STRING" | "EMAIL" | "PHONE" | "NUMBER" | "URL";
  options?: string[];
}

/** The outcome of book(): either the browser is being redirected, or it's done. */
export type BookingResult =
  | { kind: "redirect"; url: string }
  | { kind: "confirmed"; bookingId: string; orderId: string | null };
