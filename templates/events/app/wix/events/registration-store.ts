// The registration flow for one event as a framework-free store — the logic behind
// useEventRegistration, usable from React (the hook wraps it), from a static page's event view,
// from Vue/Svelte, or as the specification for a port. Branched on event.registrationType:
// TICKETING loads the tier picker and checkout() reserves → redirects to Wix's hosted checkout;
// RSVP is the built-in name+email form submitted in place. All correctness (the visitor-public
// tier read, the reservation payload, the redirect callbacks, rsvpV2) lives in the data layer —
// this store orchestrates; the page owns how it looks.
//
// One store per event surface: createRegistrationStore(event), not a singleton. A static site
// passes `paths` so the hosted checkout returns to its files (`event-confirmation.html`).
import { fetchTicketTiers, startTicketCheckout, submitRsvp, type CheckoutPaths } from "./registration";
import type { EventDetail, RegistrationResult, TicketTier } from "./types";

export type RsvpField = "firstName" | "lastName" | "email";

export interface RegistrationStoreOptions {
  /** Where the hosted checkout returns to; defaults are the Astro routes. */
  paths?: CheckoutPaths;
}

export interface RegistrationState {
  /** TICKETING: tiers for the picker — null while loading (skeletons), [] honest empty. Other types: []. */
  tiers: TicketTier[] | null;
  /** Selected quantity per tier id (0 when untouched). */
  quantities: Record<string, number>;
  ticketCount: number;
  /** True when ≥ 1 ticket is selected — gate the checkout CTA on this. */
  canCheckout: boolean;
  /** RSVP form state — the built-in fields, exactly these. */
  rsvpValues: { firstName: string; lastName: string; email: string };
  /** True when every RSVP field is filled — gate the RSVP CTA on this. */
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
  /** Clamped to 0..limitPerCheckout; ignored for tiers not on sale (saleStatus gate). */
  setQuantity(tierId: string, quantity: number): void;
  setRsvpValue(field: RsvpField, value: string): void;
  /** Reserves + redirects to the Wix-hosted checkout. On "redirect" the browser is navigating. Throws (and sets .error) on refusal. */
  checkout(): Promise<RegistrationResult>;
  /** attending=false only when event.rsvpResponseType is "YES_AND_NO". Throws (and sets .error) on refusal. */
  rsvp(attending?: boolean): Promise<RegistrationResult>;
}

export function createRegistrationStore(event: EventDetail, { paths }: RegistrationStoreOptions = {}): RegistrationStore {
  const ticketed = event.registrationType === "TICKETING";
  let tiers: TicketTier[] | null = ticketed ? null : [];
  let quantities: Record<string, number> = {};
  let rsvpValues = { firstName: "", lastName: "", email: "" };
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

  function getState(): RegistrationState {
    if (snapshot) return snapshot;
    const ticketCount = Object.values(quantities).reduce((sum, q) => sum + q, 0);
    snapshot = {
      tiers,
      quantities,
      ticketCount,
      canCheckout: ticketCount > 0,
      rsvpValues,
      canRsvp: (["firstName", "lastName", "email"] as const).every((f) => rsvpValues[f].trim().length > 0),
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
      error = e instanceof Error ? e.message : String(e);
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
      fetchTicketTiers(event.id)
        .then((t) => {
          if (!started) return;
          tiers = t;
          emit();
        })
        .catch((e) => {
          if (!started) return;
          tiers = [];
          error = e instanceof Error ? e.message : String(e);
          emit();
        });
    },
    stop() {
      started = false;
    },
    setQuantity(tierId, quantity) {
      const tier = (tiers ?? []).find((t) => t.id === tierId);
      if (!tier || tier.saleStatus !== "SALE_STARTED") return;
      const clamped = Math.max(0, Math.min(quantity, tier.limitPerCheckout || 20));
      quantities = { ...quantities, [tierId]: clamped };
      emit();
    },
    setRsvpValue(field, value) {
      rsvpValues = { ...rsvpValues, [field]: value };
      emit();
    },
    checkout: () =>
      run(() =>
        startTicketCheckout(
          event,
          Object.entries(quantities).map(([tierId, quantity]) => ({ tierId, quantity })),
          paths,
        ),
      ),
    rsvp: (attending = true) => run(() => submitRsvp(event.id, rsvpValues, attending ? "YES" : "NO")),
  };
}
