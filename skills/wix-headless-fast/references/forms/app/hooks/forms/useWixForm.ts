// One form as state — schema in, validated submission out, minus the markup. This vertical
// ships no components: a form is schema-driven (the owner picks the fields), so every form has
// a different field set and no "contact form" component could ship for it. You render
// `form.fields`; see references/forms/INSTRUCTIONS.md.
//
// SSR-friendly: pass a server-fetched FormDto as `initialForm` (Astro frontmatter) and no
// client fetch happens; a SPA passes nothing and the hook loads it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getForm } from "../../wix/forms/forms";
import {
  createSubmission,
  normalizePhone,
  submissionErrors,
  toSubmissionValues,
  uploadFiles,
} from "../../wix/forms/submissions";
import type { FormDto, FormErrors, FormFieldDto, FormValues } from "../../wix/forms/types";

/**
 * The key in `errors` for a message that belongs to the FORM rather than one field — a schema
 * that failed to load, or a rejection with no per-field violations. `@` cannot appear in a
 * form `target`, so this never collides with a field's own error.
 */
export const FORM_ERROR = "@form";

/** The empty form: every field at a value of the shape its control binds to. */
function defaultValues(fields: FormFieldDto[]): FormValues {
  const values: FormValues = {};
  for (const f of fields) values[f.target] = Array.isArray(f.defaultValue) ? [...f.defaultValue] : f.defaultValue;
  return values;
}

/**
 * Check one field's value against its own schema. Exported because it is a plain function —
 * usable outside React, and the place to look when a message needs rewording.
 *
 * Every rule comes from the schema, never from a field's NAME. (The classic mistake is keying
 * the email check on `target === "email"`; deriving it from `format` means an owner-added
 * PHONE/URL/length rule is honored with no code change.)
 *
 * ⚠️ A client check LAXER than the server's is worse than none — the visitor then learns about
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
function errorsForField(field: FormFieldDto, values: FormValues): FormErrors {
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

function errorsForForm(fields: FormFieldDto[], values: FormValues): FormErrors {
  const errors: FormErrors = {};
  for (const field of fields) Object.assign(errors, errorsForField(field, values));
  return errors;
}

/**
 * Move focus to a control by input name. ⚠️ `namedItem` returns a RadioNodeList for a radio or
 * checkbox group and an element for everything else — a guard checking only for an element
 * silently skips every choice group.
 */
function focusControl(formEl: HTMLFormElement | null, name: string): void {
  const control = formEl?.elements?.namedItem?.(name) as unknown;
  const node =
    typeof RadioNodeList !== "undefined" && control instanceof RadioNodeList
      ? (control[0] as HTMLElement | undefined)
      : (control as HTMLElement | undefined);
  node?.focus?.();
}

export interface UseWixFormOptions {
  /** Server-fetched form (Astro frontmatter) — skips the client fetch entirely. */
  initialForm?: FormDto;
}

export interface UseWixForm {
  /** null while the schema is loading — render a skeleton, not an empty form. */
  form: FormDto | null;
  /** `target` → current value. Arrays for multi-choice and files, objects for an address. */
  values: FormValues;
  setValues: (next: FormValues | ((prev: FormValues) => FormValues)) => void;
  /** Props for a text-ish control, ready to spread: `<input {...bind("email_a1")} />`. */
  bind: (target: string) => {
    name: string;
    value: string;
    onChange: (e: { target: { value: string } }) => void;
    onBlur: () => void;
    "aria-describedby": string;
    "aria-invalid": true | undefined;
  };
  /** `onSubmit`. Resolves TRUE when the submission was created — that IS the success signal. */
  submit: (event?: { preventDefault?: () => void; currentTarget?: unknown }) => Promise<boolean>;
  /** One field, one address subfield, or the whole form when called with nothing. */
  validate: (target?: string) => boolean;
  errors: FormErrors;
  /** Loading the schema, or submitting. */
  loading: boolean;
}

export function useWixForm(formId: string, options: UseWixFormOptions = {}): UseWixForm {
  const { initialForm } = options;
  const [form, setForm] = useState<FormDto | null>(initialForm ?? null);
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(!initialForm);
  // The empty form to reset to after a successful submit — the schema's own defaults.
  const emptyRef = useRef<FormValues>({});

  const fields = useMemo(() => form?.fields ?? [], [form]);

  useEffect(() => {
    if (initialForm) return; // the SSR pass already answered this
    let alive = true;
    if (!formId) {
      setLoading(false);
      setErrors({ [FORM_ERROR]: "No formId — pass one from the seed's forms map." });
      return;
    }
    setLoading(true);
    getForm(formId)
      .then((loaded) => {
        if (!alive) return;
        setForm(loaded);
        setErrors({});
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // Fail loudly. A form that cannot load is a setup problem — never fall back to a
        // hand-built form, which would drop real enquiries silently.
        setErrors({ [FORM_ERROR]: e instanceof Error ? e.message : "Could not load the form." });
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId]);

  // Seed the controls once the schema is in: every control is controlled from the first render,
  // so each target must hold a value of the right shape before any of them mount.
  useEffect(() => {
    const empty = defaultValues(fields);
    emptyRef.current = empty;
    setValues(empty);
  }, [fields]);

  const validate = useCallback(
    (target?: string) => {
      if (!target) {
        const all = errorsForForm(fields, values);
        setErrors(all);
        return Object.keys(all).length === 0;
      }
      const key = String(target);
      const field = fields.find((f) => f.target === key.split("/")[0]);
      if (!field) return true;

      // The keys this call owns, so a re-check CLEARS what it fixed as well as flagging what it
      // did not: one key for a plain field, or every subfield when an address itself is named.
      const owned = key.includes("/")
        ? [key]
        : field.control === "address"
          ? field.addressParts.map(({ sub }) => `${field.target}/${sub}`)
          : [field.target];

      const found = errorsForField(field, values);
      setErrors((prev) => {
        const next = { ...prev };
        for (const k of owned) {
          delete next[k];
          if (found[k]) next[k] = found[k];
        }
        return next;
      });
      return owned.every((k) => !found[k]);
    },
    [fields, values],
  );

  // Covers input / textarea / select. A checkbox or radio group carries `checked` instead of
  // `value`, and a file input cannot be controlled at all — wire those by hand, keeping the
  // same `name`, `onBlur` and aria contract.
  const bind = useCallback(
    (target: string) => ({
      name: target,
      value: String(values[target] ?? ""),
      onChange: (e: { target: { value: string } }) =>
        setValues((prev) => ({ ...prev, [target]: e.target.value })),
      onBlur: () => validate(target),
      "aria-describedby": `err-${target}`,
      "aria-invalid": errors[target] ? (true as const) : undefined,
    }),
    [values, errors, validate],
  );

  const submit = useCallback(
    async (event?: { preventDefault?: () => void; currentTarget?: unknown }) => {
      event?.preventDefault?.();
      // Capture the <form> NOW: React clears currentTarget once the handler returns, so reading
      // it after the await below (to focus a server-rejected control) comes back null.
      const formEl = (event?.currentTarget ?? null) as HTMLFormElement | null;
      if (!form) return false;

      // Client pass first, so the visitor gets inline feedback in OUR wording before a round trip.
      const clientErrors = errorsForForm(fields, values);
      if (Object.keys(clientErrors).length) {
        setErrors(clientErrors);
        // FOCUS the first invalid control — scrollIntoView moves the viewport and nothing else,
        // leaving a keyboard or screen-reader user where they were.
        focusControl(formEl, Object.keys(clientErrors)[0]);
        return false;
      }

      setLoading(true);
      try {
        // Attachments go up FIRST — a File is not something the submission API takes, and its
        // value is the upload URL this hands back. No file fields → nothing happens here.
        const uploaded = await uploadFiles(form.id, fields, values);
        setValues(uploaded); // keep the URLs, so a rejection on another field never re-uploads
        await createSubmission(form.id, toSubmissionValues(fields, uploaded));
        setErrors({});
        setValues(emptyRef.current); // back to the schema's defaults, ready for another
        return true;
      } catch (e) {
        const mapped = submissionErrors(e, fields);
        if (Object.keys(mapped).length) {
          setErrors(mapped);
          focusControl(formEl, Object.keys(mapped)[0]);
        } else {
          setErrors({
            [FORM_ERROR]: e instanceof Error ? e.message : "Could not send the form. Please try again.",
          });
        }
        return false;
      } finally {
        setLoading(false);
      }
    },
    [fields, form, values],
  );

  return { form, values, setValues, bind, submit, validate, errors, loading };
}
