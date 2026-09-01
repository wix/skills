// The whole booking state machine for one service: availability window (day-grouped slots,
// week paging, optional staff filter), the schema-driven form, and book(). All correctness
// (slot scheduleId vs eventId, ANY_RESOURCE, formSubmission, payment option, checkout-or-
// place) lives in the data layer — this hook orchestrates; you own how it looks.
import { useEffect, useMemo, useState } from "react";
import { bookService, fetchBookingForm, fetchSlots } from "../../wix/bookings/booking";
import type { BookingFormField, BookingResult, ServiceDetail, Slot } from "../../wix/bookings/types";

export interface UseBookingFlow {
  /** Slots grouped by day, in order — [{ dayKey, dayLabel, slots }]. null while loading. */
  days: { dayKey: string; dayLabel: string; slots: Slot[] }[] | null;
  /** The 7-day window start; page with nextWeek/prevWeek (prev clamps to today). */
  windowStart: Date;
  nextWeek: () => void;
  prevWeek: () => void;
  /** Staff filter — render a picker only when service.staff.length > 1. */
  staffId: string | undefined;
  setStaffId: (id: string | undefined) => void;
  selectedSlot: Slot | null;
  setSelectedSlot: (s: Slot | null) => void;
  /** Schema-driven form fields (never empty — contact basics fallback). */
  formFields: BookingFormField[];
  values: Record<string, string>;
  setValue: (target: string, value: string) => void;
  /** True when a slot is selected and every field has a value. */
  canBook: boolean;
  /** Books the selected slot. On "redirect" the browser is already navigating. */
  book: () => Promise<BookingResult>;
  booking: boolean;
  /** Set after a free/offline booking completes. */
  confirmed: BookingResult | null;
  error: string | null;
}

const dayLabel = (dayKey: string): string => {
  try {
    return new Date(`${dayKey}T12:00:00`).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dayKey;
  }
};

export function useBookingFlow(service: ServiceDetail): UseBookingFlow {
  const [windowStart, setWindowStart] = useState<Date>(() => new Date());
  const [staffId, setStaffId] = useState<string | undefined>(undefined);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [formFields, setFormFields] = useState<BookingFormField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [booking, setBooking] = useState(false);
  const [confirmed, setConfirmed] = useState<BookingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setSlots(null);
    setSelectedSlot(null);
    fetchSlots(service, { from: windowStart, days: 7, staffId })
      .then((s) => alive && setSlots(s))
      .catch((e) => {
        if (!alive) return;
        setSlots([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.id, windowStart, staffId]);

  useEffect(() => {
    let alive = true;
    fetchBookingForm(service.formId).then((f) => alive && setFormFields(f));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.formId]);

  const days = useMemo(() => {
    if (slots === null) return null;
    const byDay = new Map<string, Slot[]>();
    for (const s of slots) byDay.set(s.dayKey, [...(byDay.get(s.dayKey) ?? []), s]);
    return [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dayKey, daySlots]) => ({ dayKey, dayLabel: dayLabel(dayKey), slots: daySlots }));
  }, [slots]);

  const canBook =
    !!selectedSlot && formFields.every((f) => (values[f.target] ?? "").trim().length > 0);

  async function book(): Promise<BookingResult> {
    if (!selectedSlot) throw new Error("Pick a time first.");
    setBooking(true);
    setError(null);
    try {
      const result = await bookService(service, selectedSlot, values, { staffId });
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
      setBooking(false);
    }
  }

  return {
    days,
    windowStart,
    nextWeek: () => setWindowStart((d) => new Date(d.getTime() + 7 * 24 * 3600 * 1000)),
    prevWeek: () =>
      setWindowStart((d) => {
        const prev = new Date(d.getTime() - 7 * 24 * 3600 * 1000);
        return prev < new Date() ? new Date() : prev;
      }),
    staffId,
    setStaffId,
    selectedSlot,
    setSelectedSlot,
    formFields,
    values,
    setValue: (target, value) => setValues((v) => ({ ...v, [target]: value })),
    canBook,
    book,
    booking,
    confirmed,
    error,
  };
}
