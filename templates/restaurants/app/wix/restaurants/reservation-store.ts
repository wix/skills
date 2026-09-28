// The table-reservation state machine as a framework-free store — the logic behind useReservation,
// usable from React (useReservation wraps it), from a static page or Vue/Svelte, or as the
// specification for a port. Location, date + party size, AVAILABLE slots, the 10-minute hold, the
// details form, and confirm. All correctness (AVAILABLE-only slots, hold → reserve with the
// revision, firstName + E.164 phone, RESERVED vs REQUESTED) lives in the data layer; this store
// orchestrates. Browser-only: availability is timezone-specific. One store per mounted surface:
// createReservationStore(), `start()` when mounted.
import { completeReservation, fetchReservationLocations, fetchReservationSlots, holdReservation } from "./reservations";
import type { ReservationConfirmation, ReservationHold, ReservationLocationInfo, ReservationReservee, ReservationSlot } from "./types";

const todayKey = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Everything a reservation surface renders from. Read it with getState() or through a subscription. */
export interface ReservationState {
  /** null while loading; [] when Table Reservations isn't set up (honest empty state). */
  locations: ReservationLocationInfo[] | null;
  /** The active location (default first). Render a picker only when locations.length > 1. */
  location: ReservationLocationInfo | null;
  /** "YYYY-MM-DD" for a date input. */
  date: string;
  /** "HH:mm" anchor for the slot fan-out. */
  time: string;
  /** Clamped to the location's partySizeMin/Max. */
  partySize: number;
  /** AVAILABLE slots for the current query; null until findSlots ran. */
  slots: ReservationSlot[] | null;
  /** Set after holdSlot — the visitor has 10 minutes to confirm. */
  held: ReservationHold | null;
  reservee: ReservationReservee;
  /** True when a slot is held and firstName + phone are filled — gate the confirm CTA. */
  canConfirm: boolean;
  /** Set on success. REQUESTED → tell the visitor approval is pending, not confirmed. */
  confirmed: ReservationConfirmation | null;
  loading: boolean;
  error: string | null;
}

export interface ReservationStore {
  getState(): ReservationState;
  subscribe(listener: () => void): () => void;
  /** Load the locations. Call once when mounted (a browser). */
  start(): void;
  stop(): void;
  setLocationId(id: string): void;
  setDate(date: string): void;
  setTime(time: string): void;
  setPartySize(size: number): void;
  findSlots(): Promise<void>;
  holdSlot(slot: ReservationSlot): Promise<void>;
  setReserveeField(field: keyof ReservationReservee, value: string): void;
  confirm(): Promise<void>;
  /** Back to slot picking (keeps date/party). */
  reset(): void;
}

export function createReservationStore(): ReservationStore {
  let locations: ReservationLocationInfo[] | null = null;
  let locationId: string | null = null;
  let date = todayKey();
  let time = "19:00";
  let partySize = 2;
  let slots: ReservationSlot[] | null = null;
  let held: ReservationHold | null = null;
  let reservee: ReservationReservee = { firstName: "", phone: "" };
  let confirmed: ReservationConfirmation | null = null;
  let loading = false;
  let error: string | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  let snapshot: ReservationState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  const currentLocation = (): ReservationLocationInfo | null => locations?.find((l) => l.id === locationId) ?? locations?.[0] ?? null;

  function getState(): ReservationState {
    if (snapshot) return snapshot;
    snapshot = {
      locations,
      location: currentLocation(),
      date,
      time,
      partySize,
      slots,
      held,
      reservee,
      canConfirm: !!held && reservee.firstName.trim().length > 0 && reservee.phone.trim().length > 0 && !loading,
      confirmed,
      loading,
      error,
    };
    return snapshot;
  }

  const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

  return {
    getState,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      if (started) return;
      started = true;
      fetchReservationLocations()
        .then((locs) => {
          if (!started) return;
          locations = locs;
          locationId ??= locs[0]?.id ?? null;
          emit();
        })
        .catch((e) => {
          if (!started) return;
          locations = [];
          error = fail(e);
          emit();
        });
    },
    stop() {
      started = false;
    },
    setLocationId(id) { locationId = id; emit(); },
    setDate(next) { date = next; emit(); },
    setTime(next) { time = next; emit(); },
    setPartySize(size) {
      const loc = currentLocation();
      const min = loc?.partySizeMin ?? 1;
      const max = loc?.partySizeMax ?? 20;
      partySize = Math.min(Math.max(size, min), max);
      emit();
    },
    async findSlots() {
      const loc = currentLocation();
      if (!loc) return;
      error = null; slots = null; held = null; confirmed = null; loading = true;
      emit();
      try {
        const aroundIso = new Date(`${date}T${time}:00`).toISOString();
        slots = await fetchReservationSlots(loc.id, aroundIso, partySize);
      } catch (e) {
        slots = [];
        error = fail(e);
      } finally {
        loading = false;
        emit();
      }
    },
    async holdSlot(slot) {
      const loc = currentLocation();
      if (!loc) return;
      error = null; loading = true;
      emit();
      try {
        held = await holdReservation(loc.id, slot.startIso, partySize);
      } catch (e) {
        error = fail(e);
      } finally {
        loading = false;
        emit();
      }
    },
    setReserveeField(field, value) {
      reservee = { ...reservee, [field]: value };
      emit();
    },
    async confirm() {
      if (!held) return;
      error = null; loading = true;
      emit();
      try {
        confirmed = await completeReservation(held, reservee);
      } catch (e) {
        // An expired hold can't be reserved — send the visitor back to slot picking.
        error = fail(e);
        held = null;
      } finally {
        loading = false;
        emit();
      }
    },
    reset() {
      held = null; confirmed = null; slots = null; error = null;
      emit();
    },
  };
}
