// React binding of the plan-access store (wix/pricing-plans/plan-access-store.ts) — the paywall
// logic lives there, framework-free; this hook subscribes to one instance per gated surface and
// feeds it the members session. The session is the `members` vertical's `useMember()` result
// (`{ loggedIn, loading }`) — this vertical does not ship it, so the caller passes it:
//   const session = useMember(); const { hasAccess, loading } = usePlanAccess(planIds, session);
// SSR-friendly: `initialAccess` resolved in frontmatter renders at once. Astro islands and React
// SPAs use this; a static page, Vue, or Svelte uses the store directly.
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  createPlanAccessStore,
  type PlanAccessSession,
  type PlanAccessState,
  type PlanAccessStore,
  type PlanAccessStoreOptions,
} from "../../wix/pricing-plans/plan-access-store";

export type { PlanAccessSession };
export type UsePlanAccessOptions = Omit<PlanAccessStoreOptions, "planIds">;
export type UsePlanAccess = PlanAccessState;

/** `planIds` are read once, on mount — a surface gated by other plans is another mount. */
export function usePlanAccess(planIds: string[], session: PlanAccessSession, options: UsePlanAccessOptions = {}): UsePlanAccess {
  const ref = useRef<PlanAccessStore | null>(null);
  if (!ref.current) ref.current = createPlanAccessStore({ planIds, ...options });
  const store = ref.current;
  useEffect(() => {
    store.check(session);
    return () => store.stop();
  }, [store, session.loggedIn, session.loading]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
