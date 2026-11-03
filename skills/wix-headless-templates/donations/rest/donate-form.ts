// DOM renderer for the donate form of one campaign, driven by donation-store. Builds the controls
// from `campaign.options`, updates them from store state, and forwards input to the store.
// Amounts, validation, the cart and the checkout redirect live in the store.
//
// Controls, each present only when the campaign has the setting:
// - frequency picker when `options.frequencies.length > 1`
// - one choice per `options.presets` entry, with its impact text
// - "Other amount" and a text input when `options.customAmount.enabled`
// - cover-fee checkbox when `options.askCoverFee`
// - note with a counter when `options.commentsEnabled`
// - the submit button labelled with `state.buttonLabel`; "Redirecting…" while submitting
// When `campaign.acceptsDonations` is false, renders `closedMessage` (or nothing) instead.
// The DOM is built once; state changes update attributes and text, so focus is kept while typing.
//
// No styles. Class names use one prefix (default "donate"): donate-form, donate-fieldset,
// donate-legend, donate-choices, donate-choice, donate-choice--selected, donate-radio,
// donate-choice-label, donate-choice-impact, donate-custom, donate-custom-label,
// donate-custom-field, donate-currency, donate-input, donate-help, donate-error, donate-fee,
// donate-fee-label, donate-checkbox, donate-note, donate-note-label, donate-optional,
// donate-textarea, donate-counter, donate-actions, donate-submit, donate-secure, donate-closed.
// The <form> carries `data-state`: "open" | "closed" | "submitting".
//
// To style: `donate-choice--selected` (also `aria-pressed="true"`) is the chosen preset or
// frequency; the radio inside each choice is `donate-radio`, which can be visually hidden when the
// label carries the look. An input with an error has `aria-invalid="true"`, with the text in
// `donate-error` under it; both are hidden until they apply. `donate-submit` is the one primary
// button; the presets and frequencies are chips. `donate-submit[disabled]` with `aria-busy="true"`
// is the button while submitting. `donate-secure` is the line under the button.
import { fetchCampaign, fetchDefaultCampaign } from "./campaigns.js";
import { createDonationStore, type DonationState, type DonationStore, type DonationStoreOptions } from "../app/wix/donations/donation-store.js";
import type { DonationField } from "../app/wix/donations/donations-core.js";
import type { CampaignDetail } from "../app/wix/donations/types.js";

/** Hides or shows an element. Sets `display` as well as `hidden`, because an author `display` rule overrides the attribute. */
const hide = (node: HTMLElement, on: boolean): void => { node.hidden = on; node.style.display = on ? "none" : ""; };


/** UI strings. `{fee}`, `{min}` and `{max}` are placeholders. */
export interface DonateFormText {
  howOften: string;
  amount: string;
  otherAmount: string;
  enterAmount: string;
  orMore: string;
  minimum: string;
  maximum: string;
  coverFee: string;
  coverFeeDefault: string;
  everyPayment: string;
  note: string;
  optional: string;
  redirecting: string;
  secure: string;
}

const TEXT: DonateFormText = {
  howOften: "How often",
  amount: "Amount",
  otherAmount: "Other amount",
  enterAmount: "Enter an amount",
  orMore: "{min} or more",
  minimum: "Minimum {min}",
  maximum: "Maximum {max}",
  coverFee: "Add {fee} to cover the processing fees",
  coverFeeDefault: "Cover the processing fees (2.9%)",
  everyPayment: " — on every payment",
  note: "Leave a note",
  optional: "(optional)",
  redirecting: "Redirecting…",
  secure: "Secure payment on the next step.",
};

export interface DonateFormOptions extends DonationStoreOptions {
  /** The first part of every class name (default "donate"). */
  classPrefix?: string;
  /** Shown instead of the form when the campaign isn't accepting donations; nothing when omitted. */
  closedMessage?: string;
  text?: Partial<DonateFormText>;
}

export interface DonateForm {
  /** The store behind the form, for a page that shows more of its state (the total, the fee). */
  store: DonationStore;
  /** Stop listening and empty the container. */
  destroy(): void;
}

let instances = 0;

/**
 * Renders the donate form for `campaign` into `root`, replacing its content. `paths` sets where
 * the hosted checkout returns to. Example:
 * `renderDonateForm(el, campaign, { paths: { thankYou: "/thank-you.html", campaign: location.pathname } })`
 */
export function renderDonateForm(root: HTMLElement, campaign: CampaignDetail, options: DonateFormOptions = {}): DonateForm {
  const { classPrefix = "donate", closedMessage, text: words, ...storeOptions } = options;
  const t: DonateFormText = { ...TEXT, ...words };
  const c = (name: string): string => `${classPrefix}-${name}`;
  const o = campaign.options;
  const store = createDonationStore(campaign, storeOptions);
  const fid = `${classPrefix}-${campaign.id}-${++instances}`;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string> = {}, textContent?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if ("hidden" in attrs) node.style.display = "none";
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  };
  const message = (id: string): HTMLParagraphElement => el("p", c("error"), { id, role: "alert", hidden: "" });

  root.replaceChildren();
  const form = el("form", c("form"), { novalidate: "", "data-campaign-id": campaign.id, "data-state": campaign.acceptsDonations ? "open" : "closed" });
  root.append(form);

  if (!campaign.acceptsDonations) {
    if (closedMessage) form.append(el("p", c("closed"), {}, closedMessage));
    return { store, destroy: () => root.replaceChildren() };
  }

  // A choice (frequency, preset, "Other amount") is a label wrapping a radio input.
  interface Choice { label: HTMLLabelElement; input: HTMLInputElement; selected: (s: DonationState) => boolean }
  const choices: Choice[] = [];
  const choice = (name: string, value: string, selected: Choice["selected"], onPick: () => void, title: string, impact = ""): HTMLLabelElement => {
    const label = el("label", c("choice"));
    const input = el("input", c("radio"), { type: "radio", name, value });
    input.addEventListener("change", onPick);
    label.append(input, el("span", c("choice-label"), {}, title));
    if (impact) label.append(el("span", c("choice-impact"), {}, impact));
    choices.push({ label, input, selected });
    return label;
  };
  const fieldsets: HTMLFieldSetElement[] = [];
  const errors: Partial<Record<DonationField, HTMLParagraphElement>> = {};
  const describe = (inputs: HTMLElement[], id: string): void => { for (const i of inputs) i.setAttribute("aria-describedby", id); };

  if (o.frequencies.length > 1) {
    const fs = el("fieldset", c("fieldset"), { "data-field": "frequency" });
    fs.append(el("legend", c("legend"), {}, t.howOften));
    const row = el("div", c("choices"));
    for (const f of o.frequencies) row.append(choice(`${fid}-frequency`, f.value, (s) => s.frequency === f.value, () => store.setFrequency(f.value), f.label));
    const err = message(`${fid}-frequency-error`);
    errors.frequency = err;
    fs.append(row, err);
    fieldsets.push(fs);
    form.append(fs);
  }

  let customBox: HTMLDivElement | null = null;
  let customInput: HTMLInputElement | null = null;
  let customHelp: HTMLParagraphElement | null = null;
  if (o.presets.length > 0 || o.customAmount.enabled) {
    const fs = el("fieldset", c("fieldset"), { "data-field": "amount" });
    fs.append(el("legend", c("legend"), {}, t.amount));
    const row = el("div", c("choices"));
    for (const p of o.presets) {
      row.append(choice(`${fid}-amount-choice`, String(p.amount), (s) => !s.customMode && s.presetAmount === p.amount, () => store.selectPreset(p.amount), p.label, p.impact));
    }
    if (o.customAmount.enabled && o.presets.length > 0) {
      row.append(choice(`${fid}-amount-choice`, "custom", (s) => s.customMode, () => store.selectCustom(), t.otherAmount));
    }
    const err = message(`${fid}-amount-error`);
    errors.amount = err;
    fs.append(row, err);
    if (o.customAmount.enabled) {
      customBox = el("div", c("custom"), { hidden: "" });
      const label = el("label", c("custom-label"), { for: `${fid}-amount` }, o.currency ? `${t.amount} (${o.currency})` : t.amount);
      const field = el("div", c("custom-field"));
      if (o.currency) field.append(el("span", c("currency"), {}, o.currency));
      customInput = el("input", c("input"), {
        id: `${fid}-amount`,
        inputmode: "decimal",
        autocomplete: "off",
        placeholder: o.customAmount.minLabel ? t.orMore.replace("{min}", o.customAmount.minLabel) : t.enterAmount,
        "aria-describedby": `${fid}-custom-help`,
      });
      customInput.addEventListener("input", () => store.setCustomAmount(customInput!.value));
      field.append(customInput);
      const limits = [o.customAmount.minLabel && t.minimum.replace("{min}", o.customAmount.minLabel), o.customAmount.maxLabel && t.maximum.replace("{max}", o.customAmount.maxLabel)].filter(Boolean).join(" · ");
      customHelp = el("p", c("help"), { id: `${fid}-custom-help` }, limits);
      if (!limits) hide(customHelp, true);
      const cerr = message(`${fid}-custom-error`);
      errors.customAmount = cerr;
      customBox.append(label, field, customHelp, cerr);
      fs.append(customBox);
    }
    fieldsets.push(fs);
    form.append(fs);
  }

  let feeBox: HTMLInputElement | null = null;
  let feeText: HTMLSpanElement | null = null;
  if (o.askCoverFee) {
    const label = el("label", c("fee"), { "data-field": "coverFee" });
    feeBox = el("input", c("checkbox"), { type: "checkbox" });
    feeBox.addEventListener("change", () => store.setCoverFee(feeBox!.checked));
    feeText = el("span", c("fee-label"));
    label.append(feeBox, feeText);
    form.append(label);
  }

  let noteArea: HTMLTextAreaElement | null = null;
  let counter: HTMLParagraphElement | null = null;
  if (o.commentsEnabled) {
    const box = el("div", c("note"), { "data-field": "note" });
    const label = el("label", c("note-label"), { for: `${fid}-note` }, `${t.note} `);
    label.append(el("span", c("optional"), {}, t.optional));
    noteArea = el("textarea", c("textarea"), { id: `${fid}-note`, rows: "3", maxlength: String(o.commentMaxLength), "aria-describedby": `${fid}-note-hint` });
    noteArea.addEventListener("input", () => store.setNote(noteArea!.value));
    counter = el("p", c("counter"), { id: `${fid}-note-hint` });
    const err = message(`${fid}-note-error`);
    errors.note = err;
    box.append(label, noteArea, counter, err);
    form.append(box);
  }

  const actions = el("div", c("actions"));
  const submit = el("button", c("submit"), { type: "submit" });
  const failure = el("p", c("error"), { role: "alert", hidden: "" });
  actions.append(submit, failure, el("p", c("secure"), {}, t.secure));
  form.append(actions);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void store
      .donate()
      .then(() => {
        if (!store.getState().valid) {
          // Let the store's validation state render first; do not steal focus while typing.
          requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
        }
      })
      .catch((error: { stage?: string; status?: number; body?: { code?: string; details?: { applicationError?: { code?: string } } }; details?: { applicationError?: { code?: string } } }) => {
        // The store shows a recoverable message; keep safe diagnostics, not donor data or tokens.
        console.error("Donation checkout failed", {
          stage: error?.stage ?? "checkout",
          status: error?.status,
          code: error?.body?.details?.applicationError?.code ?? error?.details?.applicationError?.code ?? error?.body?.code,
        });
      });
  });

  const update = (): void => {
    const s = store.getState();
    const show = (field: DonationField): string | null => (s.showErrors && s.messages[field]) || null;
    form.dataset.state = s.submitting ? "submitting" : "open";
    for (const fs of fieldsets) fs.disabled = s.submitting;
    for (const ch of choices) {
      const on = ch.selected(s);
      ch.input.checked = on;
      ch.label.classList.toggle(c("choice--selected"), on);
      ch.label.setAttribute("aria-pressed", String(on));
    }
    for (const [field, node] of Object.entries(errors) as [DonationField, HTMLParagraphElement][]) {
      const msg = show(field);
      node.textContent = msg ?? "";
      hide(node, !msg);
      const inputs = field === "frequency" ? choices.filter((ch) => ch.input.name === `${fid}-frequency`).map((ch) => ch.input)
        : field === "amount" ? choices.filter((ch) => ch.input.name === `${fid}-amount-choice`).map((ch) => ch.input)
        : field === "customAmount" && customInput ? [customInput]
        : field === "note" && noteArea ? [noteArea] : [];
      for (const i of inputs) i.setAttribute("aria-invalid", String(!!msg));
      if (msg && field !== "customAmount") describe(inputs, node.id);
    }
    if (customBox) {
      hide(customBox, !s.customMode);
      if (customInput && customInput.value !== s.customAmount && document.activeElement !== customInput) customInput.value = s.customAmount;
      if (customHelp) hide(customHelp, !!show("customAmount") || !customHelp.textContent);
    }
    if (feeBox && feeText) {
      feeBox.checked = s.coverFee;
      feeBox.disabled = s.submitting;
      feeText.textContent = (s.feeLabel ? t.coverFee.replace("{fee}", s.feeLabel) : t.coverFeeDefault) + (s.frequency && s.frequency !== "ONE_TIME" ? t.everyPayment : "");
    }
    if (noteArea && counter) {
      if (noteArea.value !== s.note && document.activeElement !== noteArea) noteArea.value = s.note;
      noteArea.disabled = s.submitting;
      counter.textContent = `${s.note.length}/${o.commentMaxLength}`;
    }
    submit.textContent = s.submitting ? t.redirecting : s.buttonLabel;
    submit.disabled = s.submitting;
    submit.setAttribute("aria-busy", String(s.submitting));
    failure.textContent = s.error ?? "";
    hide(failure, !s.error);
  };
  const unsubscribe = store.subscribe(update);
  update();

  return {
    store,
    destroy() {
      unsubscribe();
      root.replaceChildren();
    },
  };
}

/**
 * Fetches the campaign (by id, or the site's default campaign when `campaignId` is omitted) and
 * renders its form into `root`. Resolves to null, with `root` emptied, when the campaign does not
 * exist or is archived.
 */
export async function mountDonateForm(root: HTMLElement, campaignId?: string, options: DonateFormOptions = {}): Promise<DonateForm | null> {
  const campaign = campaignId ? await fetchCampaign(campaignId) : await fetchDefaultCampaign();
  if (!campaign) {
    root.replaceChildren();
    return null;
  }
  return renderDonateForm(root, campaign, options);
}
