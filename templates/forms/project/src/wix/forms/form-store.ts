// One form as a framework-free store — the logic behind useWixForm, usable from React (useWixForm
// wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and render), or
// as the specification for a port. Schema in, validated submission out, minus the markup: load the
// form, hold the visitor's values, apply the owner's rules on every change, validate against the
// schema's own rules in Wix's wording, move between steps, upload attachments, create the
// submission, hand a paid form to checkout, and map a rejection back onto the controls.
//
// It imports the data layer by names the REST twin exports identically (getForm, uploadFiles,
// createSubmission, checkoutUrl, submissionErrors, formLevelError, toSubmissionValues), so the same
// file runs over the SDK in Astro/React and over REST on a static page.
//
// SSR-friendly: pass a server-fetched FormDto as `initialForm` and no client fetch happens;
// `start()` then does nothing. Without it `start()` loads the schema. One store per mounted form:
// createFormStore(), not a singleton — a page can hold two forms.
import { applyRules, getForm, isClosed, otherText, otherValue } from "./forms";
import {
  EMAIL_PATTERN,
  PHONE_PATTERN,
  addressPartMessage,
  dateRangeMessage,
  itemsMessage,
  lengthMessage,
  multipleOfMessage,
  rangeMessage,
  requiredMessage,
  withSeconds,
} from "./submissions-core";
import {
  checkoutUrl,
  createSubmission,
  formLevelError,
  normalizePhone,
  normalizeUrl,
  submissionErrors,
  toSubmissionValues,
  uploadFiles,
} from "./submissions";
import type { FormDto, FormErrors, FormFieldDto, FormStep, FormValues, SubmitOutcome } from "./types";

export { otherText, otherValue };

/**
 * The key in `errors` for a message that belongs to the FORM rather than one field — a schema
 * that failed to load, a closed form, or a rejection with no per-field violations. `@` cannot
 * appear in a form `target`, so this never collides with a field's own error.
 */
export const FORM_ERROR = "@form";

/** The empty value of a field's SHAPE — what a control binds to before anyone typed. */
export function emptyValue(field: FormFieldDto): FormValues[string] {
  return field.control === "address" ? {} :
    field.inputType === "ARRAY" || field.inputType === "WIX_FILE" ? [] :
    field.inputType === "BOOLEAN" ? false : "";
}

/** The empty form: every field at its prefill, or the empty value of its shape. */
export function defaultValues(fields: FormFieldDto[]): FormValues {
  const values: FormValues = {};
  for (const f of fields) values[f.target] = Array.isArray(f.defaultValue) ? [...f.defaultValue] : f.defaultValue;
  return values;
}

const isBlank = (v: unknown): boolean => v === undefined || v === null || String(v).trim() === "";

/**
 * Check one field's value against its own schema. A plain function — usable outside the store,
 * and the place to look when a message needs rewording. Messages are Wix's own copy for the
 * common cases, so the inline check and a server rejection read alike.
 *
 * Every rule comes from the schema, never from a field's NAME. (The classic mistake is keying
 * the email check on `target === "email"`; deriving it from `format` means an owner-added
 * PHONE/URL/length rule is honored with no code change.)
 *
 * A client check LAXER than the server's is worse than none — the visitor then learns about
 * the problem only after a round trip, in the server's wording rather than yours.
 */
export function validateValue(field: FormFieldDto, value: unknown): string {
  const v = String(value ?? "").trim();
  const rules = field.validation;

  // A read-only field submits its prefill; Wix leaves it out of the required set.
  if (field.required && !field.readOnly && !v) return requiredMessage(field);
  if (!v) return ""; // optional and empty → fine

  if (field.control === "number" || field.control === "rating") {
    // The control hands back a string, so parse before comparing: "9" > 10 is false but
    // "9" > "10" is true.
    const n = Number(v);
    if (!Number.isFinite(n)) return "Enter a number.";
    // A rating is one of 1..5 (form-viewer isRating); 0 means empty.
    if (field.control === "rating" && !(Number.isInteger(n) && n >= 1 && n <= 5)) return "Choose a star rating.";
    if ((rules.minimum != null && n < rules.minimum) || (rules.maximum != null && n > rules.maximum)) return rangeMessage(rules.minimum, rules.maximum);
    if (rules.multipleOf && Math.abs(n / rules.multipleOf - Math.round(n / rules.multipleOf)) > 1e-9) return multipleOfMessage(rules.multipleOf);
    return "";
  }

  if (field.control === "date" || field.control === "time" || field.control === "datetime") {
    // Values in the field's own ISO spelling compare as strings once seconds are normalized.
    const x = withSeconds(v);
    if ((rules.minDate && x < withSeconds(rules.minDate)) || (rules.maxDate && x > withSeconds(rules.maxDate))) {
      return field.identifier === "CONTACTS_BIRTHDATE" ? "Enter a date from January 1, 1900 to today." : dateRangeMessage(rules.minDate, rules.maxDate);
    }
    return "";
  }

  if (field.control === "select" || field.control === "radio") {
    // After a rule narrowed the choices, a stale value is no longer allowed. A free-text
    // "Other" entry is anything outside the list.
    if (field.choices.length && !field.otherOption && !field.choices.some((c) => c.value === v)) return "The chosen value is not allowed.";
    return "";
  }

  if ((rules.minLength && v.length < rules.minLength) || (rules.maxLength && v.length > rules.maxLength))
    return lengthMessage(rules.minLength, rules.maxLength);
  if (rules.format === "EMAIL" && !EMAIL_PATTERN.test(v)) return "Enter an email address like example@mysite.com.";
  if (rules.format === "URL" && !/^https?:\/\/[^\s/?#]+[^\s]*$/i.test(normalizeUrl(v))) return "Enter a web URL like https://www.example.com.";
  // PHONE is E.164 server-side: leading +, country code, digits. Strip formatting first —
  // visitors add spaces, dashes and parens, and rejecting those is a UX bug, not validation.
  if (rules.format === "PHONE" && !PHONE_PATTERN.test(normalizePhone(v))) return "Enter a valid phone number.";
  if (rules.pattern) {
    try {
      if (!new RegExp(rules.pattern).test(v)) return rules.patternMessage ?? "Enter a valid answer.";
    } catch { /* an owner's pattern the engine cannot compile: the server decides */ }
  }
  return "";
}

/**
 * One field's error entries, keyed the way the controls are named. A plain field yields at most
 * one (`target`); an ADDRESS yields one per failing subfield (`target/sub`). A hidden field
 * yields none — Wix drops hidden fields from the required set and clears their values.
 *
 * An address subfield gets the `required` check only — `subdivision` is a country-dependent
 * enum the schema does not enumerate, so its content is the server's call.
 */
export function errorsForField(field: FormFieldDto, values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (field.hidden) return errors;
  const required = field.required && !field.readOnly;

  if (field.control === "address") {
    const parts = (values[field.target] ?? {}) as Record<string, unknown>;
    for (const { sub, required: subRequired } of field.addressParts) {
      if (subRequired && isBlank(parts[sub])) errors[`${field.target}/${sub}`] = addressPartMessage(sub);
    }
    return errors;
  }

  if (field.control === "file" || field.control === "signature") {
    // Files are File objects, which no string rule can judge — check the count instead. Wix
    // caps every upload field at 30 files.
    const picked = ([] as unknown[]).concat(values[field.target] ?? []).filter(Boolean);
    const limit = Math.min(field.validation.fileLimit ?? 30, 30);
    if (required && !picked.length) errors[field.target] = requiredMessage(field);
    else if (picked.length > limit) errors[field.target] = `There is an upload limit of ${limit} file${limit === 1 ? "" : "s"}.`;
    return errors;
  }

  if (field.inputType === "ARRAY") {
    const picked = (Array.isArray(values[field.target]) ? (values[field.target] as unknown[]) : []).filter((x) => !isBlank(x));
    const { minItems, maxItems } = field.validation;
    if (required && !picked.length) errors[field.target] = requiredMessage(field);
    else if ((minItems && picked.length < minItems) || (maxItems && picked.length > maxItems)) errors[field.target] = itemsMessage(minItems, maxItems);
    else if (field.choices.length && !field.otherOption && picked.some((x) => !field.choices.some((c) => c.value === x)))
      errors[field.target] = "The chosen value is not allowed.";
    return errors;
  }

  if (field.control === "checkbox") {
    // `required` on a boolean only checks presence server-side; "must be ticked" is the enum
    // [true] (`mustBeTrue`). Either way the visitor has to tick it before we send.
    if ((required || field.validation.mustBeTrue) && values[field.target] !== true) errors[field.target] = "Check the box to continue.";
    return errors;
  }

  const message = validateValue(field, values[field.target]);
  if (message) errors[field.target] = message;
  return errors;
}

export function errorsForForm(fields: FormFieldDto[], values: FormValues): FormErrors {
  const errors: FormErrors = {};
  for (const field of fields) Object.assign(errors, errorsForField(field, values));
  return errors;
}

/**
 * Move focus to a control by input name. `namedItem` returns a RadioNodeList for a radio or
 * checkbox group and an element for everything else — a guard checking only for an element
 * silently skips every choice group. FOCUS, not scrollIntoView: scrolling moves the viewport and
 * nothing else, leaving a keyboard or screen-reader user where they were.
 */
export function focusControl(formEl: HTMLFormElement | null, name: string): void {
  const control = formEl?.elements?.namedItem?.(name) as unknown;
  const node =
    typeof RadioNodeList !== "undefined" && control instanceof RadioNodeList
      ? (control[0] as HTMLElement | undefined)
      : (control as HTMLElement | undefined);
  node?.focus?.();
}

export interface FormStoreOptions {
  /** The form to load (the seed's `formId`). Ignored when `initialForm` is given. */
  formId: string;
  /** Server-fetched form (Astro frontmatter) — skips the client fetch entirely. */
  initialForm?: FormDto;
}

/** Everything a form surface renders from. Read it with getState() or through a subscription. */
export interface FormState {
  /**
   * null while the schema is loading — render a skeleton, not an empty form. Once loaded, the
   * owner's rules are already applied to the CURRENT values: `form.fields` holds only the fields
   * to render right now (hidden ones removed), each with its effective `required` and `choices`,
   * and `form.steps[].targets` lists the visible targets of each step.
   */
  form: FormDto | null;
  /** `target` → current value. Arrays for multi-choice and files, objects for an address. */
  values: FormValues;
  /** `target` (or `target/sub`) → a visitor-facing message; errors[FORM_ERROR] is form-level. */
  errors: FormErrors;
  /** Loading the schema, or submitting. */
  loading: boolean;
  /** Index into `form.steps` of the page being shown. 0 on a single-step form. */
  step: number;
  /** The form is not accepting submissions (switched off, or past its deadline): show `form.disabledMessage`. */
  closed: boolean;
  /** The last successful submit, until `reset()` (or the owner's auto-hide) clears it. null before. */
  outcome: SubmitOutcome | null;
}

/** A submit event as the store needs it — a React SyntheticEvent or a native Event both fit. */
export type FormSubmitEvent = { preventDefault?: () => void; currentTarget?: unknown };

export interface FormStore {
  getState(): FormState;
  subscribe(listener: () => void): () => void;
  /** Load the schema when no `initialForm` was given. Call once when mounted. */
  start(): void;
  /** Stop reacting; drop a late schema response. */
  stop(): void;
  setValues(next: FormValues | ((prev: FormValues) => FormValues)): void;
  /** One field's value — what a control's change handler calls. Rules re-run; a field a rule just hid is cleared. */
  setValue(target: string, value: unknown): void;
  /** One field, one address subfield (`target/sub`), or the whole form when called with nothing. A URL field is https-prefixed here when it reads like a bare domain. */
  validate(target?: string): boolean;
  /** Multi-step: validate the current step; on success show the next one. Returns whether it moved. */
  next(event?: FormSubmitEvent): boolean;
  /** Multi-step: show the previous step (nothing to validate). */
  previous(): void;
  goToStep(index: number): void;
  /** A captcha widget's token, sent with the next submit. The server asks for one with INVALID_CAPTCHA. */
  setCaptchaToken(token: string | null): void;
  /** Clear `outcome` (dismiss the thank-you and show the empty form again). */
  reset(): void;
  /**
   * The `onSubmit` handler. Client validation in Wix's wording first (focus lands on the first
   * invalid control, switching step if needed), then uploads, then the create, then the owner's
   * submit settings. Resolves the outcome when the submission was created — that IS the success
   * signal; the values are back at the schema's defaults. Resolves FALSE when it did not send.
   */
  submit(event?: FormSubmitEvent): Promise<SubmitOutcome | false>;
}

export function createFormStore({ formId, initialForm }: FormStoreOptions): FormStore {
  // `base` is the schema as loaded; `form` (in state) is `base` with the rules applied to `values`.
  let base: FormDto | null = initialForm ?? null;
  let applied: FormFieldDto[] = base ? applyRules(base, defaultValues(base.fields)) : [];
  // The empty form to reset to after a successful submit — the schema's own defaults.
  let empty: FormValues = defaultValues(base?.fields ?? []);
  let values: FormValues = empty;
  let errors: FormErrors = {};
  let loading = !initialForm;
  let step = 0;
  let outcome: SubmitOutcome | null = null;
  let captchaToken: string | null = null;
  let started = false;
  let generation = 0;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  let snapshot: FormState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };

  /** `base` narrowed to what is visible right now. */
  function visibleForm(): FormDto | null {
    if (!base) return null;
    const fields = applied.filter((f) => !f.hidden);
    const shown = new Set(fields.map((f) => f.target));
    const steps: FormStep[] = base.steps.map((s) => ({ ...s, targets: s.targets.filter((t) => shown.has(t)) }));
    return { ...base, fields, steps };
  }

  function getState(): FormState {
    if (snapshot) return snapshot;
    snapshot = { form: visibleForm(), values, errors, loading, step, closed: base ? isClosed(base) : false, outcome };
    return snapshot;
  }

  const visibleFields = (): FormFieldDto[] => applied.filter((f) => !f.hidden);
  const stepFields = (i: number): FormFieldDto[] => {
    const s = base?.steps[i];
    return s ? visibleFields().filter((f) => f.stepId === s.id) : visibleFields();
  };

  /**
   * Adopt new values: re-run the rules, and clear the value and errors of every field a rule
   * just hid, repeating until nothing else hides (clear-fields.ts does the same fixed point —
   * clearing one field can satisfy another rule's condition).
   */
  function adoptValues(next: FormValues): void {
    if (!base) { values = next; return; }
    let hiddenBefore = new Set(applied.filter((f) => f.hidden).map((f) => f.target));
    const cleared: string[] = [];
    for (let i = 0; i <= base.fields.length; i++) {
      applied = applyRules(base, next);
      const toClear = applied.filter((f) => f.hidden && !hiddenBefore.has(f.target));
      if (!toClear.length) break;
      next = { ...next };
      for (const f of toClear) { next[f.target] = emptyValue(f); cleared.push(f.target); }
      hiddenBefore = new Set(applied.filter((f) => f.hidden).map((f) => f.target));
    }
    values = next;
    if (cleared.length) {
      const kept: FormErrors = {};
      for (const [k, msg] of Object.entries(errors)) if (!cleared.includes(k.split("/")[0])) kept[k] = msg;
      errors = kept;
    }
  }

  function adopt(loaded: FormDto): void {
    base = loaded;
    // Seed the controls once the schema is in: every control is controlled from the first
    // render, so each target holds a value of the right shape before any of them mount.
    empty = defaultValues(loaded.fields);
    applied = applyRules(loaded, empty);
    values = empty;
    errors = {};
    step = 0;
    loading = false;
    emit();
  }

  function setErrors(next: FormErrors): void { errors = next; emit(); }

  /** Show the step that holds a control, then focus it. */
  function focusError(formEl: HTMLFormElement | null, key: string): void {
    const target = key.split("/")[0];
    const field = applied.find((f) => f.target === target);
    const at = base?.steps.findIndex((s) => s.id === field?.stepId) ?? -1;
    if (at >= 0 && at !== step) { step = at; emit(); }
    focusControl(formEl, key);
  }

  /** The keys a `validate(target)` call owns, so a re-check CLEARS what it fixed as well as flagging what it did not. */
  function ownedKeys(key: string, field: FormFieldDto): string[] {
    return key.includes("/") ? [key] : field.control === "address" ? field.addressParts.map(({ sub }) => `${field.target}/${sub}`) : [field.target];
  }

  function validateFields(fields: FormFieldDto[], formEl: HTMLFormElement | null): boolean {
    const found = errorsForForm(fields, values);
    const owned = new Set(fields.flatMap((f) => ownedKeys(f.target, f)));
    const next: FormErrors = {};
    for (const [k, msg] of Object.entries(errors)) if (!owned.has(k) && k !== FORM_ERROR) next[k] = msg;
    Object.assign(next, found);
    setErrors(next);
    const first = fields.flatMap((f) => ownedKeys(f.target, f)).find((k) => found[k]);
    if (first) focusError(formEl, first);
    return !first;
  }

  return {
    getState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      if (base) return; // the SSR pass already answered this
      if (!formId) {
        loading = false;
        errors = { [FORM_ERROR]: "No formId — pass one from the seed's forms map." };
        emit();
        return;
      }
      const id = ++generation;
      loading = true;
      emit();
      getForm(formId)
        .then((loaded) => { if (started && generation === id) adopt(loaded); })
        .catch((e: unknown) => {
          if (!started || generation !== id) return;
          // Fail loudly. A form that cannot load is a setup problem — never fall back to a
          // hand-built form, which would drop real enquiries silently.
          loading = false;
          errors = { [FORM_ERROR]: e instanceof Error ? e.message : "Could not load the form." };
          emit();
        });
    },
    stop() { started = false; generation++; if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } },
    setValues(next) {
      adoptValues(typeof next === "function" ? next(values) : next);
      emit();
    },
    setValue(target, value) {
      adoptValues({ ...values, [target]: value });
      emit();
    },
    validate(target) {
      if (!target) return validateFields(visibleFields(), null);
      const key = String(target);
      const field = visibleFields().find((f) => f.target === key.split("/")[0]);
      if (!field) return true;
      // Wix's URL field completes a bare domain on blur; do it before checking, so the visitor
      // sees the value that will be sent.
      if (field.control === "url" && typeof values[field.target] === "string") {
        const fixed = normalizeUrl(values[field.target]);
        if (fixed !== values[field.target]) { values = { ...values, [field.target]: fixed }; }
      }
      const owned = ownedKeys(key, field);
      const found = errorsForField(field, values);
      const next = { ...errors };
      for (const k of owned) {
        delete next[k];
        if (found[k]) next[k] = found[k];
      }
      setErrors(next);
      return owned.every((k) => !found[k]);
    },
    next(event) {
      event?.preventDefault?.();
      const formEl = (event?.currentTarget ?? null) as HTMLFormElement | null;
      if (!base || step >= base.steps.length - 1) return false;
      // Only the current step's fields (use-validation.ts validateStep): a later step's
      // required field must not block moving forward.
      if (!validateFields(stepFields(step), formEl)) return false;
      step += 1;
      emit();
      return true;
    },
    previous() {
      if (step > 0) { step -= 1; emit(); }
    },
    goToStep(index) {
      if (base && index >= 0 && index < base.steps.length && index !== step) { step = index; emit(); }
    },
    setCaptchaToken(token) { captchaToken = token; },
    reset() {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      outcome = null;
      step = 0;
      emit();
    },
    async submit(event) {
      event?.preventDefault?.();
      // Capture the <form> NOW: React clears currentTarget once the handler returns, so reading
      // it after the await below (to focus a server-rejected control) comes back null.
      const formEl = (event?.currentTarget ?? null) as HTMLFormElement | null;
      if (!base) return false;
      const current = base;
      if (isClosed(current)) {
        setErrors({ [FORM_ERROR]: current.disabledMessage || "This form is no longer accepting submissions." });
        return false;
      }
      const currentFields = visibleFields();

      // Client pass first, so the visitor gets inline feedback before a round trip.
      if (!validateFields(currentFields, formEl)) return false;

      loading = true;
      emit();
      try {
        // Attachments go up FIRST — a File is not something the submission API takes, and its
        // value is the file entry this hands back. No file fields → nothing happens here.
        const uploaded = await uploadFiles(current.id, currentFields, values);
        values = uploaded; // keep the uploaded entries, so a rejection on another field never re-uploads
        emit();
        const submission = await createSubmission(current.id, toSubmissionValues(currentFields, uploaded), captchaToken ? { captchaToken } : {});
        errors = {};
        captchaToken = null; // a token is single-use
        // What happens next is the owner's call (use-submit.ts): a paid form goes to checkout,
        // else the submit settings — thank-you text, a redirect, or nothing.
        if (submission.checkoutId) {
          outcome = { submission, action: "CHECKOUT" };
          try {
            outcome.url = await checkoutUrl(submission.checkoutId);
          } catch (e) {
            errors = { [FORM_ERROR]: e instanceof Error ? e.message : "Checkout could not start." };
          }
        } else {
          const s = current.success;
          outcome = {
            submission,
            action: s.action,
            ...(s.message ? { message: s.message } : {}),
            ...(s.durationSeconds ? { durationSeconds: s.durationSeconds } : {}),
            ...(s.redirectUrl ? { url: s.redirectUrl, newTab: s.newTab === true } : {}),
          };
          if (s.durationSeconds && typeof setTimeout !== "undefined") {
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => { hideTimer = null; outcome = null; emit(); }, s.durationSeconds * 1000);
          }
        }
        adoptValues(empty); // back to the schema's defaults, ready for another
        step = 0;
        return outcome;
      } catch (e) {
        const mapped = submissionErrors(e, currentFields);
        if (Object.keys(mapped).length) {
          errors = mapped;
          focusError(formEl, Object.keys(mapped)[0]);
        } else {
          errors = { [FORM_ERROR]: formLevelError(e, current) ?? (e instanceof Error ? e.message : "Could not send the form. Please try again.") };
        }
        return false;
      } finally {
        loading = false;
        emit();
      }
    },
  };
}
