// React binding of the reservation store (wix/restaurants/reservation-store.ts) — the whole
// table-reservation state machine lives there, framework-free: location, date + party size in the
// location's timezone, AVAILABLE slots, the 10-minute hold with its countdown (automatic approval)
// or the approval request (manual approval), the details form driven by the location's form
// configuration, and confirm. All correctness lives in the data layer; you own how it looks.
// Client-only: availability is time-specific, so render the surface with client:only="react" in Astro.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createReservationStore, type ReservationState, type ReservationStore } from "../../wix/restaurants/reservation-store";

export type UseReservation = ReservationState &
  Pick<
    ReservationStore,
    | "setLocationId"
    | "setDate"
    | "setTime"
    | "setPartySize"
    | "findSlots"
    | "holdSlot"
    | "setReserveeField"
    | "setMarketingConsent"
    | "setCustomField"
    | "confirm"
    | "reset"
  >;

export function useReservation(): UseReservation {
  const ref = useRef<ReservationStore | null>(null);
  if (!ref.current) ref.current = createReservationStore();
  const store = ref.current;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    ...state,
    setLocationId: store.setLocationId,
    setDate: store.setDate,
    setTime: store.setTime,
    setPartySize: store.setPartySize,
    findSlots: store.findSlots,
    holdSlot: store.holdSlot,
    setReserveeField: store.setReserveeField,
    setMarketingConsent: store.setMarketingConsent,
    setCustomField: store.setCustomField,
    confirm: store.confirm,
    reset: store.reset,
  };
}
