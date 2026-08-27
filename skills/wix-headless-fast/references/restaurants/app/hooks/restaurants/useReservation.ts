// The whole table-reservation state machine: location, date + party size, AVAILABLE slots,
// the 10-minute hold, the details form, and confirm. All correctness (AVAILABLE-only slots,
// hold → reserve with the revision, firstName + E.164 phone, RESERVED vs REQUESTED) lives in
// the data layer — this hook orchestrates; you own how it looks. Client-only: availability
// is timezone-specific, so render the surface with client:only="react" in Astro.
import { useEffect, useState } from "react";
import {
  completeReservation,
  fetchReservationLocations,
  fetchReservationSlots,
  holdReservation,
} from "../../wix/restaurants/reservations";
import type {
  ReservationConfirmation,
  ReservationHold,
  ReservationLocationInfo,
  ReservationReservee,
  ReservationSlot,
} from "../../wix/restaurants/types";

const todayKey = (): string => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export interface UseReservation {
  /** null while loading; [] when Table Reservations isn't set up (honest empty state). */
  locations: ReservationLocationInfo[] | null;
  /** The active location (default first). Render a picker only when locations.length > 1. */
  location: ReservationLocationInfo | null;
  setLocationId: (id: string) => void;
  /** "YYYY-MM-DD" for a date input. */
  date: string;
  setDate: (date: string) => void;
  /** "HH:mm" anchor for the slot fan-out. */
  time: string;
  setTime: (time: string) => void;
  /** Clamped to the location's partySizeMin/Max. */
  partySize: number;
  setPartySize: (size: number) => void;
  /** AVAILABLE slots for the current query; null until findSlots ran. */
  slots: ReservationSlot[] | null;
  findSlots: () => Promise<void>;
  /** Set after holdSlot — the visitor has 10 minutes to confirm. */
  held: ReservationHold | null;
  holdSlot: (slot: ReservationSlot) => Promise<void>;
  reservee: ReservationReservee;
  setReserveeField: (field: keyof ReservationReservee, value: string) => void;
  /** True when a slot is held and firstName + phone are filled — gate the confirm CTA. */
  canConfirm: boolean;
  confirm: () => Promise<void>;
  /** Set on success. REQUESTED → tell the visitor approval is pending, not confirmed. */
  confirmed: ReservationConfirmation | null;
  /** Back to slot picking (keeps date/party). */
  reset: () => void;
  loading: boolean;
  error: string | null;
}

export function useReservation(): UseReservation {
  const [locations, setLocations] = useState<ReservationLocationInfo[] | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(todayKey());
  const [time, setTime] = useState<string>("19:00");
  const [partySize, setPartySizeRaw] = useState<number>(2);
  const [slots, setSlots] = useState<ReservationSlot[] | null>(null);
  const [held, setHeld] = useState<ReservationHold | null>(null);
  const [reservee, setReservee] = useState<ReservationReservee>({ firstName: "", phone: "" });
  const [confirmed, setConfirmed] = useState<ReservationConfirmation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchReservationLocations()
      .then((locs) => {
        if (!alive) return;
        setLocations(locs);
        setLocationId((id) => id ?? locs[0]?.id ?? null);
      })
      .catch((e) => {
        if (!alive) return;
        setLocations([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  const location = locations?.find((l) => l.id === locationId) ?? locations?.[0] ?? null;

  const setPartySize = (size: number) => {
    const min = location?.partySizeMin ?? 1;
    const max = location?.partySizeMax ?? 20;
    setPartySizeRaw(Math.min(Math.max(size, min), max));
  };

  async function findSlots(): Promise<void> {
    if (!location) return;
    setError(null);
    setSlots(null);
    setHeld(null);
    setConfirmed(null);
    setLoading(true);
    try {
      const aroundIso = new Date(`${date}T${time}:00`).toISOString();
      setSlots(await fetchReservationSlots(location.id, aroundIso, partySize));
    } catch (e) {
      setSlots([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function holdSlot(slot: ReservationSlot): Promise<void> {
    if (!location) return;
    setError(null);
    setLoading(true);
    try {
      setHeld(await holdReservation(location.id, slot.startIso, partySize));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const canConfirm =
    !!held && reservee.firstName.trim().length > 0 && reservee.phone.trim().length > 0 && !loading;

  async function confirm(): Promise<void> {
    if (!held) return;
    setError(null);
    setLoading(true);
    try {
      setConfirmed(await completeReservation(held, reservee));
    } catch (e) {
      // An expired hold can't be reserved — send the visitor back to slot picking.
      setError(e instanceof Error ? e.message : String(e));
      setHeld(null);
    } finally {
      setLoading(false);
    }
  }

  return {
    locations,
    location,
    setLocationId,
    date,
    setDate,
    time,
    setTime,
    partySize,
    setPartySize,
    slots,
    findSlots,
    held,
    holdSlot,
    reservee,
    setReserveeField: (field, value) => setReservee((r) => ({ ...r, [field]: value })),
    canConfirm,
    confirm,
    confirmed,
    reset: () => {
      setHeld(null);
      setConfirmed(null);
      setSlots(null);
      setError(null);
    },
    loading,
    error,
  };
}
