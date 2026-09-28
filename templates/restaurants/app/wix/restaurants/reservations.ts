// Table reservations (@wix/table-reservations) over the SDK — the only file that touches raw
// reservation entities on this transport. Rules and mappers live in ./reservations-core (shared
// with the REST twin in templates/restaurants/rest/); this file is the transport only. Copy
// as-is; extend by calling these exports, never by editing them.
//
// getTimeSlots takes POSITIONAL args and a Date (not an ISO string); reserveReservation takes
// THREE positional args (id, reservee, revision) and the only exit from HELD is reserve;
// createReservation (manual approval, no hold) returns the reservation itself, unwrapped.
// Failures are loud — surface the message, don't swallow it.
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservation-locations/list-reservation-locations.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/time-slots/get-time-slots.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/create-held-reservation.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/reserve-reservation.md
// docs: https://dev.wix.com/docs/api-reference/business-solutions/restaurants/reservations/reservations/create-reservation.md
import { reservationLocations, timeSlots, reservations as reservationsModule } from "@wix/table-reservations";
import { wixModule } from "../sdk";
import { availableSlots, reservationBody, reserveeBody, toConfirmation, toHold, toLocations } from "./reservations-core";
import type { Raw } from "./menu-core";
import type {
  ReservationConfirmation,
  ReservationFormConfig,
  ReservationHold,
  ReservationLocationInfo,
  ReservationReservee,
  ReservationSlot,
} from "./types";

const locationsApi = wixModule(reservationLocations);
const timeSlotsApi = wixModule(timeSlots);
const reservationsApi = wixModule(reservationsModule);

/**
 * The reservation locations to offer: those with online reservations ENABLED (default first),
 * or only the default one when none is enabled — then `onlineReservationsEnabled: false` means
 * the premium-gated toggle is off and the surface renders an honest "reservations aren't open
 * yet" state. [] when Table Reservations isn't set up. Each carries its name, address, timezone,
 * approval rule, and the owner's form configuration.
 */
export async function fetchReservationLocations(): Promise<ReservationLocationInfo[]> {
  const res: Raw = await locationsApi.listReservationLocations();
  return toLocations(res.reservationLocations ?? []);
}

/**
 * AVAILABLE reservation slots around a moment for a party size — UNAVAILABLE and
 * NON_WORKING_HOURS slots are already filtered out (offering them makes the hold fail).
 * `aroundIso` anchors the fan-out (build it in the location's zone with `zonedIso`);
 * `timeZone` is the location's — labels and day keys are computed in it.
 */
export async function fetchReservationSlots(
  locationId: string,
  aroundIso: string,
  partySize: number,
  { timeZone = "", slotsBefore = 6, slotsAfter = 6 }: { timeZone?: string; slotsBefore?: number; slotsAfter?: number } = {},
): Promise<ReservationSlot[]> {
  // The date param is a Date — the SDK types it as Date, not the ISO string the docs show.
  const res: Raw = await timeSlotsApi.getTimeSlots(locationId, new Date(aroundIso), partySize, { slotsBefore, slotsAfter });
  return availableSlots(res.timeSlots ?? [], timeZone);
}

/**
 * Hold a slot for 10 minutes while the visitor enters their details (AUTOMATIC approval only).
 * The returned hold carries the { reservationId, revision } that completeReservation NEEDS —
 * keep both — and `expiresAtIso` for a countdown.
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
 * Complete a held reservation with the visitor's details, validated against the location's
 * `form` (firstName + phone always; lastName/email/custom fields as configured). A hold expires
 * after 10 minutes — on failure, start a fresh hold; never try to update a HELD reservation by
 * other means. The outcome carries the API's real status.
 */
export async function completeReservation(
  hold: Pick<ReservationHold, "reservationId" | "revision">,
  reservee: ReservationReservee,
  form: ReservationFormConfig,
): Promise<ReservationConfirmation> {
  const body = reserveeBody(reservee, form);
  const res: Raw = await reservationsApi.reserveReservation(hold.reservationId, body as any, hold.revision);
  return toConfirmation(res);
}

/**
 * Request a reservation that needs the restaurant's approval (MANUAL, or a large party under
 * MANUAL_FOR_LARGE_PARTIES): ONE createReservation with details + reservee, no hold — the path
 * Wix's own reservation code takes. The outcome is normally REQUESTED (pending), never confirmed.
 */
export async function requestReservation(
  locationId: string,
  startIso: string,
  partySize: number,
  reservee: ReservationReservee,
  form: ReservationFormConfig,
): Promise<ReservationConfirmation> {
  const body = reservationBody(locationId, startIso, partySize, reservee, form);
  const reservation: Raw = await reservationsApi.createReservation({
    details: { ...body.details, startDate: new Date(startIso) },
    reservee: body.reservee,
  } as any);
  return toConfirmation({ reservation });
}
