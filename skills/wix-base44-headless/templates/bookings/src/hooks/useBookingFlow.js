// useBookingFlow — all booking logic, no markup: load the service, list bookable slots for a local
// date range (routed by service.type), track the selected slot + participant count + contact form,
// re-validate the slot immediately before booking, then create + check out in one redirect. The
// date/timezone handling, participant cap, and re-validate-before-book step are the bug-prone parts
// — keep them verbatim; ServiceDetail only renders what this returns.
import { useState, useEffect, useMemo, useCallback } from "react";
import { getService, listSlotsForService, getAvailableSlot } from "@/rest/wix-bookings-services";
import { bookAndCheckout } from "@/rest/wix-bookings-checkout";

const timeZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();

// local "YYYY-MM-DDThh:mm:ss" for `d` at wall-clock midnight (slot APIs want local, not UTC Z).
function localDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T00:00:00`;
}

export function useBookingFlow(serviceId, { days = 14 } = {}) {
  const [service, setService] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [slots, setSlots] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [participants, setParticipants] = useState(1);
  const [contact, setContact] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    getService(serviceId).then((s) => (s ? setService(s) : setNotFound(true)));
  }, [serviceId]);

  useEffect(() => {
    if (!service) return;
    const from = new Date();
    const to = new Date(); to.setDate(to.getDate() + days);
    listSlotsForService(service, { fromLocalDate: localDate(from), toLocalDate: localDate(to), timeZone })
      .then((r) => setSlots(r.slots.filter((s) => s.bookable)))
      .catch((e) => { setError(e.message); setSlots([]); });
  }, [service, days]);

  const maxParticipants = useMemo(() => {
    const policy = service?.bookingPolicy?.participantsPolicy;
    const perBooking = policy?.enabled ? policy?.maxParticipantsPerBooking ?? 1 : 1;
    if (!selectedSlot) return perBooking;
    // for a class, also bound by the slot's open spots
    return Math.max(1, Math.min(perBooking, selectedSlot.remainingCapacity ?? perBooking));
  }, [service, selectedSlot]);

  const setContactField = (k, v) => setContact((c) => ({ ...c, [k]: v }));
  const canBook = !!selectedSlot && !!contact.email && !submitting;

  const book = useCallback(async () => {
    if (!selectedSlot) return;
    setSubmitting(true); setError(null);
    try {
      // re-validate the slot right before booking (slots get taken); picks up the staff resource.
      const fresh = await getAvailableSlot(serviceId, {
        localStartDate: selectedSlot.localStartDate, localEndDate: selectedSlot.localEndDate, timeZone,
      });
      const slot = fresh || selectedSlot;
      const { checkoutUrl } = await bookAndCheckout(slot, contact, { totalParticipants: participants, timeZone });
      window.location.href = checkoutUrl;
    } catch (e) {
      setError(e.message); setSubmitting(false);
    }
  }, [serviceId, selectedSlot, contact, participants]);

  return {
    service, notFound, slots, selectedSlot, setSelectedSlot,
    participants, setParticipants, maxParticipants,
    contact, setContactField, canBook, submitting, error, book,
  };
}
