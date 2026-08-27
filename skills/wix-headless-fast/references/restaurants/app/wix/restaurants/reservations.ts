// Table reservations (@wix/table-reservations) — the only file that touches raw reservation
// entities. Copy as-is; extend by calling these exports, never by editing them.
//
// The flow is location → AVAILABLE slots → hold (10-minute temporary reservation) → reserve
// with the visitor's details. A reservation is a hold, not a purchase — no cart, no checkout.
// getTimeSlots takes POSITIONAL args and a Date (not an ISO string); reserveReservation takes
// THREE positional args (id, reservee, revision) and the only exit from HELD is reserve.
// Failures are loud — surface the message, don't swallow it.
import { reservationLocations, timeSlots, reservations as reservationsModule } from "@wix/table-reservations";
import { wixModule } from "../sdk";
import type {
  ReservationConfirmation,
  ReservationHold,
  ReservationLocationInfo,
  ReservationReservee,
  ReservationSlot,
} from "./types";

const locationsApi = wixModule(reservationLocations);
const timeSlotsApi = wixModule(timeSlots);
const reservationsApi = wixModule(reservationsModule);

type Raw = Record<string, any>;

/**
 * Active (non-archived) reservation locations, default first. [] when Table Reservations
 * isn't set up. `onlineReservationsEnabled: false` means the premium-gated toggle is off —
 * slots and booking won't work; render an honest "reservations aren't open yet" state.
 */
export async function fetchReservationLocations(): Promise<ReservationLocationInfo[]> {
  const res: Raw = await locationsApi.listReservationLocations();
  return (res.reservationLocations ?? [])
    .filter((l: Raw) => l.archived !== true)
    .map((l: Raw): ReservationLocationInfo => {
      const online = l.configuration?.onlineReservations ?? {};
      return {
        id: l._id ?? "",
        default: l.default === true,
        partySizeMin: online.partySize?.min ?? 1,
        partySizeMax: online.partySize?.max ?? 20,
        approvalMode: online.approval?.mode ?? "AUTOMATIC",
        onlineReservationsEnabled: online.onlineReservationsEnabled === true,
      };
    })
    .filter((l: ReservationLocationInfo) => l.id)
    .sort((a: ReservationLocationInfo, b: ReservationLocationInfo) => Number(b.default) - Number(a.default));
}

function toSlot(raw: Raw): ReservationSlot {
  const start: Date = raw.startDate instanceof Date ? raw.startDate : new Date(raw.startDate);
  let label = "";
  let dayKey = "";
  try {
    label = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const pad = (n: number) => String(n).padStart(2, "0");
    dayKey = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  } catch {
    /* label/dayKey stay "" — startIso still books */
  }
  return {
    startIso: start.toISOString(),
    label,
    dayKey,
    durationMinutes: raw.duration ?? 0,
    manualApproval: raw.manualApproval === true,
  };
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
  const res: Raw = await timeSlotsApi.getTimeSlots(locationId, new Date(aroundIso), partySize, {
    slotsBefore,
    slotsAfter,
  });
  return (res.timeSlots ?? [])
    .filter((s: Raw) => s.status === "AVAILABLE")
    .map((s: Raw) => toSlot(s));
}

/**
 * Hold a slot for 10 minutes while the visitor enters their details. The returned hold
 * carries the { reservationId, revision } that completeReservation NEEDS — keep both.
 */
export async function holdReservation(
  locationId: string,
  startIso: string,
  partySize: number,
): Promise<ReservationHold> {
  const res: Raw = await reservationsApi.createHeldReservation({
    reservationLocationId: locationId,
    startDate: new Date(startIso),
    partySize,
  });
  const reservationId = res.reservation?._id;
  const revision = res.reservation?.revision;
  if (!reservationId || !revision) {
    throw new Error("That time couldn't be held — it may have just been taken. Pick another slot.");
  }
  return { reservationId, revision, startIso, partySize };
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
  if (!reservee.firstName?.trim() || !reservee.phone?.trim()) {
    throw new Error("First name and phone number are required.");
  }
  const res: Raw = await reservationsApi.reserveReservation(
    hold.reservationId,
    {
      firstName: reservee.firstName.trim(),
      phone: reservee.phone.trim(),
      ...(reservee.lastName?.trim() ? { lastName: reservee.lastName.trim() } : {}),
      ...(reservee.email?.trim() ? { email: reservee.email.trim() } : {}),
    },
    hold.revision,
  );
  const reservation = res.reservation;
  if (!reservation?._id) {
    throw new Error("The reservation couldn't be completed — the hold may have expired. Start over.");
  }
  return {
    reservationId: reservation._id,
    status: reservation.status === "REQUESTED" ? "REQUESTED" : "RESERVED",
  };
}
