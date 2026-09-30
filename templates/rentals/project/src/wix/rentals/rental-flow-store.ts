// The whole rental state machine for one rental as a framework-free store — the logic behind
// useRentalFlow, usable from React (useRentalFlow wraps it), from a static page's rental surface,
// from Vue/Svelte, or as the specification for a port: the availability window (starts grouped by
// day, week paging), the chosen start, the lengths that start allows (hourly: the server's end
// options; daily: the consecutive-day walk), the chosen length and its server-priced quote, the
// schema-driven form, the CTA state, and rent(). All correctness (the rental's resource, the
// customer's end date, the price preview's three fields, the Rentals app id on the cart,
// checkout-or-place) lives in the data layer; this store orchestrates. A late response from a
// superseded window is dropped. One store per rental surface: createRentalFlowStore(rental).
//
// Time zone: every request runs in the BUSINESS zone (none is sent; the response names it), which
// daily rentals require and hourly ones tolerate; the label tells the visitor which zone applies.
import { fetchEndOptions, fetchQuote, fetchRentalForm, fetchStarts, rentResource } from "./rentals";
import { dayLabel, startOfDay } from "./rentals-core";
import type { EndOption, RentalDetail, RentalFormField, RentalQuote, RentalResult, StartOption } from "./types";

/** Starts grouped by day, in order. For a DAILY rental every day holds exactly one start (midnight). */
export interface RentalDay {
  dayKey: string;
  dayLabel: string;
  starts: StartOption[];
}

const HOURLY_WINDOW_DAYS = 7;
const DAILY_WINDOW_DAYS = 14;

/** Everything a rental surface renders from. Read it with getState() or through a subscription. */
export interface RentalFlowState {
  /** Starts grouped by day within the window; null while loading; [] when the window has none. */
  days: RentalDay[] | null;
  /** The window start (a day boundary); page with nextWindow/prevWindow (prev clamps to today). Hourly windows are 7 days, daily 14. */
  windowStart: Date;
  windowDays: number;
  /** The IANA zone the shown times are in (the business zone, from the response); null until known. */
  timeZone: string | null;
  selectedStart: StartOption | null;
  /** The lengths the chosen start allows; null while loading (or before a start is chosen); [] when the start allows none. */
  endOptions: EndOption[] | null;
  selectedEnd: EndOption | null;
  /** The server's price for start + length; null until both are chosen and the preview returns. */
  quote: RentalQuote | null;
  /** Schema-driven form fields (never empty — contact basics fallback). */
  formFields: RentalFormField[];
  values: Record<string, string>;
  /** rent / requestToRent — the CTA's label and the confirmed copy follow it. */
  ctaState: "rent" | "requestToRent";
  /** True when a start and a length are chosen and every required field has a value. */
  canRent: boolean;
  renting: boolean;
  /** Set after a free/offline rental completes — the only REAL success signal. */
  confirmed: RentalResult | null;
  error: string | null;
}

export interface RentalFlowStore {
  getState(): RentalFlowState;
  subscribe(listener: () => void): () => void;
  /** Load the first window and the form. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop late responses. */
  stop(): void;
  nextWindow(): void;
  prevWindow(): void;
  /** Move the window to the one holding this day ("YYYY-MM-DD"). */
  jumpTo(dayKey: string): void;
  /** Ignored for a non-bookable start. Clears the length and the quote; loads the new start's lengths. */
  setSelectedStart(start: StartOption | null): void;
  /** Requests the quote for start + length. */
  setSelectedEnd(end: EndOption | null): void;
  setValue(target: string, value: string): void;
  /** Rents the chosen start for the chosen length. On "redirect" the browser is already navigating; otherwise `confirmed` is set. Rejects with the refusal (also in .error). */
  rent(): Promise<RentalResult>;
}

function groupByDay(starts: StartOption[]): RentalDay[] {
  const map = new Map<string, StartOption[]>();
  for (const s of starts) {
    const list = map.get(s.dayKey) ?? [];
    list.push(s);
    map.set(s.dayKey, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dayKey, list]) => ({ dayKey, dayLabel: dayLabel(dayKey), starts: list }));
}

export function createRentalFlowStore(rental: RentalDetail): RentalFlowStore {
  const daily = rental.unit === "DAY";
  const windowDays = daily ? DAILY_WINDOW_DAYS : HOURLY_WINDOW_DAYS;
  let windowStart = startOfDay(new Date());
  let starts: StartOption[] | null = null; // the window's starts
  let availableDayKeys: string[] = []; // DAILY: the window's days plus the run-off the walk needs
  let timeZone: string | null = null;
  let selectedStart: StartOption | null = null;
  let endOptions: EndOption[] | null = null;
  let selectedEnd: EndOption | null = null;
  let quote: RentalQuote | null = null;
  let formFields: RentalFormField[] = [];
  let values: Record<string, string> = {};
  let renting = false;
  let confirmed: RentalResult | null = null;
  let error: string | null = null;
  let started = false;
  let generation = 0;
  let endGeneration = 0;
  const listeners = new Set<() => void>();
  let snapshot: RentalFlowState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  const ctaState = (): RentalFlowState["ctaState"] => (rental.requiresManualApproval ? "requestToRent" : "rent");
  const formComplete = () => formFields.every((f) => !f.required || (values[f.target] ?? "").trim().length > 0);

  function getState(): RentalFlowState {
    if (snapshot) return snapshot;
    snapshot = {
      days: starts === null ? null : groupByDay(starts),
      windowStart,
      windowDays,
      timeZone,
      selectedStart,
      endOptions,
      selectedEnd,
      quote,
      formFields,
      values,
      ctaState: ctaState(),
      canRent: !!selectedStart?.bookable && !!selectedEnd && formComplete() && !renting,
      renting,
      confirmed,
      error,
    };
    return snapshot;
  }

  // The window changed: clear the picker and load the starts. A DAILY rental fetches the window plus
  // its maximum length beyond it, so a start near the window's end still sees every day it can run into.
  function loadStarts(): void {
    if (!started) return;
    const id = ++generation;
    starts = null;
    selectedStart = null;
    endOptions = null;
    selectedEnd = null;
    quote = null;
    emit();
    const runOff = daily ? Math.max(0, Math.floor(rental.maxUnits)) : 0;
    fetchStarts(rental, { from: windowStart, days: windowDays + runOff })
      .then((page) => {
        if (!started || generation !== id) return; // superseded — drop it
        const windowEnd = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + windowDays);
        const endKey = `${windowEnd.getFullYear()}-${String(windowEnd.getMonth() + 1).padStart(2, "0")}-${String(windowEnd.getDate()).padStart(2, "0")}`;
        starts = page.options.filter((s) => s.dayKey < endKey);
        availableDayKeys = [...new Set(page.options.filter((s) => s.bookable).map((s) => s.dayKey))];
        timeZone = page.timeZone;
        emit();
      })
      .catch((e) => {
        if (!started || generation !== id) return;
        starts = [];
        error = e instanceof Error ? e.message : String(e);
        emit();
      });
  }

  function loadEndOptions(start: StartOption): void {
    const id = ++endGeneration;
    const gen = generation;
    endOptions = null;
    emit();
    fetchEndOptions(rental, start, { timeZone, availableDayKeys })
      .then((options) => {
        if (!started || endGeneration !== id || generation !== gen) return;
        endOptions = options;
        emit();
      })
      .catch((e) => {
        if (!started || endGeneration !== id || generation !== gen) return;
        endOptions = [];
        error = e instanceof Error ? e.message : String(e);
        emit();
      });
  }

  function loadQuote(start: StartOption, end: EndOption): void {
    const id = endGeneration;
    const gen = generation;
    quote = null;
    emit();
    fetchQuote(rental, start, end, timeZone ?? undefined).then((q) => {
      if (!started || endGeneration !== id || generation !== gen || selectedEnd !== end) return;
      quote = q;
      emit();
    });
  }

  const shiftWindow = (days: number) => {
    const today = startOfDay(new Date());
    const next = new Date(windowStart.getFullYear(), windowStart.getMonth(), windowStart.getDate() + days);
    windowStart = next < today ? today : next;
    loadStarts();
  };

  return {
    getState,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      if (started) return;
      started = true;
      loadStarts();
      fetchRentalForm(rental.formId).then((f) => {
        if (!started) return;
        formFields = f;
        emit();
      });
    },
    stop() {
      started = false;
      generation++;
      endGeneration++;
    },
    nextWindow() {
      shiftWindow(windowDays);
    },
    prevWindow() {
      shiftWindow(-windowDays);
    },
    jumpTo(dayKey) {
      const day = new Date(`${dayKey}T12:00:00`);
      if (Number.isNaN(day.getTime())) return;
      const today = startOfDay(new Date());
      const target = startOfDay(day);
      windowStart = target < today ? today : target;
      loadStarts();
    },
    setSelectedStart(start) {
      if (start && !start.bookable) return;
      selectedStart = start;
      selectedEnd = null;
      quote = null;
      error = null;
      endGeneration++;
      if (start) loadEndOptions(start);
      else endOptions = null;
      emit();
    },
    setSelectedEnd(end) {
      selectedEnd = end;
      quote = null;
      if (selectedStart && end) loadQuote(selectedStart, end);
      else emit();
    },
    setValue(target, value) {
      values = { ...values, [target]: value };
      emit();
    },
    async rent() {
      if (!selectedStart) throw new Error("Pick a start first.");
      if (!selectedEnd) throw new Error("Pick how long first.");
      renting = true;
      error = null;
      emit();
      try {
        const result = await rentResource(rental, selectedStart, selectedEnd, values, timeZone ?? undefined);
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
        renting = false;
        emit();
      }
    },
  };
}
