// Availability, the booking form, and the createBooking → Cart V2 → checkout-or-place
// sequence. The payload shapes here are exact and easy to get subtly wrong — copy as-is;
// extend by calling these exports, never by editing them. Failures are loud.
import {
  availabilityTimeSlots,
  eventTimeSlots,
  bookings as bookingsModule,
} from "@wix/bookings";
import { createCart, calculateCart, placeOrder } from "@wix/auto_sdk_ecom_cart-v-2";
import { redirects as redirectsModule } from "@wix/redirects";
import { forms as formsModule } from "@wix/forms";
import { wixModule } from "../sdk";
import { BOOKINGS_APP_ID, STAFF_RESOURCE_TYPE_ID } from "./services";
import type { BookingFormField, BookingResult, ServiceDetail, Slot } from "./types";

const apptSlots = wixModule(availabilityTimeSlots);
const classSlots = wixModule(eventTimeSlots);
const bookings = wixModule(bookingsModule);
const cart = wixModule({ createCart, calculateCart, placeOrder });
const redirects = wixModule(redirectsModule);
const forms = wixModule(formsModule);

type Raw = Record<string, any>;

const pad = (n: number) => String(n).padStart(2, "0");
/** Local wall-clock "YYYY-MM-DDThh:mm:ss" (NO Z) — the format the availability APIs require. */
export function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toSlot(raw: Raw): Slot {
  const start: string = raw.localStartDate ?? "";
  const staff = (raw.availableResources ?? [])
    .flatMap((ar: Raw) => ar.resources ?? [])
    .map((r: Raw) => ({ id: r._id ?? "", name: r.name ?? "" }))
    .filter((r: { id: string }) => r.id);
  let label = start.slice(11, 16);
  try {
    label = new Date(start).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch {
    /* keep the hh:mm fallback */
  }
  return {
    startLocal: start,
    endLocal: raw.localEndDate ?? "",
    dayKey: start.slice(0, 10),
    label,
    scheduleId: raw.scheduleId ?? null,
    eventId: raw.eventInfo?.eventId ?? null,
    staff,
  };
}

/**
 * Bookable slots for a service in [from, to) — APPOINTMENT and CLASS use different APIs;
 * this branches for you. Dates are local wall-clock; timeZone defaults to the visitor's.
 */
export async function fetchSlots(
  service: Pick<ServiceDetail, "id" | "type">,
  {
    from = new Date(),
    days = 7,
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    staffId,
  }: { from?: Date; days?: number; timeZone?: string; staffId?: string } = {},
): Promise<Slot[]> {
  const to = new Date(from.getTime() + days * 24 * 3600 * 1000);
  const fromLocalDate = toLocalDateString(from);
  const toLocalDate = toLocalDateString(to);

  if (service.type === "CLASS") {
    const res: Raw = await classSlots.listEventTimeSlots({
      serviceIds: [service.id],
      fromLocalDate,
      toLocalDate,
      timeZone,
      includeNonBookable: false,
      ...(staffId ? { eventFilter: { "resources.id": { $hasSome: [staffId] } } } : {}),
    } as any);
    return (res.timeSlots ?? []).map((t: Raw) => toSlot(t));
  }

  const res: Raw = await apptSlots.listAvailabilityTimeSlots({
    serviceId: service.id,
    fromLocalDate,
    toLocalDate,
    timeZone,
    bookable: true,
    cursorPaging: { limit: 100 },
    includeResourceTypeIds: [STAFF_RESOURCE_TYPE_ID],
    ...(staffId
      ? { resourceTypes: [{ resourceTypeId: STAFF_RESOURCE_TYPE_ID, resourceIds: [staffId] }] }
      : {}),
  } as any);
  return (res.timeSlots ?? []).map((t: Raw) => toSlot(t));
}

const FALLBACK_FIELDS: BookingFormField[] = [
  { target: "first_name", label: "First Name", type: "STRING" },
  { target: "last_name", label: "Last Name", type: "STRING" },
  { target: "email", label: "Email", type: "EMAIL" },
];

/**
 * The service's booking-form fields, flat and render-ready (values are keyed by `target`).
 * ALWAYS returns a non-empty list — contact basics when the schema is missing/unusable —
 * so the form can render unconditionally.
 */
export async function fetchBookingForm(formId: string | null): Promise<BookingFormField[]> {
  if (!formId) return FALLBACK_FIELDS;
  try {
    const res: Raw = await forms.getFormSummary(formId);
    const fields = (res.formSummary?.fields ?? [])
      .filter((f: Raw) => !f.deleted)
      .filter((f: Raw) => f.type && ["STRING", "EMAIL", "PHONE", "NUMBER", "URL"].includes(f.type))
      .map((f: Raw) => ({
        target: f.target ?? "",
        label: f.label ?? f.target ?? "",
        type: f.type,
        ...(Array.isArray(f.options) && f.options.length ? { options: f.options } : {}),
      }))
      .filter((f: BookingFormField) => f.target);
    return fields.length ? fields : FALLBACK_FIELDS;
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
  { staffId, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: { staffId?: string; timeZone?: string } = {},
): Promise<BookingResult> {
  const staff = staffId ? slot.staff.find((s) => s.id === staffId) : undefined;
  const created: Raw = await bookings.createBooking(
    {
      selectedPaymentOption: service.paymentOption,
      totalParticipants: 1,
      bookedEntity: {
        slot: {
          serviceId: service.id,
          scheduleId: slot.scheduleId ?? undefined, // APPOINTMENT: the SLOT's scheduleId (never service.schedule.id)
          eventId: slot.eventId ?? undefined, // CLASS
          startDate: slot.startLocal,
          endDate: slot.endLocal,
          timezone: timeZone,
          ...(staff
            ? { resource: { _id: staff.id, name: staff.name } }
            : {
                resourceSelections: [
                  { resourceTypeId: STAFF_RESOURCE_TYPE_ID, selectionMethod: "ANY_RESOURCE" },
                ],
              }),
          location: { locationType: "OWNER_BUSINESS" },
        },
      },
    } as any,
    { formSubmission: formValues } as any,
  );
  const bookingId: string | undefined = created.booking?._id;
  if (!bookingId) throw new Error("The booking couldn't be created — the slot may have just been taken.");

  const newCart: Raw = await cart.createCart({
    catalogItems: [
      { quantity: 1, catalogReference: { catalogItemId: bookingId, appId: BOOKINGS_APP_ID } },
    ],
    cart: { source: { channelType: "WEB" } },
  } as any);
  const cartId: string | undefined = newCart._id ?? newCart.cart?._id;
  if (!cartId) throw new Error("The booking couldn't be reserved — please try again.");

  const calc: Raw = await cart.calculateCart(cartId);
  const total = Number(calc?.summary?.priceSummary?.total?.amount ?? 0);
  const checkoutRequired =
    service.cancellationFeeEnabled || (total > 0 && service.paymentOption !== "OFFLINE");

  if (checkoutRequired) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const session: Raw = await redirects.createRedirectSession({
      ecomCheckout: { checkoutId: cartId },
      callbacks: { postFlowUrl: origin ? `${origin}/` : undefined },
    });
    const url = session?.redirectSession?.fullUrl;
    if (!url) throw new Error("Checkout couldn't start — please try again.");
    return { kind: "redirect", url };
  }

  const order: Raw = await cart.placeOrder(cartId);
  return { kind: "confirmed", bookingId, orderId: order?.orderId ?? order?.order?._id ?? null };
}
