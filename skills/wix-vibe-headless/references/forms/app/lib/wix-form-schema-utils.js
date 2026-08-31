// Reading a Wix Form schema — plain functions over the RAW `Form` and its `formFields[]`. No React,
// no REST, no projection: the field object Wix returns IS the model the UI renders from, and these
// are the accessors that make it readable.
//
//   import * as read from "@/lib/wix-form-schema-utils";
//   read.orderedInputs(form).map((field) => <Field key={read.targetOf(field)} field={field} />)
//
// Nothing is guessed, and nothing is dropped — which matters because the schema nests a field's
// settings TWO levels deep, under blocks named after its own enums:
//
//   inputOptions
//     ├─ target / inputType / required        ← the field's identity
//     └─ stringOptions | arrayOptions | …     ← named after `inputType`            (`optionsOf`)
//          ├─ componentType / validation      ← the control, and its rules         (`validationOf`)
//          └─ dropdownOptions | textInputOptions | …  ← named after `componentType` (`componentOf`)
//               └─ label / placeholder / options / default
//
// ⚠️ Those two block names are the whole reason this file exists. They are looked up in the tables
// below rather than hand-written at the call site, because `inputOptions.stringOptions.dropdownOptions`
// spelled out in a component is one typo away from silently reading back no label at all.

/**
 * `inputType` → the block holding that type's `componentType`, `validation`, and component block.
 * Every input type the Form Schemas API defines
 * (https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields.md).
 */
const INPUT_BLOCK = {
  STRING: "stringOptions",
  NUMBER: "numberOptions",
  BOOLEAN: "booleanOptions",
  ARRAY: "arrayOptions",
  ADDRESS: "addressOptions",
  WIX_FILE: "wixFileOptions",
  PAYMENT: "paymentOptions",
  SCHEDULING: "schedulingOptions",
};

/**
 * `componentType` → the block holding that control's `label`, `placeholder`, `options`, `default`.
 * Note several fields share one component — short AND long answer are both `TEXT_INPUT`, image
 * choice and multi choice are both `CHECKBOX_GROUP` — which is why the render branches on
 * `identifier` too.
 */
const COMPONENT_BLOCK = {
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

// An enum missing from a table means Wix added a type — say so ONCE (these run per field per
// render) instead of quietly handing back an empty block and a field labelled by its target.
const warned = new Set();
function blockName(table, key, what) {
  const name = table[key];
  if (!name && key && !warned.has(key)) {
    warned.add(key);
    console.warn(
      `wix-forms: no ${what} block mapped for "${key}" — that field will render without its label ` +
        `or options. Add it to ${what === "inputType" ? "INPUT_BLOCK" : "COMPONENT_BLOCK"} in lib/wix-form-schema-utils.js.`,
    );
  }
  return name;
}

/** The field's immutable storage key — the input's `name`, and THE submission key. */
export const targetOf = (field) => field?.inputOptions?.target;

/** STRING | NUMBER | ARRAY | ADDRESS | WIX_FILE | BOOLEAN | PAYMENT | SCHEDULING. */
export const inputTypeOf = (field) => field?.inputOptions?.inputType;

/** ⚠️ From `inputOptions`, not from `validation`. */
export const isRequired = (field) => field?.inputOptions?.required ?? false;

/** The input-type block: `componentType`, `validation`, and the component's own sub-block. */
export const optionsOf = (field) =>
  field?.inputOptions?.[blockName(INPUT_BLOCK, inputTypeOf(field), "inputType")] ?? {};

/** DROPDOWN | RADIO_GROUP | CHECKBOX_GROUP | TEXT_INPUT | NUMBER_INPUT | FILE_UPLOAD | … */
export const componentTypeOf = (field) => optionsOf(field).componentType;

/** The component sub-block: `label`, `placeholder`, `options`, `default`, … */
export const componentOf = (field) =>
  optionsOf(field)[blockName(COMPONENT_BLOCK, componentTypeOf(field), "componentType")] ?? {};

/** `format`, `minLength`, `maxLength`, `pattern`, `fields` (address), `fileLimit`, `phoneOptions`, … */
export const validationOf = (field) => optionsOf(field).validation ?? {};

/**
 * The owner's label, falling back to the target so a control is never nameless.
 *
 * ⚠️ The fallback also covers a label that ISN'T A STRING: a BOOLEAN field (consent checkbox) labels
 * itself with a Ricos rich-content object, which would otherwise reach the page — and any error copy
 * built from it — as the text `[object Object]`. Render that field's label from
 * `componentOf(field).label` yourself if you write a branch for it.
 */
export const labelOf = (field) => {
  const label = componentOf(field).label;
  return typeof label === "string" && label ? label : targetOf(field);
};

/** Multi-choice: submits an ARRAY of the checked option values. */
export const isMulti = (field) => inputTypeOf(field) === "ARRAY";

/** File upload or signature: holds `File` objects until submit swaps them for their upload URLs. */
export const isFile = (field) => inputTypeOf(field) === "WIX_FILE";

/** NUMBER covers both the number input and a rating — the value goes on the wire as a number. */
export const isNumber = (field) => inputTypeOf(field) === "NUMBER";

/** An ADDRESS submits a nested OBJECT, so its subfields are their own controls. */
export const isAddress = (field) => inputTypeOf(field) === "ADDRESS";

/** Choice options as `{ value, label }` — a label is optional in the schema, the value never is. */
export const choicesOf = (field) =>
  componentOf(field).options?.map((o) => ({ value: o.value, label: o.label ?? o.value })) ?? [];

/**
 * An ADDRESS field's subfields as `{ sub, required }`, in schema order. `validation.fields` lists
 * them; only `addressLine2` carries a visibility setting, so this hides just that one when the owner
 * turned it off.
 */
export const addressPartsOf = (field) =>
  Object.entries(validationOf(field).fields ?? {})
    .filter(([sub]) => componentOf(field).fieldSettings?.[sub]?.show !== false)
    .map(([sub, cfg]) => ({ sub, required: cfg?.required ?? false }));

/** The country a PHONE field's example should use — the FIELD's own before the site's. */
export const phoneCountryOf = (field) =>
  componentOf(field).defaultCountryCode ?? validationOf(field).phoneOptions?.allowedCountryCodes?.[0];

/**
 * Every visible INPUT field, in the order the owner laid out.
 *
 * ⚠️ Display order comes from `steps[].layout`, NOT from `formFields[]` array order. Take the order
 * only — the geometry (`row`/`column`/`width`) is Wix's editor layout, which your own design
 * replaces. A field the owner never placed sorts LAST; it still stores values.
 *
 * The submit button is `fieldType: "DISPLAY"`, so filtering to INPUT drops it automatically.
 *
 * @param {object} form  A Form from `getForm` / `listForms`.
 * @returns {object[]}  Raw field objects — read them with the accessors above.
 */
export function orderedInputs(form) {
  const order = new Map(
    (form?.steps ?? [])
      // Sort WITHIN each step, then concatenate in step order: `row` restarts at 0 in every step,
      // so one sort across the flattened list interleaves them — step 1's second field would land
      // after step 2's first.
      .flatMap((s) =>
        (s.layout?.large?.items ?? s.layout?.medium?.items ?? s.layout?.small?.items ?? [])
          .slice()
          .sort((a, b) => a.row - b.row || a.column - b.column),
      )
      .map((item, i) => [item.fieldId, i]),
  );
  return (form?.formFields ?? [])
    .filter((f) => f.fieldType === "INPUT" && !f.hidden)
    .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
}

/**
 * The owner's submit-button wording, or "" when they didn't set one. It lives on the SUBMIT_BUTTON —
 * a DISPLAY field, so it never appears in `orderedInputs` — and nests under `pageNavigationOptions`
 * because one control drives both multi-page navigation and the final submit.
 */
export const submitTextOf = (form) =>
  (form?.formFields ?? []).find((f) => f.identifier === "SUBMIT_BUTTON")
    ?.displayOptions?.pageNavigationOptions?.submitText ?? "";
