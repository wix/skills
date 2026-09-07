// Plans listing. SSR-friendly: pass server-fetched data as `initialPlans` (Astro frontmatter
// / server component) and no client fetch happens; a SPA passes nothing.
import { useEffect, useState } from "react";
import { fetchPlans } from "../../wix/pricing-plans/plans";
import type { PlanSummary } from "../../wix/pricing-plans/types";

export interface UsePlansOptions {
  initialPlans?: PlanSummary[];
}

export interface UsePlans {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  plans: PlanSummary[] | null;
  error: string | null;
}

export function usePlans({ initialPlans }: UsePlansOptions = {}): UsePlans {
  const [plans, setPlans] = useState<PlanSummary[] | null>(initialPlans ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!initialPlans) {
      fetchPlans()
        .then((p) => alive && setPlans(p))
        .catch((e) => {
          if (!alive) return;
          setPlans([]);
          setError(e instanceof Error ? e.message : String(e));
        });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { plans, error };
}
