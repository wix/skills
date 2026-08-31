import { wixApiRequest } from "./wix-client.js";
import { listAvailableSlots } from "./wix-bookings-services.js";

/**
 * Wix Rentals — a DELTA on `wix-bookings-services.js`, not a replacement.
 *
 * Wix Rentals has no APIs of its own. A rental is a Bookings **service** with rentals-specific
 * field values, so the catalog read, the booking form, and the whole
 * `createBooking → cart → checkout` chain in `wix-bookings-checkout.js` are UNCHANGED. Only
 * three things differ, and they are all here:
 *
 *   1. every catalog read filters by the rentals `appId`, or rentals and appointments interleave
 *   2. the customer picks the LENGTH, so availability is two calls: start times, then the valid
 *      ends for the chosen start
 *   3. price is a rate per unit, so the total for a chosen length comes from the server
 *
 * What makes a service a rental (from the docs' own mapping — nothing is inferred):
 *   type      always "APPOINTMENT"
 *   appId     always RENTALS_APP_ID
 *   schedule.availabilityConstraints.durationRange   replaces `sessionDurations`
 *                                                    — MUTUALLY EXCLUSIVE, one or the other
 *   primaryResourceType   a resource type id, not staff — availability comes from its resources
 *   payment.rateType      always "FIXED", charged per hour or per day
 *
 * ⚠️ Because the two constraint fields are mutually exclusive, `isRental()` below is a reliable
 * test on the DATA. Never decide "this is a rental" from the brief, the service name, or a
 * category — a 60-minute yoga class and a meeting room rented for 1–8 hours are told apart by
 * which constraint the service carries, and nothing else.
 *
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/rentals/wix-rentals-and-the-bookings-apis.md
 * docs: https://dev.wix.com/docs/api-reference/business-solutions/rentals/about-wix-rentals-availability.md
 */

/** The Wix Rentals app. Used twice: to filter the catalog, and as the cart's catalogReference.appId. */
export const RENTALS_APP_ID = "ff5d6eb1-65e4-4f9a-8b14-64d34c12cc2e";

/** The Wix Bookings app — the other half of a mixed site. */
export const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";

/**
 * Is this service a rental? True when it carries a duration RANGE the customer picks within,
 * rather than a fixed session length. This is the only correct test.
 * @param {object} service
 * @returns {boolean}
 */
export function isRental(service) {
  return Boolean(service?.schedule?.availabilityConstraints?.durationRange);
}

/**
 * The rental's unit and bounds, or null for an ordinary service.
 * Hourly bounds are MINUTES (30–1440), daily bounds are DAYS (1–8).
 * @param {object} service
 * @returns {{ unit: "HOUR"|"DAY", min: number, max: number, step: number }|null}
 */
export function rentalDuration(service) {
  const range = service?.schedule?.availabilityConstraints?.durationRange;
  if (!range) return null;
  if (range.unitType === "DAY") {
    return {
      unit: "DAY",
      min: range.dayOptions?.minDurationInDays ?? 1,
      max: range.dayOptions?.maxDurationInDays ?? 1,
      step: 1,
    };
  }
  return {
    unit: "HOUR",
    min: range.hourOptions?.minDurationInMinutes ?? 30,
    max: range.hourOptions?.maxDurationInMinutes ?? 1440,
    step: 30,
  };
}

/**
 * Query rentals only. On a site that has both apps an unfiltered `queryServices` returns
 * haircuts next to meeting rooms, so this is not optional — it is the same query with the
 * rentals `appId` on the filter.
 *
 * Pass `appId: BOOKINGS_APP_ID` to get the ordinary services instead, on a mixed site.
 * @param {{ limit?: number, offset?: number, appId?: string }} [options]
 * @returns {Promise<{ services: object[], total: number, nextOffset: number|null }>}
 */
export async function queryRentals({ limit = 100, offset = 0, appId = RENTALS_APP_ID } = {}) {
  const res = await wixApiRequest("/bookings/v2/services/query", {
    method: "POST",
    body: { query: { filter: { hidden: false, appId }, paging: { limit, offset } } },
  });
  const services = res?.services ?? [];
  const total = res?.pagingMetadata?.total ?? services.length;
  const loaded = offset + services.length;
  return { services, total, nextOffset: loaded < total ? loaded : null };
}

/**
 * The resource type id(s) a rental's availability comes from — read off `serviceResources`.
 * Every rental availability call must pass these as `includeResourceTypeIds`, or it returns zero slots.
 * @param {object} service
 * @returns {string[]}
 */
export function rentalResourceTypeIds(service) {
  return (service?.serviceResources ?? [])
    .map((sr) => sr.resourceType?._id ?? sr.resourceType?.id)
    .filter(Boolean);
}

/**
 * Start times for a rental — step 1 of 2.
 *
 * A rental is an APPOINTMENT-typed service, so this is the same availability call an appointment
 * uses; what comes back are the times a rental may START. The customer then picks how long, which is
 * `listEndOptions` below. Pass the whole `service` so its resource types ride along — the
 * availability engine reads them to find a resource-driven service's slots.
 * @param {object} service  A rental service from queryRentals.
 * @param {{ fromLocalDate: string, toLocalDate: string, timeZone?: string, limit?: number, cursor?: string }} options
 * @returns {Promise<{ slots: object[], nextCursor: string|null, timeZone: string|null }>}
 */
export function listRentalStartSlots(service, options = {}) {
  const serviceId = service?._id || service?.id;
  return listAvailableSlots(serviceId, { ...options, includeResourceTypeIds: rentalResourceTypeIds(service) });
}

/**
 * The valid END times for a chosen start — step 2 of 2, HOURLY rentals only.
 *
 * Each entry is a TimeSlot sharing `localStartDate` with the request and varying only in
 * `localEndDate`, sorted shortest first. The service's maximum duration always caps the list,
 * so a `maxLocalEndDate` beyond it is ignored rather than rejected.
 *
 * ⚠️ Hourly only. A DAILY rental has no end options — its lengths are whole days, so walk
 * consecutive days from the chosen start instead (`dailyEndOptions` below).
 * https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slot-end-options.md
 * Pass the chosen start slot's own `location`. It carries `locationType` (and an `id` on a
 * multi-location site); `{ locationType: "BUSINESS" }` is enough on a single-location site.
 * @param {string} serviceId
 * @param {{ localStartDate: string, location: object, maxLocalEndDate?: string, timeZone?: string }} options
 * @returns {Promise<{ endOptions: object[], timeZone: string|null }>}
 */
export async function listEndOptions(serviceId, { localStartDate, location, maxLocalEndDate, timeZone } = {}) {
  if (!localStartDate) throw new Error("listEndOptions requires localStartDate (local 'YYYY-MM-DDThh:mm:ss').");
  if (!location) throw new Error("listEndOptions requires the chosen slot's location.");
  const res = await wixApiRequest("/_api/service-availability/v2/time-slots/end-options", {
    method: "POST",
    body: {
      serviceId,
      localStartDate,
      location,
      ...(maxLocalEndDate ? { maxLocalEndDate } : {}),
      ...(timeZone ? { timeZone } : {}),
    },
  });
  return { endOptions: res?.endOptions ?? [], timeZone: res?.timeZone ?? null };
}

/**
 * The lengths a DAILY rental can run for from a chosen start day — the daily counterpart to
 * `listEndOptions`. A day's slot list is the availability, so this walks forward from the start
 * and stops at the first day that has none: a 3-day rental needs all 3 days free, and a gap
 * means the longer options are not bookable however far out the calendar goes.
 *
 * Returns one entry per bookable length, `{ days, localEndDate }`, shortest first.
 * `localEndDate` is midnight of the day AFTER the last rented day — the end boundary is
 * exclusive, which is the same convention the catalog's availability window uses.
 * @param {object} service  A rental service (daily).
 * @param {{ localStartDate: string, timeZone?: string }} options
 * @returns {Promise<{ days: number, localEndDate: string }[]>}
 */
export async function dailyEndOptions(service, { localStartDate, timeZone } = {}) {
  const duration = rentalDuration(service);
  if (!duration || duration.unit !== "DAY") {
    throw new Error("dailyEndOptions expects a DAY-unit rental — use listEndOptions for hourly.");
  }
  const serviceId = service._id || service.id;
  const includeResourceTypeIds = rentalResourceTypeIds(service);
  const startDay = localStartDate.slice(0, 10);
  const dayAfter = (isoDay, n) => {
    const d = new Date(`${isoDay}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const out = [];
  for (let days = 1; days <= duration.max; days++) {
    const dayToCheck = dayAfter(startDay, days - 1);
    const { slots } = await listAvailableSlots(serviceId, {
      fromLocalDate: `${dayToCheck}T00:00:00`,
      toLocalDate: `${dayAfter(dayToCheck, 1)}T00:00:00`,
      timeZone,
      limit: 1,
      includeResourceTypeIds,
    });
    if (!slots.length) break; // a gap — every longer option is unbookable too
    if (days >= duration.min) out.push({ days, localEndDate: `${dayAfter(startDay, days)}T00:00:00` });
  }
  return out;
}

/**
 * The price for a chosen length, from the server.
 *
 * ⚠️ Never compute this client-side. A rental is charged as a RATE — per hour or per day — and
 * hourly is calculated at per-minute granularity, so a 90-minute rental of a $10/hour room is
 * $15. Multiplying a displayed base price by a rounded number of hours quietly disagrees with
 * what the customer is charged at checkout.
 *
 * ⚠️ Omitting the local dates or the time zone does NOT error — it returns a duration-blind
 * price, which is the same trap in a quieter form.
 * https://dev.wix.com/docs/api-reference/business-solutions/bookings/pricing/pricing-api/preview-price.md
 * @param {string} serviceId
 * @param {{ localStartDate: string, localEndDate: string, timeZone: string, numberOfParticipants?: number }} options
 * @returns {Promise<{ total: string, currency: string|null, raw: object }>}
 */
export async function previewRentalPrice(serviceId, { localStartDate, localEndDate, timeZone, numberOfParticipants = 1 } = {}) {
  if (!localStartDate || !localEndDate || !timeZone) {
    throw new Error("previewRentalPrice requires localStartDate, localEndDate and timeZone — without them the price ignores the duration.");
  }
  const res = await wixApiRequest("/bookings/v2/pricing/v2/pricing/preview", {
    method: "POST",
    body: {
      bookingLineItems: [{ serviceId, localStartDate, localEndDate, timeZone, numberOfParticipants }],
    },
  });
  const info = res?.priceInfo ?? {};
  const total = info.totalPrice ?? info.total ?? {};
  return {
    total: total.formattedValue ?? (total.value != null ? String(total.value) : ""),
    currency: total.currency ?? null,
    raw: info,
  };
}

/**
 * A rental's rate, ready to render — "$10 / hour" or "$120 / day".
 * `servicePriceLabel` in `lib/serviceFacts.js` renders the same number as a flat price, which
 * reads as the whole cost of the rental rather than its rate.
 * @param {object} service
 * @returns {string}
 */
export function rentalRateLabel(service) {
  const duration = rentalDuration(service);
  if (!duration) return "";
  const price = service?.payment?.fixed?.price;
  const money =
    price?.formattedValue ||
    (price?.currency && price?.value != null
      ? new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).format(Number(price.value))
      : "");
  if (!money) return "";
  return `${money} / ${duration.unit === "DAY" ? "day" : "hour"}`;
}
