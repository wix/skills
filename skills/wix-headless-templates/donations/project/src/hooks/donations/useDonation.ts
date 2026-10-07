// React binding of the donation store (wix/donations/donation-store.ts) — the donate form's state
// and actions for one campaign. All correctness (defaults, validation, the fee, the checkout line,
// the hosted redirect) lives in the data layer; you own how it looks. One store per campaign
// surface; a new campaign id gets a fresh store.
import { useMemo, useSyncExternalStore } from "react";
import { createDonationStore, type DonationState, type DonationStore, type DonationStoreOptions } from "../../wix/donations/donation-store";
import type { CampaignDetail } from "../../wix/donations/types";

export type UseDonationOptions = DonationStoreOptions;

export type UseDonation = DonationState & Omit<DonationStore, "getState" | "subscribe">;

export function useDonation(campaign: CampaignDetail, options: UseDonationOptions = {}): UseDonation {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const store = useMemo(() => createDonationStore(campaign, options), [campaign.id]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return {
    ...state,
    selectPreset: store.selectPreset,
    selectCustom: store.selectCustom,
    setCustomAmount: store.setCustomAmount,
    setFrequency: store.setFrequency,
    setCoverFee: store.setCoverFee,
    setNote: store.setNote,
    donate: store.donate,
  };
}
