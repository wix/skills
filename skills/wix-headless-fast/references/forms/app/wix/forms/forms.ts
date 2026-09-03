// Wix Forms schema reads (@wix/forms `forms`) — the only file that touches a raw Form.
// Returns flat FormDto / FormFieldDto from ./types. Copy as-is; extend by adding functions.
//
// ⚠️ The visitor token is enough, and the spec says otherwise. Every schema read is listed
// under the owner scope `SCOPE.FORMS.VIEW-FORM`, and returns 200 on an anonymous visitor:
// Wix grants implicit visitor access so a published site can render its own forms. Do NOT add
// a backend, a connector token, or auth.elevate to make a form load.
//
// docs: https://dev.wix.com/docs/sdk/business-solutions/forms/forms/get-form.md
// docs: https://dev.wix.com/docs/sdk/business-solutions/forms/forms/list-forms.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields.md
import { forms as formsModule } from "@wix/forms";
import { wixModule } from "../sdk";
import type {
  FormAddressPart,
  FormChoice,
  FormControl,
  FormDto,
  FormFieldDto,
  FormValidation,
} from "./types";

const forms = wixModule(formsModule);

/** The Wix Forms app namespace. Every form this vertical touches lives here. */
export const FORMS_NAMESPACE = "wix.form_app.form";

type Raw = Record<string, any>;

// A field's settings nest TWO levels deep, under blocks named after its own enums:
//   inputOptions.<inputType block>.<componentType block>.label
// These tables resolve those names. Spelling them at a call site is one typo away from
// silently reading back no label at all — which is the whole reason this file exists.
const INPUT_BLOCK: Record<string, string> = {
  STRING: "stringOptions",
  NUMBER: "numberOptions",
  BOOLEAN: "booleanOptions",
  ARRAY: "arrayOptions",
  ADDRESS: "addressOptions",
  WIX_FILE: "wixFileOptions",
  PAYMENT: "paymentOptions",
  SCHEDULING: "schedulingOptions",
};

const COMPONENT_BLOCK: Record<string, string> = {
  TEXT_INPUT: "textInputOptions",
  NUMBER_INPUT: "numberInputOptions",
  RATING_INPUT: "ratingInputOptions",
  PHONE_INPUT: "phoneInputOptions",
  DATE_INPUT: "dateInputOptions",
  DATE_PICKER: "datePickerOptions",
  DATE_TIME: "dateTimeOptions",
  TIME_INPUT: "timeInputOptions",
  CHECKBOX: "checkboxOptions",
  CHECKBOX_GROUP: "checkboxGroupOptions",
  RADIO_GROUP: "radioGroupOptions",
  DROPDOWN: "dropdownOptions",
  TAGS: "tagsOptions",
  MULTILINE_ADDRESS: "multilineAddressOptions",
  FILE_UPLOAD: "fileUploadOptions",
  SIGNATURE: "signatureOptions",
  FIXED_PAYMENT: "fixedPaymentOptions",
  PAYMENT_INPUT: "paymentInputOptions",
  DONATION_INPUT: "donationInputOptions",
  APPOINTMENT: "appointmentOptions",
  SERVICES_DROPDOWN: "servicesDropdownOptions",
  SERVICES_CHECKBOX_GROUP: "servicesCheckboxGroupOptions",
};

// componentType → the control to render. Several field kinds share one component (short and
// long answer are both TEXT_INPUT), so `format` and `inputType` refine it below.
const CONTROL: Record<string, FormControl> = {
  TEXT_INPUT: "text",
  NUMBER_INPUT: "number",
  RATING_INPUT: "rating",
  PHONE_INPUT: "phone",
  DATE_INPUT: "date",
  DATE_PICKER: "date",
  DATE_TIME: "datetime",
  TIME_INPUT: "time",
  CHECKBOX: "checkbox",
  CHECKBOX_GROUP: "checkboxGroup",
  RADIO_GROUP: "radio",
  DROPDOWN: "select",
  TAGS: "tags",
  MULTILINE_ADDRESS: "address",
  FILE_UPLOAD: "file",
  SIGNATURE: "signature",
  FIXED_PAYMENT: "payment",
  PAYMENT_INPUT: "payment",
  DONATION_INPUT: "payment",
  SERVICES_DROPDOWN: "select",
  SERVICES_CHECKBOX_GROUP: "checkboxGroup",
  APPOINTMENT: "appointment",
};

// An enum missing from a table means Wix added a type. Say so ONCE — a silent empty block
// renders a field labelled by its storage key with none of its settings.
const warned = new Set<string>();
function blockName(table: Record<string, string>, key: string | undefined, what: string): string | undefined {
  const name = key ? table[key] : undefined;
  if (!name && key && !warned.has(what + key)) {
    warned.add(what + key);
    console.warn(
      `forms: no ${what} block mapped for "${key}" — that field renders without its label or ` +
        `options. Add it to the table in app/wix/forms/forms.ts.`,
    );
  }
  return name;
}

/** A BOOLEAN consent field labels itself with Ricos rich content; take its plain text. */
function plainText(label: unknown): string {
  if (typeof label === "string") return label;
  const nodes = (label as Raw)?.nodes;
  if (!Array.isArray(nodes)) return "";
  const walk = (list: Raw[]): string =>
    list
      .map((n) => (n?.textData?.text ?? "") + (Array.isArray(n?.nodes) ? walk(n.nodes) : ""))
      .join("");
  return walk(nodes).trim();
}

/** `postalCode` → "Postal code". A subfield is a key; the schema carries no label for it. */
function humanizeSub(sub: string): string {
  const words = sub.replace(/([A-Z])|(\d+)/g, " $1$2").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function toField(raw: Raw): FormFieldDto {
  const input = raw.inputOptions ?? {};
  const inputType: string = input.inputType ?? "";
  const optionsBlock: Raw = input[blockName(INPUT_BLOCK, inputType, "inputType") ?? ""] ?? {};
  const componentType: string = optionsBlock.componentType ?? "";
  const component: Raw = optionsBlock[blockName(COMPONENT_BLOCK, componentType, "componentType") ?? ""] ?? {};
  const rules: Raw = optionsBlock.validation ?? {};

  const validation: FormValidation = {
    ...(rules.format ? { format: rules.format } : {}),
    ...(rules.minLength != null ? { minLength: rules.minLength } : {}),
    ...(rules.maxLength != null ? { maxLength: rules.maxLength } : {}),
    ...(rules.pattern ? { pattern: rules.pattern } : {}),
    // JSON-Schema spelling everywhere else in this block; minValue/maxValue is read too since
    // the public reference documents neither and an older schema may carry them.
    ...((rules.minimum ?? rules.minValue) != null ? { minimum: rules.minimum ?? rules.minValue } : {}),
    ...((rules.maximum ?? rules.maxValue) != null ? { maximum: rules.maximum ?? rules.maxValue } : {}),
    ...(rules.fileLimit != null ? { fileLimit: rules.fileLimit } : {}),
    ...(rules.minItems != null ? { minItems: rules.minItems } : {}),
    ...(rules.maxItems != null ? { maxItems: rules.maxItems } : {}),
  };

  // TEXT_INPUT covers short answer, long answer, email, url and phone — and a long answer is
  // NOT flagged on the component (no `multiline`, no `numberOfLines`). Only `identifier` says
  // TEXT_AREA, which is why it is carried on the DTO.
  const identifier: string = raw.identifier ?? "";
  let control: FormControl = CONTROL[componentType] ?? "unknown";
  // A product list is a PAYMENT field wearing a CHECKBOX_GROUP component — typed by its
  // component it would look like a multi-choice and be bound to an array of strings, when what
  // it submits is a payment structure. The input type wins.
  if (inputType === "PAYMENT") control = "payment";
  if (control === "text") {
    if (identifier === "TEXT_AREA" || component.multiline || component.numberOfLines > 1) control = "textarea";
    else if (rules.format === "EMAIL") control = "email";
    else if (rules.format === "URL") control = "url";
    else if (rules.format === "PHONE") control = "phone";
  }

  const choices: FormChoice[] = Array.isArray(component.options)
    ? component.options.map((o: Raw) => ({ value: String(o.value), label: String(o.label ?? o.value) }))
    : [];

  const addressParts: FormAddressPart[] = Object.entries((rules.fields ?? {}) as Raw)
    // Only addressLine2 carries a visibility setting; hide it when the owner turned it off.
    .filter(([sub]) => component.fieldSettings?.[sub]?.show !== false)
    .map(([sub, cfg]) => ({ sub, label: humanizeSub(sub), required: (cfg as Raw)?.required ?? false }));

  const target: string = input.target ?? "";
  const label = plainText(component.label) || target;

  // Every control is controlled from the first render, so each field starts at a value of the
  // right SHAPE — [] for multi-choice and files, {} for an address, the owner's prefill else "".
  // Wix spells the prefill `default` on most components and `defaultValue` on a rating.
  const prefill = component.default ?? component.defaultValue;
  const defaultValue =
    control === "address" ? {} :
    inputType === "ARRAY" || inputType === "WIX_FILE" ? [] :
    // a consent checkbox is a BOOLEAN: "" would bind to `checked` as false and work by
    // accident, but the DTO promises the shape its control writes back
    inputType === "BOOLEAN" ? ((prefill as boolean | undefined) ?? false) :
    (prefill as string | number | boolean | undefined) ?? "";

  return {
    target,
    label,
    control,
    required: input.required ?? false,
    ...(component.placeholder ? { placeholder: String(component.placeholder) } : {}),
    ...(component.description ? { description: plainText(component.description) } : {}),
    defaultValue,
    choices,
    addressParts,
    validation,
    ...(component.defaultCountryCode || rules.phoneOptions?.allowedCountryCodes?.[0]
      ? { phoneCountry: component.defaultCountryCode ?? rules.phoneOptions.allowedCountryCodes[0] }
      : {}),
    identifier,
    inputType,
    componentType,
  };
}

/**
 * Display order comes from `steps[].layout`, NOT from `formFields[]` array order. Sort WITHIN
 * each step and concatenate in step order: `row` restarts at 0 in every step, so one sort
 * across the flattened list interleaves them. A field the owner never placed sorts LAST — it
 * still stores values. The submit button is `fieldType: "DISPLAY"`, so filtering to INPUT
 * drops it automatically.
 */
function orderedInputs(raw: Raw): Raw[] {
  const order = new Map<string, number>(
    ((raw.steps ?? []) as Raw[])
      .flatMap((s) =>
        ((s.layout?.large?.items ?? s.layout?.medium?.items ?? s.layout?.small?.items ?? []) as Raw[])
          .slice()
          .sort((a, b) => a.row - b.row || a.column - b.column),
      )
      .map((item, i) => [item.fieldId as string, i] as const),
  );
  return ((raw.formFields ?? []) as Raw[])
    .filter((f) => f.fieldType === "INPUT" && !f.hidden)
    .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
}

function toForm(raw: Raw): FormDto {
  const submit = ((raw.formFields ?? []) as Raw[]).find((f) => f.identifier === "SUBMIT_BUTTON");
  return {
    id: raw._id ?? raw.id,
    name: raw.name ?? "",
    fields: orderedInputs(raw).map(toField),
    // The submit wording lives on a DISPLAY field, nested under pageNavigationOptions because
    // one control drives both multi-page navigation and the final submit.
    submitText: submit?.displayOptions?.pageNavigationOptions?.submitText ?? "",
  };
}

/**
 * Read one form by id. Throws when the id is wrong or the form was deleted — a form that
 * cannot load is a setup problem, so fail loudly rather than rendering a hand-built fallback
 * that would drop real enquiries silently.
 */
export async function getForm(formId: string): Promise<FormDto> {
  const raw = (await forms.getForm(formId)) as Raw;
  if (!raw) throw new Error(`forms: form "${formId}" not found.`);
  return toForm(raw);
}

/**
 * Every form on the site, in the Wix Forms namespace. Use ONE call for several forms on a page
 * rather than a getForm each.
 *
 * ⚠️ Returns only ENABLED forms — a form the owner disabled vanishes from the listing rather
 * than erroring. That is usually right for a public site.
 */
export async function listForms(): Promise<FormDto[]> {
  // The namespace is POSITIONAL — an options object here is a type error, and untyped it would
  // silently list nothing.
  const res = (await forms.listForms(FORMS_NAMESPACE)) as Raw;
  return ((res?.forms ?? []) as Raw[]).map(toForm);
}
