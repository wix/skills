// The donate form for one campaign as a framework-free store — the logic behind useDonation,
// usable from React (the hook wraps it), from a static page's campaign view, from Vue/Svelte, or as
// the specification for a port. Frequency, preset or custom amount, the fee, the note, validation
// with the widget's codes, the live button label, and donate() which navigates the FULL document
// to the Wix-hosted checkout. All correctness (the line item, the checkout, the redirect session)
// lives in the data layer; every rule (defaults, validation, fee, label) in donations-core.
//
// One store per campaign surface: createDonationStore(campaign), not a singleton. A static site
// passes `paths` so the hosted checkout returns to its files (`thank-you.html`).
import { donationCheckoutUrl, type DonatePaths } from "./donate";
import {
  defaultSelection,
  donateLabel,
  errorMessage,
  feeFor,
  formatAmount,
  selectedAmount,
  toInput,
  totalFor,
  validateDonation,
  type DonationField,
  type DonationSelection,
} from "./donations-core";
import type { CampaignDetail, DonationErrorCode, DonationFrequency } from "./types";

export interface DonationStoreOptions {
  /** The site's public https origin (default: window.location.origin). */
  origin?: string;
  /** Where the hosted checkout returns to; defaults are the Astro routes. */
  paths?: DonatePaths;
}

/** Everything a donate form renders from. Read it with getState() or through a subscription. */
export interface DonationState extends DonationSelection {
  /** The amount in play: the preset, or the parsed custom text (null when none / unparsable). */
  amount: number | null;
  /** The donor's 2.9% fee — only when the owner asks and the donor agreed; null otherwise. */
  fee: number | null;
  /** Formatted fee for the checkbox label ("$0.73"); "" when none or the currency is unknown. */
  feeLabel: string;
  /** amount + fee. */
  total: number | null;
  /** Formatted total; "" when no amount or the currency is unknown. */
  totalLabel: string;
  /** "Donate $25 Monthly" — the CTA's text. */
  buttonLabel: string;
  errors: Partial<Record<DonationField, DonationErrorCode>>;
  /** Visitor-facing text per field error. */
  messages: Partial<Record<DonationField, string>>;
  /** True after the first donate() attempt — show `messages` only then (the widget's hasSubmitted). */
  showErrors: boolean;
  valid: boolean;
  /** True while the checkout is being created and the browser is leaving; stays true on success. */
  submitting: boolean;
  /** The last checkout failure, visitor-facing; a new donate() clears it. */
  error: string | null;
  /** campaign.acceptsDonations — false renders the closed state, never the form. */
  available: boolean;
}

export interface DonationStore {
  getState(): DonationState;
  subscribe(listener: () => void): () => void;
  /** Pick a preset amount; leaves custom mode and clears the custom text. */
  selectPreset(amount: number): void;
  /** Activate "Other amount". */
  selectCustom(): void;
  setCustomAmount(text: string): void;
  setFrequency(frequency: DonationFrequency): void;
  setCoverFee(coverFee: boolean): void;
  setNote(note: string): void;
  /**
   * Validate, then start the hosted checkout — when it resolves the browser is already navigating
   * away (or validation failed and `messages` are showing). Rejects (and records `error`) when the
   * checkout couldn't start or the campaign isn't accepting donations — surface it.
   */
  donate(): Promise<void>;
}

export function createDonationStore(campaign: CampaignDetail, { origin, paths }: DonationStoreOptions = {}): DonationStore {
  const options = campaign.options;
  let sel: DonationSelection = defaultSelection(options);
  let showErrors = false;
  let submitting = false;
  let error: string | null = null;
  const listeners = new Set<() => void>();

  const derive = (): DonationState => {
    const amount = selectedAmount(sel);
    const fee = options.askCoverFee && sel.coverFee ? feeFor(amount) : null;
    const total = totalFor(amount, sel.coverFee, options.askCoverFee);
    const errors = validateDonation(options, sel);
    const messages: Partial<Record<DonationField, string>> = {};
    for (const [field, code] of Object.entries(errors) as [DonationField, DonationErrorCode][]) messages[field] = errorMessage(code, options);
    return {
      ...sel,
      amount,
      fee,
      feeLabel: formatAmount(fee, options.currency),
      total,
      totalLabel: formatAmount(total, options.currency),
      buttonLabel: donateLabel(total, sel.frequency, options.currency),
      errors,
      messages,
      showErrors,
      valid: Object.keys(errors).length === 0,
      submitting,
      error,
      available: campaign.acceptsDonations,
    };
  };

  let state = derive();
  const emit = (): void => {
    state = derive();
    for (const fn of listeners) fn();
  };
  const update = (patch: Partial<DonationSelection>): void => {
    if (submitting) return;
    sel = { ...sel, ...patch };
    emit();
  };

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    selectPreset: (amount) => update({ presetAmount: amount, customMode: false, customAmount: "" }),
    selectCustom: () => update({ customMode: true, presetAmount: null }),
    setCustomAmount: (text) => update({ customAmount: text }),
    setFrequency: (frequency) => update({ frequency }),
    setCoverFee: (coverFee) => update({ coverFee }),
    setNote: (note) => update({ note: note.slice(0, options.commentMaxLength) }),
    async donate() {
      if (submitting) return; // a second click while the checkout is being created is ignored
      showErrors = true;
      error = null;
      if (!campaign.acceptsDonations) {
        error = "This campaign isn't accepting donations right now.";
        emit();
        throw new Error(error);
      }
      const input = toInput(options, sel);
      if (!input) {
        emit();
        return;
      }
      submitting = true;
      emit();
      try {
        window.location.href = await donationCheckoutUrl(campaign.id, input, { origin, paths });
        // stays "submitting" — the browser is leaving for the hosted checkout
      } catch (e) {
        submitting = false;
        error = e instanceof Error ? e.message : String(e);
        emit();
        throw e;
      }
    },
  };
}
