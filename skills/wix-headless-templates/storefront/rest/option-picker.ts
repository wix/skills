// DOM renderer for a product's purchase controls, driven by product-detail-store. Builds the
// controls from the product and updates them from store state; selection, variant resolution,
// stock, plans and the add to cart live in the store.
//
// Controls, each present only when the product has the setting:
// - one group per option: swatch buttons for a color option, text buttons otherwise; a choice
//   that is out of stock with the current picks, or has no variant, is disabled
// - one group per choice modifier; a textarea with a counter per free-text modifier
// - the plan list for a subscription product, plus "One-time purchase" when the merchant allows it
// - a quantity stepper (`showQuantity`) capped at `state.maxQuantity`
// - the add button: disabled until `state.canAdd`; label "Add to cart", "Pre-order" or "Adding…"
// - under it: "Only N left", the pre-order note, `state.blockedReason`, the notify-me form when
//   the item is sold out and the merchant collects requests, and `state.error`
// Price, name and gallery are not rendered here; the page reads them from the store.
//
// No styles except a swatch's background color. Class names use one prefix (default "picker"):
// picker, picker-group, picker-group--option, picker-group--modifier, picker-group--plans,
// picker-legend, picker-choices, picker-choice, picker-choice--selected, picker-choice--swatch,
// picker-textarea, picker-counter, picker-plan, picker-plan--selected, picker-plan-name,
// picker-plan-terms, picker-plan-price, picker-actions, picker-quantity, picker-quantity-button,
// picker-quantity-value, picker-add, picker-note, picker-reason, picker-error, picker-notify,
// picker-notify-input, picker-notify-button, picker-notify-result. The root carries
// `data-state`: "loading" | "not-found" | "open" | "adding".
import {
  ONE_TIME_PLAN,
  createProductDetailStore,
  type ProductDetailState,
  type ProductDetailStore,
  type ProductDetailStoreOptions,
} from "../app/wix/storefront/product-detail-store.js";
import type { ProductDetail } from "../app/wix/storefront/types.js";

/** Hides or shows an element. Sets `display` as well as `hidden`, because an author `display` rule overrides the attribute. */
const hide = (node: HTMLElement, on: boolean): void => { node.hidden = on; node.style.display = on ? "none" : ""; };


/** UI strings. `{n}` is a placeholder. */
export interface OptionPickerText {
  add: string;
  preorder: string;
  adding: string;
  onlyLeft: string;
  purchaseOption: string;
  oneTime: string;
  loading: string;
  notFound: string;
  decrease: string;
  increase: string;
  notifyTitle: string;
  notifyPlaceholder: string;
  notifyButton: string;
  notifySaving: string;
  notifyCreated: string;
  notifyExists: string;
}

const TEXT: OptionPickerText = {
  add: "Add to cart",
  preorder: "Pre-order",
  adding: "Adding…",
  onlyLeft: "Only {n} left in stock",
  purchaseOption: "Purchase option",
  oneTime: "One-time purchase",
  loading: "Loading options…",
  notFound: "This product isn't available anymore.",
  decrease: "Decrease quantity",
  increase: "Increase quantity",
  notifyTitle: "Notify me when it's back",
  notifyPlaceholder: "you@example.com",
  notifyButton: "Notify me",
  notifySaving: "Saving…",
  notifyCreated: "We'll email you when it's back in stock.",
  notifyExists: "You're already on the list for this item.",
};

export interface OptionPickerOptions {
  /** The first part of every class name (default "picker"). */
  classPrefix?: string;
  /** Render the quantity stepper (a product page does; a tile picker adds one). */
  showQuantity?: boolean;
  text?: Partial<OptionPickerText>;
  /** Called after a successful add. */
  onAdded?: () => void;
}

export interface OptionPicker {
  store: ProductDetailStore;
  /** Stop listening and empty the container. Does not stop the store. */
  destroy(): void;
}

let instances = 0;

/**
 * Renders the purchase controls for the store's product into `root`, replacing its content, and
 * keeps them in step with the store. The page creates and starts the store (`createProductDetailStore`),
 * so it can render the price and gallery from the same state.
 */
export function renderOptionPicker(root: HTMLElement, store: ProductDetailStore, options: OptionPickerOptions = {}): OptionPicker {
  const { classPrefix = "picker", showQuantity = false, text: words, onAdded } = options;
  const t: OptionPickerText = { ...TEXT, ...words };
  const c = (name: string): string => (name ? `${classPrefix}-${name}` : classPrefix);
  const id = `${classPrefix}-${++instances}`;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string | undefined> = {}, textContent?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
    if ("hidden" in attrs && attrs.hidden !== undefined) node.style.display = "none";
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  };

  root.replaceChildren();
  const box = el("div", c(""), { "data-state": "loading" });
  root.append(box);

  let builtFor: string | null = null; // product id the controls were built for
  let update: (s: ProductDetailState) => void = () => {};

  function build(product: ProductDetail, s: ProductDetailState): void {
    box.replaceChildren();
    const updates: ((s: ProductDetailState) => void)[] = [];

    // Option groups.
    for (const group of s.optionGroups) {
      const fs = el("fieldset", `${c("group")} ${c("group--option")}`, { "data-option": group.id });
      fs.append(el("legend", c("legend"), {}, group.name));
      const row = el("div", c("choices"));
      const buttons: { button: HTMLButtonElement; choiceId: string }[] = [];
      for (const choice of group.choices) {
        const button = el("button", group.isColor && choice.colorCode ? `${c("choice")} ${c("choice--swatch")}` : c("choice"), { type: "button", "aria-pressed": "false", title: choice.name });
        if (group.isColor && choice.colorCode) { button.setAttribute("aria-label", choice.name); button.style.backgroundColor = choice.colorCode; }
        else button.textContent = choice.name;
        button.addEventListener("click", () => store.selectOption(group.id, choice.choiceId));
        row.append(button);
        buttons.push({ button, choiceId: choice.choiceId });
      }
      fs.append(row);
      box.append(fs);
      updates.push((st) => {
        const g = st.optionGroups.find((x) => x.id === group.id);
        if (!g) return;
        for (const { button, choiceId } of buttons) {
          const ch = g.choices.find((x) => x.choiceId === choiceId);
          if (!ch) continue;
          const unavailable = !ch.inStock || !ch.exists;
          button.disabled = unavailable;
          button.setAttribute("aria-pressed", String(ch.selected));
          button.classList.toggle(c("choice--selected"), ch.selected);
          button.title = unavailable ? `${ch.name} (unavailable)` : ch.name;
        }
      });
    }

    // Choice modifiers.
    for (const m of product.modifiers.filter((x) => x.type === "choices")) {
      const fs = el("fieldset", `${c("group")} ${c("group--modifier")}`, { "data-modifier": m.key });
      fs.append(el("legend", c("legend"), {}, m.mandatory ? `${m.name} *` : m.name));
      const row = el("div", c("choices"));
      const buttons: { button: HTMLButtonElement; key: string }[] = [];
      for (const choice of m.choices) {
        const button = el("button", c("choice"), { type: "button", "aria-pressed": "false" }, choice.name);
        button.addEventListener("click", () => {
          const on = store.getState().modifierValues[m.key] === choice.key;
          store.setModifier(m.key, on && !m.mandatory ? "" : choice.key);
        });
        row.append(button);
        buttons.push({ button, key: choice.key });
      }
      fs.append(row);
      box.append(fs);
      updates.push((st) => {
        for (const { button, key } of buttons) {
          const on = st.modifierValues[m.key] === key;
          button.setAttribute("aria-pressed", String(on));
          button.classList.toggle(c("choice--selected"), on);
        }
      });
    }

    // Free-text modifiers.
    for (const m of product.modifiers.filter((x) => x.type === "text")) {
      const fs = el("fieldset", `${c("group")} ${c("group--text")}`, { "data-modifier": m.key });
      const legend = el("legend", c("legend"), {}, m.mandatory ? `${m.title} *` : m.title);
      const counter = m.maxChars ? el("span", c("counter")) : null;
      if (counter) legend.append(" ", counter);
      const area = el("textarea", c("textarea"), { rows: "2", maxlength: m.maxChars ? String(m.maxChars) : undefined, "aria-label": m.title });
      area.addEventListener("input", () => store.setModifier(m.key, area.value));
      fs.append(legend, area);
      box.append(fs);
      updates.push((st) => {
        const v = st.modifierValues[m.key] ?? "";
        if (area.value !== v && document.activeElement !== area) area.value = v;
        if (counter) counter.textContent = `${v.length}/${m.maxChars}`;
      });
    }

    // Plans.
    if (product.subscriptions.length > 0) {
      const fs = el("fieldset", `${c("group")} ${c("group--plans")}`);
      fs.append(el("legend", c("legend"), {}, t.purchaseOption));
      const rows: { label: HTMLLabelElement; radio: HTMLInputElement; planId: string; price: HTMLSpanElement }[] = [];
      const plan = (planId: string, name: string, terms: string): void => {
        const label = el("label", c("plan"));
        const radio = el("input", c("plan-radio"), { type: "radio", name: `${id}-plan`, value: planId });
        radio.addEventListener("change", () => store.selectPlan(planId));
        const text = el("span", c("plan-text"));
        text.append(el("span", c("plan-name"), {}, name));
        if (terms) text.append(el("span", c("plan-terms"), {}, terms));
        const price = el("span", c("plan-price"));
        label.append(radio, text, price);
        fs.append(label);
        rows.push({ label, radio, planId, price });
      };
      for (const p of product.subscriptions) plan(p.id, p.name, p.description ? `${p.terms} · ${p.description}` : p.terms);
      if (product.allowOneTimePurchase) plan(ONE_TIME_PLAN, t.oneTime, "");
      box.append(fs);
      updates.push((st) => {
        for (const r of rows) {
          const on = st.subscriptionPlanId === r.planId;
          r.radio.checked = on;
          r.label.classList.toggle(c("plan--selected"), on);
          r.price.textContent = r.planId === ONE_TIME_PLAN ? (st.variant ? st.variant.price : "") : (st.plans.find((p) => p.id === r.planId)?.price ?? "");
        }
      });
    }

    // Quantity and add.
    const actions = el("div", c("actions"));
    let minus: HTMLButtonElement | null = null;
    let plus: HTMLButtonElement | null = null;
    let value: HTMLSpanElement | null = null;
    if (showQuantity) {
      const q = el("div", c("quantity"));
      minus = el("button", c("quantity-button"), { type: "button", "aria-label": t.decrease }, "−");
      value = el("span", c("quantity-value"), { "aria-live": "polite" });
      plus = el("button", c("quantity-button"), { type: "button", "aria-label": t.increase }, "+");
      minus.addEventListener("click", () => store.setQuantity(store.getState().quantity - 1));
      plus.addEventListener("click", () => store.setQuantity(store.getState().quantity + 1));
      q.append(minus, value, plus);
      actions.append(q);
    }
    const add = el("button", c("add"), { type: "button" });
    add.addEventListener("click", () => { void store.add().then(() => onAdded?.()).catch(() => {}); });
    actions.append(add);
    box.append(actions);

    const note = el("p", c("note"), { hidden: "" });
    const reason = el("p", c("reason"), { hidden: "" });
    const error = el("p", c("error"), { role: "alert", hidden: "" });
    box.append(note, reason);

    // Notify me.
    const notify = el("form", c("notify"), { hidden: "", novalidate: "" });
    const notifyLabel = el("label", c("notify-label"), { for: `${id}-notify` }, t.notifyTitle);
    const notifyRow = el("div", c("notify-row"));
    const notifyInput = el("input", c("notify-input"), { id: `${id}-notify`, type: "email", placeholder: t.notifyPlaceholder, autocomplete: "email" });
    const notifyButton = el("button", c("notify-button"), { type: "submit" }, t.notifyButton);
    const notifyResult = el("p", c("notify-result"), { role: "status", hidden: "" });
    const notifyError = el("p", c("error"), { role: "alert", hidden: "" });
    notifyRow.append(notifyInput, notifyButton);
    notify.append(notifyLabel, notifyRow, notifyError);
    notify.addEventListener("submit", (e) => { e.preventDefault(); void store.notify(notifyInput.value).catch(() => {}); });
    box.append(notify, notifyResult, error);

    update = (st) => {
      for (const u of updates) u(st);
      box.dataset.state = st.adding ? "adding" : "open";
      if (minus && plus && value) {
        value.textContent = String(st.quantity);
        minus.disabled = st.quantity <= 1 || st.adding;
        plus.disabled = st.quantity >= st.maxQuantity || st.adding;
      }
      add.disabled = !st.canAdd || st.adding;
      add.setAttribute("aria-busy", String(st.adding));
      add.textContent = st.adding ? t.adding : st.isPreorder ? t.preorder : t.add;
      const showLeft = st.remaining !== null && st.remaining > 0 && st.remaining <= 10 && st.canAdd && !st.isPreorder;
      note.textContent = showLeft ? t.onlyLeft.replace("{n}", String(st.remaining)) : st.isPreorder && st.preorderMessage ? st.preorderMessage : "";
      hide(note, !note.textContent);
      reason.textContent = st.blockedReason && !st.canAdd ? st.blockedReason : "";
      hide(reason, !reason.textContent);
      error.textContent = st.error ?? "";
      hide(error, !st.error);
      hide(notify, !st.canNotify || st.notifyResult !== null);
      notifyButton.disabled = st.notifying;
      notifyButton.textContent = st.notifying ? t.notifySaving : t.notifyButton;
      notifyError.textContent = st.notifyError ?? "";
      hide(notifyError, !st.notifyError);
      notifyResult.textContent = st.notifyResult === "created" ? t.notifyCreated : st.notifyResult === "already-subscribed" ? t.notifyExists : "";
      hide(notifyResult, !notifyResult.textContent);
    };
    update(s);
  }

  function render(): void {
    const s = store.getState();
    if (!s.product) {
      builtFor = null;
      box.replaceChildren(el("p", c(s.notFound ? "not-found" : "loading"), {}, s.notFound ? t.notFound : t.loading));
      box.dataset.state = s.notFound ? "not-found" : "loading";
      return;
    }
    if (builtFor !== s.product.id) { builtFor = s.product.id; build(s.product, s); return; }
    update(s);
  }

  const unsubscribe = store.subscribe(render);
  render();
  return { store, destroy() { unsubscribe(); root.replaceChildren(); } };
}

export interface MountOptionPickerOptions extends OptionPickerOptions, ProductDetailStoreOptions {}

/**
 * Creates and starts a product detail store for `slug` or `initial`, renders the purchase controls
 * into `root`, and returns them with the store. `destroy()` also stops the store.
 */
export function mountOptionPicker(root: HTMLElement, options: MountOptionPickerOptions): OptionPicker {
  const { initial, slug, ...rest } = options;
  const store = createProductDetailStore({ initial, slug });
  const picker = renderOptionPicker(root, store, rest);
  store.start();
  return { store, destroy() { picker.destroy(); store.stop(); } };
}
