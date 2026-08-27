// The whole registration state machine for one event, branched on event.registrationType:
// TICKETING loads the tier picker and checkout() reserves → redirects to Wix's hosted
// checkout; RSVP is the built-in name+email form submitted in place. All correctness (the
// visitor-public tier read, the reservation payload, the redirect callbacks, rsvpV2) lives
// in the data layer — this hook orchestrates; you own how it looks.
import { useEffect, useMemo, useState } from "react";
import { fetchTicketTiers, startTicketCheckout, submitRsvp } from "../../wix/events/registration";
import type { EventDetail, RegistrationResult, TicketTier } from "../../wix/events/types";

export interface UseEventRegistration {
  /** TICKETING: tiers for the picker — null while loading (skeletons), [] honest empty. Other types: []. */
  tiers: TicketTier[] | null;
  /** Selected quantity per tier id (0 when untouched). */
  quantities: Record<string, number>;
  /** Clamped to 0..limitPerCheckout; ignored for tiers not on sale (saleStatus gate). */
  setQuantity: (tierId: string, quantity: number) => void;
  ticketCount: number;
  /** True when ≥ 1 ticket is selected — gate the checkout CTA on this. */
  canCheckout: boolean;
  /** Reserves + redirects to the Wix-hosted checkout. On "redirect" the browser is navigating. */
  checkout: () => Promise<RegistrationResult>;
  /** RSVP form state — the built-in fields, exactly these. */
  rsvpValues: { firstName: string; lastName: string; email: string };
  setRsvpValue: (field: "firstName" | "lastName" | "email", value: string) => void;
  /** True when every RSVP field is filled — gate the RSVP CTA on this. */
  canRsvp: boolean;
  /** attending=false only when event.rsvpResponseType is "YES_AND_NO". */
  rsvp: (attending?: boolean) => Promise<RegistrationResult>;
  submitting: boolean;
  /** Set after an RSVP completes (kind "rsvpConfirmed"; status may be "WAITLIST"). */
  confirmed: RegistrationResult | null;
  error: string | null;
}

export function useEventRegistration(event: EventDetail): UseEventRegistration {
  const ticketed = event.registrationType === "TICKETING";
  const [tiers, setTiers] = useState<TicketTier[] | null>(ticketed ? null : []);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [rsvpValues, setRsvpValues] = useState({ firstName: "", lastName: "", email: "" });
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketed) return;
    let alive = true;
    setTiers(null);
    setQuantities({});
    fetchTicketTiers(event.id)
      .then((t) => alive && setTiers(t))
      .catch((e) => {
        if (!alive) return;
        setTiers([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id, ticketed]);

  const setQuantity = (tierId: string, quantity: number) => {
    const tier = (tiers ?? []).find((t) => t.id === tierId);
    if (!tier || tier.saleStatus !== "SALE_STARTED") return;
    const clamped = Math.max(0, Math.min(quantity, tier.limitPerCheckout || 20));
    setQuantities((q) => ({ ...q, [tierId]: clamped }));
  };

  const ticketCount = useMemo(
    () => Object.values(quantities).reduce((sum, q) => sum + q, 0),
    [quantities],
  );
  const canRsvp = (["firstName", "lastName", "email"] as const).every(
    (f) => rsvpValues[f].trim().length > 0,
  );

  async function run(op: () => Promise<RegistrationResult>): Promise<RegistrationResult> {
    setSubmitting(true);
    setError(null);
    try {
      const result = await op();
      if (result.kind === "redirect") {
        window.location.href = result.url;
      } else {
        setConfirmed(result);
      }
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setSubmitting(false);
    }
  }

  return {
    tiers,
    quantities,
    setQuantity,
    ticketCount,
    canCheckout: ticketCount > 0,
    checkout: () =>
      run(() =>
        startTicketCheckout(
          event,
          Object.entries(quantities).map(([tierId, quantity]) => ({ tierId, quantity })),
        ),
      ),
    rsvpValues,
    setRsvpValue: (field, value) => setRsvpValues((v) => ({ ...v, [field]: value })),
    canRsvp,
    rsvp: (attending = true) => run(() => submitRsvp(event.id, rsvpValues, attending ? "YES" : "NO")),
    submitting,
    confirmed,
    error,
  };
}
