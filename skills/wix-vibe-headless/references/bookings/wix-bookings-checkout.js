import { wixApiRequest } from "./wix-client.js";

// Data model reference: see INSTRUCTIONS.md
// Service and TimeSlot shapes: see wix-bookings-services.js

// Wix Bookings app id — required inside catalogReference for the eCommerce checkout.
const BOOKINGS_APP_ID = "13d21c63-b5ec-5912-8397-c3a5ddb27a97";

/**
 * Wix Bookings Booking (Bookings Writer V2) — what createBooking returns.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md
 *
 *   id {string}, status "CREATED" (not yet on calendar; confirmed after hosted checkout),
 *   paymentStatus {string} — "NOT_PAID" until checkout completes,
 *   bookedEntity.slot {object} — { serviceId, scheduleId, startDate, endDate, timezone, location },
 *   contactDetails {object}, totalParticipants {number}
 */

/** Visitor's local IANA time zone — used as default for the booking timezone. */
function defaultTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Create a booking for a slot. The booking starts as status "CREATED" and is NOT yet on the
 * calendar — it is confirmed automatically after the buyer completes the hosted checkout (call
 * checkoutBooking next). selectedPaymentOption is "ONLINE".
 *
 * Works for **both** service types — it reads the discriminator off the slot:
 *  - APPOINTMENT slot (from `listAvailableSlots`/`getAvailableSlot`) carries `scheduleId`.
 *  - CLASS/COURSE slot (from `listEventTimeSlots`) carries `eventInfo.eventId` and no `scheduleId`;
 *    Wix derives the session's date/resource/location from that event.
 * For appointments, call `getAvailableSlot` first to re-validate and get staff (`availableResources`).
 * Throws on an unbookable slot or missing booking id.
 * https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/create-booking.md
 *
 * @param {object} slot                       A TimeSlot from listAvailableSlots/getAvailableSlot/listEventTimeSlots.
 * @param {{ firstName?: string, lastName?: string, email: string, phone?: string }} contactDetails
 * @param {{ totalParticipants?: number, timeZone?: string, title?: string }} [options]
 * @returns {Promise<object>} The created booking (status "CREATED").
 */
export async function createBooking(slot, contactDetails, { totalParticipants = 1, timeZone, title } = {}) {
  if (!slot || slot.bookable === false) {
    throw new Error("Cannot book: the selected slot is not bookable. Re-check availability and pick another time.");
  }
  // A slot is bound either by scheduleId (appointment) or by eventInfo.eventId (class/course).
  const eventId = slot.eventInfo?.eventId;
  if (!slot.serviceId || (!slot.scheduleId && !eventId) || !slot.localStartDate || !slot.localEndDate) {
    throw new Error("Cannot book: slot is missing serviceId, localStartDate/localEndDate, and a scheduleId (appointment) or eventInfo.eventId (class/course).");
  }
  if (!contactDetails?.email) {
    throw new Error("Cannot book: contactDetails.email is required.");
  }

  const resource = slot.availableResources?.[0]?.resources?.[0];

  // The availability slot's location uses the SERVICE location enum (e.g. "BUSINESS"), but the
  // createBooking endpoint expects the BOOKING location enum [UNDEFINED, OWNER_BUSINESS,
  // OWNER_CUSTOM, CUSTOM]. Passing slot.location straight through 400s
  // ("slot.location.locationType enum must be in [...]"). Remap before sending.
  const bookingLocation = (() => {
    const loc = slot.location;
    if (!loc) return null;
    const valid = ["UNDEFINED", "OWNER_BUSINESS", "OWNER_CUSTOM", "CUSTOM"];
    const map = { BUSINESS: "OWNER_BUSINESS", CUSTOM: "CUSTOM", CUSTOMER: "CUSTOM" };
    const locationType = map[loc.locationType] || (valid.includes(loc.locationType) ? loc.locationType : "OWNER_BUSINESS");
    return { ...loc, locationType };
  })();

  const bookedSlot = {
    serviceId: slot.serviceId,
    // Appointment → scheduleId; class/course → eventId. Send exactly one.
    ...(eventId ? { eventId } : { scheduleId: slot.scheduleId }),
    startDate: slot.localStartDate,
    endDate: slot.localEndDate,
    timezone: timeZone || defaultTimeZone(),
    ...(bookingLocation ? { location: bookingLocation } : {}),
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
 * Redirect the buyer there (window.location.href = ...). On return, the booking is confirmed.
 * Throws if no redirect URL is produced.
 * https://dev.wix.com/docs/rest/business-solutions/e-commerce/checkout/create-checkout.md
 * @param {string} bookingId  booking.id from createBooking().
 * @returns {Promise<string>} The hosted-checkout URL to redirect to.
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
