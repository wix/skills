// Availability, the booking form, and the createBooking → Cart V2 → checkout-or-place sequence
// over the SDK. The payload shapes are exact and easy to get subtly wrong — they are built in
// ./booking-core (shared with the REST twin in references/bookings/rest/); this file is the
// transport only. Copy as-is; extend by calling these exports, never by editing them. Failures
// are loud.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-event-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/create-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/calculate-cart.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart-v2/place-order.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form-summary.md
import { availabilityTimeSlots, eventTimeSlots, bookings as bookingsModule } from "@wix/bookings";
import { createCart, calculateCart, placeOrder } from "@wix/auto_sdk_ecom_cart-v-2";
import { redirects as redirectsModule } from "@wix/redirects";
import { forms as formsModule } from "@wix/forms";
import { wixModule } from "../sdk";
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
} from "./booking-core";
import type { BookingFormField, BookingResult, ServiceDetail, Slot } from "./types";

export { toLocalDateString };

const apptSlots = wixModule(availabilityTimeSlots);
const classSlots = wixModule(eventTimeSlots);
const bookings = wixModule(bookingsModule);
const cart = wixModule({ createCart, calculateCart, placeOrder });
const redirects = wixModule(redirectsModule);
const forms = wixModule(formsModule);

/**
 * Bookable slots for a service in [from, from + days) — APPOINTMENT and CLASS use different APIs;
 * this branches for you. Dates are local wall-clock; timeZone defaults to the visitor's.
 */
export async function fetchSlots(service: Pick<ServiceDetail, "id" | "type">, window: SlotsWindow = {}): Promise<Slot[]> {
  const res: Raw =
    service.type === "CLASS"
      ? await classSlots.listEventTimeSlots(classSlotsRequest(service.id, window) as any)
      : await apptSlots.listAvailabilityTimeSlots(appointmentSlotsRequest(service.id, window) as any);
  return ((res.timeSlots ?? []) as Raw[]).map(toSlot);
}

/**
 * The service's booking-form fields, flat and render-ready (values are keyed by `target`).
 * ALWAYS returns a non-empty list — contact basics when the schema is missing/unusable —
 * so the form can render unconditionally.
 */
export async function fetchBookingForm(formId: string | null): Promise<BookingFormField[]> {
  if (!formId) return FALLBACK_FIELDS;
  try {
    // The summary has labels and types; only the full schema says which fields are required.
    const [res, form] = await Promise.all([
      forms.getFormSummary(formId) as Promise<Raw>,
      (forms.getForm(formId) as Promise<Raw>).catch(() => null),
    ]);
    return toFormFields(res.formSummary, form);
  } catch {
    return FALLBACK_FIELDS;
  }
}

/**
 * Book a slot: createBooking → createCart (holds the seat) → calculateCart →
 * hosted checkout (paid) or placeOrder (free / pay-in-person). Call from the browser.
 * `formValues` is the object your inputs wrote, keyed by field `target` — passed as the
 * formSubmission DIRECTLY. Throws with a friendly message on refusal (slot taken, invalid
 * form) — surface it, don't swallow it.
 */
export async function bookService(
  service: ServiceDetail,
  slot: Slot,
  formValues: Record<string, unknown>,
  { staffId, timeZone = defaultTimeZone() }: { staffId?: string; timeZone?: string } = {},
): Promise<BookingResult> {
  const created: Raw = await bookings.createBooking(
    bookingRequest(service, slot, { staffId, timeZone, idKey: "_id" }) as any,
    { formSubmission: formValues } as any,
  );
  const bookingId = bookingIdOf(created);
  if (!bookingId) throw new Error("The booking couldn't be created — the slot may have just been taken.");

  const newCart: Raw = await cart.createCart(bookingCartRequest(bookingId) as any);
  const cartId = cartIdOf(newCart);
  if (!cartId) throw new Error("The booking couldn't be reserved — please try again.");

  const calc: Raw = await cart.calculateCart(cartId);
  if (checkoutRequired(service, cartTotal(calc))) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const session: Raw = await redirects.createRedirectSession(checkoutRedirectRequest(cartId, origin));
    const url = session?.redirectSession?.fullUrl;
    if (!url) throw new Error("Checkout couldn't start — please try again.");
    return { kind: "redirect", url };
  }

  const order: Raw = await cart.placeOrder(cartId);
  return confirmedResult(bookingId, order);
}
