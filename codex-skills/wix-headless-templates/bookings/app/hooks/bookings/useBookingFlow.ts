// React binding of the booking-flow store (wix/bookings/booking-flow-store.ts) — the whole booking
// state machine for one service lives there, framework-free: the display zone, the availability
// window (day-grouped slots, week paging, staff filter, next availability), a course's seats, a
// class's sessions, participants, deposit choice, add-ons, the schema-driven form, the CTA state,
// and book(). All correctness lives in the data layer; you own how it looks. Mount the surface
// client-only: availability is timezone/session-specific.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createBookingFlowStore, type BookingFlowState, type BookingFlowStore } from "../../wix/bookings/booking-flow-store";
import type { ServiceDetail } from "../../wix/bookings/types";

export type UseBookingFlow = BookingFlowState &
  Pick<
    BookingFlowStore,
    | "nextWeek"
    | "prevWeek"
    | "jumpTo"
    | "setStaffId"
    | "setSelectedSlot"
    | "setDisplayTimeZone"
    | "setParticipants"
    | "setPayDeposit"
    | "toggleAddOn"
    | "setAddOnQuantity"
    | "canSelectMore"
    | "loadMoreSessions"
    | "setValue"
    | "book"
  >;

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
    jumpTo: store.jumpTo,
    setStaffId: store.setStaffId,
    setSelectedSlot: store.setSelectedSlot,
    setDisplayTimeZone: store.setDisplayTimeZone,
    setParticipants: store.setParticipants,
    setPayDeposit: store.setPayDeposit,
    toggleAddOn: store.toggleAddOn,
    setAddOnQuantity: store.setAddOnQuantity,
    canSelectMore: store.canSelectMore,
    loadMoreSessions: store.loadMoreSessions,
    setValue: store.setValue,
    book: store.book,
  };
}
