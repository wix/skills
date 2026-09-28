// The campaigns listing as a framework-free store — the logic behind useCampaigns, usable from
// React (useCampaigns wraps it with useSyncExternalStore), from a static page or Vue/Svelte
// (subscribe and render), or as the specification for a port.
//
// SSR-friendly: seed with `initialCampaigns` and they render at once with no client fetch; without
// a seed `start()` fetches the non-archived campaigns. A failed load leaves `campaigns: []` with the
// message in `error`, so the surface renders its empty state and the message, never a skeleton
// forever. One store per mounted listing: createCampaignsStore(), not a singleton.
import { fetchCampaigns } from "./campaigns";
import type { CampaignSummary } from "./types";

export interface CampaignsStoreOptions {
  initialCampaigns?: CampaignSummary[];
}

export interface CampaignsState {
  /** null while the first load is in flight — render skeletons, not an empty state. */
  campaigns: CampaignSummary[] | null;
  error: string | null;
}

export interface CampaignsStore {
  getState(): CampaignsState;
  subscribe(listener: () => void): () => void;
  /** Fetch the campaigns when no `initialCampaigns` were given. Call once when mounted (a browser). */
  start(): void;
  /** Stop reacting; drop a late response. */
  stop(): void;
}

export function createCampaignsStore({ initialCampaigns }: CampaignsStoreOptions = {}): CampaignsStore {
  let state: CampaignsState = { campaigns: initialCampaigns ?? null, error: null };
  let started = false;
  const listeners = new Set<() => void>();

  function setState(patch: Partial<CampaignsState>): void {
    state = { ...state, ...patch };
    for (const fn of listeners) fn();
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start() {
      if (started) return;
      started = true;
      if (initialCampaigns) return;
      fetchCampaigns()
        .then((campaigns) => { if (started) setState({ campaigns }); })
        .catch((e) => { if (started) setState({ campaigns: [], error: e instanceof Error ? e.message : String(e) }); });
    },
    stop() {
      started = false;
    },
  };
}
