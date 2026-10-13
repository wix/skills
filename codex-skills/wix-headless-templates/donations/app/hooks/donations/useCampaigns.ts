// React binding of the campaigns store (wix/donations/campaigns-store.ts) — the listing logic lives
// there, framework-free; this hook subscribes to one instance per mounted listing. SSR-friendly:
// pass server-fetched data as `initialCampaigns` (Astro frontmatter / server component) and no
// client fetch happens; a SPA passes nothing.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createCampaignsStore, type CampaignsState, type CampaignsStore, type CampaignsStoreOptions } from "../../wix/donations/campaigns-store";

export type UseCampaignsOptions = CampaignsStoreOptions;

export type UseCampaigns = CampaignsState;

export function useCampaigns(options: UseCampaignsOptions = {}): UseCampaigns {
  const ref = useRef<CampaignsStore | null>(null);
  if (!ref.current) ref.current = createCampaignsStore(options);
  const store = ref.current;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
