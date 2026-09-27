// Table reservations over REST — the twin of app/wix/restaurants/reservations.ts. Same exports,
// same DTOs; rules and mappers from reservations-core (the SAME file the SDK transport uses,
// deployed flat next to this one). The flow is location → AVAILABLE slots → hold → reserve; a
// reservation is a hold, not a purchase — no cart, no checkout. Every call here is a visitor's own
// action with the visitor token. The hold and reserve calls are premium-gated on the site: a
// non-premium site answers 428 "site must be premium" — surface it, don't retry.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/time-slots/get-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/create-held-reservation.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/reserve-reservation.md
import { wixRequest } from "./client.js";
import { availableSlots, reserveeBody, toConfirmation, toHold, toLocations } from "./reservations-core.js";
import type { Raw } from "./menu-core.js";
import type { ReservationConfirmation, ReservationHold, ReservationLocationInfo, ReservationReservee, ReservationSlot } from "./types.js";

const RESERVATIONS = "/table-reservations/reservations/v1";

/**
 * Active (non-archived) locations, default first; [] when Table Reservations isn't set up.
 * `onlineReservationsEnabled: false` → the premium-gated toggle is off; render an honest notice.
 * GET /table-reservations/reservation-locations/v1/reservation-locations
 */
export async function fetchReservationLocations(): Promise<ReservationLocationInfo[]> {
  const res = await wixRequest<Raw>("/table-reservations/reservation-locations/v1/reservation-locations", { method: "GET" });
  return toLocations(res?.reservationLocations ?? []);
}

/**
 * AVAILABLE slots around a moment for a party size (UNAVAILABLE / NON_WORKING_HOURS dropped).
 * POST /table-reservations/reservations/v1/time-slots  { reservationLocationId, date, partySize, slotsBefore, slotsAfter }
 */
export async function fetchReservationSlots(
  locationId: string,
  aroundIso: string,
  partySize: number,
  { slotsBefore = 6, slotsAfter = 6 }: { slotsBefore?: number; slotsAfter?: number } = {},
): Promise<ReservationSlot[]> {
  const res = await wixRequest<Raw>(`${RESERVATIONS}/time-slots`, {
    body: { reservationLocationId: locationId, date: new Date(aroundIso).toISOString(), partySize, slotsBefore, slotsAfter },
  });
  return availableSlots(res?.timeSlots ?? []);
}

/**
 * Hold a slot for 10 minutes while the visitor enters their details; the hold's { reservationId, revision } feed completeReservation.
 * POST /table-reservations/reservations/v1/reservations/hold  { reservationDetails: { reservationLocationId, startDate, partySize } }
 */
export async function holdReservation(locationId: string, startIso: string, partySize: number): Promise<ReservationHold> {
  const res = await wixRequest<Raw>(`${RESERVATIONS}/reservations/hold`, {
    body: { reservationDetails: { reservationLocationId: locationId, startDate: new Date(startIso).toISOString(), partySize } },
  });
  return toHold(res, startIso, partySize);
}

/**
 * Complete a held reservation. firstName and phone (E.164) are REQUIRED; an expired hold can't be
 * reserved — start a fresh hold.
 * POST /table-reservations/reservations/v1/reservations/{reservationId}/reserve  { revision, reservee: { firstName, phone, lastName?, email? } }
 */
export async function completeReservation(
  hold: Pick<ReservationHold, "reservationId" | "revision">,
  reservee: ReservationReservee,
): Promise<ReservationConfirmation> {
  const body = reserveeBody(reservee);
  const res = await wixRequest<Raw>(`${RESERVATIONS}/reservations/${encodeURIComponent(hold.reservationId)}/reserve`, {
    body: { revision: hold.revision, reservee: body },
  });
  return toConfirmation(res);
}
