// Forms DTOs — the serializable shapes every hook and page consumes. A form is schema-driven
// (the owner picks the fields in their dashboard), so a FormDto is a LIST of fields rather
// than a fixed interface: render by mapping `form.fields`, never by naming fields in code.
//
// Why a DTO at all, when the schema IS the model: the raw `Form` nests a field's settings two
// levels deep under blocks named after its own enums
// (`inputOptions.stringOptions.dropdownOptions.label`), carries Date objects and Ricos
// rich-content labels that are not island-serializable, and spreads display ORDER across
// `steps[].layout` rather than `formFields[]`. FormFieldDto is that resolved once, in the data
// layer, into flat keys — the same rule every other vertical here follows.
//
// It is a FLATTENING, not a subset: every setting a renderer needs is carried through. When a
// field kind needs something not listed here, add the key — never reach past the DTO into the
// raw form.

/** What the visitor types into. Drives which control your component renders. */
export type FormControl =
  | "text"
  | "textarea"
  | "password"
  | "number"
  | "rating"
  | "email"
  | "phone"
  | "url"
  | "date"
  | "time"
  | "datetime"
  | "select"
  | "radio"
  | "checkbox"
  | "checkboxGroup"
  | "tags"
  | "address"
  | "file"
  | "signature"
  | "payment"
  /** A bookings slot picker embedded in a form — needs the `bookings` vertical, not an <input>. */
  | "appointment"
  | "unknown";

/** One choice in a select / radio / checkbox group. */
export interface FormChoice {
  value: string;
  /** The owner's wording, falling back to `value` so a choice is never blank. */
  label: string;
  /** IMAGE_CHOICE only: the option's picture, already a browser-loadable URL. */
  imageUrl?: string;
}

/** One subfield of an ADDRESS field — its own control, its own error key (`target/sub`). */
export interface FormAddressPart {
  /**
   * `country`, `addressLine`, `streetName`, `streetNumber`, `city`, `subdivision`, `postalCode`, … —
   * also the key inside the submitted object. WHICH subfields appear, and in what order, follows
   * the chosen country (Wix's own per-country address templates: Israel has a street name and
   * number and no subdivision, the United States one address line and a state), so re-read
   * `addressParts` from the store after the country changes.
   */
  sub: string;
  /** "Postal code", or the country's own word for its subdivision ("State", "Province", "Region"). */
  label: string;
  required: boolean;
  /**
   * `country`: ISO-2 codes to offer — the owner's `allowedCountries`, else every country.
   * `subdivision`: the country's states / provinces / regions (value is the ISO 3166-2 code, "US-NY");
   * absent when the country has none on record — render a text input then.
   */
  choices?: FormChoice[];
}

/** The owner's address settings, kept on the field so the parts can be recomputed for a country. */
export interface AddressOverrides {
  /** `validation.fields[sub].required` */
  required: Record<string, boolean | undefined>;
  /** `multilineAddressOptions.fieldSettings[sub].show` */
  show: Record<string, boolean | undefined>;
  /** `validation.allowedCountries`; empty means every country. */
  allowedCountries: string[];
}

/** The schema's own rules, resolved onto the field. Undefined means the owner set no rule. */
export interface FormValidation {
  /** EMAIL | PHONE | URL | DATE | TIME | DATE_TIME — drives both the control type and the format check. */
  format?: string;
  minLength?: number;
  maxLength?: number;
  /** A regex SOURCE string, not a RegExp — compile it at the call site. */
  pattern?: string;
  /** The owner's wording for a `pattern` miss (`validationMessages.pattern`); fall back to yours. */
  patternMessage?: string;
  /** NUMBER / rating bounds. */
  minimum?: number;
  maximum?: number;
  /** NUMBER step: 0.01 means two decimals; 1 means whole numbers. */
  multipleOf?: number;
  /** date / time / datetime bounds, already resolved to ISO (`$now+2d` becomes a real date at load). */
  minDate?: string;
  maxDate?: string;
  /** WIX_FILE: how many files this field accepts (Wix caps it at 30). */
  fileLimit?: number;
  /** WIX_FILE: the owner's format families — VIDEO | IMAGE | AUDIO | DOCUMENT | ARCHIVE; empty = any. */
  fileFormats?: string[];
  /** WIX_FILE: those families as an `<input accept>` value; "" when any file goes. */
  accept?: string;
  /** Multi-choice bounds, when the owner set them. */
  minItems?: number;
  maxItems?: number;
  /** A consent checkbox that must be ticked (`booleanOptions.validation.enum: [true]`). */
  mustBeTrue?: boolean;
  /** PHONE: ISO-2 country codes the number may belong to; empty = any. */
  allowedCountryCodes?: string[];
}

/**
 * One visible input, flattened. `target` is the field's immutable storage key — the input's
 * `name`, the key in `values`, the key in the submission, and the root of the server's error
 * paths. Everything is keyed by it, so nothing has to be matched by label or index.
 */
export interface FormFieldDto {
  target: string;
  /** The owner's label. Never empty — falls back to `target`. Always a string (a consent
   *  checkbox labels itself with rich content upstream; that is flattened to its plain text). */
  label: string;
  /** false when the owner hid the label; keep it for assistive tech (aria-label), not on screen. */
  showLabel: boolean;
  control: FormControl;
  required: boolean;
  /** The visitor cannot change it; it submits its prefill. Render disabled, skip the required check. */
  readOnly: boolean;
  /** Hidden right now — by the owner, or by a rule reacting to the current values. Not rendered, not submitted. */
  hidden: boolean;
  /** The step this field is laid out on (`FormDto.steps[].id`). */
  stepId: string;
  placeholder?: string;
  /** Help text shown under the control, when the owner wrote one. */
  description?: string;
  /** The owner's prefill: "" / [] / {} / false when unset, so the control is controlled from render one. */
  defaultValue: string | number | boolean | string[] | Record<string, string>;
  /** select / radio / checkboxGroup / tags — empty for every other control. After rules: the allowed subset. */
  choices: FormChoice[];
  /** A free-text "Other" entry the owner enabled on a choice field. Its submitted value is `otherValue(field, text)`. */
  otherOption?: { label: string; placeholder?: string };
  /**
   * address only — empty for every other control. `country` is always first. The store recomputes
   * these for the country the visitor picked (`FormState.form.fields`), so take them from there.
   */
  addressParts: FormAddressPart[];
  /** address only: what the recomputation needs. Not for rendering. */
  addressOverrides?: AddressOverrides;
  validation: FormValidation;
  /** phone only: the country whose example to show ("US", "GB", …). */
  phoneCountry?: string;
  /** file only: the owner's button wording, and the text shown once a file is picked. */
  buttonText?: string;
  explanationText?: string;
  /**
   * The field's kind as the owner picked it — TEXT_AREA, IMAGE_CHOICE, CONTACTS_EMAIL,
   * CONTACTS_BIRTHDATE, CONTACTS_SUBSCRIBE, … Several kinds share one component (short and long
   * answer are both TEXT_INPUT; image choice and multi choice are both CHECKBOX_GROUP), so this is
   * what separates them when `control` cannot.
   */
  identifier: string;
  /** The raw `inputType` / `componentType`, for the rare branch the flattening does not cover. */
  inputType: string;
  componentType: string;
}

/** One page of a multi-step form. A single-step form has exactly one. */
export interface FormStep {
  id: string;
  /** The owner's step name, "" when unnamed. */
  name: string;
  /** The targets laid out on this step, in display order. */
  targets: string[];
}

/**
 * A condition as the owner built it in the Rules tab, normalized from both schema spellings.
 * Operators are the v4 names: EQUAL, NOT_EQUAL, EMPTY, NOT_EMPTY, CONTAINS, NOT_CONTAINS,
 * LESS_THAN, LESS_THAN_OR_EQUALS, GREATER_THAN, GREATER_THAN_OR_EQUALS, BEFORE, BEFORE_OR_EQUAL,
 * AFTER, AFTER_OR_EQUAL, BETWEEN, ANY, ARRAY_EQUAL, ARRAY_NOT_EQUAL, CHECKED, NOT_CHECKED, IN,
 * NOT_IN, IS_DATE_OLDER_THAN(_OR_EQUAL), IS_DATE_NEWER_THAN(_OR_EQUAL).
 */
export type RuleCondition =
  | { and: RuleCondition[] }
  | { or: RuleCondition[] }
  | { target: string; operator: string; value?: unknown };

/** What a rule changes on one field while its condition holds. */
export interface RuleEffect {
  target: string;
  hidden?: boolean;
  required?: boolean;
  /** The choice values that stay selectable. */
  allowedValues?: string[];
}

export interface FormRule {
  id: string;
  when: RuleCondition;
  then: RuleEffect[];
}

/** What the owner chose to happen after a successful submit (dashboard: Submit settings). */
export interface FormSuccess {
  /** THANK_YOU_MESSAGE | REDIRECT | POPUP | NO_ACTION — NO_ACTION when the owner set nothing. */
  action: string;
  /** THANK_YOU_MESSAGE: the owner's text, paragraphs separated by "\n". */
  message?: string;
  /** THANK_YOU_MESSAGE: auto-hide the message after this many seconds and show the form again. */
  durationSeconds?: number;
  /** REDIRECT: the owner's URL (always https://). */
  redirectUrl?: string;
  /** REDIRECT: open in a new tab rather than replacing the page. */
  newTab?: boolean;
}

/** One form, ready to render. */
export interface FormDto {
  id: string;
  /** The owner's form name — an internal label, not necessarily page copy. */
  name: string;
  /** Every input, in the order the owner laid out (across steps, in step order). Hidden ones carry `hidden: true`. */
  fields: FormFieldDto[];
  /** The pages of the form, in order. One entry for a plain form. */
  steps: FormStep[];
  /** The owner's rules. The store applies them; a page never evaluates them itself. */
  rules: FormRule[];
  /** The owner's submit-button wording, or "" when they left the default. */
  submitText: string;
  /** Multi-step: the next / back button wording, "" when default. */
  nextText: string;
  previousText: string;
  /** false when the owner switched the form off. Show `disabledMessage` instead of the form. */
  enabled: boolean;
  /** The owner's "form closed" text ("" when unset — write your own). */
  disabledMessage: string;
  /** The owner's submission limits. The form closes itself at `deadline`; the counts are enforced server-side. */
  limits: { deadline?: string; maxSubmissions?: number; perVisitor?: number };
  /** How the owner marks required fields: ASTERISK | TEXT ("Required") | NONE, and where. */
  requiredIndicator: string;
  requiredIndicatorBefore: boolean;
  success: FormSuccess;
}

/** `target` → the visitor's current value. Arrays for multi-choice, objects for an address. */
export type FormValues = Record<string, unknown>;

/**
 * `target` (or `target/sub`) → a visitor-facing message. The key is the control's `name`, so a
 * message lands on its own control with no mapping table.
 */
export type FormErrors = Record<string, string>;

/** An uploaded attachment as the submission carries it (the WIX_FILE value is a list of these). */
export interface UploadedFile {
  fileId: string;
  displayName: string;
  fileType: string;
  url?: string;
}

/** A created submission. There is nothing to read back — this IS the confirmation. */
export interface SubmissionDto {
  id: string;
  /** CONFIRMED | PENDING | PAYMENT_WAITING — all three mean the submission exists. */
  status: string;
  /** PAYMENT_WAITING only: the checkout the visitor must be sent to (`checkoutUrl(checkoutId)`). */
  checkoutId?: string;
}

/** What a successful `submit()` resolves to — the owner's submit settings applied to this submission. */
export interface SubmitOutcome {
  submission: SubmissionDto;
  /** CHECKOUT | THANK_YOU_MESSAGE | REDIRECT | POPUP | NO_ACTION. */
  action: string;
  /** THANK_YOU_MESSAGE: the owner's text; absent → your own thank-you. */
  message?: string;
  durationSeconds?: number;
  /** CHECKOUT or REDIRECT: navigate the document here. */
  url?: string;
  newTab?: boolean;
}
