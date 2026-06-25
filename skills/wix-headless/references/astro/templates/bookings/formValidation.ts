// formValidation.ts — client-side form validation built from the @wix/forms
// schema, mirroring the rules the server enforces (a UX layer — createBooking
// validates authoritatively regardless). Uses AJV (the same engine family the Wix
// validator uses) for string/number/array/required/format rules, plus
// libphonenumber for phone. Pure, framework-agnostic.
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { isValidPhoneNumber } from "libphonenumber-js/min";

// Minimal shape this module needs from a normalized booking-form field.
export interface ValidatableField {
  target: string;
  required: boolean;
  renderType: string;
  valueType: "string" | "number" | "boolean" | "array" | "address" | "file";
  validation?: {
    minLength?: number; maxLength?: number; pattern?: string; format?: string;
    enum?: string[]; minimum?: number; maximum?: number; multipleOf?: number;
    minItems?: number; maxItems?: number;
  };
}

// Wix string format → AJV (ajv-formats) format name. Unmapped formats (PHONE,
// COLOR_HEX, CURRENCY…) are handled elsewhere or skipped.
// NOTE: DATE_TIME is deliberately NOT mapped. A `datetime-local` input emits a
// zone-less value (e.g. "2026-07-01T10:30:00"), but ajv-formats' "date-time"
// requires an RFC3339 offset (Z / ±hh:mm), so it would reject every valid input
// and make the field unsubmittable. The server validates it authoritatively.
// (DATE and TIME are safe — ajv's "time" treats the offset as optional.)
const FORMAT_MAP: Record<string, string> = {
  EMAIL: "email", DATE: "date", TIME: "time",
  URL: "url", URI: "uri", UUID: "uuid", HOSTNAME: "hostname",
};

export function buildValidator(fields: ValidatableField[]): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const f of fields) {
    if (!f.target || f.renderType === "file") continue;
    const v = f.validation ?? {};
    let p: any;
    if (f.valueType === "number") {
      p = { type: "number" };
      if (v.minimum != null) p.minimum = v.minimum;
      if (v.maximum != null) p.maximum = v.maximum;
      if (v.multipleOf != null) p.multipleOf = v.multipleOf;
    } else if (f.valueType === "boolean") {
      p = { type: "boolean" };
    } else if (f.valueType === "array") {
      p = { type: "array", items: { type: "string" } };
      if (v.minItems != null) p.minItems = v.minItems;
      if (v.maxItems != null) p.maxItems = v.maxItems;
    } else if (f.valueType === "address") {
      p = { type: "object" }; // sub-fields validated server-side
    } else {
      p = { type: "string" };
      if (v.minLength != null) p.minLength = v.minLength;
      if (v.maxLength != null) p.maxLength = v.maxLength;
      if (v.pattern) p.pattern = v.pattern;
      const fm = v.format && FORMAT_MAP[v.format];
      if (fm) p.format = fm;
      if (v.enum?.length) p.enum = v.enum;
    }
    properties[f.target] = p;
    if (f.required) required.push(f.target);
  }
  return ajv.compile({ type: "object", properties, required, additionalProperties: true });
}

function humanMessage(e: any): string {
  switch (e.keyword) {
    case "required": return "This field is required.";
    case "minLength": return `Must be at least ${e.params.limit} characters.`;
    case "maxLength": return `Must be at most ${e.params.limit} characters.`;
    case "pattern": return "Please match the requested format.";
    case "format": return e.params.format === "email" ? "Please enter a valid email." : `Please enter a valid ${e.params.format}.`;
    case "minimum": return `Must be at least ${e.params.limit}.`;
    case "maximum": return `Must be at most ${e.params.limit}.`;
    case "multipleOf": return `Must be a multiple of ${e.params.multipleOf}.`;
    case "minItems": return `Please select at least ${e.params.limit}.`;
    case "maxItems": return `Please select at most ${e.params.limit}.`;
    case "enum": return "Please choose a valid option.";
    default: return "Please enter a valid value.";
  }
}

// Validate the (already-cleaned) submission object → { target: message }.
export function fieldErrors(
  validate: ValidateFunction,
  fields: ValidatableField[],
  submission: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  validate(submission);
  for (const e of validate.errors ?? []) {
    const target = e.instancePath ? e.instancePath.slice(1).split("/")[0] : (e.params as any)?.missingProperty;
    if (target && !out[target]) out[target] = humanMessage(e);
  }
  // Phone: libphonenumber check (PHONE format isn't an ajv-format).
  for (const f of fields) {
    if (f.renderType !== "tel") continue;
    const val = submission[f.target] as string | undefined;
    if (val) {
      try { if (!isValidPhoneNumber(val)) out[f.target] ??= "Please enter a valid phone number."; }
      catch { out[f.target] ??= "Please enter a valid phone number."; }
    } else if (f.required) {
      out[f.target] ??= "This field is required.";
    }
  }
  return out;
}
