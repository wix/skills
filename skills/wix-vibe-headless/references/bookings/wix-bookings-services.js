import { wixApiRequest } from "./wix-client.js";

// Data model reference: see INSTRUCTIONS.md

/**
 * Wix Bookings Service (Services V2) — key fields for the services list and booking UI.
 * This skill ships the APPOINTMENT flow; CLASS/COURSE are "Beyond the snippets".
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
 *
 *   id {string}, type "APPOINTMENT"|"CLASS"|"COURSE", name {string}, tagLine {string},
 *   description {string}, hidden {boolean},
 *   media.items {array} — [{ image: { id, url, width, height, altText } }]
 *     (url may be a bare Wix media handle — pass through mediaUrl() before rendering),
 *   payment.rateType "FIXED"|"CUSTOM"|"VARIED"|"NO_FEE"|"SUBSCRIPTION",
 *   payment.fixed.price { value, currency, formattedValue } — value + currency are always
 *     present; formattedValue is optional (may be missing), so format the price from
 *     value+currency and use formattedValue only when present,
 *   payment.options { online, inPerson, deposit, pricingPlan },
 *   schedule.id {string}, onlineBooking.enabled {boolean},
 *   category { id, name }, staffMemberIds {string[]}, locations {array},
 *   bookingPolicy.participantsPolicy { enabled {boolean}, maxParticipantsPerBooking {number} }
 *     — the MOST participants a single booking may reserve. Cap the participant selector at this
 *     value (for a CLASS, also bound by the slot's remainingCapacity). It is commonly 1, in which
 *     case there is no participant choice at all — book exactly 1. Sending totalParticipants above
 *     this makes createBooking fail.
 *
 * TimeSlot (Time Slots V2, appointments):
 *   serviceId {string}, localStartDate {string}, localEndDate {string} — "YYYY-MM-DDThh:mm:ss" (no zone),
 *   bookable {boolean}, scheduleId {string},
 *   location { id, name, formattedAddress, locationType "BUSINESS"|"CUSTOM"|"CUSTOMER" },
 *   totalCapacity {number}, remainingCapacity {number},
 *   availableResources {array} — staff (populated by getAvailableSlot, not listAvailableSlots)
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md
 */

/** The visitor's local IANA time zone — used as the default for availability queries. */
function defaultTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Resolve a service image to an absolute URL. Wix media fields are sometimes a bare
 * handle ("abc.jpg") rather than a full URL; this prefixes the Wix static host.
 * @param {{ url?: string, id?: string }|string} image
 * @returns {string|null}
 */
export function mediaUrl(image) {
  const raw = typeof image === "string" ? image : image?.url || image?.id;
  if (!raw) return null;
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("wix:image://")) {
    const stripped = raw.slice("wix:image://".length).replace(/^v1\//, "");
    return `https://static.wixstatic.com/media/${stripped.split("#")[0].split("/")[0]}`;
  }
  return `https://static.wixstatic.com/media/${raw}`;
}

/**
 * Query bookable services (one page). Returns only services visible to visitors (hidden:false).
 * https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
 * @param {{ limit?: number, offset?: number }} [options]
 * @returns {Promise<{ services: object[], total: number, nextOffset: number|null }>}
 */
export async function queryServices({ limit = 100, offset = 0 } = {}) {
  const res = await wixApiRequest("/bookings/v2/services/query", {
    method: "POST",
    body: {
      query: {
        filter: { hidden: false },
        paging: { limit, offset },
      },
    },
  });
  const services = res?.services ?? [];
  const total = res?.pagingMetadata?.total ?? services.length;
  const loaded = offset + services.length;
  return { services, total, nextOffset: loaded < total ? loaded : null };
}

/**
 * Fetch a single service by its GUID. Returns null if not found.
 * @param {string} serviceId
 * @returns {Promise<object|null>}
 */
export async function getService(serviceId) {
  const res = await wixApiRequest("/bookings/v2/services/query", {
    method: "POST",
    body: { query: { filter: { id: serviceId }, paging: { limit: 1 } } },
  });
  return res?.services?.[0] ?? null;
}

/**
 * Total number of visitor-visible services. Used for empty-state logic.
 * @returns {Promise<number>}
 */
export async function countServices() {
  const res = await wixApiRequest("/bookings/v2/services/query", {
    method: "POST",
    body: { query: { filter: { hidden: false }, paging: { limit: 1 } } },
  });
  return res?.pagingMetadata?.total ?? (res?.services?.length ?? 0);
}

/**
 * List bookable time slots for an **APPOINTMENT** service within a local date range (availability
 * comes from staff working hours). For **CLASS / COURSE** services (booked against scheduled
 * sessions) use `listEventTimeSlots` — this endpoint returns an empty list for them, silently.
 * If you render a mixed catalog, route by `service.type` via `listSlotsForService`.
 * Dates are LOCAL ("YYYY-MM-DDThh:mm:ss") in timeZone.
 * https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md
 * @param {string} serviceId
 * @param {{ fromLocalDate: string, toLocalDate: string, timeZone?: string, limit?: number, cursor?: string }} options
 * @returns {Promise<{ slots: object[], nextCursor: string|null }>}
 */
export async function listAvailableSlots(serviceId, { fromLocalDate, toLocalDate, timeZone, limit = 1000, cursor } = {}) {
  if (!cursor && (!fromLocalDate || !toLocalDate)) {
    throw new Error("listAvailableSlots requires fromLocalDate and toLocalDate (local 'YYYY-MM-DDThh:mm:ss').");
  }
  const body = cursor
    ? { cursorPaging: { limit, cursor } }
    : {
        serviceId,
        bookable: true,
        fromLocalDate,
        toLocalDate,
        timeZone: timeZone || defaultTimeZone(),
        cursorPaging: { limit },
      };
  const res = await wixApiRequest("/_api/service-availability/v2/time-slots", { method: "POST", body });
  return {
    slots: res?.timeSlots ?? [],
    nextCursor: res?.cursorPagingMetadata?.cursors?.next ?? null,
  };
}

/**
 * Re-validate a specific appointment slot right before booking, and fetch its available
 * resources (staff). Always re-check before createBooking — slots can be taken between listing
 * and booking. Returns the slot or null if it's gone.
 * https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/get-availability-time-slot.md
 * @param {string} serviceId
 * @param {{ localStartDate: string, localEndDate: string, timeZone?: string, location?: object }} options
 * @returns {Promise<object|null>}
 */
export async function getAvailableSlot(serviceId, { localStartDate, localEndDate, timeZone, location } = {}) {
  if (!localStartDate || !localEndDate) {
    throw new Error("getAvailableSlot requires localStartDate and localEndDate.");
  }
  const res = await wixApiRequest("/_api/service-availability/v2/time-slots/get", {
    method: "POST",
    body: {
      serviceId,
      localStartDate,
      localEndDate,
      timeZone: timeZone || defaultTimeZone(),
      ...(location ? { location } : {}),
    },
  });
  return res?.timeSlot ?? null;
}

/**
 * List bookable session slots for **CLASS / COURSE** services within a local date range. These
 * services are booked against scheduled sessions (calendar events), not staff working hours, so
 * they use a different endpoint than appointments. Each returned slot carries `eventInfo.eventId`
 * (the session) and has **no** `scheduleId` — `createBooking` reads that `eventId`.
 * Dates are LOCAL ("YYYY-MM-DDThh:mm:ss") in timeZone.
 * https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-event-time-slots.md
 * @param {string|string[]} serviceIds  One service id or several (the endpoint takes a plural list).
 * @param {{ fromLocalDate: string, toLocalDate: string, timeZone?: string, limit?: number, cursor?: string }} options
 * @returns {Promise<{ slots: object[], nextCursor: string|null }>}
 */
export async function listEventTimeSlots(serviceIds, { fromLocalDate, toLocalDate, timeZone, limit = 1000, cursor } = {}) {
  if (!cursor && (!fromLocalDate || !toLocalDate)) {
    throw new Error("listEventTimeSlots requires fromLocalDate and toLocalDate (local 'YYYY-MM-DDThh:mm:ss').");
  }
  const ids = Array.isArray(serviceIds) ? serviceIds : [serviceIds];
  const body = cursor
    ? { cursorPaging: { limit, cursor } }
    : {
        serviceIds: ids,
        bookable: true,
        fromLocalDate,
        toLocalDate,
        timeZone: timeZone || defaultTimeZone(),
        cursorPaging: { limit },
      };
  const res = await wixApiRequest("/_api/service-availability/v2/time-slots/event", { method: "POST", body });
  return {
    slots: res?.timeSlots ?? [],
    nextCursor: res?.cursorPagingMetadata?.cursors?.next ?? null,
  };
}

/**
 * Type-agnostic convenience: list bookable slots for a service, routing to the right endpoint by
 * `service.type` — APPOINTMENT → `listAvailableSlots`, CLASS/COURSE → `listEventTimeSlots`. The
 * returned slots are shaped the same either way (`localStartDate`/`localEndDate`/`location`/
 * `availableResources`), and each is bookable via `createBooking`.
 * NOTE: a **COURSE** is enrolled as a whole (not per session), so it typically returns **no** slots
 * here — the per-slot booking flow applies to APPOINTMENT and CLASS.
 * @param {{ _id?: string, id?: string, type?: string }} service  A service from queryServices.
 * @param {{ fromLocalDate: string, toLocalDate: string, timeZone?: string, limit?: number, cursor?: string }} options
 * @returns {Promise<{ slots: object[], nextCursor: string|null }>}
 */
export async function listSlotsForService(service, options = {}) {
  const serviceId = service?._id || service?.id;
  if (!serviceId) throw new Error("listSlotsForService requires a service with an id.");
  return service?.type === "CLASS" || service?.type === "COURSE"
    ? listEventTimeSlots(serviceId, options)
    : listAvailableSlots(serviceId, options);
}
