// Table-reservation rules and DTO mapping — transport-agnostic, imported by both
// ./reservations.ts (SDK) and the REST twin in references/restaurants/rest/reservations.ts (fetch).
// The flow is location → AVAILABLE slots → hold (10-minute temporary reservation) → reserve with
// the visitor's details; a reservation is a hold, not a purchase. Raw entities carry `_id` (SDK)
// or `id` (REST); slot dates arrive as Date (SDK) or ISO string (REST). Imports are type-only.
import type {
  ReservationConfirmation,
  ReservationHold,
  ReservationLocationInfo,
  ReservationReservee,
  ReservationSlot,
} from "./types";
import type { Raw } from "./menu-core";

export const rawId = (raw: Raw | undefined | null): string => raw?._id ?? raw?.id ?? "";

export function toLocation(raw: Raw): ReservationLocationInfo {
  const online = raw.configuration?.onlineReservations ?? {};
  return {
    id: rawId(raw),
    default: raw.default === true,
    partySizeMin: online.partySize?.min ?? 1,
    partySizeMax: online.partySize?.max ?? 20,
    approvalMode: online.approval?.mode ?? "AUTOMATIC",
    onlineReservationsEnabled: online.onlineReservationsEnabled === true,
  };
}

/** Active (non-archived) locations, default first. `onlineReservationsEnabled: false` → the premium-gated toggle is off. */
export function toLocations(raws: Raw[]): ReservationLocationInfo[] {
  return raws
    .filter((l) => l.archived !== true)
    .map(toLocation)
    .filter((l) => l.id)
    .sort((a, b) => Number(b.default) - Number(a.default));
}

export function toSlot(raw: Raw): ReservationSlot {
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

/** AVAILABLE slots only — UNAVAILABLE and NON_WORKING_HOURS are dropped (offering them makes the hold fail). */
export function availableSlots(raws: Raw[]): ReservationSlot[] {
  return raws.filter((s) => s.status === "AVAILABLE").map(toSlot);
}

/** The hold's { reservationId, revision } that completeReservation NEEDS; throws when the slot wasn't held. */
export function toHold(res: Raw | null | undefined, startIso: string, partySize: number): ReservationHold {
  const reservationId = rawId(res?.reservation);
  const revision = res?.reservation?.revision;
  if (!reservationId || !revision) {
    throw new Error("That time couldn't be held — it may have just been taken. Pick another slot.");
  }
  return { reservationId, revision: String(revision), startIso, partySize };
}

/** The reservee body of a reserve: firstName + phone (E.164) REQUIRED, trimmed; optional fields only when filled. */
export function reserveeBody(reservee: ReservationReservee): Raw {
  if (!reservee.firstName?.trim() || !reservee.phone?.trim()) {
    throw new Error("First name and phone number are required.");
  }
  return {
    firstName: reservee.firstName.trim(),
    phone: reservee.phone.trim(),
    ...(reservee.lastName?.trim() ? { lastName: reservee.lastName.trim() } : {}),
    ...(reservee.email?.trim() ? { email: reservee.email.trim() } : {}),
  };
}

/** RESERVED = confirmed; REQUESTED = pending approval. Throws when the hold expired (no reservation back). */
export function toConfirmation(res: Raw | null | undefined): ReservationConfirmation {
  const reservation = res?.reservation;
  const reservationId = rawId(reservation);
  if (!reservationId) {
    throw new Error("The reservation couldn't be completed — the hold may have expired. Start over.");
  }
  return { reservationId, status: reservation.status === "REQUESTED" ? "REQUESTED" : "RESERVED" };
}
