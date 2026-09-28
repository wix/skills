// The registration flow for one event as a framework-free store — the logic behind
// useEventRegistration, usable from React (the hook wraps it), from a static page's event view,
// from Vue/Svelte, or as the specification for a port. Branched on event.registrationType:
// TICKETING loads the tier picker (quantities per tier or per pricing option, a named price for
// donation tiers, Wix's running totals) and checkout() reserves → redirects to Wix's hosted
// checkout; RSVP renders the ORGANIZER'S form (event.rsvpForm) and submits it in place. All
// correctness (the visitor-public tier read, the reservation payload, the redirect callbacks,
// rsvpV2, the form body) lives in the data layer — this store orchestrates; the page owns how it
// looks.
//
// One store per event surface: createRegistrationStore(event), not a singleton. A static site
// passes `paths` so the hosted checkout returns to its files (`event-confirmation.html`).
import { fetchTicketTiers, startTicketCheckout, submitRsvp, type CheckoutPaths } from "./registration";
import {
  canSubmitRsvp,
  clampQuantity,
  errorMessage,
  guestPriceValid,
  rsvpFormOf,
  selectionKey,
  selectionTotals,
  ticketCount as countTickets,
  type RsvpValues,
} from "./registration-core";
import type { EventDetail, RegistrationResult, RsvpForm, SelectionTotals, TicketSelection, TicketTier } from "./types";

export type { RsvpValues };

export interface RegistrationStoreOptions {
  /** Where the hosted checkout returns to; defaults are the Astro routes. */
  paths?: CheckoutPaths;
}

export interface RegistrationState {
  /** TICKETING: tiers for the picker — null while loading (skeletons), [] honest empty. Other types: []. */
  tiers: TicketTier[] | null;
  /** Selected quantity per selection key — `tierId`, or `${tierId}:${optionId}` for a pricing option (0 when untouched). */
  quantities: Record<string, number>;
  /** GUEST (donation) tiers: the amount the visitor typed, per tier id. */
  guestPrices: Record<string, string>;
  /** The current selection as line items (quantity > 0 only). */
  selections: TicketSelection[];
  ticketCount: number;
  /** The event's cap on one order — the picker refuses more (`+` disabled at the cap). */
  ticketLimitPerOrder: number;
  /** Wix's running totals for the selection (formatted); null with nothing selected. The hosted checkout is authoritative. */
  totals: SelectionTotals | null;
  /** True when ≥ 1 ticket is selected, within the order cap, and every donation tier has a valid amount — gate the checkout CTA on this. */
  canCheckout: boolean;
  /** RSVP: the form to render — the organizer's (event.rsvpForm) or the built-in name + email. */
  rsvpForm: RsvpForm;
  /** RSVP answers keyed by input name (CHECKBOX answers are arrays). */
  rsvpValues: RsvpValues;
  /** RSVP: additional guests (only meaningful when rsvpForm.guestControl is set). */
  guestCount: number;
  guestNames: string[];
  /** True when the built-in identity and every mandatory input are filled — gate the RSVP CTA on this. */
  canRsvp: boolean;
  submitting: boolean;
  /** Set after an RSVP completes (kind "rsvpConfirmed"; status may be "WAITLIST"). */
  confirmed: RegistrationResult | null;
  error: string | null;
}

export interface RegistrationStore {
  getState(): RegistrationState;
  subscribe(listener: () => void): () => void;
  /** Load the tiers of a TICKETING event. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop a late response. */
  stop(): void;
  /** Clamped to 0..limitPerCheckout (0 = sold out); ignored for tiers not on sale. `optionId` for an OPTIONS tier. Clears `error`. */
  setQuantity(tierId: string, quantity: number, optionId?: string): void;
  /** GUEST tiers: the amount the visitor pays (a decimal string). Clears `error`. */
  setGuestPrice(tierId: string, value: string): void;
  /** Answer one RSVP input by name (an array for CHECKBOX inputs). */
  setRsvpValue(inputName: string, value: string | string[]): void;
  /** RSVP: how many additional guests (0..guestControl.maxGuests) and their names. */
  setGuestCount(count: number): void;
  setGuestName(index: number, name: string): void;
  /** Reserves + redirects to the Wix-hosted checkout. On "redirect" the browser is navigating. Throws (and sets .error) on refusal. */
  checkout(): Promise<RegistrationResult>;
  /** attending=false only when event.rsvpResponseType is "YES_AND_NO". Throws (and sets .error) on refusal. */
  rsvp(attending?: boolean): Promise<RegistrationResult>;
}

export function createRegistrationStore(event: EventDetail, { paths }: RegistrationStoreOptions = {}): RegistrationStore {
  const ticketed = event.registrationType === "TICKETING";
  const rsvpForm = rsvpFormOf(event);
  let tiers: TicketTier[] | null = ticketed ? null : [];
  let quantities: Record<string, number> = {};
  let guestPrices: Record<string, string> = {};
  let rsvpValues: RsvpValues = {};
  let guestCount = 0;
  let guestNames: string[] = [];
  let submitting = false;
  let confirmed: RegistrationResult | null = null;
  let error: string | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  let snapshot: RegistrationState | null = null;
  const emit = () => {
    snapshot = null;
    for (const fn of listeners) fn();
  };

  function currentSelections(): TicketSelection[] {
    return Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([key, quantity]) => {
        const [tierId, optionId] = key.split(":");
        const tier = (tiers ?? []).find((t) => t.id === tierId);
        return {
          tierId,
          quantity,
          ...(optionId ? { optionId } : {}),
          ...(tier?.pricingType === "GUEST" ? { guestPrice: guestPrices[tierId] ?? "" } : {}),
        };
      });
  }

  function getState(): RegistrationState {
    if (snapshot) return snapshot;
    const selections = currentSelections();
    const ticketCount = countTickets(selections);
    const guestPricesValid = selections.every((s) => {
      const tier = (tiers ?? []).find((t) => t.id === s.tierId);
      return !tier || guestPriceValid(tier, s.guestPrice);
    });
    snapshot = {
      tiers,
      quantities,
      guestPrices,
      selections,
      ticketCount,
      ticketLimitPerOrder: event.ticketLimitPerOrder,
      totals: selectionTotals(tiers ?? [], selections, event.taxSettings),
      canCheckout: ticketCount > 0 && ticketCount <= event.ticketLimitPerOrder && guestPricesValid,
      rsvpForm,
      rsvpValues,
      guestCount,
      guestNames,
      canRsvp: canSubmitRsvp(rsvpForm, rsvpValues, guestCount, true),
      submitting,
      confirmed,
      error,
    };
    return snapshot;
  }

  async function run(op: () => Promise<RegistrationResult>): Promise<RegistrationResult> {
    submitting = true;
    error = null;
    emit();
    try {
      const result = await op();
      if (result.kind === "redirect") {
        if (typeof window !== "undefined") window.location.href = result.url;
      } else {
        confirmed = result;
      }
      return result;
    } catch (e) {
      error = errorMessage(e);
      throw e;
    } finally {
      submitting = false;
      emit();
    }
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
      if (!ticketed) return;
      fetchTicketTiers(event)
        .then((t) => {
          if (!started) return;
          tiers = t;
          emit();
        })
        .catch((e) => {
          if (!started) return;
          tiers = [];
          error = errorMessage(e);
          emit();
        });
    },
    stop() {
      started = false;
    },
    setQuantity(tierId, quantity, optionId) {
      const tier = (tiers ?? []).find((t) => t.id === tierId);
      if (!tier || !tier.available) return;
      if (optionId && !tier.options.some((o) => o.id === optionId)) return;
      const key = selectionKey(tierId, optionId);
      const clamped = clampQuantity(tier, quantity);
      // The event caps one order: never let the total pass it (Wix's reservation would refuse with an opaque error).
      const others = Object.entries(quantities).reduce((sum, [k, q]) => (k === key ? sum : sum + q), 0);
      const capped = Math.max(0, Math.min(clamped, event.ticketLimitPerOrder - others));
      quantities = { ...quantities, [key]: capped };
      error = capped < clamped ? `Up to ${event.ticketLimitPerOrder} tickets per order.` : null; // a stale error never outlives a selection change
      emit();
    },
    setGuestPrice(tierId, value) {
      guestPrices = { ...guestPrices, [tierId]: value };
      error = null;
      emit();
    },
    setRsvpValue(inputName, value) {
      rsvpValues = { ...rsvpValues, [inputName]: value };
      emit();
    },
    setGuestCount(count) {
      const max = rsvpForm.guestControl?.maxGuests ?? 0;
      guestCount = Math.max(0, Math.min(Math.trunc(count) || 0, max));
      guestNames = guestNames.slice(0, guestCount);
      emit();
    },
    setGuestName(index, name) {
      if (index < 0 || index >= guestCount) return;
      const next = guestNames.slice();
      while (next.length < guestCount) next.push("");
      next[index] = name;
      guestNames = next;
      emit();
    },
    checkout: () => run(() => startTicketCheckout(event, currentSelections(), paths, tiers ?? [])),
    rsvp: (attending = true) => run(() => submitRsvp(event, rsvpValues, attending ? "YES" : "NO", { guestCount, guestNames })),
  };
}
