// Table reservations (@wix/table-reservations) over the SDK — the only file that touches raw
// reservation entities on this transport. Rules and mappers live in ./reservations-core (shared
// with the REST twin in references/restaurants/rest/); this file is the transport only. Copy
// as-is; extend by calling these exports, never by editing them.
//
// getTimeSlots takes POSITIONAL args and a Date (not an ISO string); reserveReservation takes
// THREE positional args (id, reservee, revision) and the only exit from HELD is reserve.
// Failures are loud — surface the message, don't swallow it.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/list-reservation-locations.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/time-slots/get-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/create-held-reservation.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/reserve-reservation.md
import { reservationLocations, timeSlots, reservations as reservationsModule } from "@wix/table-reservations";
import { wixModule } from "../sdk";
import { availableSlots, reserveeBody, toConfirmation, toHold, toLocations } from "./reservations-core";
import type { Raw } from "./menu-core";
import type { ReservationConfirmation, ReservationHold, ReservationLocationInfo, ReservationReservee, ReservationSlot } from "./types";

const locationsApi = wixModule(reservationLocations);
const timeSlotsApi = wixModule(timeSlots);
const reservationsApi = wixModule(reservationsModule);

/**
 * Active (non-archived) reservation locations, default first. [] when Table Reservations
 * isn't set up. `onlineReservationsEnabled: false` means the premium-gated toggle is off —
 * slots and booking won't work; render an honest "reservations aren't open yet" state.
 */
export async function fetchReservationLocations(): Promise<ReservationLocationInfo[]> {
  const res: Raw = await locationsApi.listReservationLocations();
  return toLocations(res.reservationLocations ?? []);
}

/**
 * AVAILABLE reservation slots around a moment for a party size — UNAVAILABLE and
 * NON_WORKING_HOURS slots are already filtered out (offering them makes the hold fail).
 * `aroundIso` anchors the fan-out: slotsBefore/slotsAfter extra slots on each side.
 */
export async function fetchReservationSlots(
  locationId: string,
  aroundIso: string,
  partySize: number,
  { slotsBefore = 6, slotsAfter = 6 }: { slotsBefore?: number; slotsAfter?: number } = {},
): Promise<ReservationSlot[]> {
  // The date param is a Date — the SDK types it as Date, not the ISO string the docs show.
  const res: Raw = await timeSlotsApi.getTimeSlots(locationId, new Date(aroundIso), partySize, { slotsBefore, slotsAfter });
  return availableSlots(res.timeSlots ?? []);
}

/**
 * Hold a slot for 10 minutes while the visitor enters their details. The returned hold
 * carries the { reservationId, revision } that completeReservation NEEDS — keep both.
 */
export async function holdReservation(locationId: string, startIso: string, partySize: number): Promise<ReservationHold> {
  const res: Raw = await reservationsApi.createHeldReservation({
    reservationLocationId: locationId,
    startDate: new Date(startIso),
    partySize,
  });
  return toHold(res, startIso, partySize);
}

/**
 * Complete a held reservation with the visitor's details. firstName and phone (E.164, e.g.
 * "+15551234567") are REQUIRED. A hold expires after 10 minutes — on failure, start a fresh
 * hold; never try to update a HELD reservation by other means.
 */
export async function completeReservation(
  hold: Pick<ReservationHold, "reservationId" | "revision">,
  reservee: ReservationReservee,
): Promise<ReservationConfirmation> {
  const body = reserveeBody(reservee);
  const res: Raw = await reservationsApi.reserveReservation(hold.reservationId, body, hold.revision);
  return toConfirmation(res);
}
