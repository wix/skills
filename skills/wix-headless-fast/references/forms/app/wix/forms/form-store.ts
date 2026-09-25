// One form as a framework-free store — the logic behind useWixForm, usable from React (useWixForm
// wraps it with useSyncExternalStore), from a static page or Vue/Svelte (subscribe and render), or
// as the specification for a port. Schema in, validated submission out, minus the markup: load the
// form, hold the visitor's values, validate them against the schema's own rules in our wording,
// upload attachments, create the submission, and map a rejection back onto the controls.
//
// It imports the data layer by names the REST twin exports identically (getForm, uploadFiles,
// createSubmission, submissionErrors, toSubmissionValues), so the same file runs over the SDK in
// Astro/React and over REST on a static page.
//
// SSR-friendly: pass a server-fetched FormDto as `initialForm` and no client fetch happens;
// `start()` then does nothing. Without it `start()` loads the schema. One store per mounted form:
// createFormStore(), not a singleton — a page can hold two forms.
import { getForm } from "./forms";
import {
  createSubmission,
  normalizePhone,
  submissionErrors,
  toSubmissionValues,
  uploadFiles,
} from "./submissions";
import type { FormDto, FormErrors, FormFieldDto, FormValues } from "./types";

/**
 * The key in `errors` for a message that belongs to the FORM rather than one field — a schema
 * that failed to load, or a rejection with no per-field violations. `@` cannot appear in a
 * form `target`, so this never collides with a field's own error.
 */
export const FORM_ERROR = "@form";

/** The empty form: every field at a value of the shape its control binds to. */
export function defaultValues(fields: FormFieldDto[]): FormValues {
  const values: FormValues = {};
  for (const f of fields) values[f.target] = Array.isArray(f.defaultValue) ? [...f.defaultValue] : f.defaultValue;
  return values;
}

/**
 * Check one field's value against its own schema. A plain function — usable outside the store,
 * and the place to look when a message needs rewording.
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

  if (field.required && !v) return `${field.label} is required.`;
  if (!v) return ""; // optional and empty → fine

  if (field.control === "number" || field.control === "rating") {
    // The control hands back a string, so parse before comparing: "9" > 10 is false but
    // "9" > "10" is true.
    const n = Number(v);
    if (!Number.isFinite(n)) return `${field.label} must be a number.`;
    if (rules.minimum != null && n < rules.minimum) return `${field.label} must be ${rules.minimum} or more.`;
    if (rules.maximum != null && n > rules.maximum) return `${field.label} must be ${rules.maximum} or less.`;
    return "";
  }

  if (rules.minLength && v.length < rules.minLength)
    return `${field.label} must be at least ${rules.minLength} characters.`;
  if (rules.maxLength && v.length > rules.maxLength)
    return `${field.label} must be at most ${rules.maxLength} characters.`;
  if (rules.format === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
    return "Please enter a valid email address.";
  if (rules.format === "URL" && !/^https?:\/\/.+/.test(v)) return "Please enter a valid URL.";
  // PHONE is E.164 server-side: leading +, country code, digits. Strip formatting first —
  // visitors add spaces, dashes and parens, and rejecting those is a UX bug, not validation.
  if (rules.format === "PHONE" && !/^\+[1-9]\d{6,14}$/.test(normalizePhone(v)))
    return "Use international format, starting with + and the country code.";
  if (rules.pattern && !new RegExp(rules.pattern).test(v))
    return `${field.label} is not in the expected format.`;
  return "";
}

/**
 * One field's error entries, keyed the way the controls are named. A plain field yields at most
 * one (`target`); an ADDRESS yields one per failing subfield (`target/sub`).
 *
 * An address subfield gets the `required` check only — `country` and `subdivision` are
 * country-dependent enums the schema does not enumerate, so their content is the server's call.
 */
export function errorsForField(field: FormFieldDto, values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (field.control === "address") {
    const parts = (values[field.target] ?? {}) as Record<string, unknown>;
    for (const { sub, label, required } of field.addressParts) {
      if (required && !String(parts[sub] ?? "").trim()) errors[`${field.target}/${sub}`] = `${label} is required.`;
    }
    return errors;
  }

  if (field.control === "file" || field.control === "signature") {
    // Files are File objects, which no string rule can judge — check the count instead.
    const picked = ([] as unknown[]).concat(values[field.target] ?? []).filter(Boolean);
    const limit = field.validation.fileLimit;
    if (field.required && !picked.length) errors[field.target] = `${field.label} is required.`;
    else if (limit && picked.length > limit)
      errors[field.target] = `Attach at most ${limit} file${limit === 1 ? "" : "s"}.`;
    return errors;
  }

  if (field.inputType === "ARRAY") {
    const picked = (Array.isArray(values[field.target]) ? (values[field.target] as unknown[]) : []).filter(Boolean);
    const { minItems, maxItems } = field.validation;
    if (field.required && !picked.length) errors[field.target] = `${field.label} is required.`;
    else if (minItems && picked.length < minItems) errors[field.target] = `Choose at least ${minItems}.`;
    else if (maxItems && picked.length > maxItems) errors[field.target] = `Choose at most ${maxItems}.`;
    return errors;
  }

  if (field.control === "checkbox") {
    if (field.required && values[field.target] !== true) errors[field.target] = `${field.label} is required.`;
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
  /** null while the schema is loading — render a skeleton, not an empty form. */
  form: FormDto | null;
  /** `target` → current value. Arrays for multi-choice and files, objects for an address. */
  values: FormValues;
  /** `target` (or `target/sub`) → a visitor-facing message; errors[FORM_ERROR] is form-level. */
  errors: FormErrors;
  /** Loading the schema, or submitting. */
  loading: boolean;
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
  /** One field's value — what a control's change handler calls. */
  setValue(target: string, value: unknown): void;
  /** One field, one address subfield (`target/sub`), or the whole form when called with nothing. */
  validate(target?: string): boolean;
  /**
   * The `onSubmit` handler. Client validation in our wording first (focus lands on the first
   * invalid control), then uploads, then the create. Resolves TRUE when the submission was
   * created — that IS the success signal; the values are back at the schema's defaults.
   */
  submit(event?: FormSubmitEvent): Promise<boolean>;
}

export function createFormStore({ formId, initialForm }: FormStoreOptions): FormStore {
  let form: FormDto | null = initialForm ?? null;
  // The empty form to reset to after a successful submit — the schema's own defaults.
  let empty: FormValues = defaultValues(form?.fields ?? []);
  let values: FormValues = empty;
  let errors: FormErrors = {};
  let loading = !initialForm;
  let started = false;
  let generation = 0;
  const listeners = new Set<() => void>();
  let snapshot: FormState | null = null;
  const emit = () => { snapshot = null; for (const fn of listeners) fn(); };
  const fields = (): FormFieldDto[] => form?.fields ?? [];

  function getState(): FormState {
    if (snapshot) return snapshot;
    snapshot = { form, values, errors, loading };
    return snapshot;
  }

  function adopt(loaded: FormDto): void {
    form = loaded;
    // Seed the controls once the schema is in: every control is controlled from the first
    // render, so each target holds a value of the right shape before any of them mount.
    empty = defaultValues(loaded.fields);
    values = empty;
    errors = {};
    loading = false;
    emit();
  }

  function setErrors(next: FormErrors): void { errors = next; emit(); }

  return {
    getState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start() {
      if (started) return;
      started = true;
      if (form) return; // the SSR pass already answered this
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
    stop() { started = false; generation++; },
    setValues(next) {
      values = typeof next === "function" ? next(values) : next;
      emit();
    },
    setValue(target, value) {
      values = { ...values, [target]: value };
      emit();
    },
    validate(target) {
      if (!target) {
        const all = errorsForForm(fields(), values);
        setErrors(all);
        return Object.keys(all).length === 0;
      }
      const key = String(target);
      const field = fields().find((f) => f.target === key.split("/")[0]);
      if (!field) return true;

      // The keys this call owns, so a re-check CLEARS what it fixed as well as flagging what it
      // did not: one key for a plain field, or every subfield when an address itself is named.
      const owned = key.includes("/")
        ? [key]
        : field.control === "address"
          ? field.addressParts.map(({ sub }) => `${field.target}/${sub}`)
          : [field.target];

      const found = errorsForField(field, values);
      const next = { ...errors };
      for (const k of owned) {
        delete next[k];
        if (found[k]) next[k] = found[k];
      }
      setErrors(next);
      return owned.every((k) => !found[k]);
    },
    async submit(event) {
      event?.preventDefault?.();
      // Capture the <form> NOW: React clears currentTarget once the handler returns, so reading
      // it after the await below (to focus a server-rejected control) comes back null.
      const formEl = (event?.currentTarget ?? null) as HTMLFormElement | null;
      if (!form) return false;
      const current = form;
      const currentFields = current.fields;

      // Client pass first, so the visitor gets inline feedback in OUR wording before a round trip.
      const clientErrors = errorsForForm(currentFields, values);
      if (Object.keys(clientErrors).length) {
        setErrors(clientErrors);
        focusControl(formEl, Object.keys(clientErrors)[0]);
        return false;
      }

      loading = true;
      emit();
      try {
        // Attachments go up FIRST — a File is not something the submission API takes, and its
        // value is the upload URL this hands back. No file fields → nothing happens here.
        const uploaded = await uploadFiles(current.id, currentFields, values);
        values = uploaded; // keep the URLs, so a rejection on another field never re-uploads
        emit();
        await createSubmission(current.id, toSubmissionValues(currentFields, uploaded));
        errors = {};
        values = empty; // back to the schema's defaults, ready for another
        return true;
      } catch (e) {
        const mapped = submissionErrors(e, currentFields);
        if (Object.keys(mapped).length) {
          errors = mapped;
          focusControl(formEl, Object.keys(mapped)[0]);
        } else {
          errors = { [FORM_ERROR]: e instanceof Error ? e.message : "Could not send the form. Please try again." };
        }
        return false;
      } finally {
        loading = false;
        emit();
      }
    },
  };
}
