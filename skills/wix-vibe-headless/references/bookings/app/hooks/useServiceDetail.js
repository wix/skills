// useServiceDetail — all detail + booking-flow logic, no markup: load a service by id, list its
// bookable slots, hold the buyer's slot/contact/participant selections, then re-validate and book +
// check out in one step. The data paths here are the bug-prone part — keep them verbatim; the
// ServiceDetail page and the SlotPicker/BookingForm components only render what this returns.
import { useState, useEffect, useMemo, useCallback } from "react";
import { getService, listSlotsForService, getAvailableSlot } from "@/rest/wix-bookings-services";
import { bookAndCheckout } from "@/rest/wix-bookings-checkout";

// Local wall-clock "YYYY-MM-DDThh:mm:ss" (NO zone / Z) — the slot APIs interpret it in the
// visitor's timeZone. Sending a UTC `Z` timestamp to the slot APIs is wrong.
function localMidnight(daysFromNow = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`;
}

export function useServiceDetail(serviceId) {
  const [service, setService] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [slots, setSlots] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [contact, setContact] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [participants, setParticipants] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // getService returns null on a miss — show not-found, never invent a service.
    getService(serviceId).then((s) => (s ? setService(s) : setNotFound(true)));
  }, [serviceId]);

  useEffect(() => {
    if (!service) return;
    // listSlotsForService routes by service.type (APPOINTMENT → working hours, CLASS → sessions) and
    // returns { slots, nextCursor }. The LIST call takes fromLocalDate / toLocalDate — a different
    // arg naming than the single-slot re-validate call (getAvailableSlot: localStartDate/localEndDate).
    listSlotsForService(service, { fromLocalDate: localMidnight(0), toLocalDate: localMidnight(14) })
      .then(({ slots, nextCursor }) => { setSlots(slots); setCursor(nextCursor); });
  }, [service]);

  const loadMoreSlots = useCallback(() => {
    if (!service || !cursor) return;
    listSlotsForService(service, { cursor }).then(({ slots: more, nextCursor }) => {
      setSlots((s) => [...s, ...more]);
      setCursor(nextCursor);
    });
  }, [service, cursor]);

  // maxParticipantsPerBooking is the per-booking cap (commonly 1 → no selector; book exactly one).
  // Never use slot.remainingCapacity as the per-buyer limit — a count above the policy makes
  // createBooking fail.
  const maxParticipants = service?.bookingPolicy?.participantsPolicy?.maxParticipantsPerBooking ?? 1;

  const price = useMemo(() => {
    const p = service?.payment?.fixed?.price;
    if (!p) return "";                                     // free / custom-priced
    return p.formattedValue                                // formattedValue is OPTIONAL — build from value+currency when missing
      || new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency }).format(Number(p.value));
  }, [service]);

  const setContactField = (k) => (e) => setContact((c) => ({ ...c, [k]: e.target.value }));
  const canSubmit = Boolean(selectedSlot && contact.email && !submitting);

  const submit = useCallback(async () => {
    if (!selectedSlot || !service) return;
    setSubmitting(true);
    setError(null);
    try {
      // Re-validate right before booking — slots get taken. getAvailableSlot returns the slot or NULL
      // (guard it); the single-slot call uses localStartDate / localEndDate (not from/toLocalDate).
      const fresh = await getAvailableSlot(service.id, {
        localStartDate: selectedSlot.localStartDate,
        localEndDate: selectedSlot.localEndDate,
      });
      if (!fresh) {
        setSelectedSlot(null);
        setError("That time was just taken — please pick another.");
        return;
      }
      // bookAndCheckout = createBooking(slot, contact, options) then checkoutBooking; it returns
      // { booking, checkoutUrl } — redirect straight to the hosted checkout, never a hand-built URL.
      const { checkoutUrl } = await bookAndCheckout(fresh, contact, { totalParticipants: participants });
      window.location.href = checkoutUrl;
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }, [service, selectedSlot, contact, participants]);

  return {
    service, notFound, price,
    slots, cursor, loadMoreSlots,
    selectedSlot, pickSlot: setSelectedSlot,
    contact, setContactField,
    maxParticipants, participants, setParticipants,
    submitting, error, canSubmit, submit,
  };
}
