// React binding of the form store (wix/forms/form-store.ts) — schema in, validated submission
// out, minus the markup; the state machine lives there, framework-free. This hook subscribes to
// one store per mounted form and exposes its state and actions under one name, plus `bind` (the
// props a text-ish control spreads). Astro islands and React SPAs use this; a static page, Vue,
// or Svelte uses the store directly.
//
// This vertical ships no components: a form is schema-driven (the owner picks the fields), so
// every form has a different field set and no "contact form" component could ship for it. You
// render `form.fields`; see references/forms/INSTRUCTIONS.md.
//
// SSR-friendly: pass a server-fetched FormDto as `initialForm` (Astro frontmatter) and no
// client fetch happens; a SPA passes nothing and the hook loads it.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { createFormStore, type FormStore, type FormSubmitEvent } from "../../wix/forms/form-store";
import type { FormDto, FormErrors, FormValues } from "../../wix/forms/types";

export { FORM_ERROR, validateValue } from "../../wix/forms/form-store";

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
  submit: (event?: FormSubmitEvent) => Promise<boolean>;
  /** One field, one address subfield, or the whole form when called with nothing. */
  validate: (target?: string) => boolean;
  errors: FormErrors;
  /** Loading the schema, or submitting. */
  loading: boolean;
}

export function useWixForm(formId: string, options: UseWixFormOptions = {}): UseWixForm {
  const { initialForm } = options;
  const ref = useRef<{ formId: string; store: FormStore } | null>(null);
  if (!ref.current || ref.current.formId !== formId) ref.current = { formId, store: createFormStore({ formId, initialForm }) };
  const store = ref.current.store;
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const { values, errors } = state;

  // Covers input / textarea / select. A checkbox or radio group carries `checked` instead of
  // `value`, and a file input cannot be controlled at all — wire those by hand, keeping the
  // same `name`, `onBlur` and aria contract.
  const bind = useCallback(
    (target: string) => ({
      name: target,
      value: String(values[target] ?? ""),
      onChange: (e: { target: { value: string } }) => store.setValue(target, e.target.value),
      onBlur: () => store.validate(target),
      "aria-describedby": `err-${target}`,
      "aria-invalid": errors[target] ? (true as const) : undefined,
    }),
    [values, errors, store],
  );

  return {
    form: state.form,
    values,
    setValues: store.setValues,
    bind,
    submit: store.submit,
    validate: store.validate,
    errors,
    loading: state.loading,
  };
}
