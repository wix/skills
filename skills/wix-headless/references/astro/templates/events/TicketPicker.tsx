import { useState } from "react";
import { buyTickets, isPaymentSetupError } from "./eventsDriver";

// TicketPicker.tsx — client:only="react" island for a TICKETING event.
// Renders the event's ticket tiers (fetched server-side, passed in as `tiers`),
// lets the visitor pick a quantity per tier, then reserves + redirects to Wix's
// hosted checkout via eventsDriver.buyTickets(). No payment is collected here.
//
// Adapt copy/layout/classes to the brand; keep the SDK flow in the driver intact.

export interface TicketTier {
  id: string; // ticketDefinitionId
  name: string;
  price?: string; // formatted, e.g. "$65.00"; undefined for free tiers
  description?: string;
  soldOut?: boolean;
}

interface Props {
  eventSlug: string;
  tiers: TicketTier[];
  ticketLimitPerOrder?: number; // from event.registration.tickets.ticketLimitPerOrder
}

export default function TicketPicker({ eventSlug, tiers, ticketLimitPerOrder = 8 }: Props) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<"idle" | "submitting">("idle");
  const [error, setError] = useState<string | null>(null);

  const total = Object.values(qty).reduce((n, q) => n + (q || 0), 0);
  const set = (id: string, q: number) =>
    setQty((prev) => ({ ...prev, [id]: Math.max(0, Math.min(ticketLimitPerOrder, q)) }));

  const handleCheckout = async () => {
    if (total === 0) return;
    setStatus("submitting");
    setError(null);
    try {
      await buyTickets({
        eventSlug,
        selections: Object.entries(qty)
          .filter(([, q]) => q > 0)
          .map(([ticketDefinitionId, quantity]) => ({ ticketDefinitionId, quantity })),
      });
      // redirect in progress — the page is navigating to Wix's checkout
    } catch (err) {
      console.error("[events] checkout failed:", err);
      setError(
        isPaymentSetupError(err)
          ? "Ticket sales aren't switched on yet — the organizer still needs to connect a payment method."
          : "Something went wrong starting checkout. Please try again.",
      );
      setStatus("idle");
    }
  };

  return (
    <div className="ticket-picker">
      <ul className="ticket-tier-list">
        {tiers.map((t) => (
          <li key={t.id} className={`ticket-tier${t.soldOut ? " ticket-tier--soldout" : ""}`}>
            <div className="ticket-tier-info">
              <span className="ticket-tier-name">{t.name}</span>
              {t.description && <span className="ticket-tier-desc">{t.description}</span>}
            </div>
            <span className="ticket-tier-price">{t.price ?? "Free"}</span>
            {t.soldOut ? (
              <span className="ticket-tier-soldout">Sold out</span>
            ) : (
              <div className="ticket-qty" role="group" aria-label={`Quantity for ${t.name}`}>
                <button type="button" onClick={() => set(t.id, (qty[t.id] || 0) - 1)} aria-label="Decrease">−</button>
                <span className="ticket-qty-value">{qty[t.id] || 0}</span>
                <button type="button" onClick={() => set(t.id, (qty[t.id] || 0) + 1)} aria-label="Increase">+</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="ticket-error" role="alert">{error}</p>}

      <button
        type="button"
        className="ticket-cta"
        disabled={total === 0 || status === "submitting"}
        onClick={handleCheckout}
      >
        {status === "submitting"
          ? "Taking you to checkout…"
          : total > 0
            ? `Checkout · ${total} ${total === 1 ? "ticket" : "tickets"}`
            : "Select tickets"}
      </button>
      <p className="ticket-note">You'll enter your details and pay securely on Wix. Tickets are emailed with a check-in QR code.</p>
    </div>
  );
}
