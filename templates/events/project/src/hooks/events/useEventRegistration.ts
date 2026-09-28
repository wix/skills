// React binding of the registration store (wix/events/registration-store.ts) — the whole
// registration state machine for one event lives there, framework-free, branched on
// event.registrationType: TICKETING loads the tier picker and checkout() reserves → redirects to
// Wix's hosted checkout; RSVP is the built-in name+email form submitted in place. All correctness
// (the visitor-public tier read, the reservation payload, the redirect callbacks, rsvpV2) lives
// in the data layer; you own how it looks. One store per event — a new event id gets a fresh one.
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  createRegistrationStore,
  type RegistrationState,
  type RegistrationStore,
} from "../../wix/events/registration-store";
import type { EventDetail } from "../../wix/events/types";

export type UseEventRegistration = RegistrationState &
  Pick<RegistrationStore, "setQuantity" | "setRsvpValue" | "checkout" | "rsvp">;

export function useEventRegistration(event: EventDetail): UseEventRegistration {
  const key = `${event.id}:${event.registrationType}`;
  const ref = useRef<{ key: string; store: RegistrationStore } | null>(null);
  if (!ref.current || ref.current.key !== key) ref.current = { key, store: createRegistrationStore(event) };
  const store = ref.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    ...state,
    setQuantity: store.setQuantity,
    setRsvpValue: store.setRsvpValue,
    checkout: store.checkout,
    rsvp: store.rsvp,
  };
}
