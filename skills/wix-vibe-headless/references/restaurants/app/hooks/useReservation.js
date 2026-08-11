// useReservation — all table-reservation flow logic, no markup. The bug-prone parts are here and
// must stay verbatim: skip archived locations; offer only AVAILABLE slots; a HELD reservation
// carries the { id, revision } that reserveReservation NEEDS and expires in 10 minutes; the
// confirmed status is RESERVED (auto-approved) or REQUESTED (manual approval pending). firstName +
// phone (E.164, e.g. "+15551234567") are mandatory. The page only renders what this returns.
import { useState, useEffect, useCallback } from "react";
import {
  listReservationLocations,
  getTimeSlots,
  createHeldReservation,
  reserveReservation,
} from "@/rest/wix-restaurants-reservations";

const today = () => new Date().toISOString().slice(0, 10);   // yyyy-mm-dd for the date input

export function useReservation() {
  const [locations, setLocations] = useState(null);
  const [locationId, setLocationId] = useState(null);
  const [date, setDate] = useState(today());
  const [partySize, setPartySize] = useState(2);
  const [slots, setSlots] = useState(null);                  // AVAILABLE slots for the current query
  const [held, setHeld] = useState(null);                    // { id, revision, ... } after hold
  const [reservee, setReservee] = useState({ firstName: "", lastName: "", phone: "", email: "" });
  const [confirmed, setConfirmed] = useState(null);          // reservation after reserve
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    listReservationLocations().then((locs) => {
      const active = locs.filter((l) => l.archived !== true);   // archived locations are hidden
      setLocations(active);
      setLocationId(active.find((l) => l.default)?.id ?? active[0]?.id ?? null);
    });
  }, []);

  // The chosen slot's ISO datetime is passed to hold (getTimeSlots wants an ISO datetime for `date`).
  const findSlots = useCallback(async () => {
    if (!locationId) return;
    setError(null); setSlots(null); setHeld(null); setConfirmed(null); setLoading(true);
    try {
      const iso = new Date(`${date}T19:00:00`).toISOString();
      const { availableTimeSlots } = await getTimeSlots(locationId, iso, partySize);
      setSlots(availableTimeSlots);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [locationId, date, partySize]);

  const holdSlot = async (slot) => {
    setError(null); setLoading(true);
    try { setHeld(await createHeldReservation(locationId, slot.startDate, partySize)); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const confirm = async () => {
    if (!held) return;
    setError(null); setLoading(true);
    try {
      const clean = { firstName: reservee.firstName, phone: reservee.phone };
      if (reservee.lastName) clean.lastName = reservee.lastName;
      if (reservee.email) clean.email = reservee.email;
      setConfirmed(await reserveReservation(held.id, held.revision, clean));
    } catch (e) { setError(e.message); setHeld(null); } finally { setLoading(false); }
  };

  const reset = () => { setHeld(null); setConfirmed(null); setSlots(null); setError(null); };

  return {
    locations, locationId, setLocationId,
    date, setDate, partySize, setPartySize,
    slots, findSlots, held, holdSlot,
    reservee, setReservee, confirm, confirmed, reset,
    loading, error,
  };
}
