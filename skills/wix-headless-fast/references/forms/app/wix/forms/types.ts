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
}

/** One subfield of an ADDRESS field — its own control, its own error key (`target/sub`). */
export interface FormAddressPart {
  /** `addressLine`, `city`, `postalCode`, `country`, … — also the key inside the submitted object. */
  sub: string;
  /** "Postal code" — humanized from `sub`; the schema carries no label for a subfield. */
  label: string;
  required: boolean;
}

/** The schema's own rules, resolved onto the field. Undefined means the owner set no rule. */
export interface FormValidation {
  /** EMAIL | PHONE | URL | DATE — drives both the control type and the format check. */
  format?: string;
  minLength?: number;
  maxLength?: number;
  /** A regex SOURCE string, not a RegExp — compile it at the call site. */
  pattern?: string;
  /** NUMBER / rating bounds. */
  minimum?: number;
  maximum?: number;
  /** WIX_FILE: how many files this field accepts. */
  fileLimit?: number;
  /** Multi-choice bounds, when the owner set them. */
  minItems?: number;
  maxItems?: number;
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
  control: FormControl;
  required: boolean;
  placeholder?: string;
  /** Help text shown under the control, when the owner wrote one. */
  description?: string;
  /** The owner's prefill: "" / [] / {} when unset, so the control is controlled from render one. */
  defaultValue: string | number | boolean | string[] | Record<string, string>;
  /** select / radio / checkboxGroup / tags — empty for every other control. */
  choices: FormChoice[];
  /** address only — empty for every other control. */
  addressParts: FormAddressPart[];
  validation: FormValidation;
  /** phone only: the country whose example to show ("US", "GB", …). */
  phoneCountry?: string;
  /**
   * The field's kind as the owner picked it — TEXT_AREA, IMAGE_CHOICE, CONTACTS_EMAIL, … Several
   * kinds share one component (short and long answer are both TEXT_INPUT; image choice and multi
   * choice are both CHECKBOX_GROUP), so this is what separates them when `control` cannot.
   */
  identifier: string;
  /** The raw `inputType` / `componentType`, for the rare branch the flattening does not cover. */
  inputType: string;
  componentType: string;
}

/** One form, ready to render. */
export interface FormDto {
  id: string;
  /** The owner's form name — an internal label, not necessarily page copy. */
  name: string;
  /** Every visible input, in the order the owner laid out (across steps, in step order). */
  fields: FormFieldDto[];
  /** The owner's submit-button wording, or "" when they left the default. */
  submitText: string;
}

/** `target` → the visitor's current value. Arrays for multi-choice, objects for an address. */
export type FormValues = Record<string, unknown>;

/**
 * `target` (or `target/sub`) → a visitor-facing message. The key is the control's `name`, so a
 * message lands on its own control with no mapping table.
 */
export type FormErrors = Record<string, string>;

/** A created submission. There is nothing to read back — this IS the confirmation. */
export interface SubmissionDto {
  id: string;
  /** CONFIRMED | PENDING | PAYMENT_WAITING — all three mean the submission exists. */
  status: string;
}
