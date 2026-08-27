// useWixForm — one form, minus the markup. It loads the LIVE schema, validates against it, submits,
// and lands the server's violations on the right controls. What it does NOT do is render: this
// vertical ships no UI, because a form is schema-driven (the owner picks the fields), so every form
// has a different field set and no "contact form" component could ship for it. You build the markup
// — see `references/forms/INSTRUCTIONS.md`, "Build the UI".
//
//   const { form, values, setValues, bind, submit, validate, errors, loading, read } =
//     useWixForm(WIX_FORMS.contact.formId);
//
// The fields to render are the RAW field objects Wix returned — no projection, nothing hidden. Take
// them off `form` with the same accessors the hook uses internally (`read` is the module
// `lib/wix-form-schema-utils.js`, handed back so the UI needs one import):
//
//   read.orderedInputs(form).map((field) => <label key={read.targetOf(field)}>{read.labelOf(field)}…</label>)
//
// The controls are CONTROLLED: `values` (keyed by each field's `target`) is the form's state, so
// validate and submit read it directly — there is no FormData pass and no ref to hand over.
//
// Reading the live schema rather than a hardcoded field list is what makes an owner's dashboard edit
// (add, relabel, reorder, require, constrain a field) show up on the site with no code change, and
// what keeps the submission map from desyncing.
//
// Not on React? `validateField` below and everything in `lib/wix-form-schema-utils.js` are plain
// functions — port the ~80 lines of state around them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getForm, phoneExample, normalizePhone } from "@/rest/wix-forms";
import {
  uploadFormFiles,
  toSubmissionValues,
  createSubmission,
  submissionViolations,
} from "@/rest/wix-forms-submissions";
import * as read from "@/lib/wix-form-schema-utils";
import {
  targetOf, labelOf, isRequired, isMulti, isFile, isNumber, isAddress,
  addressPartsOf, validationOf, phoneCountryOf, orderedInputs,
} from "@/lib/wix-form-schema-utils";

/**
 * The key in `errors` for a message that belongs to the FORM rather than one field — a schema that
 * failed to load, or a submit rejection with no per-field violations. `@` can't appear in a Wix
 * form `target`, so this can never collide with a field's own error.
 */
export const FORM_ERROR = "@form";

/**
 * The empty form: one entry per field, in the shape that field's control binds to — `[]` for a
 * multi-choice field, `{}` for an address, and the owner's `default` prefill (else `""`) for the
 * rest. Dropping `defaultValue` here would silently discard a dashboard setting.
 */
function defaultValues(fields) {
  const values = {};
  for (const field of fields) {
    values[targetOf(field)] =
      isAddress(field) ? {} :
      isMulti(field) || isFile(field) ? [] : // a file field holds File objects
      // The owner's prefill. Wix spells it `default` on most components and `defaultValue` on a
      // rating, so read both — picking one silently drops a dashboard setting on the other.
      read.componentOf(field).default ?? read.componentOf(field).defaultValue ?? "";
  }
  return values;
}

/**
 * Client-side validation for one field — the rules behind `validate(target)`. It lives here rather
 * than in `rest/` because nothing about it is a REST call: it's the UI's own read of the schema.
 * Derives EVERY check from that schema — never from the field's name. (The classic mistake is keying the email check on `target === "email"`; doing it
 * off `format` means an owner-added PHONE/URL/length rule is honored with no code change.)
 *
 * ⚠️ A client check LAXER than the server's is worse than none — the visitor then learns about the
 * problem only after a round trip, in the server's wording rather than yours. Keep these at least
 * as strict as the server, and submit the NORMALIZED value the check passed.
 *
 * @param {object} field  One raw field, from `fields`.
 * @param {unknown} value  The control's current value.
 * @returns {string}  A visitor-facing message, or "" when it passes.
 */
export function validateField(field, value) {
  const rules = validationOf(field);
  const label = labelOf(field);
  const v = String(value ?? "").trim();
  if (isRequired(field) && !v) return `${label} is required.`;
  if (!v) return ""; // optional + empty → ok
  if (rules.minLength && v.length < rules.minLength) return `${label} must be at least ${rules.minLength} characters.`;
  if (rules.maxLength && v.length > rules.maxLength) return `${label} must be at most ${rules.maxLength} characters.`;
  // A NUMBER field carries no `format`; its rules are the bounds, and the control hands back a
  // string, so parse before comparing — `"9" > 10` is false but `"9" > "10"` is true.
  if (isNumber(field)) {
    const n = Number(v);
    if (!Number.isFinite(n)) return `${label} must be a number.`;
    const min = minimumOf(field);
    const max = maximumOf(field);
    if (min != null && n < min) return `${label} must be ${min} or more.`;
    if (max != null && n > max) return `${label} must be ${max} or less.`;
    return "";
  }
  if (rules.format === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "Please enter a valid email address.";
  if (rules.format === "URL" && !/^https?:\/\/.+/.test(v)) return "Please enter a valid URL.";
  // PHONE is E.164 server-side: leading +, country code, digits only. Strip formatting first —
  // visitors add spaces, dashes and parens, and rejecting those is a UX bug, not validation.
  if (rules.format === "PHONE" && !/^\+[1-9]\d{6,14}$/.test(normalizePhone(v)))
    return `Use international format, e.g. ${phoneExample(phoneCountryOf(field))}.`;
  if (rules.pattern && !new RegExp(rules.pattern).test(v)) return `${label} is not in the expected format.`;
  return "";
}

/**
 * A NUMBER field's bounds. The validation block is JSON-Schema shaped everywhere else
 * (`minLength`, `maxLength`, `pattern`, `format`, `enum`), so the numeric pair is `minimum` /
 * `maximum`; `minValue` / `maxValue` are read too, since the public reference documents neither
 * spelling and an older schema may carry them. Undefined when the owner set no bound.
 */
const minimumOf = (field) => validationOf(field).minimum ?? validationOf(field).minValue;
const maximumOf = (field) => validationOf(field).maximum ?? validationOf(field).maxValue;

/** `postalCode` → "Postal code" — an address subfield is a key, not a label the schema carries. */
function humanizeSub(sub) {
  const words = sub.replace(/([A-Z])|(\d+)/g, " $1$2").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The error entries one field currently has, keyed by input NAME — the same keys the controls and
 * the server's error paths use. (Distinct from `validateField` above, which judges a single VALUE
 * against one field's rules and returns one message; this maps that onto the form's keys, and an
 * address has several.) A plain field yields at most one entry (`target`); an ADDRESS
 * yields one per failing subfield (`target/sub`).
 *
 * Every rule comes from the schema (`validateField` above): `required`,
 * `minLength`/`maxLength`, `pattern`, and `format` — EMAIL, PHONE (E.164), URL. Nothing is keyed off
 * a field's NAME, so an owner-added constraint is honored with no code change.
 *
 * An address subfield gets the `required` check only: `country` and `subdivision` are
 * country-dependent enums the schema doesn't enumerate, so their content is the server's call.
 */
function errorsForField(field, values) {
  const errors = {};
  const target = targetOf(field);

  if (isAddress(field)) {
    const parts = values[target] ?? {};
    for (const { sub, required } of addressPartsOf(field)) {
      // Only `required` is checkable here: country/subdivision are country-dependent enums the
      // schema doesn't enumerate, so their content is the server's call.
      if (required && !String(parts[sub] ?? "").trim())
        errors[`${target}/${sub}`] = `${humanizeSub(sub)} is required.`;
    }
    return errors;
  }

  // A file field holds File objects, which no string rule can judge — check the count instead.
  if (isFile(field)) {
    const limit = validationOf(field).fileLimit;
    const picked = [].concat(values[target] ?? []).filter(Boolean);
    if (isRequired(field) && !picked.length) errors[target] = `${labelOf(field)} is required.`;
    else if (limit && picked.length > limit)
      errors[target] = `Attach at most ${limit} file${limit === 1 ? "" : "s"}.`;
    return errors;
  }

  const message = validateField(field, values[target]);
  if (message) errors[target] = message;
  return errors;
}

/** Every field's error entries, merged into one `name → message` map. */
function errorsForForm(fields, values) {
  const errors = {};
  for (const field of fields) Object.assign(errors, errorsForField(field, values));
  return errors;
}

/** `format` → the copy for a FORMAT_ERROR, since "wrong shape" means something different per format. */
const FORMAT_COPY = {
  EMAIL: () => "Enter a valid email address.",
  PHONE: (f) => `Use international format, e.g. ${phoneExample(phoneCountryOf(f))}.`,
  URL: () => "Enter a full URL starting with https://",
  DATE: () => "Choose a valid date.",
};

/** errorType → visitor-facing copy, written from the field's own schema. */
const ERROR_COPY = {
  REQUIRED_VALUE_ERROR: (f) => `${labelOf(f)} is required.`,
  MIN_LENGTH_ERROR: (f) => `${labelOf(f)} must be at least ${validationOf(f).minLength} characters.`,
  MAX_LENGTH_ERROR: (f) => `${labelOf(f)} must be at most ${validationOf(f).maxLength} characters.`,
  MIN_VALUE_ERROR: (f) => `${labelOf(f)} must be ${minimumOf(f) ?? "higher"} or more.`,
  MAX_VALUE_ERROR: (f) => `${labelOf(f)} must be ${maximumOf(f) ?? "lower"} or less.`,
  FORMAT_ERROR: (f) => FORMAT_COPY[validationOf(f).format]?.(f) ?? `Please check ${labelOf(f)}.`,
  PATTERN_ERROR: (f) => `${labelOf(f)} is not in the expected format.`,
  NOT_ALLOWED_VALUE_ERROR: (f) => `Choose one of the listed options for ${labelOf(f)}.`,
  TYPE_ERROR: (f) => `Please check ${labelOf(f)}.`,
  UNKNOWN_VALUE_ERROR: (f) => `Please check ${labelOf(f)}.`,
};

/**
 * Turn a failed `createSubmission` into per-control messages, keyed by input NAME — so each message
 * lands on its own control instead of only a form-level banner. An address subfield's server path
 * (`address/subdivision`) is exactly how its control is named, so it maps straight through.
 *
 * The copy is written from `errorType` plus the field's own schema; Wix's `errorMessage` is the
 * validator's internal wording, so it goes to `console.debug` only. An unmapped `errorType` degrades
 * to safe copy — the enum grows, and MIN/MAX_VALUE_ERROR, MIN/MAX_ITEMS_ERROR and
 * DISABLED_FORM_ERROR are all reachable without being listed above.
 *
 * ⚠️ Two rejections here are SEED bugs, not frontend bugs — do NOT mangle the key or the value to
 * work around them (fix them in `seed/SEED.md`):
 *   • `UNKNOWN_VALUE_ERROR` on a key that IS in the schema → the field was seeded with no
 *     `validation` block, and that block is what registers the target as an accepted value.
 *   • `NOT_ALLOWED_VALUE_ERROR` on a choice field → the seed's `options[].value` and its validation
 *     enum disagree; the two declarations must match.
 *
 * @param {Error & { body?: object }} err
 * @param {object[]} fields  The raw fields being rendered.
 * @returns {Record<string, string>}  Empty when the failure wasn't a validation error.
 */
export function mapSubmissionErrors(err, fields) {
  const byTarget = new Map(fields.map((f) => [targetOf(f), f]));
  const errors = {};
  for (const violation of submissionViolations(err)) {
    const field = byTarget.get(violation.errorPath.split("/")[0]);
    if (!field) continue;
    console.debug("wix-forms: server violation", violation.errorPath, violation.errorType, violation.errorMessage);
    errors[violation.errorPath] = ERROR_COPY[violation.errorType]?.(field) ?? `Please check ${labelOf(field)}.`;
  }
  return errors;
}

/**
 * Move focus to a control by input name. ⚠️ `namedItem` returns a `RadioNodeList` for a radio or
 * checkbox group and an element for everything else — a guard that checks only for an element
 * silently skips every choice group.
 */
function focusControl(formEl, name) {
  const control = formEl?.elements?.namedItem?.(name);
  const node =
    typeof RadioNodeList !== "undefined" && control instanceof RadioNodeList ? control[0] : control;
  node?.focus?.();
}

/**
 * @param {string} formId  The form's GUID — read it from `WIX_FORMS` in `rest/wix-forms.config.js`
 *                         (written by the seed); never type a literal id into a component.
 * @returns {{
 *   form: object|null,
 *     // The Form exactly as Wix returned it, once loaded. Nothing is stripped or renamed: the
 *     // fields to render are `read.orderedInputs(form)`, the submit wording
 *     // `read.submitTextOf(form)`. Never hardcode a field list.
 *   values: Record<string, unknown>,
 *     // The form's state, keyed by each field's `target`: a string for text/choice/date, an ARRAY
 *     // for a multi-choice field, an OBJECT for an address. Bind every control's `value` to it.
 *   setValues: (next: object | ((prev: object) => object)) => void,
 *     // The plain React setter — `setValues((v) => ({ ...v, [name]: value }))` from onChange.
 *   bind: (target: string) => object,
 *     // The props a text-ish control needs, ready to spread: name, value, onChange, onBlur and the
 *     // two aria attributes. `<input {...bind(target)} type="email" required />`.
 *   submit: (event?: SubmitEvent) => Promise<boolean>,
 *     // Use as `onSubmit`. Validates, submits, and resolves TRUE when the submission was created —
 *     // that resolved true IS the success signal (a visitor can't read submissions back), so flip
 *     // your own thank-you state on it. FALSE means `errors` now says why.
 *   validate: (target?: string) => boolean,
 *     // `validate("email")` checks that one field, `validate("address/city")` one address subfield,
 *     // `validate()` the whole form. Every rule comes from the schema — `required`,
 *     // `minLength`/`maxLength`, `pattern`, `format` (EMAIL/PHONE/URL) — never from a field's name.
 *     // Writes `errors` (clearing what now passes) and returns whether what it checked passed.
 *   errors: Record<string, string>,
 *     // input name → visitor-facing message. The name is the field's `target`, or `target/sub` for
 *     // an address subfield. `errors[FORM_ERROR]` holds a form-level message (load or submit).
 *   loading: boolean,
 *     // Busy: loading the schema (`form` still null) or submitting (`form` set).
 *   read: typeof import("@/lib/wix-form-schema-utils"),
 *     // The schema accessors — functions, not data: `read.labelOf(field)`, `read.choicesOf(field)`,
 *     // `read.submitTextOf(form)`, … Handed back so the UI needs one import.
 * }}
 */
export function useWixForm(formId) {
  const [form, setForm] = useState(null);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(true);
  // The empty form to fall back to after a successful submit — the schema's own defaults.
  const emptyRef = useRef({});

  // Every visible INPUT the schema lays out, in the owner's order — the list the hook seeds values
  // from, validates and submits. The UI gets it the same way (`read.orderedInputs(form)`), so there
  // is no second copy to keep in sync and no filtered subset to explain.
  const fields = useMemo(() => orderedInputs(form), [form]);

  useEffect(() => {
    let live = true;
    if (!formId) {
      setLoading(false);
      setErrors({ [FORM_ERROR]: "No formId — pass one from WIX_FORMS (the seed writes it)." });
      return;
    }
    setLoading(true);
    getForm(formId)
      .then((loaded) => {
        if (!live) return;
        setForm(loaded);
        setErrors({});
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;
        // Fail loudly. A form that can't load is a setup problem (wrong id, Forms app missing) —
        // never fall back to a hand-built form, which would drop real enquiries silently.
        setErrors({ [FORM_ERROR]: e.message || "Could not load the form." });
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [formId]);

  // Seed the controls once the schema is in: every control is controlled from the first render, so
  // each `target` must hold a value of the right shape before any of them mount.
  useEffect(() => {
    const empty = defaultValues(fields);
    emptyRef.current = empty;
    setValues(empty);
  }, [fields]);

  const validate = useCallback(
    (target) => {
      // No target → the whole form. This is what `submit` runs before it sends anything.
      if (!target) {
        const all = errorsForForm(fields, values);
        setErrors(all);
        return Object.keys(all).length === 0;
      }

      const key = String(target);
      const field = fields.find((f) => targetOf(f) === key.split("/")[0]);
      if (!field) return true;

      // The error keys this call owns, so a re-check CLEARS what it fixed as well as flagging what
      // it didn't: one key for a plain field, or all of an address's subfields (`target/sub`) when
      // the address itself is named. Naming a single subfield scopes it to that one.
      const owned = key.includes("/")
        ? [key]
        : isAddress(field)
          ? addressPartsOf(field).map(({ sub }) => `${targetOf(field)}/${sub}`)
          : [targetOf(field)];

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

  // Everything a text-ish control needs, in one spread: `<input {...bind("email_a1b2")} type="email" />`.
  // Covers input / textarea / select. A checkbox or radio group carries `checked` instead of `value`
  // and a file input can't be controlled at all — wire those two by hand (INSTRUCTIONS.md, step 2),
  // keeping the same `name`, `onBlur` and `aria-*` contract.
  const bind = useCallback(
    (target) => ({
      name: target,
      value: values[target] ?? "",
      onChange: (event) => setValues((prev) => ({ ...prev, [target]: event.target.value })),
      onBlur: () => validate(target),
      "aria-describedby": `err-${target}`,
      "aria-invalid": errors[target] ? true : undefined,
    }),
    [values, errors, validate],
  );

  const submit = useCallback(
    async (event) => {
      event?.preventDefault?.();
      // Capture the <form> now: React clears `currentTarget` once the handler returns, so reading it
      // after the await below (to focus a server-rejected control) would come back null.
      const formEl = event?.currentTarget ?? null;
      if (!form) return false;

      // Client pass first, so the visitor gets inline feedback in OUR wording before a round trip.
      const clientErrors = errorsForForm(fields, values);
      if (Object.keys(clientErrors).length) {
        setErrors(clientErrors);
        // FOCUS the first invalid control — `scrollIntoView` moves the viewport and nothing else,
        // leaving a keyboard or screen-reader user where they were. The <form> comes from the event,
        // and each control is found by its `name` (which is its `target`).
        focusControl(formEl, Object.keys(clientErrors)[0]);
        return false;
      }

      setLoading(true);
      try {
        // Any picked files go up FIRST — a `File` object is not something the submission API takes,
        // and its value is the upload URL this hands back. No file fields → nothing happens here.
        const uploaded = await uploadFormFiles(form.id, fields, values);
        // Resolves on CONFIRMED, PENDING or PAYMENT_WAITING — all three are created submissions.
        // There is nothing to read back, so this is the only confirmation there is. (A form that
        // collects payment leaves the visitor a payment step; call createSubmission directly if you
        // need its `status` to surface that inside your success state.)
        await createSubmission(form.id, toSubmissionValues(fields, uploaded));
        setErrors({});
        setValues(emptyRef.current); // back to the schema's defaults, ready for another
        return true;
      } catch (e) {
        // Per-field violations land on their controls; anything else is a form-level message.
        const mapped = mapSubmissionErrors(e, fields);
        if (Object.keys(mapped).length) {
          setErrors(mapped);
          focusControl(formEl, Object.keys(mapped)[0]);
        } else {
          setErrors({ [FORM_ERROR]: e.message || "Could not send the form. Please try again." });
        }
        return false;
      } finally {
        setLoading(false);
      }
    },
    [fields, form, values],
  );

  return { form, values, setValues, bind, submit, validate, errors, loading, read };
}
