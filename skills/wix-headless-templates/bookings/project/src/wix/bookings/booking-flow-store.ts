// The whole booking state machine for one service as a framework-free store — the logic behind
// useBookingFlow, usable from React (useBookingFlow wraps it), from a static page's booking surface,
// from Vue/Svelte, or as the specification for a port: the display time zone (the site's setting),
// the availability window (day-grouped slots, week paging, optional staff filter, next availability),
// a course's seats and dates, a class's upcoming sessions, participants, deposit choice, add-on
// selection, the schema-driven form, the CTA state, and book(). All correctness (slot scheduleId vs
// eventId vs a course's schedule, ANY_RESOURCE, the slot's location, formSubmission, payment option,
// checkout-or-place) lives in the data layer; this store orchestrates. A late response from a
// superseded window is dropped. One store per booking surface: createBookingFlowStore(service).
import {
  bookService,
  fetchAddOnGroups,
  fetchBookingForm,
  fetchBookingsSettings,
  fetchCourseAvailability,
  fetchNextAvailableSlots,
  fetchOfferedDays,
  fetchSessions,
  fetchSlots,
  resolveDisplayTimeZone,
} from "./booking";
import { ctaStateOf } from "./services-core";
import {
  addOnsDuration,
  addOnsTotal,
  canSelectMore,
  groupSlotsByDay,
  maxParticipants,
  showsNextAvailability,
  startOfDay,
  timeZoneLabel,
  withAddOnQuantity,
  type AddOnSelection,
  type BookingDay,
} from "./booking-core";
import type { AddOnGroup, BookingFormField, BookingResult, BookingsSettings, CourseAvailability, CtaState, ServiceDetail, Session, Slot, Weekday } from "./types";

export type { BookingDay };

const WINDOW_DAYS = 7;
const RESOURCE_PARAM = "resource";

/** Everything a booking surface renders from. Read it with getState() or through a subscription. */
export interface BookingFlowState {
  /** Slots grouped by day, in order — [{ dayKey, dayLabel, slots }]. null while loading; [] for a COURSE (no slots). */
  days: BookingDay[] | null;
  /** The 7-day window start (a day boundary); page with nextWeek/prevWeek (prev clamps to today). */
  windowStart: Date;
  /** The next few bookable times beyond the window — what an empty week points at; null while loading, [] when none/not applicable. */
  nextAvailable: Slot[] | null;
  /** Staff filter — render a picker only when service.staff.length > 1. Seeded from `?resource=`. */
  staffId: string | undefined;
  selectedSlot: Slot | null;
  /** The IANA zone the shown times are in (the response's), and its label ("Eastern Time (EDT)"); null/"" until known. */
  timeZone: string | null;
  timeZoneLabel: string;
  /** Which zone is in use and whether the owner lets the visitor switch (setDisplayTimeZone). */
  displayTimeZone: "BUSINESS" | "CUSTOMER";
  customerCanChangeTimeZone: boolean;
  /** COURSE only: seats from its sessions (null while loading, once ended, or for other types). */
  course: CourseAvailability | null;
  /** Weekdays a class/course meets ("MONDAY"…), from its recurring sessions; [] for appointments or until loaded. */
  offeredDays: Weekday[];
  /** Upcoming sessions of a class (or a running course); null while loading, [] for appointments. */
  sessions: Session[] | null;
  hasMoreSessions: boolean;
  /** Seats in this booking and the most allowed (policy / capacity / seats left on the slot). */
  participants: number;
  maxParticipants: number;
  /** Deposit choice: true = pay the deposit now (the default when the service takes one); false = pay in full now. */
  payDeposit: boolean;
  /** Add-on groups (empty unless service.hasAddOns), the selection (quantity by add-on id), and its totals. */
  addOnGroups: AddOnGroup[];
  addOns: AddOnSelection;
  /** Formatted extra price of the selected add-ons ("" when none). Shown, not yet booked — see INSTRUCTIONS. */
  addOnsTotal: string;
  addOnsMinutes: number;
  /** Schema-driven form fields (never empty — contact basics fallback). */
  formFields: BookingFormField[];
  values: Record<string, string>;
  /** book / requestToBook / viewCourse — the CTA's label and the confirmed copy follow it. */
  ctaState: CtaState;
  /** True when a bookable slot is selected (or the service is a bookable course) and every required field has a value. */
  canBook: boolean;
  booking: boolean;
  /** Set after a free/offline booking completes — the only REAL success signal. */
  confirmed: BookingResult | null;
  error: string | null;
}

export interface BookingFlowStore {
  getState(): BookingFlowState;
  subscribe(listener: () => void): () => void;
  /** Load settings, the first window, next availability, sessions/seats, add-ons, and the form. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
  nextWeek(): void;
  prevWeek(): void;
  /** Move the window to the week holding this day ("YYYY-MM-DD" — a nextAvailable slot's dayKey). */
  jumpTo(dayKey: string): void;
  setStaffId(id: string | undefined): void;
  /** Ignored for a non-bookable slot (full session, policy). */
  setSelectedSlot(slot: Slot | null): void;
  /** Only when customerCanChangeTimeZone; reloads the window in the other zone. */
  setDisplayTimeZone(zone: "BUSINESS" | "CUSTOMER"): void;
  setParticipants(n: number): void;
  /** Only meaningful when service.deposit?.fullUpfrontAllowed; otherwise the deposit is mandatory. */
  setPayDeposit(payDeposit: boolean): void;
  toggleAddOn(id: string): void;
  setAddOnQuantity(id: string, quantity: number): void;
  /** Whether `groupId` accepts another distinct add-on. */
  canSelectMore(groupId: string): boolean;
  loadMoreSessions(): Promise<void>;
  setValue(target: string, value: string): void;
  /** Books the selected slot (a course: the course). On "redirect" the browser is already navigating; otherwise `confirmed` is set. Rejects with the refusal (also in .error). */
  book(): Promise<BookingResult>;
}

const readResourceParam = (): string | undefined => {
  if (typeof window === "undefined") return undefined;
  try {
    return new URL(window.location.href).searchParams.get(RESOURCE_PARAM) || undefined;
  } catch {
    return undefined;
  }
};

export function createBookingFlowStore(service: ServiceDetail): BookingFlowStore {
  const isCourse = service.type === "COURSE";
  let windowStart = startOfDay(new Date());
  let staffId: string | undefined = readResourceParam();
  let slots: Slot[] | null = isCourse ? [] : null;
  let nextAvailable: Slot[] | null = showsNextAvailability(service) ? null : [];
  let selectedSlot: Slot | null = null;
  let settings: BookingsSettings = { displayTimeZone: "BUSINESS", customerCanChange: false };
  let requestZone: string | undefined; // what the requests send; undefined = the business zone
  let timeZone: string | null = null; // what the response says the times are in
  let course: CourseAvailability | null = null;
  let offeredDays: Weekday[] = service.offeredDays;
  let sessions: Session[] | null = service.type === "APPOINTMENT" ? [] : null;
  let sessionsCursor: string | null = null;
  let participants = 1;
  let payDeposit = !!service.deposit;
  let addOnGroups: AddOnGroup[] = [];
  let addOns: AddOnSelection = {};
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

  const ctaState = (): CtaState => ctaStateOf(service, course?.full ?? false);
  const formComplete = () => formFields.every((f) => !f.required || (values[f.target] ?? "").trim().length > 0);
  const zoneForBooking = () => timeZone ?? requestZone ?? undefined;

  function getState(): BookingFlowState {
    if (snapshot) return snapshot;
    const cta = ctaState();
    const target = isCourse ? !service.course?.ended && cta !== "viewCourse" && !!service.scheduleId : !!selectedSlot?.bookable;
    snapshot = {
      days: slots === null ? null : groupSlotsByDay(slots),
      windowStart,
      nextAvailable,
      staffId,
      selectedSlot,
      timeZone,
      timeZoneLabel: timeZoneLabel(timeZone, selectedSlot ? new Date(selectedSlot.startLocal) : windowStart),
      displayTimeZone: settings.displayTimeZone,
      customerCanChangeTimeZone: settings.customerCanChange,
      course,
      offeredDays,
      sessions,
      hasMoreSessions: !!sessionsCursor,
      participants,
      maxParticipants: maxParticipants(service, selectedSlot),
      payDeposit,
      addOnGroups,
      addOns,
      addOnsTotal: addOnsTotal(addOnGroups, addOns),
      addOnsMinutes: addOnsDuration(addOnGroups, addOns),
      formFields,
      values,
      ctaState: cta,
      canBook: target && formComplete() && !booking,
      booking,
      confirmed,
      error,
    };
    return snapshot;
  }

  // The window, the staff filter, or the zone changed: clear the picker and load the slots for the new selection.
  function loadSlots(): void {
    if (!started || isCourse) return;
    const id = ++generation;
    slots = null;
    selectedSlot = null;
    emit();
    fetchSlots(service, { from: windowStart, days: WINDOW_DAYS, staffId, timeZone: requestZone })
      .then((page) => {
        if (!started || generation !== id) return; // superseded — drop it
        slots = page.slots;
        timeZone = page.timeZone ?? requestZone ?? null;
        emit();
      })
      .catch((e) => {
        if (!started || generation !== id) return;
        slots = [];
        error = e instanceof Error ? e.message : String(e);
        emit();
      });
  }

  // Next availability follows the staff filter and the zone, not the window.
  function loadNextAvailable(): void {
    if (!started || !showsNextAvailability(service)) return;
    const id = generation;
    nextAvailable = null;
    fetchNextAvailableSlots(service, { staffId, timeZone: requestZone })
      .then((page) => {
        if (!started || generation !== id) return;
        nextAvailable = page.slots;
        emit();
      })
      .catch(() => {
        if (!started || generation !== id) return;
        nextAvailable = [];
        emit();
      });
  }

  // Sessions: a class always, a course while it still runs, never an appointment.
  function loadSessions(): void {
    const scheduleId = service.scheduleId;
    if (!started || !scheduleId || service.type === "APPOINTMENT" || (isCourse && service.course?.ended)) {
      sessions = sessions ?? [];
      return;
    }
    const id = generation;
    fetchSessions(scheduleId, { timeZone: requestZone }).then((page) => {
      if (!started || generation !== id) return;
      sessions = page.sessions;
      sessionsCursor = page.nextCursor;
      emit();
    });
  }

  // The recurring sessions: the weekdays a class/course meets, and a course's seats.
  function loadSchedule(): void {
    if (!started || service.type === "APPOINTMENT" || !service.scheduleId) return;
    const id = generation;
    const scheduleId = service.scheduleId;
    fetchOfferedDays([scheduleId], requestZone).then((days) => {
      if (!started || generation !== id) return;
      offeredDays = days[scheduleId] ?? offeredDays;
      emit();
    });
    if (!isCourse) return;
    fetchCourseAvailability(service, requestZone).then((c) => {
      if (!started || generation !== id) return;
      course = c;
      timeZone = timeZone ?? requestZone ?? null;
      emit();
    });
  }

  function loadForZone(): void {
    loadSlots();
    loadNextAvailable();
    loadSessions();
    loadSchedule();
    emit();
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
      // The zone policy first: everything time-related is requested in the zone the owner chose.
      fetchBookingsSettings().then((s) => {
        if (!started) return;
        settings = s;
        requestZone = resolveDisplayTimeZone(s);
        loadForZone();
      });
      fetchBookingForm(service.formId).then((f) => { if (started) { formFields = f; emit(); } });
      if (service.hasAddOns) fetchAddOnGroups(service.id).then((g) => { if (started) { addOnGroups = g; emit(); } });
    },
    stop() {
      started = false;
      generation++;
    },
    nextWeek() {
      windowStart = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + WINDOW_DAYS);
      loadSlots();
    },
    prevWeek() {
      const today = startOfDay(new Date());
      const prev = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() - WINDOW_DAYS);
      windowStart = prev < today ? today : prev;
      loadSlots();
    },
    jumpTo(dayKey) {
      const day = new Date(`${dayKey}T12:00:00`);
      if (Number.isNaN(day.getTime())) return;
      const today = startOfDay(new Date());
      const target = startOfDay(day);
      windowStart = target < today ? today : target;
      loadSlots();
    },
    setStaffId(id) {
      if (id === staffId) return;
      staffId = id;
      loadSlots();
      loadNextAvailable();
    },
    setSelectedSlot(slot) {
      if (slot && !slot.bookable) return;
      selectedSlot = slot;
      participants = Math.min(participants, maxParticipants(service, slot));
      emit();
    },
    setDisplayTimeZone(zone) {
      if (!settings.customerCanChange || zone === settings.displayTimeZone) return;
      settings = { ...settings, displayTimeZone: zone };
      requestZone = resolveDisplayTimeZone(settings);
      timeZone = null;
      generation++;
      loadForZone();
    },
    setParticipants(n) {
      participants = Math.max(1, Math.min(Math.floor(n) || 1, maxParticipants(service, selectedSlot)));
      emit();
    },
    setPayDeposit(v) {
      if (!service.deposit) return;
      payDeposit = service.deposit.fullUpfrontAllowed ? v : true;
      emit();
    },
    toggleAddOn(id) {
      addOns = withAddOnQuantity(addOnGroups, addOns, id, addOns[id] > 0 ? 0 : 1);
      emit();
    },
    setAddOnQuantity(id, quantity) {
      addOns = withAddOnQuantity(addOnGroups, addOns, id, quantity);
      emit();
    },
    canSelectMore(groupId) {
      const group = addOnGroups.find((g) => g.id === groupId);
      return group ? canSelectMore(group, addOns) : false;
    },
    async loadMoreSessions() {
      if (!started || !sessionsCursor || !service.scheduleId) return;
      const id = generation;
      const cursor = sessionsCursor;
      sessionsCursor = null;
      emit();
      const page = await fetchSessions(service.scheduleId, { cursor, timeZone: requestZone });
      if (!started || generation !== id) return;
      sessions = [...(sessions ?? []), ...page.sessions];
      sessionsCursor = page.nextCursor;
      emit();
    },
    setValue(target, value) {
      values = { ...values, [target]: value };
      emit();
    },
    async book() {
      if (!isCourse && !selectedSlot) throw new Error("Pick a time first.");
      if (isCourse && ctaState() === "viewCourse") throw new Error("This course can't be booked anymore.");
      booking = true;
      error = null;
      emit();
      try {
        const result = await bookService(service, isCourse ? null : selectedSlot, values, {
          staffId,
          timeZone: zoneForBooking(),
          participants,
          depositSelected: service.deposit?.fullUpfrontAllowed ? payDeposit : undefined,
        });
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
