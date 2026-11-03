// DOM renderer for a Wix form, driven by form-store. Builds one control per field in
// `form.fields` (see the control table in INSTRUCTIONS.md), updates it from store state, and
// forwards input to the store. State, validation, rules, uploads and the submission live in the
// store; this file does not implement any of them.
//
// Rendering rules:
// - required indicator per `form.requiredIndicator` and `requiredIndicatorBefore`
// - `showLabel: false` → no visible label, `aria-label` on the control
// - help text and the error line are linked through `aria-describedby`; errors show only after
//   the store sets them (blur or submit)
// - multi-step forms show one step at a time with back / next / submit per the owner's wording
// - a closed form shows `disabledMessage`
// - a successful submit replaces the form with the thank-you text (`\n` = paragraph), or
//   navigates to `outcome.url` (checkout or redirect)
// - address parts are rebuilt when the country changes; a field a rule hides is removed; other
//   fields are updated in place so focus is kept while typing
//
// No styles. Class names use one prefix (default "form"): form, form-loading, form-closed,
// form-step, form-step-title, form-step-count, form-fields, form-field, form-field--<control>,
// form-label, form-required, form-control, form-choices, form-choice, form-choice--selected,
// form-choice-label, form-choice-image, form-other-input, form-address, form-address-part,
// form-help, form-error, form-file-note, form-unsupported, form-actions, form-back, form-next,
// form-submit, form-form-error, form-success, form-success-text. The <form> carries
// `data-state`: "loading" | "open" | "submitting" | "closed" | "done".
import {
  FORM_ERROR,
  createFormStore,
  otherText,
  otherValue,
  type FormState,
  type FormStore,
  type FormSubmitEvent,
} from "../app/wix/forms/form-store.js";
import type { FormAddressPart, FormDto, FormFieldDto, SubmitOutcome } from "../app/wix/forms/types.js";

/** Hides or shows an element. Sets `display` as well as `hidden`, because an author `display` rule overrides the attribute. */
const hide = (node: HTMLElement, on: boolean): void => { node.hidden = on; node.style.display = on ? "none" : ""; };


/** UI strings. `{n}` and `{total}` are placeholders. */
export interface FormRendererText {
  loading: string;
  closed: string;
  submit: string;
  next: string;
  back: string;
  sending: string;
  required: string;
  choose: string;
  otherPlaceholder: string;
  filesChosen: string;
  fileChosen: string;
  unsupported: string;
  thanks: string;
  redirecting: string;
  stepOf: string;
}

const TEXT: FormRendererText = {
  loading: "Loading the form…",
  closed: "This form is no longer accepting responses.",
  submit: "Send",
  next: "Continue",
  back: "Back",
  sending: "Sending…",
  required: "Required",
  choose: "Choose…",
  otherPlaceholder: "Please specify",
  filesChosen: "{n} files chosen",
  fileChosen: "1 file chosen",
  unsupported: "This field cannot be filled in on this page.",
  thanks: "Thank you. Your response was sent.",
  redirecting: "Redirecting…",
  stepOf: "Step {n} of {total}",
};

export interface FormRendererOptions {
  /** The form to load (the seed's `formId`). Not needed when `initialForm` is given. */
  formId?: string;
  /** A form already fetched (server-rendered pages); skips the client fetch. */
  initialForm?: FormDto;
  /** The first part of every class name (default "form"). */
  classPrefix?: string;
  text?: Partial<FormRendererText>;
  /**
   * Called once per successful submit, after the renderer has shown the thank-you or started the
   * navigation to `outcome.url`. For a page that wants to do more (scroll, analytics, its own copy).
   */
  onOutcome?: (outcome: SubmitOutcome) => void;
}

export interface FormRenderer {
  /** The store behind the form, for a page that reads more of its state. */
  store: FormStore;
  /** Stop listening, stop the store and empty the container. */
  destroy(): void;
}

const OTHER = "__other__";
let instances = 0;

const isTextish = (c: FormFieldDto["control"]): boolean =>
  c === "text" || c === "email" || c === "url" || c === "phone" || c === "password" || c === "number" || c === "date" || c === "time" || c === "datetime";

const inputType = (f: FormFieldDto): string => {
  switch (f.control) {
    case "email": return "email";
    case "url": return "url";
    case "phone": return "tel";
    case "password": return "password";
    case "number": return "number";
    case "date": return "date";
    case "time": return "time";
    case "datetime": return "datetime-local";
    default: return "text";
  }
};

/** Trims an ISO bound to the format the input type accepts. */
const localBound = (value: string | undefined, control: string): string | undefined => {
  if (!value) return undefined;
  if (control === "datetime") return value.slice(0, 16);
  if (control === "date") return value.slice(0, 10);
  return value;
};

/** The field settings the DOM is built from. A change rebuilds the field; otherwise it is updated in place. */
const shapeOf = (f: FormFieldDto): string =>
  JSON.stringify([
    f.control, f.label, f.showLabel, f.required, f.readOnly, f.placeholder, f.description, f.identifier,
    f.choices.map((c) => [c.value, c.label, c.imageUrl]),
    f.otherOption?.label, f.otherOption?.placeholder,
    f.addressParts.map((p) => [p.sub, p.label, p.required, (p.choices ?? []).map((c) => c.value)]),
    f.validation, f.buttonText, f.explanationText,
  ]);

interface FieldNode {
  shape: string;
  wrapper: HTMLElement;
  update(field: FormFieldDto, state: FormState): void;
}

/**
 * Renders the form into `root`, replacing its content. Loads the schema by `formId` unless
 * `initialForm` is given. Example: `renderForm(document.getElementById("contact"), { formId })`.
 */
export function renderForm(root: HTMLElement, options: FormRendererOptions): FormRenderer {
  const { classPrefix = "form", text: words, formId = "", initialForm, onOutcome } = options;
  const t: FormRendererText = { ...TEXT, ...words };
  const c = (name: string): string => (name ? `${classPrefix}-${name}` : classPrefix);
  const fid = `${classPrefix}-${++instances}`;
  const store = createFormStore({ formId, initialForm });

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string | undefined> = {}, textContent?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) node.setAttribute(k, v);
    if ("hidden" in attrs && attrs.hidden !== undefined) node.style.display = "none";
    if (textContent !== undefined) node.textContent = textContent;
    return node;
  };
  const errorId = (key: string): string => `${fid}-err-${key.replace("/", "--")}`;
  const helpId = (target: string): string => `${fid}-help-${target}`;

  root.replaceChildren();
  const form = el("form", c(""), { novalidate: "", "data-state": "loading" });
  root.append(form);

  // Fixed parts of the form, filled on each update.
  const notice = el("div", c("loading"), {}, t.loading);
  const stepHead = el("div", c("step"), { hidden: "" });
  const stepTitle = el("h3", c("step-title"));
  const stepCount = el("p", c("step-count"));
  stepHead.append(stepTitle, stepCount);
  const fieldsBox = el("fieldset", c("fields"), { hidden: "" });
  const formError = el("p", c("form-error"), { role: "alert", hidden: "" });
  const actions = el("div", c("actions"), { hidden: "" });
  const back = el("button", c("back"), { type: "button" }, t.back);
  const next = el("button", c("next"), { type: "button" }, t.next);
  const submit = el("button", c("submit"), { type: "submit" }, t.submit);
  actions.append(back, next, submit);
  const success = el("div", c("success"), { role: "status", hidden: "" });
  form.append(notice, stepHead, fieldsBox, formError, actions, success);

  const submitEvent = (): FormSubmitEvent => ({ preventDefault() {}, currentTarget: form });
  back.addEventListener("click", () => store.previous());
  next.addEventListener("click", () => { store.next(submitEvent()); });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void store.submit({ preventDefault() {}, currentTarget: form });
  });

  const nodes = new Map<string, FieldNode>();
  let shownOutcome: SubmitOutcome | null = null;

  // ---- one field -------------------------------------------------------------------------

  /** The owner's required mark, as `form.requiredIndicator` says. */
  const requiredMark = (dto: FormDto): HTMLElement | null => {
    if (dto.requiredIndicator === "TEXT") return el("span", c("required"), {}, t.required);
    if (dto.requiredIndicator === "NONE") return null;
    return el("span", c("required"), { "aria-hidden": "true" }, "*");
  };

  const labelFor = (f: FormFieldDto, dto: FormDto, forId: string | undefined, tag: "label" | "legend" | "span" = "label"): HTMLElement | null => {
    if (!f.showLabel) return null;
    const label = el(tag, c("label"), forId && tag === "label" ? { for: forId } : {});
    const mark = f.required && !f.readOnly ? requiredMark(dto) : null;
    if (mark && dto.requiredIndicatorBefore) label.append(mark, " ");
    label.append(f.label);
    if (mark && !dto.requiredIndicatorBefore) label.append(" ", mark);
    return label;
  };

  const describedBy = (f: FormFieldDto, key: string): string =>
    [f.description ? helpId(f.target) : "", errorId(key)].filter(Boolean).join(" ");

  const commonAttrs = (f: FormFieldDto, key: string): Record<string, string | undefined> => ({
    name: key,
    "aria-describedby": describedBy(f, key),
    "aria-label": f.showLabel ? undefined : f.label,
  });

  /** Sets a text-like control's value from the store unless the visitor is typing in it. */
  const syncValue = (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: unknown): void => {
    const v = value === undefined || value === null ? "" : String(value);
    if (input.value !== v && document.activeElement !== input) input.value = v;
  };

  const errorLine = (key: string): HTMLParagraphElement => el("p", c("error"), { id: errorId(key), role: "alert", hidden: "" });

  const setError = (line: HTMLElement, controls: Element[], message: string | undefined): void => {
    line.textContent = message ?? "";
    hide(line, !message);
    for (const x of controls) x.setAttribute("aria-invalid", message ? "true" : "false");
  };

  function buildField(f: FormFieldDto, dto: FormDto, state: FormState): FieldNode {
    const wrapper = el("div", `${c("field")} ${c(`field--${f.control}`)}`, { "data-target": f.target });
    const controls: Element[] = [];
    let update: (field: FormFieldDto, s: FormState) => void = () => {};
    const help = f.description ? el("p", c("help"), { id: helpId(f.target) }, f.description) : null;
    const error = errorLine(f.target);
    const id = `${fid}-${f.target}`;

    if (isTextish(f.control)) {
      const input = el("input", c("control"), {
        ...commonAttrs(f, f.target), id, type: inputType(f), placeholder: f.placeholder,
        min: f.control === "number" ? (f.validation.minimum != null ? String(f.validation.minimum) : undefined) : localBound(f.validation.minDate, f.control),
        max: f.control === "number" ? (f.validation.maximum != null ? String(f.validation.maximum) : undefined) : localBound(f.validation.maxDate, f.control),
        step: f.control === "number" && f.validation.multipleOf ? String(f.validation.multipleOf) : undefined,
        minlength: f.validation.minLength != null ? String(f.validation.minLength) : undefined,
        maxlength: f.validation.maxLength != null ? String(f.validation.maxLength) : undefined,
        inputmode: f.control === "phone" ? "tel" : f.control === "number" ? "decimal" : undefined,
        autocomplete: f.control === "email" ? "email" : f.control === "phone" ? "tel" : f.control === "url" ? "url" : undefined,
      });
      input.addEventListener("input", () => store.setValue(f.target, input.value));
      input.addEventListener("blur", () => store.validate(f.target));
      controls.push(input);
      const label = labelFor(f, dto, id);
      if (label) wrapper.append(label);
      wrapper.append(input);
      update = (field, s) => { syncValue(input, s.values[field.target]); input.disabled = field.readOnly; };
    } else if (f.control === "textarea") {
      const area = el("textarea", c("control"), { ...commonAttrs(f, f.target), id, placeholder: f.placeholder, rows: "4",
        minlength: f.validation.minLength != null ? String(f.validation.minLength) : undefined,
        maxlength: f.validation.maxLength != null ? String(f.validation.maxLength) : undefined });
      area.addEventListener("input", () => store.setValue(f.target, area.value));
      area.addEventListener("blur", () => store.validate(f.target));
      controls.push(area);
      const label = labelFor(f, dto, id);
      if (label) wrapper.append(label);
      wrapper.append(area);
      update = (field, s) => { syncValue(area, s.values[field.target]); area.disabled = field.readOnly; };
    } else if (f.control === "rating") {
      // Rating: a radio group with values 1 to 5.
      const group = el("div", c("choices"), { role: "radiogroup" });
      const radios: HTMLInputElement[] = [];
      for (let n = 1; n <= 5; n++) {
        const choice = el("label", c("choice"));
        const radio = el("input", c("radio"), { ...commonAttrs(f, f.target), type: "radio", value: String(n), id: `${id}-${n}` });
        radio.addEventListener("change", () => { store.setValue(f.target, String(n)); store.validate(f.target); });
        choice.append(radio, el("span", c("choice-label"), {}, String(n)));
        group.append(choice);
        radios.push(radio);
        controls.push(radio);
      }
      const label = labelFor(f, dto, undefined, "span");
      if (label) wrapper.append(label);
      wrapper.append(group);
      update = (field, s) => {
        const v = String(s.values[field.target] ?? "");
        for (const r of radios) { r.checked = r.value === v; r.disabled = field.readOnly; r.parentElement?.classList.toggle(c("choice--selected"), r.checked); }
      };
    } else if (f.control === "select") {
      const select = el("select", c("control"), { ...commonAttrs(f, f.target), id });
      select.append(el("option", "", { value: "" }, f.placeholder || t.choose));
      for (const ch of f.choices) select.append(el("option", "", { value: ch.value }, ch.label));
      if (f.otherOption) select.append(el("option", "", { value: OTHER }, f.otherOption.label));
      const other = f.otherOption ? el("input", `${c("control")} ${c("other-input")}`, { type: "text", placeholder: f.otherOption.placeholder || t.otherPlaceholder, "aria-label": f.otherOption.label, hidden: "" }) : null;
      select.addEventListener("change", () => {
        if (select.value === OTHER) { store.setValue(f.target, otherValue(f, other?.value ?? "")); other?.focus(); }
        else { store.setValue(f.target, select.value); store.validate(f.target); }
      });
      select.addEventListener("blur", () => { if (select.value !== OTHER) store.validate(f.target); });
      other?.addEventListener("input", () => store.setValue(f.target, otherValue(f, other.value)));
      other?.addEventListener("blur", () => store.validate(f.target));
      controls.push(select);
      const label = labelFor(f, dto, id);
      if (label) wrapper.append(label);
      wrapper.append(select);
      if (other) wrapper.append(other);
      update = (field, s) => {
        const v = s.values[field.target];
        const typed = otherText(field, v);
        if (typed !== null && other) { if (select.value !== OTHER) select.value = OTHER; hide(other, false); syncValue(other, typed); }
        else { syncValue(select, v); if (other) { hide(other, true); } }
        select.disabled = field.readOnly;
        if (other) other.disabled = field.readOnly;
      };
    } else if (f.control === "radio" || f.control === "checkboxGroup" || f.control === "tags") {
      const multi = f.control !== "radio";
      const group = el("div", c("choices"), { role: multi ? "group" : "radiogroup" });
      const inputs: { input: HTMLInputElement; choice: HTMLElement; value: string }[] = [];
      const addChoice = (value: string, labelText: string, imageUrl?: string): HTMLInputElement => {
        const choice = el("label", c("choice"));
        const input = el("input", c(multi ? "checkbox" : "radio"), { ...commonAttrs(f, f.target), type: multi ? "checkbox" : "radio", value, id: `${id}-${inputs.length}` });
        choice.append(input);
        if (imageUrl) choice.append(el("img", c("choice-image"), { src: imageUrl, alt: "" }));
        choice.append(el("span", c("choice-label"), {}, labelText));
        group.append(choice);
        inputs.push({ input, choice, value });
        controls.push(input);
        return input;
      };
      for (const ch of f.choices) {
        const input = addChoice(ch.value, ch.label, ch.imageUrl);
        input.addEventListener("change", () => {
          if (!multi) { store.setValue(f.target, ch.value); }
          else {
            const current = (Array.isArray(store.getState().values[f.target]) ? (store.getState().values[f.target] as unknown[]) : []).map(String);
            store.setValue(f.target, input.checked ? [...current.filter((x) => x !== ch.value), ch.value] : current.filter((x) => x !== ch.value));
          }
          store.validate(f.target);
        });
      }
      let otherInput: HTMLInputElement | null = null;
      let otherText$: HTMLInputElement | null = null;
      if (f.otherOption) {
        otherInput = addChoice(OTHER, f.otherOption.label);
        otherText$ = el("input", `${c("control")} ${c("other-input")}`, { type: "text", placeholder: f.otherOption.placeholder || t.otherPlaceholder, "aria-label": f.otherOption.label, hidden: "" });
        const writeOther = (): void => {
          const typed = otherValue(f, otherText$!.value);
          if (!multi) { store.setValue(f.target, typed); return; }
          const current = (Array.isArray(store.getState().values[f.target]) ? (store.getState().values[f.target] as unknown[]) : []).map(String);
          const kept = current.filter((x) => otherText(f, x) === null);
          store.setValue(f.target, otherInput!.checked ? [...kept, typed] : kept);
        };
        otherInput.addEventListener("change", () => { writeOther(); if (otherInput!.checked) otherText$!.focus(); else store.validate(f.target); });
        otherText$.addEventListener("input", writeOther);
        otherText$.addEventListener("blur", () => store.validate(f.target));
        group.append(otherText$);
      }
      const label = labelFor(f, dto, undefined, "span");
      if (label) wrapper.append(label);
      wrapper.append(group);
      update = (field, s) => {
        const raw = s.values[field.target];
        const chosen = (Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === "" ? [] : [raw]).map(String);
        const typed = chosen.map((x) => otherText(field, x)).find((x) => x !== null) ?? null;
        for (const { input, choice, value } of inputs) {
          input.checked = value === OTHER ? typed !== null : chosen.includes(value);
          input.disabled = field.readOnly;
          choice.classList.toggle(c("choice--selected"), input.checked);
        }
        if (otherText$) { hide(otherText$, typed === null); if (typed !== null) syncValue(otherText$, typed); otherText$.disabled = field.readOnly; }
      };
    } else if (f.control === "checkbox") {
      // Single checkbox: boolean value, the label is the statement.
      const choice = el("label", `${c("choice")} ${c("checkbox-single")}`);
      const input = el("input", c("checkbox"), { ...commonAttrs(f, f.target), type: "checkbox", id });
      input.addEventListener("change", () => { store.setValue(f.target, input.checked); store.validate(f.target); });
      controls.push(input);
      choice.append(input);
      const mark = f.required && !f.readOnly ? requiredMark(dto) : null;
      const textSpan = el("span", c("choice-label"));
      if (mark && dto.requiredIndicatorBefore) textSpan.append(mark, " ");
      textSpan.append(f.label);
      if (mark && !dto.requiredIndicatorBefore) textSpan.append(" ", mark);
      choice.append(textSpan);
      wrapper.append(choice);
      update = (field, s) => { input.checked = s.values[field.target] === true; input.disabled = field.readOnly; choice.classList.toggle(c("choice--selected"), input.checked); };
    } else if (f.control === "address") {
      const box = el("div", c("address"), { role: "group" });
      const parts: { part: FormAddressPart; control: HTMLInputElement | HTMLSelectElement; line: HTMLElement }[] = [];
      for (const part of f.addressParts) {
        const key = `${f.target}/${part.sub}`;
        const partBox = el("div", `${c("address-part")} ${c(`address-part--${part.sub}`)}`);
        const partId = `${id}-${part.sub}`;
        const partLabel = el("label", c("label"), { for: partId });
        const mark = part.required ? requiredMark(dto) : null;
        if (mark && dto.requiredIndicatorBefore) partLabel.append(mark, " ");
        partLabel.append(part.label);
        if (mark && !dto.requiredIndicatorBefore) partLabel.append(" ", mark);
        let control: HTMLInputElement | HTMLSelectElement;
        if (part.choices && part.choices.length) {
          const select = el("select", c("control"), { name: key, id: partId, "aria-describedby": errorId(key) });
          select.append(el("option", "", { value: "" }, t.choose));
          for (const ch of part.choices) select.append(el("option", "", { value: ch.value }, ch.label));
          control = select;
        } else {
          control = el("input", c("control"), { name: key, id: partId, type: "text", "aria-describedby": errorId(key), autocomplete: part.sub === "postalCode" ? "postal-code" : part.sub === "city" ? "address-level2" : undefined });
        }
        const write = (): void => {
          const current = (store.getState().values[f.target] ?? {}) as Record<string, string>;
          store.setValue(f.target, { ...current, [part.sub]: control.value });
        };
        control.addEventListener(control instanceof HTMLSelectElement ? "change" : "input", write);
        control.addEventListener("blur", () => store.validate(key));
        const line = errorLine(key);
        partBox.append(partLabel, control, line);
        box.append(partBox);
        parts.push({ part, control, line });
        controls.push(control);
      }
      const label = labelFor(f, dto, undefined, "span");
      if (label) wrapper.append(label);
      wrapper.append(box);
      update = (field, s) => {
        const value = (s.values[field.target] ?? {}) as Record<string, unknown>;
        for (const { part, control, line } of parts) {
          syncValue(control, value[part.sub]);
          control.disabled = field.readOnly;
          setError(line, [control], s.errors[`${field.target}/${part.sub}`]);
        }
      };
    } else if (f.control === "file" || f.control === "signature") {
      const input = el("input", c("control"), { ...commonAttrs(f, f.target), id, type: "file", accept: f.validation.accept || undefined, multiple: (f.validation.fileLimit ?? 1) > 1 ? "" : undefined });
      const note = el("p", c("file-note"), {}, f.explanationText ?? "");
      input.addEventListener("change", () => { store.setValue(f.target, Array.from(input.files ?? [])); store.validate(f.target); });
      controls.push(input);
      const label = labelFor(f, dto, id);
      if (label) { if (f.buttonText) label.append(` (${f.buttonText})`); wrapper.append(label); }
      wrapper.append(input, note);
      update = (field, s) => {
        const picked = ([] as unknown[]).concat(s.values[field.target] ?? []).filter(Boolean);
        if (!picked.length && input.files && input.files.length) input.value = "";
        note.textContent = picked.length ? (picked.length === 1 ? t.fileChosen : t.filesChosen.replace("{n}", String(picked.length))) : (field.explanationText ?? "");
        input.disabled = field.readOnly;
      };
    } else {
      // payment, appointment, unknown: not supported by this renderer.
      const label = labelFor(f, dto, undefined, "span");
      if (label) wrapper.append(label);
      wrapper.append(el("p", c("unsupported"), {}, t.unsupported));
    }

    if (help) wrapper.append(help);
    wrapper.append(error);
    const node: FieldNode = {
      shape: shapeOf(f),
      wrapper,
      update(field, s) {
        update(field, s);
        if (field.control !== "address") setError(error, controls, s.errors[field.target]);
        else { setError(error, [], undefined); }
      },
    };
    node.update(f, state);
    return node;
  }

  // ---- the whole form ----------------------------------------------------------------------

  function render(): void {
    const s = store.getState();
    const dto = s.form;

    if (s.outcome) {
      form.dataset.state = "done";
      hide(notice, true); hide(stepHead, true); hide(fieldsBox, true); hide(actions, true); hide(formError, true);
      if (shownOutcome !== s.outcome) {
        shownOutcome = s.outcome;
        success.replaceChildren();
        if (s.outcome.url) {
          success.append(el("p", c("success-text"), {}, t.redirecting));
          if (s.outcome.newTab) window.open(s.outcome.url, "_blank", "noopener");
          else window.location.assign(s.outcome.url);
        } else {
          for (const para of (s.outcome.message || t.thanks).split("\n")) if (para.trim()) success.append(el("p", c("success-text"), {}, para));
        }
        onOutcome?.(s.outcome);
      }
      hide(success, false);
      return;
    }
    hide(success, true);

    if (!dto) {
      form.dataset.state = "loading";
      const failed = s.errors[FORM_ERROR];
      notice.className = failed ? c("form-error") : c("loading");
      notice.textContent = failed ?? t.loading;
      hide(notice, false);
      hide(stepHead, true); hide(fieldsBox, true); hide(actions, true); hide(formError, true);
      return;
    }
    hide(notice, true);

    if (s.closed) {
      form.dataset.state = "closed";
      notice.className = c("closed");
      notice.textContent = dto.disabledMessage || t.closed;
      hide(notice, false);
      hide(stepHead, true); hide(fieldsBox, true); hide(actions, true); hide(formError, true);
      for (const n of nodes.values()) n.wrapper.remove();
      nodes.clear();
      return;
    }

    form.dataset.state = s.loading ? "submitting" : "open";
    const steps = dto.steps;
    const current = steps[s.step] ?? steps[0];
    const multi = steps.length > 1;
    hide(stepHead, !multi);
    if (multi) {
      stepTitle.textContent = current?.name ?? "";
      hide(stepTitle, !current?.name);
      stepCount.textContent = t.stepOf.replace("{n}", String(s.step + 1)).replace("{total}", String(steps.length));
    }
    const fields = current ? dto.fields.filter((f) => f.stepId === current.id) : dto.fields;

    // Reconcile the step's fields: remove, rebuild, update, then restore order.
    const wanted = new Set(fields.map((f) => f.target));
    for (const [target, n] of nodes) if (!wanted.has(target)) { n.wrapper.remove(); nodes.delete(target); }
    const ordered: HTMLElement[] = [];
    for (const f of fields) {
      let n = nodes.get(f.target);
      const shape = shapeOf(f);
      if (!n || n.shape !== shape) {
        const focusedName = (document.activeElement as HTMLInputElement | null)?.name;
        const fresh = buildField(f, dto, s);
        if (n) n.wrapper.replaceWith(fresh.wrapper); else fieldsBox.append(fresh.wrapper);
        n = fresh;
        nodes.set(f.target, n);
        if (focusedName && focusedName.split("/")[0] === f.target) {
          const again = fresh.wrapper.querySelector<HTMLElement>(`[name="${CSS.escape(focusedName)}"]`);
          again?.focus();
        }
      } else {
        n.update(f, s);
      }
      ordered.push(n.wrapper);
    }
    const children = Array.from(fieldsBox.children);
    if (children.some((child, i) => child !== ordered[i])) for (const w of ordered) fieldsBox.append(w);
    hide(fieldsBox, false);
    fieldsBox.disabled = s.loading;

    formError.textContent = s.errors[FORM_ERROR] ?? "";
    hide(formError, !s.errors[FORM_ERROR]);

    hide(actions, false);
    const last = s.step >= steps.length - 1;
    hide(back, !(multi && s.step > 0));
    back.textContent = dto.previousText || t.back;
    back.disabled = s.loading;
    hide(next, !multi || last);
    next.textContent = dto.nextText || t.next;
    next.disabled = s.loading;
    hide(submit, !last);
    submit.textContent = s.loading ? t.sending : (dto.submitText || t.submit);
    submit.disabled = s.loading;
    submit.setAttribute("aria-busy", String(s.loading));
  }

  const unsubscribe = store.subscribe(render);
  render();
  store.start();

  return {
    store,
    destroy() {
      unsubscribe();
      store.stop();
      root.replaceChildren();
    },
  };
}
