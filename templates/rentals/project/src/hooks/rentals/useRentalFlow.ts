// React binding of the rental-flow store (wix/rentals/rental-flow-store.ts) — the whole rental
// state machine for one rental lives there, framework-free: the availability window (starts grouped
// by day, paging), the chosen start, the lengths it allows, the chosen length and its quote, the
// schema-driven form, the CTA state, and rent(). All correctness lives in the data layer; you own
// how it looks. Mount the surface client-only: availability is time-zone/session-specific.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createRentalFlowStore, type RentalFlowState, type RentalFlowStore } from "../../wix/rentals/rental-flow-store";
import type { RentalDetail } from "../../wix/rentals/types";

export type UseRentalFlow = RentalFlowState & Pick<RentalFlowStore, "nextWindow" | "prevWindow" | "jumpTo" | "setSelectedStart" | "setSelectedEnd" | "setValue" | "rent">;

export function useRentalFlow(rental: RentalDetail): UseRentalFlow {
  const ref = useRef<{ rentalId: string; store: RentalFlowStore } | null>(null);
  if (!ref.current || ref.current.rentalId !== rental.id) ref.current = { rentalId: rental.id, store: createRentalFlowStore(rental) };
  const store = ref.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    ...state,
    nextWindow: store.nextWindow,
    prevWindow: store.prevWindow,
    jumpTo: store.jumpTo,
    setSelectedStart: store.setSelectedStart,
    setSelectedEnd: store.setSelectedEnd,
    setValue: store.setValue,
    rent: store.rent,
  };
}
