// Availability, the booking form, and the createBooking → Cart V2 → checkout-or-place sequence over
// REST — the twin of app/wix/bookings/booking.ts. Same exports, same DTOs; every body comes from
// booking-core (the SAME file the SDK transport uses, deployed flat next to this one), so this file
// is only the transport: literal paths, one fetch per step. Failures are loud: a taken slot, a
// refused cart, a checkout that won't start all throw — surface the message to the visitor.
// All calls run with the visitor token: the booking and its cart are the token's (see ./client).
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-event-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form-summary.md
import { wixRequest } from "./client.js";
import {
  FALLBACK_FIELDS,
  appointmentSlotsRequest,
  bookingCartRequest,
  bookingIdOf,
  bookingRequest,
  cartIdOf,
  cartTotal,
  checkoutRedirectRequest,
  checkoutRequired,
  classSlotsRequest,
  confirmedResult,
  defaultTimeZone,
  toFormFields,
  toLocalDateString,
  toSlot,
  type Raw,
  type SlotsWindow,
} from "./booking-core.js";
import type { BookingFormField, BookingResult, ServiceDetail, Slot } from "./types.js";

export { toLocalDateString };

/**
 * Bookable slots for a service in [from, from + days) — APPOINTMENT and CLASS use different APIs;
 * this branches for you. Dates are local wall-clock; timeZone defaults to the visitor's.
 * APPOINTMENT: POST /service-availability/v2/time-slots  { serviceId, fromLocalDate, toLocalDate, timeZone, bookable, cursorPaging, includeResourceTypeIds, resourceTypes? }
 * CLASS:       POST /service-availability/v2/time-slots/event  { serviceIds, fromLocalDate, toLocalDate, timeZone, includeNonBookable, eventFilter? }
 */
export async function fetchSlots(service: Pick<ServiceDetail, "id" | "type">, window: SlotsWindow = {}): Promise<Slot[]> {
  const res =
    service.type === "CLASS"
      ? await wixRequest<Raw>("/service-availability/v2/time-slots/event", { body: classSlotsRequest(service.id, window) })
      : await wixRequest<Raw>("/service-availability/v2/time-slots", { body: appointmentSlotsRequest(service.id, window) });
  return ((res?.timeSlots ?? []) as Raw[]).map(toSlot);
}

/**
 * The service's booking-form fields, flat and render-ready (values keyed by `target`). ALWAYS a
 * non-empty list — contact basics when the schema is missing/unusable — so the form renders
 * unconditionally.  GET /form-schema-service/v4/forms/{formId}/summary
 */
export async function fetchBookingForm(formId: string | null): Promise<BookingFormField[]> {
  if (!formId) return FALLBACK_FIELDS;
  try {
    const res = await wixRequest<Raw>(`/form-schema-service/v4/forms/${encodeURIComponent(formId)}/summary`, { method: "GET" });
    return toFormFields(res?.formSummary);
  } catch {
    return FALLBACK_FIELDS;
  }
}

/**
 * Book a slot: createBooking → createCart (holds the seat) → calculateCart → hosted checkout (paid)
 * or placeOrder (free / pay-in-person). Call from the browser. `formValues` is the object your
 * inputs wrote, keyed by field `target` — passed as the formSubmission DIRECTLY. Throws with the
 * refusal (slot taken, invalid form) — surface it, don't swallow it. `origin` is the site's real
 * https origin as registered on the OAuth app's allowed domains (browser: window.location.origin).
 *   POST /bookings/v2/bookings            { booking, formSubmission }
 *   POST /ecom/v2/carts                   { catalogItems: [{ quantity: 1, catalogReference: { catalogItemId: <bookingId>, appId } }], cart: { source: { channelType: "WEB" } } }
 *   POST /ecom/v2/carts/{cartId}/calculate {}
 *   POST /headless/v1/redirect-session    { ecomCheckout: { checkoutId: <cartId> }, callbacks: { postFlowUrl } }
 *   POST /ecom/v2/carts/{cartId}/place-order {}
 */
export async function bookService(
  service: ServiceDetail,
  slot: Slot,
  formValues: Record<string, unknown>,
  {
    staffId,
    timeZone = defaultTimeZone(),
    origin = typeof window !== "undefined" ? window.location.origin : "",
  }: { staffId?: string; timeZone?: string; origin?: string } = {},
): Promise<BookingResult> {
  const created = await wixRequest<Raw>("/bookings/v2/bookings", {
    body: { booking: bookingRequest(service, slot, { staffId, timeZone, idKey: "id" }), formSubmission: formValues },
  });
  const bookingId = bookingIdOf(created);
  if (!bookingId) throw new Error("The booking couldn't be created — the slot may have just been taken.");

  const newCart = await wixRequest<Raw>("/ecom/v2/carts", { body: bookingCartRequest(bookingId) });
  const cartId = cartIdOf(newCart);
  if (!cartId) throw new Error("The booking couldn't be reserved — please try again.");

  const calc = await wixRequest<Raw>(`/ecom/v2/carts/${cartId}/calculate`, { body: {} });
  if (checkoutRequired(service, cartTotal(calc))) {
    const session = await wixRequest<Raw>("/headless/v1/redirect-session", { body: checkoutRedirectRequest(cartId, origin) });
    const url = session?.redirectSession?.fullUrl;
    if (!url) throw new Error("Checkout couldn't start — please try again.");
    return { kind: "redirect", url };
  }

  const order = await wixRequest<Raw>(`/ecom/v2/carts/${cartId}/place-order`, { body: {} });
  return confirmedResult(bookingId, order);
}
