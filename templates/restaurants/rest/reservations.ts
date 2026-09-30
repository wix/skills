// Table reservations over REST — the twin of app/wix/restaurants/reservations.ts. Same exports,
// same DTOs; rules and mappers from reservations-core (the SAME file the SDK transport uses,
// deployed flat next to this one). The flow is location → AVAILABLE slots → (AUTOMATIC approval)
// hold → reserve, or (MANUAL approval) one create with details + reservee and no hold; a
// reservation is a hold, not a purchase — no cart, no checkout. Every call here is a visitor's own
// action with the visitor token. The hold, reserve, and create calls are premium-gated on the site:
// a non-premium site answers 428 "site must be premium" — surface it, don't retry.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/time-slots/get-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/create-held-reservation.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/reserve-reservation.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/create-reservation.md
import { wixRequest } from "./client.js";
import { availableSlots, reservationBody, reserveeBody, toConfirmation, toHold, toLocations } from "./reservations-core.js";
import type { Raw } from "./menu-core.js";
import type {
  ReservationConfirmation,
  ReservationFormConfig,
  ReservationHold,
  ReservationLocationInfo,
  ReservationReservee,
  ReservationSlot,
} from "./types.js";

const RESERVATIONS = "/table-reservations/reservations/v1";

/**
 * The locations to offer: those with online reservations ENABLED (default first), or only the
 * default one when none is enabled (then `onlineReservationsEnabled: false` → render an honest
 * notice); [] when Table Reservations isn't set up. Each carries name, address, timezone, approval
 * rule, and the owner's form configuration.
 * GET /table-reservations/reservation-locations/v1/reservation-locations
 */
export async function fetchReservationLocations(): Promise<ReservationLocationInfo[]> {
  const res = await wixRequest<Raw>("/table-reservations/reservation-locations/v1/reservation-locations", { method: "GET" });
  return toLocations(res?.reservationLocations ?? []);
}

/**
 * AVAILABLE slots around a moment for a party size (UNAVAILABLE / NON_WORKING_HOURS dropped);
 * `aroundIso` is built in the location's zone (`zonedIso`), labels and day keys use `timeZone`.
 * POST /table-reservations/reservations/v1/time-slots  { reservationLocationId, date, partySize, slotsBefore, slotsAfter }
 */
export async function fetchReservationSlots(
  locationId: string,
  aroundIso: string,
  partySize: number,
  { timeZone = "", slotsBefore = 6, slotsAfter = 6 }: { timeZone?: string; slotsBefore?: number; slotsAfter?: number } = {},
): Promise<ReservationSlot[]> {
  const res = await wixRequest<Raw>(`${RESERVATIONS}/time-slots`, {
    body: { reservationLocationId: locationId, date: new Date(aroundIso).toISOString(), partySize, slotsBefore, slotsAfter },
  });
  return availableSlots(res?.timeSlots ?? [], timeZone);
}

/**
 * Hold a slot for 10 minutes while the visitor enters their details (AUTOMATIC approval); the hold's
 * { reservationId, revision } feed completeReservation, `expiresAtIso` a countdown.
 * POST /table-reservations/reservations/v1/reservations/hold  { reservationDetails: { reservationLocationId, startDate, partySize } }
 */
export async function holdReservation(locationId: string, startIso: string, partySize: number): Promise<ReservationHold> {
  const res = await wixRequest<Raw>(`${RESERVATIONS}/reservations/hold`, {
    body: { reservationDetails: { reservationLocationId: locationId, startDate: new Date(startIso).toISOString(), partySize } },
  });
  return toHold(res, startIso, partySize);
}

/**
 * Complete a held reservation with the visitor's details, validated against the location's `form`
 * (firstName + phone always; lastName/email/custom fields as configured); an expired hold can't be
 * reserved — start a fresh hold. The outcome carries the API's real status.
 * POST /table-reservations/reservations/v1/reservations/{reservationId}/reserve
 *   { revision, reservee: { firstName, phone, lastName?, email?, marketingConsent?, customFields? } }
 */
export async function completeReservation(
  hold: Pick<ReservationHold, "reservationId" | "revision">,
  reservee: ReservationReservee,
  form: ReservationFormConfig,
): Promise<ReservationConfirmation> {
  const body = reserveeBody(reservee, form);
  const res = await wixRequest<Raw>(`${RESERVATIONS}/reservations/${encodeURIComponent(hold.reservationId)}/reserve`, {
    body: { revision: hold.revision, reservee: body },
  });
  return toConfirmation(res);
}

/**
 * Request a reservation that needs the restaurant's approval (MANUAL, or a large party under
 * MANUAL_FOR_LARGE_PARTIES): ONE create with details + reservee, no hold. Normally ends REQUESTED (pending).
 * POST /table-reservations/reservations/v1/reservations
 *   { reservation: { details: { reservationLocationId, startDate, partySize }, reservee: { … } } }
 */
export async function requestReservation(
  locationId: string,
  startIso: string,
  partySize: number,
  reservee: ReservationReservee,
  form: ReservationFormConfig,
): Promise<ReservationConfirmation> {
  const reservation = reservationBody(locationId, new Date(startIso).toISOString(), partySize, reservee, form);
  const res = await wixRequest<Raw>(`${RESERVATIONS}/reservations`, { body: { reservation } });
  return toConfirmation(res);
}
