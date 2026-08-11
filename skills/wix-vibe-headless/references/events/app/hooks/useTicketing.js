// useTicketing — ticket selection + checkout logic for a TICKETING event, no markup.
//   • queryTicketDefinitions(eventId) already returns only non-hidden, buyable (SALE_STARTED) tickets.
//   • Ticket-definition price is a PLAIN number at pricing.fixedPrice.amount (+ currency) — a different
//     shape from the card's registration.tickets.lowestPrice Money object.
//   • reserveTickets([...]) holds the tickets (status PENDING) and throws if they aren't actually held.
//   • PAID tickets: reserve → window.location = getTicketCheckoutUrl(event, reservationId) (the Wix-
//     hosted ticket form collects guest details + payment). NEVER hand-build that URL.
//   • FREE tickets only: reserve → checkoutTickets(eventId, { reservationId, buyer, guests }) finishes
//     in-app and returns an order with status "FREE"; it throws for paid orders.
import { useState, useEffect } from "react";
import {
  queryTicketDefinitions, reserveTickets, getTicketCheckoutUrl, checkoutTickets,
} from "@/rest/wix-events-registration";

export function useTicketing(event) {
  const eventId = event?.id;
  const [definitions, setDefinitions] = useState([]);
  const [selection, setSelection] = useState({}); // { [defId]: { quantity, guestPrice?, pricingOptionId? } }
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState(null); // free-checkout order on success
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!eventId) return;
    queryTicketDefinitions(eventId).then(setDefinitions);
  }, [eventId]);

  const setLine = (defId, patch) =>
    setSelection((s) => ({ ...s, [defId]: { quantity: 0, ...s[defId], ...patch } }));
  const setQuantity = (defId, quantity) => setLine(defId, { quantity: Math.max(0, quantity) });

  const lines = Object.entries(selection)
    .filter(([, l]) => l.quantity > 0)
    .map(([ticketDefinitionId, l]) => ({
      ticketDefinitionId,
      quantity: l.quantity,
      guestPrice: l.guestPrice,
      pricingOptionId: l.pricingOptionId,
    }));

  const hasSelection = lines.length > 0;
  const allFree = hasSelection && lines.every((l) => definitions.find((d) => d.id === l.ticketDefinitionId)?.free);

  // PAID (or mixed): reserve then hand off to the Wix-hosted ticket form.
  async function checkoutPaid() {
    setSubmitting(true);
    setError(null);
    try {
      const reservation = await reserveTickets(lines);
      window.location.href = getTicketCheckoutUrl(event, reservation.id);
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  // FREE tickets only: reserve then finish in-app; buyer = { firstName, lastName, email }.
  async function checkoutFree(buyer) {
    setSubmitting(true);
    setError(null);
    try {
      const reservation = await reserveTickets(lines);
      const created = await checkoutTickets(eventId, {
        reservationId: reservation.id,
        buyer,
        guests: [{ firstName: buyer.firstName, lastName: buyer.lastName, email: buyer.email }],
      });
      setOrder(created); // status "FREE"; carries ticketsPdf + tickets[]
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return {
    definitions, selection, setQuantity, setLine,
    hasSelection, allFree, submitting, order, error,
    checkoutPaid, checkoutFree,
  };
}
