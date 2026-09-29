// React binding of the receipt store (wix/donations/receipt-store.ts) — the thank-you page's order
// read. Reads `?orderId=` (or `?orderid=`) from the browser URL when no id is passed, so mount the
// consuming island client:only. `receipt` null once `loading` is false is a normal outcome (the
// order may not be readable by the visitor) — thank without order facts then.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createReceiptStore, type ReceiptState, type ReceiptStore } from "../../wix/donations/receipt-store";

export type UseDonationReceipt = ReceiptState;

export function useDonationReceipt(orderId?: string): UseDonationReceipt {
  const ref = useRef<ReceiptStore | null>(null);
  if (!ref.current) ref.current = createReceiptStore(orderId);
  const store = ref.current;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
