// Availability, the calendar reads (sessions, offered days, course seats), add-ons, settings, the
// booking form, and the createBooking → Cart V2 → checkout-or-place sequence over REST — the twin of
// app/wix/bookings/booking.ts. Same exports, same DTOs; every body comes from booking-core (the SAME
// file the SDK transport uses, deployed flat next to this one), so this file is only the transport:
// literal paths, one fetch per step. Failures are loud where a visitor acts (booking): a taken slot,
// a refused cart, a checkout that won't start all throw — surface the message. Reads that only
// inform (settings, sessions, offered days, add-ons) fall back to an empty default.
// All calls run with the visitor token: the booking and its cart are the token's (see ./client).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-event-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/query-events.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/list-add-on-groups-by-service-id.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form-summary.md
import { wixRequest } from "./client.js";
import { DEFAULT_BOOKINGS_SETTINGS, toBookingsSettings } from "./services-core.js";
import {
  FALLBACK_FIELDS,
  addOnGroupsRequest,
  appointmentSlotsRequest,
  bookingCartRequest,
  bookingIdOf,
  bookingOptions,
  bookingRequest,
  cartIdOf,
  checkoutRedirectRequest,
  checkoutRequired,
  classSlotsRequest,
  clampNextAvailable,
  confirmedResult,
  contactOf,
  courseAvailabilityOf,
  defaultTimeZone,
  masterEventsRequest,
  nextAvailableRequest,
  nextEventsCursor,
  nextSlotsCursor,
  offeredDaysByScheduleId,
  resolveDisplayTimeZone,
  sessionsRequest,
  toAddOnGroups,
  toFormFields,
  toLocalDateString,
  toSession,
  toSlotsPage,
  type BookingOptions,
  type NextAvailableOptions,
  type Raw,
  type SlotsWindow,
} from "./booking-core.js";
import type { AddOnGroup, BookingFormField, BookingResult, BookingsSettings, CourseAvailability, ServiceDetail, Session, Slot, SlotsPage, Weekday } from "./types.js";

export { resolveDisplayTimeZone, toLocalDateString };

// The two time-slot endpoints. APPOINTMENT pages on `cursorPagingMetadata`, CLASS on `pagingMetadata`.
//   POST /service-availability/v2/time-slots        { serviceId, fromLocalDate, toLocalDate, timeZone?, bookable, cursorPaging, includeResourceTypeIds, resourceTypes? }
//   POST /service-availability/v2/time-slots/event  { serviceIds, fromLocalDate, toLocalDate, timeZone?, includeNonBookable, cursorPaging, eventFilter? }
const listSlots = (type: string, body: Raw): Promise<Raw> =>
  wixRequest<Raw>(type === "CLASS" ? "/service-availability/v2/time-slots/event" : "/service-availability/v2/time-slots", { body });

/**
 * Every slot for a service in [start of `from`'s day, +days) — APPOINTMENT and CLASS use different
 * endpoints; this branches and follows the cursor until the week is complete. Same-time slots across
 * staff are merged; full class sessions come back with `bookable: false`. `timeZone` undefined → the
 * business zone (the response says which zone the local times are in). COURSE has no slots ([]).
 */
export async function fetchSlots(service: Pick<ServiceDetail, "id" | "type">, window: SlotsWindow = {}): Promise<SlotsPage> {
  if (service.type === "COURSE") return { slots: [], timeZone: window.timeZone ?? null };
  const raws: Raw[] = [];
  let timeZone: string | null = null;
  let cursor: string | undefined;
  do {
    const body = service.type === "CLASS" ? classSlotsRequest(service.id, { ...window, cursor }) : appointmentSlotsRequest(service.id, { ...window, cursor });
    const res = await listSlots(service.type, body);
    raws.push(...((res?.timeSlots ?? []) as Raw[]));
    timeZone ??= res?.timeZone ?? null;
    cursor = nextSlotsCursor(res) ?? undefined;
  } while (cursor);
  return toSlotsPage(raws, timeZone);
}

/**
 * The next few bookable times (default 3, clamped 1..6) scanning from today to the end of the month
 * six months out — what an empty week points at. Not meaningful for VARIED pricing, add-ons, or a
 * course (`showsNextAvailability`); those return []. Same two endpoints as fetchSlots.
 */
export async function fetchNextAvailableSlots(service: Pick<ServiceDetail, "id" | "type">, options: NextAvailableOptions = {}): Promise<SlotsPage> {
  if (service.type === "COURSE") return { slots: [], timeZone: null };
  const res = await listSlots(service.type, nextAvailableRequest(service, options));
  const page = toSlotsPage((res?.timeSlots ?? []) as Raw[], res?.timeZone);
  return { ...page, slots: page.slots.slice(0, clampNextAvailable(options.limit)) };
}

/**
 * Which zone the site shows times in and whether visitors may switch. Never rejects: Wix's default
 * (business zone) on failure. The path is the one the @wix/bookings SDK resolves for
 * `bookingsSettings.getBookingsSettings()` (no public reference page yet).
 *   GET /_api/bookings-settings/v2/settings  → { bookingsSettings: { displayTimeZone: { basedOn, customerCanChange } } }
 */
export async function fetchBookingsSettings(): Promise<BookingsSettings> {
  try {
    return toBookingsSettings(await wixRequest<Raw>("/_api/bookings-settings/v2/settings", { method: "GET" }));
  } catch {
    return DEFAULT_BOOKINGS_SETTINGS;
  }
}

/**
 * The service's add-on groups with their add-ons (prices formatted). Non-fatal (empty on failure).
 *   POST /bookings/v2/services/add-on-groups/list-add-on-groups-by-service-id  { serviceId }  → { addOnGroupsDetails }
 */
export async function fetchAddOnGroups(serviceId: string): Promise<AddOnGroup[]> {
  try {
    return toAddOnGroups(await wixRequest<Raw>("/bookings/v2/services/add-on-groups/list-add-on-groups-by-service-id", { body: addOnGroupsRequest(serviceId) }));
  } catch {
    return [];
  }
}

// The Calendar Events query: sessions (INSTANCE events of one schedule) and recurring MASTER events.
//   POST /calendar/v3/events/query  { query: { filter, cursorPaging }, fromLocalDate, timeZone?, recurrenceType? }  → { events, pagingMetadata }
const queryEvents = (body: Raw): Promise<Raw> => wixRequest<Raw>("/calendar/v3/events/query", { body });

/**
 * Upcoming sessions of a class or course schedule, oldest first, 7 per page; `nextCursor` fetches the
 * next page. Informational (booking goes through a Slot or the course itself). Non-fatal.
 */
export async function fetchSessions(scheduleId: string, options: { limit?: number; cursor?: string; timeZone?: string } = {}): Promise<{ sessions: Session[]; nextCursor: string | null }> {
  try {
    const res = await queryEvents(sessionsRequest(scheduleId, options));
    return { sessions: ((res?.events ?? []) as Raw[]).map(toSession), nextCursor: nextEventsCursor(res) };
  } catch {
    return { sessions: [], nextCursor: null };
  }
}

async function queryMasterEvents(scheduleIds: string[], timeZone?: string): Promise<Raw[]> {
  if (!scheduleIds.length) return [];
  try {
    return ((await queryEvents(masterEventsRequest(scheduleIds, timeZone)))?.events ?? []) as Raw[];
  } catch {
    return [];
  }
}

/** The weekdays each class/course schedule meets on — ONE batched call for a whole listing page. Non-fatal ({}). */
export async function fetchOfferedDays(scheduleIds: string[], timeZone?: string): Promise<Record<string, Weekday[]>> {
  return offeredDaysByScheduleId(await queryMasterEvents(scheduleIds, timeZone));
}

/** A COURSE's seats (total, left, full) from its recurring sessions; null once ended or without sessions. Non-fatal. */
export async function fetchCourseAvailability(service: Pick<ServiceDetail, "scheduleId" | "course">, timeZone?: string): Promise<CourseAvailability | null> {
  if (!service.scheduleId) return null;
  return courseAvailabilityOf(await queryMasterEvents([service.scheduleId], timeZone), service.course?.ended ?? true);
}

/**
 * The service's booking-form fields, flat and render-ready (values keyed by `target`). ALWAYS a
 * non-empty list — contact basics when the schema is missing/unusable — so the form renders
 * unconditionally.  GET /form-schema-service/v4/forms/{formId}/summary (labels, types) and
 * GET /form-schema-service/v4/forms/{formId} (which fields are required — the summary doesn't say).
 */
export async function fetchBookingForm(formId: string | null): Promise<BookingFormField[]> {
  if (!formId) return FALLBACK_FIELDS;
  try {
    const id = encodeURIComponent(formId);
    const [res, form] = await Promise.all([
      wixRequest<Raw>(`/form-schema-service/v4/forms/${id}/summary`, { method: "GET" }),
      wixRequest<Raw>(`/form-schema-service/v4/forms/${id}`, { method: "GET" }).catch(() => null),
    ]);
    return toFormFields(res?.formSummary, form?.form);
  } catch {
    return FALLBACK_FIELDS;
  }
}

/**
 * Book a slot (or, for a COURSE, the whole course — pass `slot: null`): createBooking → createCart
 * (holds the seat, carries the contact and location) → calculateCart → hosted checkout (paid) or
 * placeOrder (free / pay-in-person, decided from the calculated cart). Call from the browser.
 * `formValues` is the object your inputs wrote, keyed by field `target` — passed as the
 * formSubmission DIRECTLY. Throws with the refusal (slot taken, invalid form) — surface it, don't
 * swallow it. `origin` is the site's real https origin as registered on the OAuth app's allowed
 * domains (browser: window.location.origin).
 *   POST /bookings/v2/bookings            { booking, participantNotification, sendSmsReminder, formSubmission }
 *   POST /ecom/v2/carts                   { catalogItems: [{ quantity: 1, catalogReference: { catalogItemId: <bookingId>, appId } }], cart: { source, businessInfo?, customerInfo? } }
 *   POST /ecom/v2/carts/{cartId}/calculate {}
 *   POST /headless/v1/redirect-session    { ecomCheckout: { checkoutId: <cartId> }, callbacks: { postFlowUrl } }
 *   POST /ecom/v2/carts/{cartId}/place-order {}
 */
export async function bookService(
  service: ServiceDetail,
  slot: Slot | null,
  formValues: Record<string, unknown>,
  {
    staffId,
    timeZone = defaultTimeZone(),
    participants,
    depositSelected,
    origin = typeof window !== "undefined" ? window.location.origin : "",
  }: Omit<BookingOptions, "idKey"> & { origin?: string } = {},
): Promise<BookingResult> {
  const created = await wixRequest<Raw>("/bookings/v2/bookings", {
    body: { booking: bookingRequest(service, slot, { staffId, timeZone, participants, depositSelected, idKey: "id" }), ...bookingOptions(formValues) },
  });
  const bookingId = bookingIdOf(created);
  if (!bookingId) throw new Error("The booking couldn't be created — the slot may have just been taken.");

  const newCart = await wixRequest<Raw>("/ecom/v2/carts", {
    body: bookingCartRequest([bookingId], contactOf(created), slot?.location?.type === "BUSINESS" ? slot.location.id : null),
  });
  const cartId = cartIdOf(newCart);
  if (!cartId) throw new Error("The booking couldn't be reserved — please try again.");

  const calc = await wixRequest<Raw>(`/ecom/v2/carts/${cartId}/calculate`, { body: {} });
  if (checkoutRequired(service, calc)) {
    const session = await wixRequest<Raw>("/headless/v1/redirect-session", { body: checkoutRedirectRequest(cartId, origin) });
    const url = session?.redirectSession?.fullUrl;
    if (!url) throw new Error("Checkout couldn't start — please try again.");
    return { kind: "redirect", url };
  }

  const order = await wixRequest<Raw>(`/ecom/v2/carts/${cartId}/place-order`, { body: {} });
  return confirmedResult(bookingId, order);
}
