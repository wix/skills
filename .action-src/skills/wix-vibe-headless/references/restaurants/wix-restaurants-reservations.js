import { wixApiRequest } from "./wix-client.js";

// Data model reference: see INSTRUCTIONS.md

/**
 * ReservationLocation — a restaurant location that accepts table reservations.
 *   id {string}, default {boolean}, archived {boolean},
 *   location {object} — physical location details,
 *   configuration {object}:
 *     onlineReservations.approval.mode — "AUTOMATIC"|"MANUAL"|"MANUAL_FOR_LARGE_PARTIES"
 *     partySize.min / partySize.max — guest count limits
 *     timeSlotInterval — minutes between slots
 *     reservationForm: { lastNameRequired, emailRequired, customFieldDefinitions }
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/reservation-location-object.md
 *
 * TimeSlot (from getTimeSlots):
 *   { startDate, duration, status, manualApproval }
 *   status: "AVAILABLE" | "UNAVAILABLE" | "NON_WORKING_HOURS" — offer only AVAILABLE slots.
 *
 * Reservation (from createHeldReservation / reserveReservation):
 *   { id, revision, status, details: { reservationLocationId, startDate, endDate, partySize }, reservee, paymentStatus }
 *   status: "HELD" → "RESERVED" (auto-approved) or "REQUESTED" (manual approval required) after reserve.
 * Full model: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/reservation-object.md
 */

/**
 * List the site's reservation locations (up to 100).
 * GET https://www.wixapis.com/table-reservations/reservation-locations/v1/reservation-locations
 * @returns {Promise<object[]>}
 */
export async function listReservationLocations() {
  const res = await wixApiRequest(
    "/table-reservations/reservation-locations/v1/reservation-locations",
    { method: "GET" },
  );
  return res?.reservationLocations ?? [];
}

/**
 * Get reservation time slots for a location on a date, filtered to AVAILABLE only.
 * Use slotsBefore / slotsAfter to fan out around the chosen date.
 * POST https://www.wixapis.com/table-reservations/reservations/v1/time-slots
 * https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/time-slots/get-time-slots.md
 * @param {string} reservationLocationId
 * @param {string} date       ISO-8601 datetime e.g. "2026-07-01T19:00:00.000Z"
 * @param {number} partySize
 * @param {{ slotsBefore?: number, slotsAfter?: number, duration?: number }} [options]
 * @returns {Promise<{ timeSlots: object[], availableTimeSlots: object[] }>}
 */
export async function getTimeSlots(reservationLocationId, date, partySize, { slotsBefore = 4, slotsAfter = 4, duration } = {}) {
  if (!reservationLocationId || !date || !partySize) {
    throw new Error("getTimeSlots: reservationLocationId, date and partySize are required.");
  }
  const res = await wixApiRequest("/table-reservations/reservations/v1/time-slots", {
    method: "POST",
    body: { reservationLocationId, date, partySize, slotsBefore, slotsAfter, ...(duration ? { duration } : {}) },
  });
  const timeSlots = res?.timeSlots ?? [];
  return { timeSlots, availableTimeSlots: timeSlots.filter((s) => s.status === "AVAILABLE") };
}

/**
 * Hold a reservation for 10 minutes while the visitor fills in their details.
 * Returns a reservation with status "HELD" — keep its id and revision for reserveReservation.
 * POST https://www.wixapis.com/table-reservations/reservations/v1/reservations/hold
 * @param {string} reservationLocationId
 * @param {string} startDate  ISO-8601 datetime of the chosen time slot.
 * @param {number} partySize
 * @returns {Promise<object>} The held reservation ({ id, revision, status: "HELD", ... }).
 */
export async function createHeldReservation(reservationLocationId, startDate, partySize) {
  if (!reservationLocationId || !startDate || !partySize) {
    throw new Error("createHeldReservation: reservationLocationId, startDate and partySize are required.");
  }
  const res = await wixApiRequest("/table-reservations/reservations/v1/reservations/hold", {
    method: "POST",
    body: { reservationDetails: { reservationLocationId, startDate, partySize } },
  });
  const reservation = res?.reservation;
  if (!reservation?.id) throw new Error("Failed to hold the reservation (the slot may no longer be available).");
  return reservation;
}

/**
 * Confirm a held reservation with the visitor's details. Moves status from "HELD" to
 * "RESERVED" (auto-approval) or "REQUESTED" (manual approval required).
 * reservee.firstName and reservee.phone (E.164, e.g. "+15551234567") are REQUIRED.
 * Pass the revision returned by createHeldReservation. Holds expire after 10 minutes.
 * POST https://www.wixapis.com/table-reservations/reservations/v1/reservations/{id}/reserve
 * @param {string} reservationId
 * @param {string} revision
 * @param {{ firstName: string, phone: string, lastName?: string, email?: string, marketingConsent?: boolean }} reservee
 * @returns {Promise<object>} The updated reservation.
 */
export async function reserveReservation(reservationId, revision, reservee) {
  if (!reservationId || !revision) throw new Error("reserveReservation: reservationId and revision are required.");
  if (!reservee?.firstName || !reservee?.phone) {
    throw new Error("reserveReservation: reservee.firstName and reservee.phone are required.");
  }
  const res = await wixApiRequest(
    `/table-reservations/reservations/v1/reservations/${encodeURIComponent(reservationId)}/reserve`,
    { method: "POST", body: { revision, reservee } },
  );
  const reservation = res?.reservation;
  if (!reservation?.id) throw new Error("Failed to confirm the reservation (the hold may have expired — start over).");
  return reservation;
}
