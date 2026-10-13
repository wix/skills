// React binding of the order store (wix/events/order-store.ts) — the post-checkout confirmation's
// state machine lives there, framework-free: the event for context, the order with its invoice,
// the 2 s / 15 s poll until the tickets are generated, and the honest `orderUnavailable` fallback
// when the visitor scope can't read the order. Pass the `?orderNumber=&eventId=` the hosted
// checkout appended to the thank-you URL. One store per confirmation view.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createOrderStore, type OrderState, type OrderStore, type OrderStoreOptions } from "../../wix/events/order-store";

export type UseEventConfirmation = OrderState;

export function useEventConfirmation(options: OrderStoreOptions): UseEventConfirmation {
  const key = `${options.eventId}:${options.orderNumber}`;
  const ref = useRef<{ key: string; store: OrderStore } | null>(null);
  if (!ref.current || ref.current.key !== key) ref.current = { key, store: createOrderStore(options) };
  const store = ref.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
