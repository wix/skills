// Form-schema rules and DTO mapping — transport-agnostic, imported by BOTH transports: ./forms.ts
// (the SDK, managed Astro and React) and the REST twin in templates/forms/rest/forms.ts (fetch, a
// static site or a port to another language). Every rule about how a raw Form Schemas v4 entity
// flattens into a FormDto lives HERE, once — and so does the evaluation of the owner's conditional
// rules, which the store re-runs on every value change. A raw form may come from the SDK (`_id`) or
// from REST (`id`); the mappers accept both. Imports are type-only so a strip to JS emits no imports.
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields.md
import type {
  FormAddressPart,
  FormChoice,
  FormControl,
  FormDto,
  FormFieldDto,
  FormRule,
  FormStep,
  FormSuccess,
  FormValidation,
  FormValues,
  RuleCondition,
  RuleEffect,
} from "./types";

/** A raw Form Schemas v4 entity as either transport returns it. */
export type Raw = Record<string, any>;
/** Media value + size → https URL. Injected: the SDK transport scales through @wix/sdk, REST through the URL form. */
export type ImgSrc = (value: any, width: number, height: number) => string;

/** The Wix Forms app namespace. Every form this vertical touches lives here. */
export const FORMS_NAMESPACE = "wix.form_app.form";

const id = (raw: Raw | undefined): string => raw?._id ?? raw?.id ?? "";

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
  PASSWORD: "passwordOptions",
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
// long answer are both TEXT_INPUT), so `format`, `identifier` and `inputType` refine it below.
const CONTROL: Record<string, FormControl> = {
  TEXT_INPUT: "text",
  PASSWORD: "password",
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

// `uploadFileFormats` family → the <input accept> list Wix's own uploader uses (form-fields
// file-format.tsx). Video/image/audio are wildcard mime types; documents and archives are
// extension lists because their mime types are inconsistent across browsers.
export const FILE_FORMAT_ACCEPT: Record<string, string> = {
  VIDEO: "video/*",
  IMAGE: "image/*",
  AUDIO: "audio/*",
  DOCUMENT:
    ".ai,.cdr,.csv,.doc,.docb,.docx,.dot,.dotx,.dwg,.eps,.epub,.fla,.gpx,.ical,.icalendar,.ics,.ifb,.indd,.ipynb,.key,.kml,.kmz,.mobi,.mtf,.mtx,.numbers,.odg,.odp,.ods,.odt,.otp,.ots,.ott,.oxps,.pages,.pdf,.pdn,.pkg,.pot,.potx,.pps,.ppsx,.ppt,.pptx,.psd,.pub,.rtf,.sldx,.txt,.json,.vcf,.xcf,.xls,.xlsx,.xlt,.xltx,.xlw,.xps,.xml,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
  ARCHIVE: ".zip,.rar,.tar,.tar.gz,.gz,.gzip,.jar,.7z,.fgz,.webarchive",
};

/**
 * Every country an address may name when the owner set no `allowedCountries` — the list Wix's
 * own address field enumerates (form-multiline-address country-codes.ts). ISO 3166-1 alpha-2.
 */
export const COUNTRY_CODES: readonly string[] = ["AD","AE","AF","AG","AI","AL","AM","AN","AO","AQ","AR","AS","AT","AU","AW","AX","AZ","BA","BB","BD","BE","BF","BG","BH","BI","BJ","BL","BM","BN","BO","BQ","BR","BS","BT","BV","BW","BY","BZ","CA","CC","CD","CF","CG","CH","CI","CK","CL","CM","CN","CO","CR","CV","CW","CX","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE","EG","EH","ER","ES","ET","FI","FJ","FK","FM","FO","FR","GA","GB","GD","GE","GF","GG","GH","GI","GL","GM","GN","GP","GQ","GR","GS","GT","GU","GW","GY","HK","HM","HN","HR","HT","HU","ID","IE","IL","IM","IN","IO","IQ","IS","IT","JE","JM","JO","JP","KE","KG","KH","KI","KM","KN","KR","KW","KY","KZ","LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY","MA","MC","MD","ME","MF","MG","MH","MK","ML","MM","MN","MO","MP","MQ","MR","MS","MT","MU","MV","MW","MX","MY","MZ","NA","NC","NE","NF","NG","NI","NL","NO","NP","NR","NU","NZ","OM","PA","PE","PF","PG","PH","PK","PL","PM","PN","PR","PS","PT","PW","PY","QA","RE","RO","RS","RU","RW","SA","SB","SC","SD","SE","SG","SH","SI","SJ","SK","SL","SM","SN","SO","SR","SS","ST","SV","SX","SZ","TC","TD","TF","TG","TH","TJ","TK","TL","TM","TN","TO","TR","TT","TV","TW","TZ","UA","UG","UM","US","UY","UZ","VA","VC","VE","VG","VI","VN","VU","WF","WS","XK","YE","YT","ZA","ZM","ZW"];

/**
 * The subfields of an address, in the order Wix's country templates lay them out; `country`
 * always comes first (Wix prepends it to every template, get-country-field.ts). The per-country
 * templates Wix fetches at runtime vary this set (a US template adds a state, a JP one reorders);
 * this is the common set, with any extra key the owner configured in `validation.fields`
 * (streetName, streetNumber, apartment) appended.
 */
export const ADDRESS_SUBFIELDS = ["country", "addressLine", "addressLine2", "city", "subdivision", "postalCode"] as const;

// An enum missing from a table means Wix added a type. Say so ONCE — a silent empty block
// renders a field labelled by its storage key with none of its settings.
const warned = new Set<string>();
function blockName(table: Record<string, string>, key: string | undefined, what: string): string | undefined {
  const name = key ? table[key] : undefined;
  if (!name && key && !warned.has(what + key)) {
    warned.add(what + key);
    console.warn(
      `forms: no ${what} block mapped for "${key}" — that field renders without its label or ` +
        `options. Add it to the table in wix/forms/forms-core.ts.`,
    );
  }
  return name;
}

/**
 * Ricos rich content → plain text. Labels, descriptions, the owner's thank-you and "form closed"
 * messages all arrive as rich content; block nodes (paragraphs, headings, list items) become
 * lines so a multi-paragraph thank-you keeps its breaks. Links and decorations are dropped.
 */
export function plainText(label: unknown): string {
  if (typeof label === "string") return label;
  const nodes = (label as Raw)?.nodes;
  if (!Array.isArray(nodes)) return "";
  const BLOCK = /^(PARAGRAPH|HEADING|LIST_ITEM|BLOCKQUOTE|CODE_BLOCK)$/;
  const walk = (list: Raw[]): string =>
    list
      .map((n) => (n?.textData?.text ?? "") + (Array.isArray(n?.nodes) ? walk(n.nodes) : "") + (BLOCK.test(n?.type ?? "") ? "\n" : ""))
      .join("");
  return walk(nodes).replace(/\n{3,}/g, "\n\n").trim();
}

/** `postalCode` → "Postal code". A subfield is a key; the schema carries no label for it. */
export function humanizeSub(sub: string): string {
  const words = sub.replace(/([A-Z])|(\d+)/g, " $1$2").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** "US" → "United States" where the runtime knows names (Intl.DisplayNames); the code otherwise. */
export function countryName(code: string): string {
  try {
    const dn = (Intl as any).DisplayNames ? new (Intl as any).DisplayNames(["en"], { type: "region" }) : null;
    return (dn?.of(code) as string | undefined) ?? code;
  } catch {
    return code;
  }
}

const RELATIVE_DATE = /^\$now(?:([+-])(\d{1,2})([yMdmh]))?$/;

/**
 * A date bound or default as the schema stores it — an ISO string, or `$now`, `$now+2d`,
 * `$now-1M` (units y M d m h; string-format-options-mapper.ts) — resolved to a static value in
 * the field's own format: `YYYY-MM-DD` (date), `HH:mm:ss` (time), `YYYY-MM-DDTHH:mm:ss` (datetime).
 * An ISO input is returned unchanged; anything else (an unsupported expression) is dropped.
 */
export function resolveDate(value: unknown, control: string, now: Date = new Date()): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const m = value.match(RELATIVE_DATE);
  if (!m) return /^\d{4}-\d{2}-\d{2}|^\d{2}:\d{2}/.test(value) ? value : undefined;
  const d = new Date(now.getTime());
  const sign = m[1] === "-" ? -1 : 1;
  const n = m[2] ? sign * parseInt(m[2], 10) : 0;
  switch (m[3]) {
    case "y": d.setUTCFullYear(d.getUTCFullYear() + n); break;
    case "M": d.setUTCMonth(d.getUTCMonth() + n); break;
    case "d": d.setUTCDate(d.getUTCDate() + n); break;
    case "h": d.setUTCHours(d.getUTCHours() + n); break;
    case "m": d.setUTCMinutes(d.getUTCMinutes() + n); break;
  }
  const iso = d.toISOString(); // YYYY-MM-DDTHH:mm:ss.sssZ
  if (control === "time") return iso.slice(11, 19);
  if (control === "datetime") return iso.slice(0, 19);
  return iso.slice(0, 10);
}

/** The submitted value of a choice field's free-text "Other" entry: `"<Other label>: <text>"` (radio-group-field-headless.tsx). */
export function otherValue(field: FormFieldDto, text: string): string {
  return `${field.otherOption?.label ?? "Other"}: ${text}`;
}

/** The visitor's text back out of an "Other" value, or null when the value is a listed choice. */
export function otherText(field: FormFieldDto, value: unknown): string | null {
  if (!field.otherOption || typeof value !== "string" || !value) return null;
  if (field.choices.some((c) => c.value === value)) return null;
  const prefix = `${field.otherOption.label}: `;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function addressParts(rules: Raw, component: Raw, required: boolean): FormAddressPart[] {
  const overrides: Raw = rules.fields ?? {};
  const allowed: string[] = Array.isArray(rules.allowedCountries) && rules.allowedCountries.length ? rules.allowedCountries : [...COUNTRY_CODES];
  const subs = [...ADDRESS_SUBFIELDS, ...Object.keys(overrides).filter((k) => !(ADDRESS_SUBFIELDS as readonly string[]).includes(k))];
  return subs
    // Only addressLine2 carries a visibility setting; hide it when the owner turned it off.
    .filter((sub) => component.fieldSettings?.[sub]?.show !== false)
    .map((sub) => ({
      sub,
      label: humanizeSub(sub),
      // Wix requires the country exactly when the address itself is required (get-country-field.ts);
      // every other subfield is optional unless the owner's `validation.fields` says otherwise.
      required: overrides[sub]?.required ?? (sub === "country" ? required : false),
      ...(sub === "country" ? { choices: allowed.map((code) => ({ value: code, label: countryName(code) })) } : {}),
    }));
}

export function toField(raw: Raw, imgSrc: ImgSrc, stepId: string): FormFieldDto {
  const input = raw.inputOptions ?? {};
  const inputType: string = input.inputType ?? "";
  const optionsBlock: Raw = input[blockName(INPUT_BLOCK, inputType, "inputType") ?? ""] ?? {};
  const componentType: string = optionsBlock.componentType ?? "";
  const component: Raw = optionsBlock[blockName(COMPONENT_BLOCK, componentType, "componentType") ?? ""] ?? {};
  const rules: Raw = optionsBlock.validation ?? {};
  const identifier: string = raw.identifier ?? "";
  const required: boolean = input.required ?? false;

  let control: FormControl = CONTROL[componentType] ?? "unknown";
  // A product list is a PAYMENT field wearing a CHECKBOX_GROUP component — typed by its
  // component it would look like a multi-choice and be bound to an array of strings, when what
  // it submits is a payment structure. The input type wins.
  if (inputType === "PAYMENT") control = "payment";
  if (control === "text") {
    // A long answer is NOT flagged on the component (v4 TextInput has no `multiline` or
    // `numberOfLines`); only `identifier: TEXT_AREA` says so.
    if (identifier === "TEXT_AREA") control = "textarea";
    else if (rules.format === "EMAIL") control = "email";
    else if (rules.format === "URL") control = "url";
    else if (rules.format === "PHONE") control = "phone";
  }

  // Date bounds live under the format's own options block; `$now±N` is resolved here, once, so
  // the DTO carries a real ISO value for `min`/`max` attributes and for the client check.
  const dateRules: Raw = rules.dateOptions ?? rules.dateTimeOptions ?? rules.timeOptions ?? rules.dateOptionalTimeOptions ?? {};
  const fileFormats: string[] = Array.isArray(rules.uploadFileFormats) ? rules.uploadFileFormats : [];
  const isBirthdate = identifier === "CONTACTS_BIRTHDATE";
  const validation: FormValidation = {
    ...(rules.format ? { format: rules.format } : {}),
    ...(rules.minLength != null ? { minLength: rules.minLength } : {}),
    ...(rules.maxLength != null ? { maxLength: rules.maxLength } : {}),
    ...(rules.pattern ? { pattern: rules.pattern } : {}),
    ...(rules.validationMessages?.pattern ? { patternMessage: String(rules.validationMessages.pattern) } : {}),
    ...(rules.minimum != null ? { minimum: rules.minimum } : {}),
    ...(rules.maximum != null ? { maximum: rules.maximum } : {}),
    ...(rules.multipleOf != null ? { multipleOf: rules.multipleOf } : {}),
    // CONTACTS_BIRTHDATE is bounded 1900-01-01..today by Wix's own field (contacts-birthdate-validation.tsx).
    ...(resolveDate(dateRules.minimum, control) || isBirthdate
      ? { minDate: resolveDate(dateRules.minimum, control) ?? "1900-01-01" } : {}),
    ...(resolveDate(dateRules.maximum, control) || isBirthdate
      ? { maxDate: resolveDate(dateRules.maximum, control) ?? resolveDate("$now", "date") } : {}),
    ...(rules.fileLimit != null ? { fileLimit: rules.fileLimit } : {}),
    ...(fileFormats.length
      ? { fileFormats, accept: fileFormats.map((f) => FILE_FORMAT_ACCEPT[f]).filter(Boolean).join(",") }
      : control === "file" || control === "signature" ? { accept: "" } : {}),
    ...(rules.minItems != null ? { minItems: rules.minItems } : {}),
    ...(rules.maxItems != null ? { maxItems: rules.maxItems } : {}),
    // "Must be checked" is a BOOLEAN enum of [true]; `required` alone only checks presence.
    ...(inputType === "BOOLEAN" && Array.isArray(rules.enum) && rules.enum.length === 1 && rules.enum[0] === true ? { mustBeTrue: true } : {}),
    ...(Array.isArray(rules.phoneOptions?.allowedCountryCodes) && rules.phoneOptions.allowedCountryCodes.length
      ? { allowedCountryCodes: [...rules.phoneOptions.allowedCountryCodes] } : {}),
  };

  const options: Raw[] = Array.isArray(component.options) ? component.options : [];
  const choices: FormChoice[] = options.map((o: Raw) => ({
    value: String(o.value),
    label: String(o.label ?? o.value),
    // IMAGE_CHOICE options carry `media.image` (a wix:image URI) — resolved to a URL here.
    ...(o.media ? { imageUrl: imgSrc(o.media, 400, 400) } : {}),
  }));

  const target: string = input.target ?? "";
  const label = plainText(component.label) || target;

  // Every control is controlled from the first render, so each field starts at a value of the
  // right SHAPE. The prefill key differs per component (make-view-of-input-field.ts): choice
  // components mark `options[].default`, a checkbox has `checked`, a rating `defaultValue`,
  // text / number / date have `default` (a date default may be `$now+2d`).
  const defaultValue =
    control === "address" ? {} :
    inputType === "ARRAY" ? options.filter((o) => o.default).map((o) => String(o.value)) :
    inputType === "WIX_FILE" ? [] :
    inputType === "BOOLEAN" ? component.checked === true :
    control === "select" || control === "radio" ? String(options.find((o) => o.default)?.value ?? "") :
    control === "rating" ? ((component.defaultValue as number | undefined) ?? "") :
    control === "date" || control === "time" || control === "datetime" ? (resolveDate(component.default, control) ?? "") :
    (component.default as string | number | undefined) ?? "";

  return {
    target,
    label,
    showLabel: component.showLabel !== false,
    control,
    required,
    readOnly: input.readOnly === true,
    hidden: raw.hidden === true,
    stepId,
    ...(component.placeholder ? { placeholder: String(component.placeholder) } : {}),
    ...(component.description ? { description: plainText(component.description) } : {}),
    defaultValue,
    choices,
    ...(component.customOption
      ? { otherOption: { label: String(component.customOption.label ?? "Other"), ...(component.customOption.placeholder ? { placeholder: String(component.customOption.placeholder) } : {}) } }
      : {}),
    addressParts: control === "address" ? addressParts(rules, component, required) : [],
    validation,
    ...(component.defaultCountryCode ? { phoneCountry: String(component.defaultCountryCode) } : {}),
    ...(component.buttonText ? { buttonText: String(component.buttonText) } : {}),
    ...(component.explanationText ? { explanationText: String(component.explanationText) } : {}),
    identifier,
    inputType,
    componentType,
  };
}

/**
 * Display order comes from `steps[].layout`, NOT from `formFields[]` array order. Sort WITHIN
 * each step and concatenate in step order: `row` restarts at 0 in every step, so one sort
 * across the flattened list interleaves them. Wix reads the `large` layout (`small` only on a
 * phone, when present) and does not render a field absent from it; a field the owner never
 * placed sorts LAST here, on the last step — it still stores values. The submit button is
 * `fieldType: "DISPLAY"`, so filtering to INPUT drops it automatically. A hidden step's fields
 * are skipped.
 */
export function orderedInputs(raw: Raw): { field: Raw; stepId: string }[] {
  const steps = ((raw.steps ?? []) as Raw[]).filter((s) => !s.hidden);
  const placed = new Map<string, { order: number; stepId: string }>();
  let i = 0;
  for (const s of steps) {
    const items = ((s.layout?.large?.items ?? s.layout?.small?.items ?? []) as Raw[]).slice().sort((a, b) => a.row - b.row || a.column - b.column);
    for (const item of items) placed.set(item.fieldId as string, { order: i++, stepId: id(s) });
  }
  const lastStep = id(steps[steps.length - 1]);
  return ((raw.formFields ?? []) as Raw[])
    .filter((f) => f.fieldType === "INPUT")
    .map((f) => ({ field: f, order: placed.get(id(f))?.order ?? Infinity, stepId: placed.get(id(f))?.stepId ?? lastStep }))
    .sort((a, b) => a.order - b.order)
    .map(({ field, stepId }) => ({ field, stepId }));
}

// Legacy `rules[]` (json-rules-engine spelling, form-conditions/condition-operators.ts) → v4
// operator names. Unknown names pass through and evaluate to false.
const LEGACY_OPERATOR: Record<string, string> = {
  equal: "EQUAL", notEqual: "NOT_EQUAL", empty: "EMPTY", notEmpty: "NOT_EMPTY",
  contains: "CONTAINS", notContains: "NOT_CONTAINS",
  greaterThan: "GREATER_THAN", greaterThanOrEqual: "GREATER_THAN_OR_EQUALS",
  lessThan: "LESS_THAN", lessThanOrEqual: "LESS_THAN_OR_EQUALS",
  after: "AFTER", afterOrEqual: "AFTER_OR_EQUAL", before: "BEFORE", beforeOrEqual: "BEFORE_OR_EQUAL",
  between: "BETWEEN", any: "ANY", arrayEqual: "ARRAY_EQUAL", arrayNotEqual: "ARRAY_NOT_EQUAL",
  checked: "CHECKED", notChecked: "NOT_CHECKED", in: "IN", notIn: "NOT_IN",
  isDateNewerThan: "IS_DATE_NEWER_THAN", isDateOlderThan: "IS_DATE_OLDER_THAN",
  isDateNewerThanOrEqual: "IS_DATE_NEWER_THAN_OR_EQUAL", isDateOlderThanOrEqual: "IS_DATE_OLDER_THAN_OR_EQUAL",
};

/**
 * The owner's rules, normalized from both spellings the schema carries into one serializable
 * shape keyed by TARGET (so the store never needs field ids):
 *   - `formRules[]` (v4 `Rule`): `expression` is a ConditionNode tree (and / or / condition
 *     {target, operator, value}); overrides are FIELD entries with fieldId + propertyType
 *     REQUIRED / HIDDEN / ALLOWED_VALUES.
 *   - `rules[]` (deprecated `FormRule`, still what the runtime evaluates): `condition` is a
 *     json-rules-engine tree ({and|or: [{fact: <field id>, operator, value}]}); overrides are
 *     `valueChanges` keyed by path (`hidden`, `validation.required`, `validation.string.enum`,
 *     `view.options`; transform-path-to-v2.ts).
 * A rule referencing a field that no longer exists is dropped, as Wix does (isFormRuleValid).
 */
export function toRules(raw: Raw): FormRule[] {
  const targetOf = new Map<string, string>(
    ((raw.formFields ?? []) as Raw[]).filter((f) => f.inputOptions?.target).map((f) => [id(f), f.inputOptions.target as string]),
  );
  const targets = new Set(targetOf.values());
  const out: FormRule[] = [];

  const v4Node = (n: Raw | undefined): RuleCondition | null => {
    if (!n) return null;
    if (n.and?.conditions) { const list = (n.and.conditions as Raw[]).map(v4Node); return list.every(Boolean) && list.length ? { and: list as RuleCondition[] } : null; }
    if (n.or?.conditions) { const list = (n.or.conditions as Raw[]).map(v4Node); return list.every(Boolean) && list.length ? { or: list as RuleCondition[] } : null; }
    const c = n.condition;
    // A condition target may be dotted for a nested value (`address.city`); the root must be a field.
    if (!c?.target || !c.operator || !targets.has(String(c.target).split(".")[0])) return null;
    return { target: String(c.target), operator: String(c.operator), value: c.value };
  };
  for (const rule of (raw.formRules ?? []) as Raw[]) {
    const when = v4Node(rule.expression);
    const then: RuleEffect[] = ((rule.overrides ?? []) as Raw[]).flatMap((o): RuleEffect[] => {
      const f = o.fieldOptions;
      const target = f?.fieldId ? targetOf.get(f.fieldId) : undefined;
      if (!target) return [];
      if (f.propertyType === "HIDDEN") return [{ target, hidden: f.hiddenOptions?.hidden === true }];
      if (f.propertyType === "REQUIRED") return [{ target, required: f.requiredOptions?.required === true }];
      if (f.propertyType === "ALLOWED_VALUES") return [{ target, allowedValues: ((f.allowedValuesOptions?.allowedValues ?? []) as unknown[]).map(String) }];
      return [];
    });
    if (when && then.length) out.push({ id: id(rule), when, then });
  }

  const legacyNode = (n: Raw | undefined): RuleCondition | null => {
    if (!n) return null;
    if (Array.isArray(n.and)) { const list = (n.and as Raw[]).map(legacyNode); return list.every(Boolean) && list.length ? { and: list as RuleCondition[] } : null; }
    if (Array.isArray(n.or)) { const list = (n.or as Raw[]).map(legacyNode); return list.every(Boolean) && list.length ? { or: list as RuleCondition[] } : null; }
    const target = n.fact ? targetOf.get(String(n.fact)) : undefined;
    if (!target || !n.operator) return null;
    return { target, operator: LEGACY_OPERATOR[String(n.operator)] ?? String(n.operator), value: n.value };
  };
  for (const rule of (raw.rules ?? []) as Raw[]) {
    const when = legacyNode(rule.condition);
    const then: RuleEffect[] = ((rule.overrides ?? []) as Raw[]).flatMap((o) => {
      if (o.entityType !== "FIELD" || !o.entityId) return [];
      const target = targetOf.get(String(o.entityId));
      if (!target) return [];
      const ch: Raw = o.valueChanges ?? {};
      const effect: RuleEffect = { target };
      if (typeof ch.hidden === "boolean") effect.hidden = ch.hidden;
      if (typeof ch["validation.required"] === "boolean") effect.required = ch["validation.required"];
      if (Array.isArray(ch["validation.string.enum"])) effect.allowedValues = (ch["validation.string.enum"] as unknown[]).map(String);
      else if (Array.isArray(ch["view.options"])) effect.allowedValues = (ch["view.options"] as Raw[]).map((opt) => String(opt?.value ?? opt?.label ?? opt));
      return Object.keys(effect).length > 1 ? [effect] : [];
    });
    if (when && then.length) out.push({ id: id(rule), when, then });
  }
  return out;
}

// ---- rule evaluation (form-conditions operators, without the engine) -----------------------------

const missing = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A value as a number for ordering: numbers as they are, strings as timestamps (time-only gets a fixed day). */
function ordinal(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v !== "string" || !v) return null;
  const t = new Date(/^\d{2}:\d{2}(:\d{2})?$/.test(v) ? `2000-01-01 ${v}` : v).getTime();
  return Number.isNaN(t) ? null : t;
}

function dayDiff(given: unknown, spec: unknown, now: Date): { date: Date; pivot: Date } | null {
  if (!Array.isArray(spec) || spec.length !== 2 || typeof given !== "string") return null;
  const units = Number(spec[0]);
  const unit = spec[1];
  const date = new Date(given);
  if (Number.isNaN(date.getTime()) || Number.isNaN(units) || (unit !== "day" && unit !== "month")) return null;
  const pivot = new Date(now.getTime());
  if (unit === "day") pivot.setDate(pivot.getDate() + units); else pivot.setMonth(pivot.getMonth() + units);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return { date: day(date), pivot: day(pivot) };
}

/** Evaluate one comparison exactly as Wix's operators do (form-conditions/src/lib/operators). */
export function holds(operator: string, given: unknown, expected: unknown, now: Date = new Date()): boolean {
  const g = given, e = expected;
  const contains = (): boolean => {
    if (missing(g)) return false;
    if (isObj(g)) return Object.values(g).includes(e);
    if (Array.isArray(g) || typeof g === "string") return (g as any).indexOf(e) > -1;
    return false;
  };
  const within = (): boolean => {
    if (isObj(e)) return Object.values(e).includes(g);
    if (Array.isArray(e) || typeof e === "string") return (e as any).indexOf(g) > -1;
    return false;
  };
  const cmp = (op: (a: number, b: number) => boolean): boolean => {
    if (missing(g)) return false;
    const a = ordinal(g), b = ordinal(e);
    return a !== null && b !== null && op(a, b);
  };
  const arrayEq = (): boolean => {
    if (missing(g) || !Array.isArray(g) || !Array.isArray(e) || g.length !== e.length) return false;
    return e.every((v) => g.includes(v));
  };
  switch (operator) {
    case "EQUAL": return g === e;
    case "NOT_EQUAL": return g !== e;
    case "EMPTY": return missing(g);
    case "NOT_EMPTY": return !missing(g);
    case "CONTAINS": return contains();
    case "NOT_CONTAINS": return !contains();
    case "GREATER_THAN": case "AFTER": return cmp((a, b) => a > b);
    case "GREATER_THAN_OR_EQUALS": case "AFTER_OR_EQUAL": return cmp((a, b) => a >= b);
    case "LESS_THAN": case "BEFORE": return cmp((a, b) => a < b);
    case "LESS_THAN_OR_EQUALS": case "BEFORE_OR_EQUAL": return cmp((a, b) => a <= b);
    case "BETWEEN": {
      if (missing(g) || !Array.isArray(e) || e.length !== 2) return false;
      const a = ordinal(g), lo = ordinal(e[0]), hi = ordinal(e[1]);
      return a !== null && lo !== null && hi !== null && a > Math.min(lo, hi) && a < Math.max(lo, hi);
    }
    case "ANY": {
      if (missing(g) || !Array.isArray(e)) return false;
      return (Array.isArray(g) ? g : [g]).some((v) => e.includes(v));
    }
    case "ARRAY_EQUAL": return arrayEq();
    case "ARRAY_NOT_EQUAL": return !arrayEq();
    case "CHECKED": return Boolean(g);
    case "NOT_CHECKED": return !g;
    case "IN": return within();
    case "NOT_IN": return !within();
    case "IS_DATE_NEWER_THAN": case "IS_DATE_NEWER_THAN_OR_EQUAL": {
      const d = dayDiff(g, e, now);
      return !!d && (operator.endsWith("OR_EQUAL") ? d.date >= d.pivot : d.date > d.pivot);
    }
    case "IS_DATE_OLDER_THAN": case "IS_DATE_OLDER_THAN_OR_EQUAL": {
      const d = dayDiff(g, Array.isArray(e) ? [-Number(e[0]), e[1]] : e, now);
      return !!d && (operator.endsWith("OR_EQUAL") ? d.date <= d.pivot : d.date < d.pivot);
    }
    default: return false;
  }
}

/** A dotted condition target (`address.city`) read out of the values. */
function valueAt(values: FormValues, target: string): unknown {
  return target.split(".").reduce<unknown>((v, k) => (isObj(v) ? v[k] : undefined), values);
}

export function conditionHolds(when: RuleCondition, values: FormValues, now: Date = new Date()): boolean {
  if ("and" in when) return when.and.every((c) => conditionHolds(c, values, now));
  if ("or" in when) return when.or.some((c) => conditionHolds(c, values, now));
  return holds(when.operator, valueAt(values, when.target), when.value, now);
}

/**
 * The form's fields with every rule whose condition holds applied, in rule order (a later rule
 * wins on the same property — apply-overrides.ts reduces the same way). Hidden / required flip;
 * ALLOWED_VALUES narrows `choices` to the listed values. Pure: call it on every value change and
 * render the result.
 */
export function applyRules(form: FormDto, values: FormValues, now: Date = new Date()): FormFieldDto[] {
  if (!form.rules.length) return form.fields;
  const byTarget = new Map(form.fields.map((f) => [f.target, { ...f }]));
  for (const rule of form.rules) {
    if (!conditionHolds(rule.when, values, now)) continue;
    for (const effect of rule.then) {
      const f = byTarget.get(effect.target);
      if (!f) continue;
      if (effect.hidden !== undefined) f.hidden = effect.hidden;
      if (effect.required !== undefined) f.required = effect.required;
      if (effect.allowedValues) {
        const allowed = new Set(effect.allowedValues);
        f.choices = f.choices.filter((c) => allowed.has(c.value));
      }
    }
  }
  return form.fields.map((f) => byTarget.get(f.target) as FormFieldDto);
}

function toSuccess(settings: Raw | undefined): FormSuccess {
  const action: string = settings?.submitSuccessAction ?? "NO_ACTION";
  const out: FormSuccess = { action };
  if (action === "THANK_YOU_MESSAGE") {
    const message = plainText(settings?.thankYouMessageOptions?.richContent);
    if (message) out.message = message;
    const seconds = Number(settings?.thankYouMessageOptions?.durationInSeconds ?? 0);
    if (seconds > 0) out.durationSeconds = seconds;
  }
  if (action === "REDIRECT" && settings?.redirectOptions?.redirectUrl) {
    // Wix strips any scheme and always opens https:// (use-submit/utils.ts redirectToExternalUrl).
    out.redirectUrl = `https://${String(settings.redirectOptions.redirectUrl).replace(/^https?:\/\//, "")}`;
    out.newTab = settings.redirectOptions.target !== "SELF";
  }
  return out;
}

export function toForm(raw: Raw, imgSrc: ImgSrc): FormDto {
  const submit = ((raw.formFields ?? []) as Raw[]).find((f) => f.identifier === "SUBMIT_BUTTON");
  const nav: Raw = submit?.displayOptions?.pageNavigationOptions ?? {};
  const ordered = orderedInputs(raw);
  const fields = ordered.map(({ field, stepId }) => toField(field, imgSrc, stepId));
  const steps: FormStep[] = ((raw.steps ?? []) as Raw[])
    .filter((s) => !s.hidden)
    .map((s) => ({ id: id(s), name: s.name ?? "", targets: fields.filter((f) => f.stepId === id(s)).map((f) => f.target) }));
  const limitation: Raw = raw.limitationRule ?? {};
  const deadline = limitation.dateTimeDeadline ? new Date(limitation.dateTimeDeadline).toISOString() : undefined;
  const indicator: Raw = raw.requiredIndicatorProperties ?? {};
  return {
    id: id(raw),
    name: raw.name ?? "",
    fields,
    steps: steps.length ? steps : [{ id: "", name: "", targets: fields.map((f) => f.target) }],
    rules: toRules(raw),
    // The button wording lives on a DISPLAY field, nested under pageNavigationOptions because
    // one control drives both multi-page navigation and the final submit.
    submitText: nav.submitText ?? "",
    nextText: nav.nextPageText ?? "",
    previousText: nav.previousPageText ?? "",
    // `enabled` (default true) replaces the older `properties.disabled`; read both.
    enabled: raw.enabled != null ? raw.enabled !== false : raw.properties?.disabled !== true,
    disabledMessage: plainText(raw.disabledFormMessage),
    limits: {
      ...(deadline ? { deadline } : {}),
      ...(limitation.maxAllowedSubmissions != null ? { maxSubmissions: Number(limitation.maxAllowedSubmissions) } : {}),
      ...(limitation.submissionLimitPerUser != null ? { perVisitor: Number(limitation.submissionLimitPerUser) } : {}),
    },
    requiredIndicator: indicator.requiredIndicator ?? "ASTERISK",
    requiredIndicatorBefore: indicator.requiredIndicatorPlacement === "BEFORE_FIELD_TITLE",
    success: toSuccess(raw.submitSettings),
  };
}

/** A form that is not accepting submissions: switched off, or past its deadline (form-validator.ts isFormDisabled). */
export function isClosed(form: FormDto, now: Date = new Date()): boolean {
  return !form.enabled || (!!form.limits.deadline && new Date(form.limits.deadline).getTime() <= now.getTime());
}
