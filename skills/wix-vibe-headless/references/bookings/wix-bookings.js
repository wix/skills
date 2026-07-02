import { wixApiRequest } from "./wix-client.js";

/**
 * Wix Bookings business-solution app id — required inside catalogReference when
 * creating the eCommerce checkout for a booking.
 * https://dev.wix.com/docs/rest/articles/getting-started/wix-business-solutions.md
 */
const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";

/** The visitor's local IANA time zone, used as the default for availability + booking. */
function defaultTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Wix Bookings Service (Services V2) — key fields for building a booking UI.
 * This skill ships the APPOINTMENT flow; CLASS/COURSE are "Beyond the snippets".
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
 *
 *   id                                   {string}  Service GUID. Pass to listAvailableSlots / getService.
 *   type                                 {string}  "APPOINTMENT" | "CLASS" | "COURSE". This skill books APPOINTMENT.
 *   name                                 {string}  Display name.
 *   tagLine                              {string}  Short one-line description.
 *   description                          {string}  Long description (may contain HTML).
 *   hidden                               {boolean} Whether hidden from visitors. Skill queries only hidden:false.
 *   defaultCapacity                      {number}  Max customers per booking (1 for 1:1 appointments).
 *   media.items                          {array}   Media gallery: [{ image: { id, url, width, height, altText } }].
 *                                                  image.url may be a bare Wix media handle (e.g. "abc.jpg") rather
 *                                                  than an absolute URL — pass it through mediaUrl() before rendering.
 *   payment.rateType                     {string}  "FIXED" | "CUSTOM" | "VARIED" | "NO_FEE" | "SUBSCRIPTION".
 *   payment.fixed.price                  {object}  { value, currency, formattedValue } — the price to display.
 *   payment.options                      {object}  { online, inPerson, deposit, pricingPlan } booleans.
 *   schedule.id                          {string}  Schedule GUID. Carried into the booking's bookedEntity.slot.
 *   schedule.availabilityConstraints.sessionDurations {number[]} Allowed durations in minutes.
 *   form.id                              {string}  Booking-form GUID (see "Beyond the snippets" to render it).
 *   staffMemberIds                       {string[]} Staff resource GUIDs that provide the service.
 *   locations                            {array}   [{ id, type, business: { id, name } }] where it's offered.
 *   bookingPolicy.id                     {string}  Booking-policy GUID.
 *   category                             {object}  { id, name } — group services in the UI by category.
 *   onlineBooking.enabled                {boolean} Whether the service can be booked online.
 */

/**
 * Wix Bookings TimeSlot (Time Slots V2, appointments) — what listAvailableSlots returns.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md
 *
 *   serviceId        {string}  Service GUID this slot belongs to.
 *   localStartDate   {string}  Slot start, "YYYY-MM-DDThh:mm:ss" (no zone). Display + pass to createBooking.
 *   localEndDate     {string}  Slot end, same format.
 *   bookable         {boolean} Whether it can be booked per the service's booking policies. Skill filters bookable:true.
 *   scheduleId       {string}  Schedule GUID — carried into the booking's bookedEntity.slot.
 *   location         {object}  { id, name, formattedAddress, locationType: "BUSINESS"|"CUSTOM"|"CUSTOMER" }.
 *   totalCapacity    {number}  Spots for the slot (1 for 1:1 appointments).
 *   remainingCapacity{number}  Remaining spots — for appointments, 1 (free) or 0 (taken).
 *   availableResources {array} [{ resourceTypeId, resources: [{ id, name }] }]. Empty by default in the LIST
 *                              response; call getAvailableSlot() to get the staff/resource for the chosen slot.
 *   nonBookableReasons {object} { noRemainingCapacity, violatesBookingPolicy, ... } when bookable is false.
 */

/**
 * Wix Bookings Booking (Bookings Writer V2) — what createBooking returns.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md
 *
 *   id                {string}  Booking GUID. Pass to checkoutBooking() as the checkout catalogItemId.
 *   status            {string}  "CREATED" right after creation (not yet on the calendar). Becomes "CONFIRMED"
 *                               automatically once the buyer completes the hosted checkout, or "PENDING" if the
 *                               service requires manual approval.
 *   paymentStatus     {string}  Payment state (e.g. "UNDEFINED" / "NOT_PAID" until checkout completes).
 *   bookedEntity.slot {object}  Echoes the booked slot (serviceId, scheduleId, startDate, endDate, timezone, ...).
 *   contactDetails    {object}  The buyer details submitted with the booking.
 *   totalParticipants {number}  Number of participants.
 */

/**
 * Resolve a service image to an absolute URL. Wix media fields are sometimes a bare
 * handle ("abc.jpg") rather than a full URL; this prefixes the Wix static host so the
 * image renders. Absolute URLs and `wix:image://` values are returned/normalized too.
 * @param {{ url?: string, id?: string }|string} image  A media object or a raw handle/url.
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
 * Uses offset paging (Services V2 default). Pass the next `offset` to page.
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
 * https://dev.wix.com/docs/api-reference/business-solutions/bookings/services/services-v2/query-services.md
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
 * Total number of visitor-visible services. Used for empty-state logic
 * (0 → prompt the owner to add services in the Wix dashboard). Never invent services.
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
 * List bookable appointment time slots for a service within a local date range.
 * APPOINTMENT services only (the shipped flow). For classes/courses see "Beyond the snippets".
 * Dates are LOCAL ("YYYY-MM-DDThh:mm:ss", no zone) and interpreted in `timeZone`.
 * https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/list-availability-time-slots.md
 *
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
 * resources (staff). Returns the slot or null if it's gone. Always re-check before createBooking —
 * slots can be taken between listing and booking.
 * https://dev.wix.com/docs/api-reference/business-solutions/bookings/time-slots/time-slots-v2/get-availability-time-slot.md
 *
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
 * Create a booking for an appointment slot. The booking starts as status "CREATED" and is
 * NOT yet on the calendar — it is confirmed automatically after the buyer completes the
 * hosted checkout (call checkoutBooking next). selectedPaymentOption is "ONLINE" so the
 * eCommerce checkout drives confirmation.
 *
 * Pass a `slot` object from listAvailableSlots()/getAvailableSlot() (it carries serviceId,
 * scheduleId, localStartDate, localEndDate, location, availableResources). `timeZone` defaults
 * to the slot's location-agnostic visitor zone; pass the same zone you listed slots with.
 *
 * Throws on an unbookable slot or if Wix doesn't return a booking id (fail loudly — don't let
 * the buyer continue to checkout against a dead slot).
 * https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md
 *
 * @param {object} slot                       A TimeSlot from listAvailableSlots/getAvailableSlot.
 * @param {{ firstName?: string, lastName?: string, email: string, phone?: string }} contactDetails
 * @param {{ totalParticipants?: number, timeZone?: string, title?: string }} [options]
 * @returns {Promise<object>} The created booking (status "CREATED").
 */
export async function createBooking(slot, contactDetails, { totalParticipants = 1, timeZone, title } = {}) {
  if (!slot || slot.bookable === false) {
    throw new Error("Cannot book: the selected slot is not bookable. Re-check availability and pick another time.");
  }
  if (!slot.serviceId || !slot.scheduleId || !slot.localStartDate || !slot.localEndDate) {
    throw new Error("Cannot book: slot is missing serviceId/scheduleId/localStartDate/localEndDate.");
  }
  if (!contactDetails?.email) {
    throw new Error("Cannot book: contactDetails.email is required.");
  }

  // First available resource (staff), if the slot carries one — otherwise Wix auto-assigns.
  const resource = slot.availableResources?.[0]?.resources?.[0];

  const bookedSlot = {
    serviceId: slot.serviceId,
    scheduleId: slot.scheduleId,
    startDate: slot.localStartDate,
    endDate: slot.localEndDate,
    timezone: timeZone || defaultTimeZone(),
    ...(slot.location ? { location: slot.location } : {}),
    ...(resource ? { resource: { id: resource.id, name: resource.name } } : {}),
  };

  const res = await wixApiRequest("/bookings/v2/bookings", {
    method: "POST",
    body: {
      booking: {
        bookedEntity: { slot: bookedSlot, title: title || undefined, tags: ["INDIVIDUAL"] },
        contactDetails,
        additionalFields: [],
        totalParticipants,
        selectedPaymentOption: "ONLINE",
      },
      participantNotification: { notifyParticipants: true },
    },
  });
  const booking = res?.booking;
  if (!booking?.id) throw new Error("Failed to create the booking (no booking id returned).");
  return booking;
}

/**
 * Create an eCommerce checkout for a created booking and return the hosted checkout URL.
 * Redirect the buyer there (`window.location.href = ...`). On return, the order is placed and
 * Wix Bookings confirms the booking automatically. Throws if no redirect URL is produced.
 *
 * Checkout: https://dev.wix.com/docs/rest/business-solutions/e-commerce/checkout/create-checkout.md
 * @param {string} bookingId  `booking.id` from createBooking().
 * @returns {Promise<string>} The full hosted-checkout URL to redirect to.
 */
export async function checkoutBooking(bookingId) {
  if (!bookingId) throw new Error("checkoutBooking requires a bookingId.");

  const checkoutRes = await wixApiRequest("/ecom/v1/checkouts", {
    method: "POST",
    body: {
      channelType: "WEB",
      lineItems: [
        { quantity: 1, catalogReference: { appId: BOOKINGS_APP_ID, catalogItemId: bookingId } },
      ],
    },
  });
  const checkoutId = checkoutRes?.checkout?.id;
  if (!checkoutId) throw new Error("Failed to create a checkout for the booking.");

  const redirect = await wixApiRequest("/headless/v1/redirect-session", {
    method: "POST",
    body: { ecomCheckout: { checkoutId }, callbacks: { postFlowUrl: window.location.href } },
  });
  const url = redirect?.redirectSession?.fullUrl;
  if (!url) throw new Error("Failed to create the checkout redirect session.");
  return url;
}

/**
 * Convenience: create the booking and return the hosted-checkout URL in one call.
 * Equivalent to createBooking() then checkoutBooking(booking.id). Throws loudly on any failure.
 * @param {object} slot
 * @param {{ firstName?: string, lastName?: string, email: string, phone?: string }} contactDetails
 * @param {{ totalParticipants?: number, timeZone?: string, title?: string }} [options]
 * @returns {Promise<{ booking: object, checkoutUrl: string }>}
 */
export async function bookAndCheckout(slot, contactDetails, options = {}) {
  const booking = await createBooking(slot, contactDetails, options);
  const checkoutUrl = await checkoutBooking(booking.id);
  return { booking, checkoutUrl };
}
