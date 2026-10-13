// Rentals rules — transport-agnostic, imported by BOTH transports: ./rentals.ts (the SDK) and the
// REST twin in templates/rentals/rest/rentals.ts. What a rental IS (the five Bookings field values),
// how its rate and range read, how the two availability flows work (hourly: start then end options;
// daily: one call then a walk over consecutive days), the price preview, and the exact
// createBooking → cart → checkout bodies live HERE, once. Type-only imports: a strip to JS emits a
// plain module.
//
// Wix Rentals has no API of its own. A rental is a Bookings V2 APPOINTMENT service with:
//   appId = RENTALS_APP_ID (immutable), serviceResources + primaryResourceType (a resource type and
//   its resources; availability comes from them, not from staff), form.id = RENTALS_FORM_ID, and
//   schedule.availabilityConstraints.durationRange (HOUR with hourOptions, or DAY with dayOptions)
//   instead of sessionDurations. No category.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/rentals/introduction.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/rentals/wix-rentals-and-the-bookings-apis.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/rentals/about-wix-rentals-availability.md
import type { EndOption, RentalDetail, RentalFormField, RentalLocation, RentalQuote, RentalResult, RentalSummary, RentalUnit, StartOption } from "./types";

export type Raw = Record<string, any>;
export type ImgSrc = (value: any, width: number, height: number) => string;

/** The Wix Rentals app: the service's appId, the catalog filter, the cart's catalogReference.appId. */
export const RENTALS_APP_ID = "ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e";
/** The Rentals default booking form, provisioned by the install with the same id on every site. */
export const RENTALS_FORM_ID = "3a2ea2ce-91f4-4617-ab24-629933c0c31a";
export const RENTALS_PAGE_SIZE = 20;
/** Slots per page the availability API allows; the transports follow the cursor. */
export const SLOTS_PAGE_LIMIT = 1000;

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

// ---- money and labels ------------------------------------------------------------------------------

/** "$40" from a Wix money-like `{ value, currency }`; "" when either is missing (never a guessed currency). */
export function formatMoney(value: string | number | undefined | null, currency: string | undefined | null, locale?: string): string {
  if (value == null || value === "" || !currency) return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  try {
    const opts: Intl.NumberFormatOptions = { style: "currency", currency };
    if (Number.isInteger(n)) opts.maximumFractionDigits = 0;
    return new Intl.NumberFormat(locale, opts).format(n);
  } catch {
    return "";
  }
}

const unitWord = (unit: RentalUnit, n: number): string => (unit === "DAY" ? (n === 1 ? "day" : "days") : n === 1 ? "hour" : "hours");

/** "2 hours", "1.5 hours", "3 days". */
export function unitsLabel(units: number, unit: RentalUnit): string {
  const n = Math.round(units * 100) / 100;
  return `${n} ${unitWord(unit, n)}`;
}

export function rangeLabel(minUnits: number, maxUnits: number, unit: RentalUnit): string {
  if (!minUnits || !maxUnits) return "";
  if (minUnits === maxUnits) return unitsLabel(minUnits, unit);
  return `${Math.round(minUnits * 100) / 100} to ${unitsLabel(maxUnits, unit)}`;
}

// ---- dates ---------------------------------------------------------------------------------------------

/** Local wall-clock "YYYY-MM-DDThh:mm:ss" for a Date (no zone, no Z) — the format the availability API speaks. */
export function toLocalDateString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const defaultTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;
export const dayKeyOf = (local: string): string => local.slice(0, 10);
/** Midnight of the day after `dayKey`, as a local wall-clock string. */
export function midnightAfter(dayKey: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return toLocalDateString(new Date(y, m - 1, d + 1));
}
export function addDaysKey(dayKey: string, days: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return toLocalDateString(new Date(y, m - 1, d + days)).slice(0, 10);
}
const minutesBetween = (a: string, b: string): number => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);

export function timeLabel(local: string, locale?: string): string {
  try {
    return new Date(local).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  } catch {
    return local.slice(11, 16);
  }
}
export function dayLabel(dayKey: string, locale?: string): string {
  try {
    const [y, m, d] = dayKey.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dayKey;
  }
}

// ---- the rental entity -----------------------------------------------------------------------------------

export interface DurationRange {
  unit: RentalUnit;
  /** In the unit: hours (fractional allowed) or days. 0 when the range is missing. */
  minUnits: number;
  maxUnits: number;
}

/** The customer-pickable range off a service; HOUR minutes become hours. A service without one is not a rental. */
export function durationRangeOf(raw: Raw): DurationRange | null {
  const range: Raw | undefined = raw.schedule?.availabilityConstraints?.durationRange;
  if (!range?.unitType) return null;
  if (range.unitType === "DAY") {
    const o = range.dayOptions ?? {};
    return { unit: "DAY", minUnits: Number(o.minDurationInDays ?? 0), maxUnits: Number(o.maxDurationInDays ?? 0) };
  }
  const o = range.hourOptions ?? {};
  return { unit: "HOUR", minUnits: Number(o.minDurationInMinutes ?? 0) / 60, maxUnits: Number(o.maxDurationInMinutes ?? 0) / 60 };
}

/** A service is a rental when it carries the Rentals app id AND a duration range. */
export const isRental = (raw: Raw): boolean => raw?.appId === RENTALS_APP_ID && durationRangeOf(raw) !== null;

export function toLocation(raw: Raw): RentalLocation {
  const type = (["BUSINESS", "CUSTOM", "CUSTOMER"].includes(raw?.type) ? raw.type : "BUSINESS") as RentalLocation["type"];
  return { id: rawId(raw?.business) || null, name: raw?.business?.name ?? raw?.custom?.address?.formattedAddress ?? "", type };
}

export function toSummary(raw: Raw, imgSrc: ImgSrc): RentalSummary {
  const range = durationRangeOf(raw) ?? { unit: "HOUR" as RentalUnit, minUnits: 0, maxUnits: 0 };
  const payment: Raw = raw.payment ?? {};
  const price: Raw | undefined = payment.fixed?.price;
  const rateAmount = Number(price?.value ?? 0) || 0;
  const currency: string = price?.currency ?? "";
  const free = payment.rateType === "NO_FEE" || (payment.rateType === "FIXED" && rateAmount === 0);
  const ratePerUnit = free ? "Free" : formatMoney(price?.value, currency);
  const serviceResources = (raw.serviceResources ?? []) as Raw[];
  const resourceTypeId: string | null = raw.primaryResourceType ?? rawId(serviceResources[0]?.resourceType) ?? null;
  const resourceCount = serviceResources.reduce((n, sr) => n + ((sr.resourceIds?.values ?? []) as string[]).length, 0);
  return {
    id: rawId(raw),
    slug: raw.mainSlug?.name ?? "",
    name: raw.name ?? "",
    tagLine: raw.tagLine ?? "",
    unit: range.unit,
    ratePerUnit,
    rateLabel: ratePerUnit && !free ? `${ratePerUnit} / ${unitWord(range.unit, 1)}` : ratePerUnit,
    rateAmount,
    currency,
    minUnits: range.minUnits,
    maxUnits: range.maxUnits,
    rangeLabel: rangeLabel(range.minUnits, range.maxUnits, range.unit),
    imageUrl: raw.media?.mainMedia?.image ? imgSrc(raw.media.mainMedia.image, 800, 600) : "",
    resourceTypeId: resourceTypeId || null,
    resourceCount,
    locations: ((raw.locations ?? []) as Raw[]).map(toLocation),
    onlineBookingEnabled: raw.onlineBooking?.enabled !== false,
    requiresManualApproval: raw.onlineBooking?.requireManualApproval === true,
    free,
  };
}

export function toDetail(raw: Raw, imgSrc: ImgSrc): RentalDetail {
  const summary = toSummary(raw, imgSrc);
  const online = raw.payment?.options?.online === true;
  const inPerson = raw.payment?.options?.inPerson === true;
  // Derived, never hardcoded: an in-person-only (or free) rental booked ONLINE is refused by the cart.
  const paymentOption: "ONLINE" | "OFFLINE" = !online && inPerson ? "OFFLINE" : "ONLINE";
  return {
    ...summary,
    description: raw.description ?? "",
    formId: rawId(raw.form) || null,
    paymentOption,
    cancellationFeeEnabled: raw.bookingPolicy?.cancellationFeePolicy?.enabled === true,
    scheduleId: rawId(raw.schedule) || null,
  };
}

// ---- availability: starts ------------------------------------------------------------------------------

export interface StartWindow {
  /** First day of the window (defaults to today); the window is `days` long. */
  from?: Date;
  days?: number;
  /** IANA zone the local times are expressed in; the business zone when omitted (daily rentals need the business zone). */
  timeZone?: string;
  cursor?: string;
}

/**
 * The List Availability Time Slots body for a rental. `includeResourceTypeIds` = the rental's
 * primary resource type — without it the slots come back with no resource to book. A DAILY rental
 * asks for one slot per day (the start of each available day).
 */
export function startsRequest(rental: Pick<RentalDetail, "id" | "unit" | "resourceTypeId">, { from = new Date(), days = 7, timeZone, cursor }: StartWindow): Raw {
  const start = startOfDay(from);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days);
  return {
    serviceId: rental.id,
    fromLocalDate: toLocalDateString(start),
    toLocalDate: toLocalDateString(end), // exclusive: midnight after the last day, never 23:59:59
    ...(timeZone ? { timeZone } : {}),
    ...(rental.resourceTypeId ? { includeResourceTypeIds: [rental.resourceTypeId] } : {}),
    bookable: true,
    ...(rental.unit === "DAY" ? { timeSlotsPerDay: 1 } : {}),
    cursorPaging: { limit: SLOTS_PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
  };
}
export const nextSlotsCursor = (res: Raw | null | undefined): string | null => res?.pagingMetadata?.cursors?.next ?? res?.cursorPagingMetadata?.cursors?.next ?? null;

const toSlotLocation = (raw: Raw | undefined): RentalLocation | null => {
  if (!raw || (!rawId(raw) && !raw.name)) return null;
  const type = (["BUSINESS", "CUSTOM", "CUSTOMER"].includes(raw.locationType) ? raw.locationType : "BUSINESS") as RentalLocation["type"];
  return { id: rawId(raw) || null, name: raw.name ?? "", type };
};

export function toStartOption(raw: Raw, unit: RentalUnit): StartOption {
  const start: string = raw.localStartDate ?? "";
  const resource: Raw | undefined = ((raw.availableResources ?? []) as Raw[]).flatMap((ar) => (ar.resources ?? []) as Raw[])[0];
  return {
    key: `${start}|${rawId(raw.location)}`,
    startLocal: start,
    dayKey: dayKeyOf(start),
    label: unit === "DAY" ? dayLabel(dayKeyOf(start)) : timeLabel(start),
    bookable: raw.bookable !== false,
    location: toSlotLocation(raw.location),
    resource: resource && rawId(resource) ? { id: rawId(resource), name: resource.name ?? "" } : null,
    scheduleId: raw.scheduleId ?? null,
  };
}

/** Raw slots from one or more pages → deduped (one per start and location), ordered. */
export function toStartOptions(raws: Raw[], unit: RentalUnit): StartOption[] {
  const byKey = new Map<string, Raw>();
  for (const raw of raws) {
    const key = `${raw.localStartDate ?? ""}|${rawId(raw.location)}`;
    const seen = byKey.get(key);
    if (!seen) byKey.set(key, raw);
    else if (!seen.availableResources?.length && raw.availableResources?.length) byKey.set(key, raw);
  }
  return [...byKey.values()].map((r) => toStartOption(r, unit)).sort((a, b) => a.startLocal.localeCompare(b.startLocal));
}

// ---- availability: lengths ----------------------------------------------------------------------------

/**
 * HOURLY: the List Availability Time Slot End Options body for a chosen start. `location` is
 * required and is the start's own; the service's maximum caps the response, so no maxLocalEndDate.
 * The SDK takes `serviceId` as a positional first argument; REST sends it in the body. `idKey`
 * spells the location id the way the transport wants it: `_id` on the SDK, `id` on REST.
 */
export function endOptionsRequest(start: StartOption, timeZone: string | null | undefined, idKey: "_id" | "id" = "id"): Raw {
  return {
    localStartDate: start.startLocal,
    ...(timeZone ? { timeZone } : {}),
    location: start.location
      ? { ...(start.location.id ? { [idKey]: start.location.id } : {}), name: start.location.name, locationType: start.location.type }
      : { locationType: "BUSINESS" },
  };
}

/** HOURLY end options (the response field is `endOptions`, not `timeSlots`) → lengths, shortest first. */
export function toHourlyEndOptions(res: Raw | null | undefined, start: StartOption): EndOption[] {
  return ((res?.endOptions ?? []) as Raw[])
    .map((o) => o.localEndDate as string)
    .filter(Boolean)
    .map((endLocal) => {
      const units = minutesBetween(start.startLocal, endLocal) / 60;
      return { endLocal, units, label: `${unitsLabel(units, "HOUR")} · until ${timeLabel(endLocal)}` };
    })
    .filter((o) => o.units > 0)
    .sort((a, b) => a.units - b.units);
}

/**
 * DAILY: there is no end-options call. From the chosen start day, walk forward through the available
 * days and stop at the first gap or at the rental's maximum; each reachable length is an option whose
 * end is midnight on the day AFTER its last day. A 24/7 resource (the seed's default) takes the whole
 * range as ONE booking.
 */
export function dailyEndOptions(start: StartOption, availableDayKeys: string[], range: Pick<RentalDetail, "minUnits" | "maxUnits">): EndOption[] {
  const available = new Set(availableDayKeys);
  const out: EndOption[] = [];
  let lastDay = start.dayKey;
  for (let days = 1; days <= Math.max(1, Math.floor(range.maxUnits)); days++) {
    const day = addDaysKey(start.dayKey, days - 1);
    if (!available.has(day)) break;
    lastDay = day;
    if (days >= Math.max(1, Math.floor(range.minUnits))) {
      out.push({ endLocal: midnightAfter(lastDay), units: days, label: days === 1 ? `1 day · ${dayLabel(lastDay)}` : `${days} days · until ${dayLabel(lastDay)}` });
    }
  }
  return out;
}

// ---- price -------------------------------------------------------------------------------------------------

/**
 * Preview Price line items for a rental: one line, ONE participant (a rental takes one resource; the
 * length drives the price), the resource, and BOTH local dates with the zone — without all three the
 * server silently returns a duration-blind flat rate.
 */
export function previewRequest(rental: Pick<RentalDetail, "id">, start: StartOption, endLocal: string, timeZone: string): Raw[] {
  return [
    {
      serviceId: rental.id,
      ...(start.resource ? { resourceId: start.resource.id } : {}),
      numberOfParticipants: 1,
      localStartDate: start.startLocal,
      localEndDate: endLocal,
      timeZone,
    },
  ];
}

/** The server's total (`priceInfo.calculatedPrice`), or the local rate times the length when the preview fails. */
export function toQuote(res: Raw | null | undefined, rental: Pick<RentalDetail, "rateAmount" | "currency" | "unit">, units: number): RentalQuote {
  const server = res?.priceInfo?.calculatedPrice;
  const totalAmount = typeof server === "number" && Number.isFinite(server) ? server : Math.round(rental.rateAmount * units * 100) / 100;
  return { total: formatMoney(totalAmount, rental.currency), totalAmount, units, unit: rental.unit };
}

// ---- the booking form ---------------------------------------------------------------------------------

export const FALLBACK_FIELDS: RentalFormField[] = [
  { target: "first_name", label: "First Name", type: "STRING", required: true },
  { target: "last_name", label: "Last Name", type: "STRING", required: true },
  { target: "email", label: "Email", type: "EMAIL", required: true },
];
const FIELD_TYPES = ["STRING", "EMAIL", "PHONE", "NUMBER", "URL"];

/** Flat, render-ready fields from a form summary (+ the full schema for `required`); never empty. */
export function toFormFields(summary: Raw | null | undefined, form?: Raw | null): RentalFormField[] {
  const requiredByTarget = new Map<string, boolean>(((form?.fields ?? []) as Raw[]).filter((f) => f.target).map((f) => [f.target as string, f.validation?.required === true]));
  const fields = ((summary?.fields ?? []) as Raw[])
    .filter((f) => !f.deleted && f.type && FIELD_TYPES.includes(f.type))
    .map((f) => ({
      target: f.target ?? "",
      label: f.label ?? f.target ?? "",
      type: f.type as RentalFormField["type"],
      ...(Array.isArray(f.options) && f.options.length ? { options: f.options as string[] } : {}),
      required: requiredByTarget.get(f.target ?? "") ?? true,
    }))
    .filter((f) => f.target);
  return fields.length ? fields : FALLBACK_FIELDS;
}

// ---- createBooking → cart → checkout-or-place -------------------------------------------------------------

/** A start's location type → the booking's. */
export function bookingLocationType(type: RentalLocation["type"] | undefined): "OWNER_BUSINESS" | "CUSTOM" | "OWNER_CUSTOM" {
  if (type === "CUSTOMER") return "CUSTOM";
  if (type === "CUSTOM") return "OWNER_CUSTOM";
  return "OWNER_BUSINESS";
}

/**
 * The Create Booking `booking` object for a rental: the start's schedule, the chosen start and END
 * (the customer's length, never a duration added to the start), the zone, the start's RESOURCE (rentals
 * are resource-driven: no ANY_RESOURCE staff fallback), and the start's location. `idKey` spells ids
 * the way the transport wants them: `_id` on the SDK, `id` on REST.
 */
export function bookingRequest(rental: Pick<RentalDetail, "id" | "paymentOption">, start: StartOption, endLocal: string, timeZone: string, idKey: "_id" | "id" = "id"): Raw {
  if (!start.resource) throw new Error("This time has no resource to rent — pick another start.");
  return {
    selectedPaymentOption: rental.paymentOption,
    totalParticipants: 1,
    bookedEntity: {
      slot: {
        serviceId: rental.id,
        ...(start.scheduleId ? { scheduleId: start.scheduleId } : {}),
        startDate: start.startLocal,
        endDate: endLocal,
        timezone: timeZone,
        // availableResources carries ids only (no names, verified live) — send the name only when known
        resource: { [idKey]: start.resource.id, ...(start.resource.name ? { name: start.resource.name } : {}) },
        location: start.location
          ? { ...(start.location.id ? { [idKey]: start.location.id } : {}), name: start.location.name, locationType: bookingLocationType(start.location.type) }
          : { locationType: "OWNER_BUSINESS" },
      },
    },
  };
}

/** The rest of the Create Booking request: the form values as the formSubmission, and Wix's own notifications. */
export function bookingOptions(formValues: Record<string, unknown>): Raw {
  return {
    participantNotification: { notifyParticipants: true, metadata: { channels: "EMAIL,SMS" } },
    sendSmsReminder: true,
    formSubmission: formValues,
  };
}

export const bookingIdOf = (res: Raw | null | undefined): string => rawId(res?.booking);
export const contactOf = (res: Raw | null | undefined): Raw | undefined => res?.booking?.contactDetails ?? undefined;

/** The Create Cart body holding the booking: catalogItemId is the BOOKING id and appId the RENTALS app. */
export function cartRequest(bookingIds: string[], contact?: Raw | null, locationId?: string | null): Raw {
  const cart: Raw = { source: { channelType: "WEB" } };
  if (locationId) cart.businessInfo = { locationId };
  if (contact) {
    cart.customerInfo = {
      ...(contact.firstName ? { firstName: contact.firstName } : {}),
      ...(contact.lastName ? { lastName: contact.lastName } : {}),
      ...(contact.phone ? { phone: contact.phone } : {}),
      ...(contact.email ? { email: contact.email } : {}),
    };
  }
  return { catalogItems: bookingIds.map((id) => ({ quantity: 1, catalogReference: { catalogItemId: id, appId: RENTALS_APP_ID } })), cart };
}

export const cartIdOf = (res: Raw | null | undefined): string => rawId(res) || rawId(res?.cart);
export const cartTotal = (calc: Raw | null | undefined): number => Number(calc?.summary?.priceSummary?.total?.amount ?? 0);

/** Hosted checkout whenever a card is involved: a cancellation fee, or a non-zero total not paid fully offline. */
export function checkoutRequired(rental: Pick<RentalDetail, "cancellationFeeEnabled">, calc: Raw | null | undefined): boolean {
  if (rental.cancellationFeeEnabled) return true;
  if (cartTotal(calc) === 0) return false;
  return calc?.cart?.lineItems?.[0]?.paymentConfig?.paymentOption !== "FULL_PAYMENT_OFFLINE";
}

export function checkoutRedirectRequest(cartId: string, origin: string): Raw {
  return { ecomCheckout: { checkoutId: cartId }, callbacks: origin ? { postFlowUrl: `${origin}/` } : {} };
}

export function confirmedResult(bookingId: string, order: Raw | null | undefined): RentalResult {
  return { kind: "confirmed", bookingId, orderId: order?.orderId ?? (rawId(order?.order) || null) };
}

/** Wix's refusal codes a visitor sees, in plain words. */
export function friendlyError(message: string): string {
  if (/SLOT_NOT_AVAILABLE/.test(message)) return "That time was just taken. Pick another start.";
  if (/INVALID_DURATION/.test(message)) return "That length is outside what this rental allows. Pick another length.";
  if (/PREMIUM_VALIDATION_FAILED|SITE_NOT_ACCEPTING/.test(message)) return "This site cannot take online bookings yet (no payment method or plan). Contact the business directly.";
  if (/END_OPTIONS_NOT_SUPPORTED/.test(message)) return "This rental is booked by the day.";
  return message;
}
