// Booking rules, request builders, and DTO mapping — transport-agnostic, imported by BOTH transports:
// ./booking.ts (the SDK) and the REST twin in references/bookings/rest/booking.ts (fetch). The
// availability request bodies, the slot mapper, the form-field rules, the createBooking body, the
// cart body, and the checkout-or-place decision live HERE, once — these are the payloads that are
// exact and easy to get subtly wrong. Raw entities may carry `_id` (SDK) or `id` (REST). Imports are
// type-only so a strip to JS emits no imports.
import type { BookingFormField, BookingResult, ServiceDetail, Slot } from "./types";

export type Raw = Record<string, any>;

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

// Copies of services-core's ids (same values) so this file stands alone when stripped.
/** The Wix Bookings app id — the cart line's catalogReference.appId. */
export const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";
/** Staff-member resource type id (ANY_RESOURCE fallback + staff filtering). */
export const STAFF_RESOURCE_TYPE_ID = "1cd44cf8-756f-41c3-bd90-3e2ffcaf1155";

const pad = (n: number) => String(n).padStart(2, "0");
/** Local wall-clock "YYYY-MM-DDThh:mm:ss" (NO Z) — the format the availability APIs require. */
export function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** The visitor's IANA time zone — availability and the booking are computed in it. */
export const defaultTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---- availability ----------------------------------------------------------------------------------

export interface SlotsWindow {
  from?: Date;
  days?: number;
  timeZone?: string;
  staffId?: string;
}

/** [from, from + days) as the local strings both time-slot APIs take. */
export function slotsRange({ from = new Date(), days = 7 }: SlotsWindow): { fromLocalDate: string; toLocalDate: string } {
  const to = new Date(from.getTime() + days * 24 * 3600 * 1000);
  return { fromLocalDate: toLocalDateString(from), toLocalDate: toLocalDateString(to) };
}

/**
 * The List Availability Time Slots body for an APPOINTMENT service: bookable slots only, the staff
 * resources included on each slot, optionally narrowed to one staff member.
 */
export function appointmentSlotsRequest(serviceId: string, { timeZone = defaultTimeZone(), staffId, ...window }: SlotsWindow): Raw {
  return {
    serviceId,
    ...slotsRange(window),
    timeZone,
    bookable: true,
    cursorPaging: { limit: 100 },
    includeResourceTypeIds: [STAFF_RESOURCE_TYPE_ID],
    ...(staffId ? { resourceTypes: [{ resourceTypeId: STAFF_RESOURCE_TYPE_ID, resourceIds: [staffId] }] } : {}),
  };
}

/** The List Event Time Slots body for a CLASS service: its sessions, bookable only, optionally one staff member's. */
export function classSlotsRequest(serviceId: string, { timeZone = defaultTimeZone(), staffId, ...window }: SlotsWindow): Raw {
  return {
    serviceIds: [serviceId],
    ...slotsRange(window),
    timeZone,
    includeNonBookable: false,
    ...(staffId ? { eventFilter: { "resources.id": { $hasSome: [staffId] } } } : {}),
  };
}

export function toSlot(raw: Raw): Slot {
  const start: string = raw.localStartDate ?? "";
  const staff = ((raw.availableResources ?? []) as Raw[])
    .flatMap((ar) => (ar.resources ?? []) as Raw[])
    .map((r) => ({ id: rawId(r), name: r.name ?? "" }))
    .filter((r) => r.id);
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

export interface BookingDay {
  dayKey: string;
  dayLabel: string;
  slots: Slot[];
}

export const dayLabel = (dayKey: string): string => {
  try {
    return new Date(`${dayKey}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dayKey;
  }
};

/** Slots grouped by day, days in order — what a slot picker renders. */
export function groupSlotsByDay(slots: Slot[]): BookingDay[] {
  const byDay = new Map<string, Slot[]>();
  for (const s of slots) byDay.set(s.dayKey, [...(byDay.get(s.dayKey) ?? []), s]);
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayKey, daySlots]) => ({ dayKey, dayLabel: dayLabel(dayKey), slots: daySlots }));
}

// ---- the booking form -------------------------------------------------------------------------------

export const FALLBACK_FIELDS: BookingFormField[] = [
  { target: "first_name", label: "First Name", type: "STRING", required: true },
  { target: "last_name", label: "Last Name", type: "STRING", required: true },
  { target: "email", label: "Email", type: "EMAIL", required: true },
];

const FIELD_TYPES = ["STRING", "EMAIL", "PHONE", "NUMBER", "URL"];

/**
 * Flat, render-ready fields from a form summary — deleted fields and non-text types dropped, values
 * keyed by `target`. `required` comes from the full form schema (`fields[].validation.required`,
 * keyed by target); the summary doesn't carry it. Without the schema every field counts as required.
 * ALWAYS non-empty: contact basics when the schema is missing or unusable.
 */
export function toFormFields(summary: Raw | null | undefined, form?: Raw | null): BookingFormField[] {
  const requiredByTarget = new Map<string, boolean>(
    ((form?.fields ?? []) as Raw[]).filter((f) => f.target).map((f) => [f.target as string, f.validation?.required === true]),
  );
  const fields = ((summary?.fields ?? []) as Raw[])
    .filter((f) => !f.deleted)
    .filter((f) => f.type && FIELD_TYPES.includes(f.type))
    .map((f) => ({
      target: f.target ?? "",
      label: f.label ?? f.target ?? "",
      type: f.type as BookingFormField["type"],
      ...(Array.isArray(f.options) && f.options.length ? { options: f.options as string[] } : {}),
      required: requiredByTarget.get(f.target ?? "") ?? true,
    }))
    .filter((f) => f.target);
  return fields.length ? fields : FALLBACK_FIELDS;
}

// ---- createBooking → cart → checkout-or-place --------------------------------------------------------

/**
 * The Create Booking `booking` object. APPOINTMENT: the SLOT's scheduleId (never service.schedule.id)
 * plus start/end as local wall-clock with the time zone; CLASS: the eventId. A chosen staff member
 * is the slot's `resource`; otherwise ANY_RESOURCE of the staff type. `idKey` spells the resource's
 * id the way the transport wants it: `_id` on the SDK, `id` on REST.
 */
export function bookingRequest(
  service: Pick<ServiceDetail, "id" | "paymentOption">,
  slot: Slot,
  { staffId, timeZone = defaultTimeZone(), idKey = "id" }: { staffId?: string; timeZone?: string; idKey?: "_id" | "id" } = {},
): Raw {
  const staff = staffId ? slot.staff.find((s) => s.id === staffId) : undefined;
  return {
    selectedPaymentOption: service.paymentOption,
    totalParticipants: 1,
    bookedEntity: {
      slot: {
        serviceId: service.id,
        scheduleId: slot.scheduleId ?? undefined,
        eventId: slot.eventId ?? undefined,
        startDate: slot.startLocal,
        endDate: slot.endLocal,
        timezone: timeZone,
        ...(staff
          ? { resource: { [idKey]: staff.id, name: staff.name } }
          : { resourceSelections: [{ resourceTypeId: STAFF_RESOURCE_TYPE_ID, selectionMethod: "ANY_RESOURCE" }] }),
        location: { locationType: "OWNER_BUSINESS" },
      },
    },
  };
}

/** The Create Cart body that holds the booked seat: one line whose catalogItemId is the BOOKING id. */
export function bookingCartRequest(bookingId: string): Raw {
  return {
    catalogItems: [{ quantity: 1, catalogReference: { catalogItemId: bookingId, appId: BOOKINGS_APP_ID } }],
    cart: { source: { channelType: "WEB" } },
  };
}

/** The booking id out of a Create Booking response (wrapped { booking } on both transports). */
export const bookingIdOf = (res: Raw | null | undefined): string => rawId(res?.booking);

/** The cart id out of a Create Cart response — the SDK may unwrap the cart, REST wraps it. */
export const cartIdOf = (res: Raw | null | undefined): string => rawId(res) || rawId(res?.cart);

/** The cart's total from a Calculate Cart response (`summary.priceSummary.total`); 0 when absent. */
export const cartTotal = (calc: Raw | null | undefined): number => Number(calc?.summary?.priceSummary?.total?.amount ?? 0);

/**
 * Hosted checkout is required for anything that costs money paid online, and always when the
 * service carries a cancellation fee (a card must be on file). Otherwise the order is placed
 * directly — free and pay-in-person bookings confirm without a checkout.
 */
export function checkoutRequired(service: Pick<ServiceDetail, "paymentOption" | "cancellationFeeEnabled">, total: number): boolean {
  return service.cancellationFeeEnabled || (total > 0 && service.paymentOption !== "OFFLINE");
}

/** The Create Redirect Session body for a cart's checkout; the cart id IS the checkout id. */
export function checkoutRedirectRequest(cartId: string, origin: string): Raw {
  return { ecomCheckout: { checkoutId: cartId }, callbacks: origin ? { postFlowUrl: `${origin}/` } : {} };
}

/** A placed order → the confirmed result; the order id is wherever the transport put it. */
export function confirmedResult(bookingId: string, order: Raw | null | undefined): BookingResult {
  return { kind: "confirmed", bookingId, orderId: order?.orderId ?? (rawId(order?.order) || null) };
}
