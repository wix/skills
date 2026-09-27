// React binding of the booking-flow store (wix/bookings/booking-flow-store.ts) — the whole booking
// state machine for one service lives there, framework-free: availability window (day-grouped
// slots, week paging, optional staff filter), the schema-driven form, and book(). All correctness
// (slot scheduleId vs eventId, ANY_RESOURCE, formSubmission, payment option, checkout-or-place)
// lives in the data layer; you own how it looks. Mount the surface client-only: availability is
// timezone/session-specific.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createBookingFlowStore, type BookingFlowState, type BookingFlowStore } from "../../wix/bookings/booking-flow-store";
import type { ServiceDetail } from "../../wix/bookings/types";

export type UseBookingFlow = BookingFlowState &
  Pick<BookingFlowStore, "nextWeek" | "prevWeek" | "setStaffId" | "setSelectedSlot" | "setValue" | "book">;

export function useBookingFlow(service: ServiceDetail): UseBookingFlow {
  const ref = useRef<{ serviceId: string; store: BookingFlowStore } | null>(null);
  if (!ref.current || ref.current.serviceId !== service.id) ref.current = { serviceId: service.id, store: createBookingFlowStore(service) };
  const store = ref.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    ...state,
    nextWeek: store.nextWeek,
    prevWeek: store.prevWeek,
    setStaffId: store.setStaffId,
    setSelectedSlot: store.setSelectedSlot,
    setValue: store.setValue,
    book: store.book,
  };
}
