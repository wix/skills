// Bookings DTOs — the serializable shapes every hook, component, and page consumes.
// Plain JSON: safe as Astro island props or across server/client boundaries. Images are
// resolved https URLs; every displayable price is a ready formatted string ("" when the
// site sent no currency — the surface omits it, never guesses one).

/** The three Wix Bookings service types. Anything else never becomes a DTO. */
export type ServiceType = "APPOINTMENT" | "CLASS" | "COURSE";

/** How the service is priced (Services V2 `payment.rateType`). */
export type RateType = "FIXED" | "VARIED" | "CUSTOM" | "NO_FEE" | "SUBSCRIPTION";

/** What the one CTA does: book now, send a request the owner approves, or (a full/ended course) only view. */
export type CtaState = "book" | "requestToBook" | "viewCourse";

export type Weekday = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";

/** Where a service (or one slot) takes place. BUSINESS locations have an id; CUSTOM/CUSTOMER don't. */
export interface ServiceLocation {
  id: string | null;
  name: string;
  type: "BUSINESS" | "CUSTOM" | "CUSTOMER";
}

/** A staff member as the service lists them; `id` is the resource GUID used for filtering and booking. */
export interface StaffSummary {
  id: string;
  name: string;
  /** Resolved https URL ("" when the staff member has no photo). */
  imageUrl: string;
}

/** Deposit terms when the service takes one; null otherwise. */
export interface Deposit {
  /** Formatted deposit amount ("" when the deposit is a percentage — the server resolves it at booking). */
  amount: string;
  /** True when the visitor may choose to pay the full price upfront instead. */
  fullUpfrontAllowed: boolean;
}

/** A service as a listing/grid tile needs it. */
export interface ServiceSummary {
  id: string;
  slug: string;
  name: string;
  tagLine: string;
  type: ServiceType;
  rateType: RateType;
  /**
   * Display-ready price: FIXED → "€75"; VARIED → the lowest price (render "From €30", see `priceFrom`);
   * CUSTOM → the owner's text ("Ask for a quote"); NO_FEE → "Free"; "" when nothing can be shown.
   */
  price: string;
  /** True for VARIED pricing — `price` is the minimum, prefix it ("From €30"). */
  priceFrom: boolean;
  /** The pre-discount price when a discount applies to a FIXED price ("" otherwise) — render struck through. */
  basePrice: string;
  /** The discount's name when one applies ("" otherwise). */
  discountName: string;
  /** True when a discount applies but the amount is only known at checkout (VARIED, add-ons). */
  calculatedAtCheckout: boolean;
  /** True when the service can be paid with a pricing plan / membership. */
  hasPricingPlans: boolean;
  /** NO_FEE (or a FIXED price of 0): books without a checkout. */
  free: boolean;
  /** Session length in minutes (appointments; classes and courses may have none). */
  durationMinutes: number | null;
  /** "1 hr 30 min" / "45 min" ("" when unknown). */
  durationLabel: string;
  /** Resolved https URL ("" when the service has no image). */
  imageUrl: string;
  categoryId: string | null;
  categoryName: string;
  /** The service's schedule id — classes/courses hang their sessions on it; a COURSE books this whole schedule. */
  scheduleId: string | null;
  staff: StaffSummary[];
  locations: ServiceLocation[];
  /** Sessions carry a video-conference link. */
  conferencing: boolean;
  /** The service offers add-ons (next-availability is not shown for these; the add-ons load on the booking page). */
  hasAddOns: boolean;
  /** The owner approves each booking by hand: the CTA is "Request to book", and success is a sent request. */
  requiresManualApproval: boolean;
  onlineBookingEnabled: boolean;
  /** Late/after-start booking policy already forbids booking (courses: the course started or ended). */
  tooLateToBook: boolean;
  /** CTA state from the policy alone; a course's fullness is folded in by the booking flow (`ctaState` there). */
  ctaState: CtaState;
  /** Seats per session (classes/courses) — 1 for appointments; null when unknown. */
  defaultCapacity: number | null;
  /** Policy cap on participants per booking; null when the policy sets none. */
  maxParticipantsPerBooking: number | null;
  deposit: Deposit | null;
  /** Weekly days a class/course meets (from its recurring sessions) — filled by the listing store, [] until then. */
  offeredDays: Weekday[];
}

/** The fixed span of a COURSE (its sessions' first start and last end). */
export interface CourseSpan {
  /** ISO instants; null when the course has no sessions yet. */
  startDate: string | null;
  endDate: string | null;
  /** True once the last session is over (or none exists) — the course can't be booked. */
  ended: boolean;
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
  /** COURSE only; null for appointments and classes. */
  course: CourseSpan | null;
}

export interface BookingCategory {
  id: string;
  name: string;
}

/** A business location that hosts at least one bookable service (a listing filter option). */
export interface LocationOption {
  id: string;
  name: string;
}

/** Bookings settings the visitor-facing surfaces need. */
export interface BookingsSettings {
  /** Which zone times are shown in by default: the business's (the Wix default) or the visitor's. */
  displayTimeZone: "BUSINESS" | "CUSTOMER";
  /** The owner lets visitors switch between the two. */
  customerCanChange: boolean;
}

/** One time slot, appointment or class session. */
export interface Slot {
  /** Identity: start|end|location — two staff at the same time are ONE slot; React keys go here. */
  key: string;
  /** Local wall-clock strings "YYYY-MM-DDThh:mm:ss" (no Z) in the response's `timeZone`. */
  startLocal: string;
  endLocal: string;
  /** "YYYY-MM-DD" — for grouping slots by day. */
  dayKey: string;
  /** Display label, e.g. "9:00 AM". */
  label: string;
  /** False for a full class session or a policy-blocked time — render disabled ("Full"). */
  bookable: boolean;
  /** Seats: total and left (classes); null for appointments. */
  totalCapacity: number | null;
  remainingCapacity: number | null;
  /** Waitlist seats left when the class has a waitlist and the session is full; null otherwise. */
  waitlistCapacity: number | null;
  /** APPOINTMENT slots carry their own scheduleId; CLASS slots carry an eventId (+ title) instead. */
  scheduleId: string | null;
  eventId: string | null;
  eventTitle: string;
  location: ServiceLocation | null;
  /** Staff able to take this slot (may be empty — ANY_RESOURCE still books). */
  staff: { id: string; name: string }[];
}

/** A window of slots plus the IANA zone their local times are expressed in. */
export interface SlotsPage {
  slots: Slot[];
  /** The zone the server computed in — the one requested, or the business zone when none was sent. */
  timeZone: string | null;
}

/** One upcoming session of a class or course (informational — booking goes through a Slot / the course). */
export interface Session {
  id: string;
  title: string;
  startLocal: string;
  endLocal: string;
  dayKey: string;
  /** "Mon, Sep 7 · 9:00 AM" style label pieces: the day and the start time. */
  dayLabel: string;
  label: string;
  durationMinutes: number;
  staff: { id: string; name: string }[];
  totalCapacity: number | null;
  spotsLeft: number | null;
  isFullyBooked: boolean;
  isCancelled: boolean;
}

/** Seats on a COURSE, from its recurring sessions; null once the course has ended or has no sessions. */
export interface CourseAvailability {
  totalCapacity: number | null;
  spotsLeft: number | null;
  full: boolean;
}

/** An optional extra the visitor can add to a booking. */
export interface AddOn {
  id: string;
  name: string;
  /** Formatted price ("" when the add-on is free or the currency is unknown). */
  price: string;
  /** The same amount as a number (0 when none) with its currency — for totals; never render these. */
  priceAmount: number;
  currency: string;
  /** Extra minutes the add-on adds to the session; null for quantity-based add-ons. */
  durationMinutes: number | null;
  /** Max units of this add-on per booking; null when it is a one-off (0/1). */
  maxQuantity: number | null;
}

export interface AddOnGroup {
  id: string;
  name: string;
  /** The owner's question for this group ("Add a scalp massage?"). */
  prompt: string;
  /** Max distinct add-ons the visitor may pick from this group; null = unlimited. */
  maxSelectable: number | null;
  addOns: AddOn[];
}

/** A booking-form field (flat, from the form summary + schema; values are keyed by `target`). */
export interface BookingFormField {
  target: string;
  label: string;
  type: "STRING" | "EMAIL" | "PHONE" | "NUMBER" | "URL";
  options?: string[];
  /** The form marks it required — the only fields that gate `canBook`; the rest may stay empty. */
  required: boolean;
}

/** The outcome of book(): either the browser is being redirected, or it's done. */
export type BookingResult =
  | { kind: "redirect"; url: string }
  | { kind: "confirmed"; bookingId: string; orderId: string | null };
