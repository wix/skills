// The table-reservation state machine as a framework-free store — the logic behind useReservation,
// usable from React (useReservation wraps it), from a static page or Vue/Svelte, or as the
// specification for a port. Location, date + party size (in the LOCATION's timezone), AVAILABLE
// slots, then one of two paths Wix's own code takes: AUTOMATIC approval → a 10-minute hold with a
// countdown → the details form → reserve; MANUAL approval (or a large party) → the details form →
// one createReservation, no hold. All correctness (AVAILABLE-only slots, hold → reserve with the
// revision, the form rules from the location's configuration, the real status) lives in the data
// layer; this store orchestrates. Browser-only: availability is time-specific. One store per
// mounted surface: createReservationStore(), `start()` when mounted, `stop()` when unmounted.
import { completeReservation, fetchReservationLocations, fetchReservationSlots, holdReservation, requestReservation } from "./reservations";
import { holdSecondsLeft as secondsLeft, resolveApproval, validateReservee } from "./reservations-core";
import { zonedDayKey, zonedIso } from "./time-core";
import type { ReservationConfirmation, ReservationHold, ReservationLocationInfo, ReservationReservee, ReservationSlot } from "./types";

/** Everything a reservation surface renders from. Read it with getState() or through a subscription. */
export interface ReservationState {
  /** null while loading; [] when Table Reservations isn't set up (honest empty state). */
  locations: ReservationLocationInfo[] | null;
  /** The active location (default first). Render a picker only when locations.length > 1. */
  location: ReservationLocationInfo | null;
  /** "YYYY-MM-DD" in the location's timezone, for a date input. */
  date: string;
  /** "HH:mm" anchor for the slot fan-out, wall clock at the restaurant. */
  time: string;
  /** Clamped to the location's partySizeMin/Max. */
  partySize: number;
  /** How this party at this location is approved: AUTOMATIC → hold then reserve; MANUAL → request, pending approval. */
  approval: "AUTOMATIC" | "MANUAL";
  /** AVAILABLE slots for the current query; null until findSlots ran. */
  slots: ReservationSlot[] | null;
  /** The slot the visitor picked (both paths) — render the details form when set. */
  selectedSlot: ReservationSlot | null;
  /** Set after a successful hold (AUTOMATIC path only) — the visitor has 10 minutes to confirm. */
  held: ReservationHold | null;
  /** Seconds until the hold lapses, ticking; null when nothing is held. */
  holdSecondsLeft: number | null;
  reservee: ReservationReservee;
  /** Validation messages per field (firstName, lastName, phone, email, custom:<id>) against the location's form; {} when valid. */
  fieldErrors: Record<string, string>;
  /** True when a slot is picked (and held, on the AUTOMATIC path), the form validates, and nothing is in flight — gate the CTA. */
  canConfirm: boolean;
  /** Set on success. Only outcome "confirmed" is a confirmed table; "pending" awaits the restaurant. */
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
  /** Pick a slot: AUTOMATIC approval holds it for 10 minutes; MANUAL approval just selects it (no hold). Then render the form. */
  holdSlot(slot: ReservationSlot): Promise<void>;
  setReserveeField(field: "firstName" | "lastName" | "phone" | "email", value: string): void;
  setMarketingConsent(value: boolean): void;
  setCustomField(id: string, value: string): void;
  /** Reserve the held slot, or send the approval request — by `approval`. */
  confirm(): Promise<void>;
  /** Back to slot picking (keeps date/party). */
  reset(): void;
}

export function createReservationStore(): ReservationStore {
  let locations: ReservationLocationInfo[] | null = null;
  let locationId: string | null = null;
  let date = zonedDayKey(new Date(), "");
  let time = "19:00";
  let partySize = 2;
  let slots: ReservationSlot[] | null = null;
  let selectedSlot: ReservationSlot | null = null;
  let held: ReservationHold | null = null;
  let holdSecondsLeft: number | null = null;
  let reservee: ReservationReservee = { firstName: "", phone: "", lastName: "", email: "", customFields: {} };
  let confirmed: ReservationConfirmation | null = null;
  let loading = false;
  let error: string | null = null;
  let started = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const listeners = new Set<() => void>();
  let snapshot: ReservationState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  const currentLocation = (): ReservationLocationInfo | null => locations?.find((l) => l.id === locationId) ?? locations?.[0] ?? null;
  const approvalFor = (loc: ReservationLocationInfo | null): "AUTOMATIC" | "MANUAL" => (loc ? resolveApproval(loc, partySize) : "AUTOMATIC");

  const clearTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
    holdSecondsLeft = null;
  };
  const startTimer = () => {
    clearTimer();
    if (!held) return;
    holdSecondsLeft = secondsLeft(held);
    timer = setInterval(() => {
      if (!held) return clearTimer();
      holdSecondsLeft = secondsLeft(held);
      if (holdSecondsLeft <= 0) {
        // The hold lapsed: the reservation can't be reserved any more — back to slot picking.
        held = null; selectedSlot = null; clearTimer();
        error = "The hold expired — pick a time again.";
      }
      emit();
    }, 1000);
  };

  /** Apply a (new) location: date in its zone, party clamped to its bounds, the form's defaults. */
  const adoptLocation = (loc: ReservationLocationInfo | null) => {
    if (!loc) return;
    date = zonedDayKey(new Date(), loc.timeZone);
    partySize = Math.min(Math.max(partySize, loc.partySizeMin), Math.max(loc.partySizeMax, loc.partySizeMin));
    reservee = { ...reservee, marketingConsent: loc.form.marketingCheckbox ? loc.form.marketingCheckbox.checkedByDefault : undefined };
  };

  function getState(): ReservationState {
    if (snapshot) return snapshot;
    const location = currentLocation();
    const approval = approvalFor(location);
    const check = location ? validateReservee(reservee, location.form) : { ok: false, errors: {} };
    const picked = approval === "MANUAL" ? !!selectedSlot : !!held;
    snapshot = {
      locations,
      location,
      date,
      time,
      partySize,
      approval,
      slots,
      selectedSlot,
      held,
      holdSecondsLeft,
      reservee,
      fieldErrors: check.errors,
      canConfirm: picked && check.ok && !loading,
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
          adoptLocation(currentLocation());
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
      clearTimer();
    },
    setLocationId(id) {
      if (id === locationId) return;
      locationId = id;
      slots = null; selectedSlot = null; held = null; clearTimer();
      adoptLocation(currentLocation());
      emit();
    },
    setDate(next) { date = next; emit(); },
    setTime(next) { time = next; emit(); },
    setPartySize(size) {
      const loc = currentLocation();
      const min = loc?.partySizeMin ?? 1;
      const max = Math.max(loc?.partySizeMax ?? 1, min);
      partySize = Math.min(Math.max(size, min), max);
      emit();
    },
    async findSlots() {
      const loc = currentLocation();
      if (!loc) return;
      error = null; slots = null; selectedSlot = null; held = null; confirmed = null; loading = true; clearTimer();
      emit();
      try {
        // The anchor is the restaurant's wall clock, not the visitor's.
        const aroundIso = zonedIso(date, time, loc.timeZone);
        if (!aroundIso) throw new Error("Pick a date and a time.");
        slots = await fetchReservationSlots(loc.id, aroundIso, partySize, { timeZone: loc.timeZone });
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
      error = null;
      // Manual approval (the location's mode, or the slot says so): no hold — the form leads to a request.
      if (approvalFor(loc) === "MANUAL" || slot.manualApproval) {
        selectedSlot = slot; held = null; clearTimer();
        emit();
        return;
      }
      loading = true;
      emit();
      try {
        held = await holdReservation(loc.id, slot.startIso, partySize);
        selectedSlot = slot;
        startTimer();
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
    setMarketingConsent(value) {
      reservee = { ...reservee, marketingConsent: value };
      emit();
    },
    setCustomField(id, value) {
      reservee = { ...reservee, customFields: { ...(reservee.customFields ?? {}), [id]: value } };
      emit();
    },
    async confirm() {
      const loc = currentLocation();
      if (!loc || !selectedSlot) return;
      const manual = approvalFor(loc) === "MANUAL" || selectedSlot.manualApproval || !held;
      if (!manual && !held) return;
      error = null; loading = true;
      emit();
      try {
        confirmed = manual
          ? await requestReservation(loc.id, selectedSlot.startIso, partySize, reservee, loc.form)
          : await completeReservation(held!, reservee, loc.form);
        held = null; selectedSlot = null; clearTimer();
      } catch (e) {
        error = fail(e);
        // A validation message keeps the form; anything else on the hold path means the hold is gone.
        if (!manual && !/required|valid|too long|country code/i.test(error)) {
          held = null; selectedSlot = null; clearTimer();
        }
      } finally {
        loading = false;
        emit();
      }
    },
    reset() {
      held = null; selectedSlot = null; confirmed = null; slots = null; error = null; clearTimer();
      emit();
    },
  };
}
