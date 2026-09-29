// Availability, the calendar reads (sessions, offered days, course seats), add-ons, settings, the
// booking form, and the createBooking → Cart V2 → checkout-or-place sequence over the SDK. The
// payload shapes are exact and easy to get subtly wrong — they are built in ./booking-core (shared
// with the REST twin in templates/bookings/rest/); this file is the transport only. Copy as-is;
// extend by calling these exports, never by editing them. Failures are loud where a visitor acts
// (booking), silent-with-a-default where they only inform (settings, sessions, offered days).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-event-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-management/calendar/events-v3/query-events.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/list-add-on-groups-by-service-id.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/calculate-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/place-order.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form-summary.md
import { availabilityTimeSlots, eventTimeSlots, bookings as bookingsModule, bookingsSettings as settingsModule, services as servicesModule } from "@wix/bookings";
import { createCart, calculateCart, placeOrder } from "@wix/auto_sdk_ecom_cart-v-2";
import { redirects as redirectsModule } from "@wix/redirects";
import { wixFetch, wixModule } from "../sdk";
import { DEFAULT_BOOKINGS_SETTINGS, toBookingsSettings } from "./services-core";
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
} from "./booking-core";
import type { AddOnGroup, BookingFormField, BookingResult, BookingsSettings, CourseAvailability, ServiceDetail, Session, Slot, SlotsPage, Weekday } from "./types";

export { resolveDisplayTimeZone, toLocalDateString };

const apptSlots = wixModule(availabilityTimeSlots);
const classSlots = wixModule(eventTimeSlots);
const bookings = wixModule(bookingsModule);
const settings = wixModule(settingsModule);
const services = wixModule(servicesModule);
const cart = wixModule({ createCart, calculateCart, placeOrder });
const redirects = wixModule(redirectsModule);

/** A POST to a Wix REST endpoint whose SDK module isn't bundled (the Calendar events module); throws on a non-2xx. */
async function postJson(path: string, body: Raw): Promise<Raw> {
  const r = await wixFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} failed (${r.status}).`);
  return (await r.json()) as Raw;
}

/**
 * Every slot for a service in [start of `from`'s day, +days) — APPOINTMENT and CLASS use different
 * APIs; this branches and follows the cursor until the week is complete. Same-time slots across staff
 * are merged; full class sessions come back with `bookable: false`. `timeZone` undefined → the
 * business zone (the response says which zone the local times are in). COURSE has no slots ([]).
 */
export async function fetchSlots(service: Pick<ServiceDetail, "id" | "type">, window: SlotsWindow = {}): Promise<SlotsPage> {
  if (service.type === "COURSE") return { slots: [], timeZone: window.timeZone ?? null };
  const raws: Raw[] = [];
  let timeZone: string | null = null;
  let cursor: string | undefined;
  do {
    const res: Raw =
      service.type === "CLASS"
        ? await classSlots.listEventTimeSlots(classSlotsRequest(service.id, { ...window, cursor }) as any)
        : await apptSlots.listAvailabilityTimeSlots(appointmentSlotsRequest(service.id, { ...window, cursor }) as any);
    raws.push(...((res.timeSlots ?? []) as Raw[]));
    timeZone ??= res.timeZone ?? null;
    cursor = nextSlotsCursor(res) ?? undefined;
  } while (cursor);
  return toSlotsPage(raws, timeZone);
}

/**
 * The next few bookable times (default 3, clamped 1..6) scanning from today to the end of the month
 * six months out — what an empty week points at. Not meaningful for VARIED pricing, add-ons, or a
 * course (`showsNextAvailability`); those return [].
 */
export async function fetchNextAvailableSlots(service: Pick<ServiceDetail, "id" | "type">, options: NextAvailableOptions = {}): Promise<SlotsPage> {
  if (service.type === "COURSE") return { slots: [], timeZone: null };
  const body = nextAvailableRequest(service, options);
  const res: Raw = service.type === "CLASS" ? await classSlots.listEventTimeSlots(body as any) : await apptSlots.listAvailabilityTimeSlots(body as any);
  const page = toSlotsPage((res.timeSlots ?? []) as Raw[], res.timeZone);
  return { ...page, slots: page.slots.slice(0, clampNextAvailable(options.limit)) };
}

/** Which zone the site shows times in and whether visitors may switch. Never rejects: Wix's default (business zone) on failure. */
export async function fetchBookingsSettings(): Promise<BookingsSettings> {
  try {
    return toBookingsSettings((await settings.getBookingsSettings()) as Raw);
  } catch {
    return DEFAULT_BOOKINGS_SETTINGS;
  }
}

/** The service's add-on groups with their add-ons (prices formatted). Non-fatal (empty on failure). */
export async function fetchAddOnGroups(serviceId: string): Promise<AddOnGroup[]> {
  try {
    // The SDK takes the id positionally; REST sends addOnGroupsRequest(serviceId) as the body.
    const res: Raw = await services.listAddOnGroupsByServiceId(addOnGroupsRequest(serviceId).serviceId);
    return toAddOnGroups(res);
  } catch {
    return [];
  }
}

/**
 * Upcoming sessions of a class or course schedule, oldest first, 7 per page; `nextCursor` fetches the
 * next page. Informational (booking goes through a Slot or the course itself). Non-fatal.
 */
export async function fetchSessions(scheduleId: string, options: { limit?: number; cursor?: string; timeZone?: string } = {}): Promise<{ sessions: Session[]; nextCursor: string | null }> {
  try {
    const res = await postJson("/calendar/v3/events/query", sessionsRequest(scheduleId, options));
    return { sessions: ((res.events ?? []) as Raw[]).map(toSession), nextCursor: nextEventsCursor(res) };
  } catch {
    return { sessions: [], nextCursor: null };
  }
}

async function queryMasterEvents(scheduleIds: string[], timeZone?: string): Promise<Raw[]> {
  if (!scheduleIds.length) return [];
  try {
    return ((await postJson("/calendar/v3/events/query", masterEventsRequest(scheduleIds, timeZone))).events ?? []) as Raw[];
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
 * The service's booking-form fields, flat and render-ready (values are keyed by `target`).
 * ALWAYS returns a non-empty list — contact basics when the schema is missing/unusable —
 * so the form can render unconditionally.
 */
export async function fetchBookingForm(formId: string | null): Promise<BookingFormField[]> {
  if (!formId) return FALLBACK_FIELDS;
  try {
    // Over wixFetch, not the @wix/forms `forms` module: that generated module is 15 MB and would
    // ride into the booking island's client chunk (11 MB per visitor). The summary has labels and
    // types; only the full schema says which fields are required.
    const id = encodeURIComponent(formId);
    const json = async (path: string): Promise<Raw | null> => {
      const r = await wixFetch(path);
      return r.ok ? ((await r.json()) as Raw) : null;
    };
    const [res, form] = await Promise.all([
      json(`/form-schema-service/v4/forms/${id}/summary`),
      json(`/form-schema-service/v4/forms/${id}`).catch(() => null),
    ]);
    if (!res) return FALLBACK_FIELDS;
    return toFormFields(res.formSummary, form?.form);
  } catch {
    return FALLBACK_FIELDS;
  }
}

/**
 * Book a slot (or, for a COURSE, the whole course — pass `slot: null`): createBooking → createCart
 * (holds the seat, carries the contact and location) → calculateCart → hosted checkout (paid) or
 * placeOrder (free / pay-in-person, decided from the calculated cart). Call from the browser.
 * `formValues` is the object your inputs wrote, keyed by field `target` — passed as the
 * formSubmission DIRECTLY. Throws with a friendly message on refusal (slot taken, invalid form) —
 * surface it, don't swallow it.
 */
export async function bookService(
  service: ServiceDetail,
  slot: Slot | null,
  formValues: Record<string, unknown>,
  { staffId, timeZone = defaultTimeZone(), participants, depositSelected }: Omit<BookingOptions, "idKey"> = {},
): Promise<BookingResult> {
  const created: Raw = await bookings.createBooking(
    bookingRequest(service, slot, { staffId, timeZone, participants, depositSelected, idKey: "_id" }) as any,
    bookingOptions(formValues) as any,
  );
  const bookingId = bookingIdOf(created);
  if (!bookingId) throw new Error("The booking couldn't be created — the slot may have just been taken.");

  const newCart: Raw = await cart.createCart(bookingCartRequest([bookingId], contactOf(created), slot?.location?.type === "BUSINESS" ? slot.location.id : null) as any);
  const cartId = cartIdOf(newCart);
  if (!cartId) throw new Error("The booking couldn't be reserved — please try again.");

  const calc: Raw = await cart.calculateCart(cartId);
  if (checkoutRequired(service, calc)) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const session: Raw = await redirects.createRedirectSession(checkoutRedirectRequest(cartId, origin));
    const url = session?.redirectSession?.fullUrl;
    if (!url) throw new Error("Checkout couldn't start — please try again.");
    return { kind: "redirect", url };
  }

  const order: Raw = await cart.placeOrder(cartId);
  return confirmedResult(bookingId, order);
}
