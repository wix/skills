// The whole booking state machine for one service as a framework-free store — the logic behind
// useBookingFlow, usable from React (useBookingFlow wraps it), from a static page's booking surface,
// from Vue/Svelte, or as the specification for a port: the availability window (day-grouped slots,
// week paging, optional staff filter), the schema-driven form, and book(). All correctness (slot
// scheduleId vs eventId, ANY_RESOURCE, formSubmission, payment option, checkout-or-place) lives in
// the data layer; this store orchestrates. A late response from a superseded window is dropped.
// One store per booking surface: createBookingFlowStore(service), not a singleton.
import { bookService, fetchBookingForm, fetchSlots } from "./booking";
import { groupSlotsByDay, type BookingDay } from "./booking-core";
import type { BookingFormField, BookingResult, ServiceDetail, Slot } from "./types";

export type { BookingDay };

const WEEK = 7 * 24 * 3600 * 1000;

/** Everything a booking surface renders from. Read it with getState() or through a subscription. */
export interface BookingFlowState {
  /** Slots grouped by day, in order — [{ dayKey, dayLabel, slots }]. null while loading. */
  days: BookingDay[] | null;
  /** The 7-day window start; page with nextWeek/prevWeek (prev clamps to today). */
  windowStart: Date;
  /** Staff filter — render a picker only when service.staff.length > 1. */
  staffId: string | undefined;
  selectedSlot: Slot | null;
  /** Schema-driven form fields (never empty — contact basics fallback). */
  formFields: BookingFormField[];
  values: Record<string, string>;
  /** True when a slot is selected and every field has a value. */
  canBook: boolean;
  booking: boolean;
  /** Set after a free/offline booking completes — the only REAL success signal. */
  confirmed: BookingResult | null;
  error: string | null;
}

export interface BookingFlowStore {
  getState(): BookingFlowState;
  subscribe(listener: () => void): () => void;
  /** Load the first window and the form. Call once when mounted (a browser — availability is timezone-specific). */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
  nextWeek(): void;
  prevWeek(): void;
  setStaffId(id: string | undefined): void;
  setSelectedSlot(slot: Slot | null): void;
  setValue(target: string, value: string): void;
  /** Books the selected slot. On "redirect" the browser is already navigating; otherwise `confirmed` is set. Rejects with the refusal (also in .error). */
  book(): Promise<BookingResult>;
}

export function createBookingFlowStore(service: ServiceDetail): BookingFlowStore {
  let windowStart = new Date();
  let staffId: string | undefined;
  let slots: Slot[] | null = null;
  let selectedSlot: Slot | null = null;
  let formFields: BookingFormField[] = [];
  let values: Record<string, string> = {};
  let booking = false;
  let confirmed: BookingResult | null = null;
  let error: string | null = null;
  let started = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  let snapshot: BookingFlowState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  function getState(): BookingFlowState {
    if (snapshot) return snapshot;
    snapshot = {
      days: slots === null ? null : groupSlotsByDay(slots),
      windowStart,
      staffId,
      selectedSlot,
      formFields,
      values,
      canBook: !!selectedSlot && formFields.every((f) => (values[f.target] ?? "").trim().length > 0),
      booking,
      confirmed,
      error,
    };
    return snapshot;
  }

  // The window or the staff filter changed: clear the picker and load the slots for the new selection.
  function loadSlots(): void {
    if (!started) return;
    const id = ++generation;
    slots = null;
    selectedSlot = null;
    emit();
    fetchSlots(service, { from: windowStart, days: 7, staffId })
      .then((s) => {
        if (!started || generation !== id) return; // superseded — drop it
        slots = s;
        emit();
      })
      .catch((e) => {
        if (!started || generation !== id) return;
        slots = [];
        error = e instanceof Error ? e.message : String(e);
        emit();
      });
  }

  return {
    getState,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      if (started) return;
      started = true;
      loadSlots();
      fetchBookingForm(service.formId).then((f) => { if (started) { formFields = f; emit(); } });
    },
    stop() {
      started = false;
      generation++;
    },
    nextWeek() {
      windowStart = new Date(windowStart.getTime() + WEEK);
      loadSlots();
    },
    prevWeek() {
      const prev = new Date(windowStart.getTime() - WEEK);
      windowStart = prev < new Date() ? new Date() : prev;
      loadSlots();
    },
    setStaffId(id) {
      if (id === staffId) return;
      staffId = id;
      loadSlots();
    },
    setSelectedSlot(slot) {
      selectedSlot = slot;
      emit();
    },
    setValue(target, value) {
      values = { ...values, [target]: value };
      emit();
    },
    async book() {
      if (!selectedSlot) throw new Error("Pick a time first.");
      booking = true;
      error = null;
      emit();
      try {
        const result = await bookService(service, selectedSlot, values, { staffId });
        if (result.kind === "redirect") {
          window.location.href = result.url;
        } else {
          confirmed = result;
        }
        return result;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        throw e;
      } finally {
        booking = false;
        emit();
      }
    },
  };
}
