// Submission rules — transport-agnostic, imported by BOTH transports: ./submissions.ts (the SDK)
// and the REST twin in templates/forms/rest/submissions.ts. What a visitor's values become on
// the wire, which statuses mean "created", how a rejection maps back onto controls, how an
// attachment is uploaded, and how a paid submission hands off to checkout — all HERE, once. A
// created submission may arrive wrapped (`{ submission }`, REST) or bare (SDK), with `_id` (SDK)
// or `id` (REST); the mapper accepts both.
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values.md
import { humanizeSub, type Raw } from "./forms-core";
import type { FormDto, FormFieldDto, FormValues, SubmissionDto, UploadedFile } from "./types";

/**
 * Statuses that mean the submission EXISTS — `CONFIRMED` is recorded, `PENDING` is created but
 * not recorded yet, `PAYMENT_WAITING` is created on a form that also collects payment and now
 * needs the visitor at checkout (`SubmissionDto.checkoutId`). Treating one as a failure invites
 * the visitor to submit again, which costs the owner duplicate entries for a submission that
 * already exists. `PAYMENT_CANCELED` also exists in the enum but is never what a create returns.
 *
 * An allowlist rather than a catch-all, so a status added to the enum later cannot silently
 * render a thank-you for something that is not a submission.
 */
export const SUBMITTED_OK = new Set(["CONFIRMED", "PENDING", "PAYMENT_WAITING"]);

/**
 * Strip visitor-added formatting from a phone number — submit this, not the raw control text.
 * Wix keeps digits and the leading + only (normalize-values.ts acceptPhoneValue).
 */
export const normalizePhone = (v: unknown): string => String(v ?? "").replace(/[^0-9+]/g, "");

/**
 * "example.com/page" → "https://example.com/page". Wix's own field prefixes a scheme on blur
 * when the text looks like a domain; a value that already has one, or does not look like a
 * host, is returned as typed.
 */
export function normalizeUrl(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s || /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  return /^[\w-]+(\.[\w-]+)+(\/|$|\?|#)/.test(s) ? `https://${s}` : s;
}

/** Wix's own email pattern (form-validator email-validation.ts): unicode-aware, a letter in the TLD. */
const L = "\\u00A1-\\uD7FF\\uE000-\\uFFFF-a-zA-Z";
const LD = `${L}0-9`;
const SYM = "!#$%&'*+/=?^_`{|}~-";
export const EMAIL_PATTERN = new RegExp(
  `^(?:[${LD}${SYM}]+(?:\\.[${LD}${SYM}]+)*)@(?:[${LD}](?:[${LD}-]*[${LD}])?\\.)+(?:(?:[0-9]+[${L}][${LD}]*)|(?:[${L}][${LD}]{1,}))$`,
);

/** E.164 as the server checks it (ajv-custom-formats.ts): a leading +, then 2 to 15 digits. */
export const PHONE_PATTERN = /^\+[1-9]\d{1,14}$/;

/** Uploads a File and resolves to the value to submit for it. */
export type UploadOne = (formId: string, file: File) => Promise<UploadedFile>;

/**
 * A browser leaves `type` empty for extensions it does not recognize; the generic type keeps
 * the upload-URL call valid (Media Manager rejects a mime type that contradicts the extension).
 */
export const uploadMimeType = (file: File): string => file.type || "application/octet-stream";

/** A value already produced by an upload (a retry after the server rejected some OTHER field). */
export const isUploaded = (v: unknown): v is UploadedFile =>
  typeof v === "object" && v !== null && typeof (v as Raw).fileId === "string" && typeof (v as Raw).displayName === "string";

/**
 * PUT the bytes to the generated upload URL and build the value to submit for the field.
 *
 * A WIX_FILE value is a list of `{ fileId, displayName, fileType, url }` — the three ids are
 * required by the server's schema (predefined-schema-property-mapper.ts), `url` is what the
 * owner's dashboard links. Wix's own runtime reads the PUT response's `file` (use-upload-file.tsx
 * + headless file-upload-utils.ts) rather than submitting a bare URL. The PUT goes to a pre-signed
 * host with plain `fetch`, never through the SDK or the REST client: adding the visitor's
 * Authorization header to a pre-signed URL turns a working upload into a 400.
 */
export async function putUpload(uploadUrl: string, file: File, mimeType: string = uploadMimeType(file)): Promise<UploadedFile> {
  const put = await fetch(`${uploadUrl}?filename=${encodeURIComponent(file.name)}`, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: file,
  });
  if (!put.ok) {
    // Media Manager's own codes land here: FILE_SIZE_OVER_LIMIT, UNSUPPORTED_FILE_FORMAT,
    // MISMATCH_MIME_TYPE, ZERO_FILE_SIZE, SITE_QUOTA_EXCEEDED.
    throw new Error(`forms: could not upload "${file.name}" (${put.status}). Check its size and type.`);
  }
  let uploaded: Raw = {};
  try { uploaded = ((await put.json()) as Raw)?.file ?? {}; } catch { /* a body-less 200: the ids below still describe the file */ }
  return {
    // Wix's headless wrapper submits a placeholder id when it has none (react/Form.tsx), so the
    // server accepts any string here; the real Media Manager id is used when the PUT returns it.
    fileId: String(uploaded.id ?? uploaded.fileId ?? "uploaded"),
    displayName: String(uploaded.displayName ?? file.name),
    fileType: mimeType,
    ...(uploaded.url ? { url: String(uploaded.url) } : {}),
  };
}

/**
 * Upload every File sitting in the form's values and return a copy with each file field
 * replaced by its uploaded value(s). Values already holding uploaded entries (a retry after the
 * server rejected some OTHER field) are kept as they are, so a retry never re-uploads. `uploadOne`
 * is the transport's getMediaUploadUrl + putUpload.
 */
export async function uploadFilesWith(
  uploadOne: UploadOne,
  formId: string,
  fields: FormFieldDto[],
  values: FormValues,
): Promise<FormValues> {
  const next: FormValues = { ...values };
  for (const field of fields) {
    if (field.hidden || (field.control !== "file" && field.control !== "signature")) continue;
    const picked = ([] as unknown[]).concat(values[field.target] ?? []);
    const done: UploadedFile[] = [];
    // Sequential on purpose: a visitor's uplink is the bottleneck, and a failed file should
    // stop the submit rather than race more uploads it will throw away.
    for (const item of picked) {
      if (isUploaded(item)) done.push(item);
      else if (typeof File !== "undefined" && item instanceof File) done.push(await uploadOne(formId, item));
    }
    next[field.target] = done;
  }
  return next;
}

/** `HH:mm` → `HH:mm:ss`, `YYYY-MM-DDTHH:mm` → `…:ss`: Wix always serializes seconds (time-input-field-headless.tsx, date-time-field-utils.ts). */
export function withSeconds(value: string): string {
  return /(^|T)\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

/**
 * Turn the visitor's values into the map `createSubmission` expects, keyed by each field's
 * `target` — the same key the controls are bound to, so the keys come out right by
 * construction with no hand-maintained list to drift.
 *
 * Walks the FIELDS, not the values object: a stray key can never reach the API, and a field
 * the owner just added shows up the moment the schema does. A field hidden right now (by the
 * owner or by a rule) is left out, as Wix clears it.
 *
 * Value shapes: a flat value (text/choice/date), an ARRAY (multi-choice), an OBJECT (an
 * address, keyed by subfield — the shape behind `address/city` error paths), a LIST OF FILE
 * OBJECTS (attachments). An empty optional field is OMITTED rather than sent as "": the server
 * validates what it is given. A required empty address is sent as `{}` so the server reports
 * which subfields are missing (multiline-address-toolkit.ts normalizeEmptyValues).
 */
export function toSubmissionValues(fields: FormFieldDto[], values: FormValues): Record<string, unknown> {
  const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
  const out: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.hidden) continue;
    const raw = values?.[field.target];

    if (field.control === "address") {
      const parts: Record<string, string> = {};
      const held = (raw ?? {}) as Record<string, unknown>;
      for (const { sub } of field.addressParts) {
        if (filled(held[sub])) parts[sub] = String(held[sub]).trim();
      }
      if (Object.keys(parts).length || field.required) out[field.target] = parts;
      continue;
    }

    if (field.control === "file" || field.control === "signature") {
      // Whatever the upload produced. A stray File that never went through the upload is
      // dropped rather than sent, since it would 400 the whole form.
      const files = ([] as unknown[]).concat(raw ?? []).filter(isUploaded);
      if (files.length) out[field.target] = files;
      continue;
    }

    if (field.inputType === "ARRAY") {
      const picked = (Array.isArray(raw) ? raw : []).filter(filled);
      if (picked.length) out[field.target] = picked;
      continue;
    }

    if (field.control === "checkbox") {
      // A consent checkbox submits a boolean. Unchecked AND optional is omitted; unchecked and
      // required fails validation before it gets here.
      if (raw === true) out[field.target] = true;
      continue;
    }

    if (!filled(raw)) continue;
    const value = typeof raw === "string" ? raw.trim() : raw;
    out[field.target] =
      field.control === "number" || field.control === "rating" ? Number(value) :
      field.control === "phone" ? normalizePhone(value) :
      field.control === "url" ? normalizeUrl(value) :
      field.control === "time" || field.control === "datetime" ? withSeconds(String(value)) :
      value;
  }
  return out;
}

/**
 * The created submission as a DTO. Accepts the REST envelope (`{ submission }`) and the SDK's bare
 * entity; throws when nothing came back or the status is not one that means "created", so a
 * caller never shows a thank-you for something that is not a submission. A paid form answers
 * `PAYMENT_WAITING` with `orderDetails.checkoutId` — carried through for the checkout hand-off.
 */
export function toSubmission(created: Raw | null | undefined): SubmissionDto {
  const submission: Raw | undefined = created?.submission ?? created;
  const id: string | undefined = submission?._id ?? submission?.id;
  if (!id) throw new Error("forms: submission failed (nothing returned).");
  const status: string = submission?.status ?? "";
  if (!SUBMITTED_OK.has(status)) {
    throw new Error(
      `forms: submission status is "${status}" — not one of the statuses that mean the submission ` +
        `was created (${[...SUBMITTED_OK].join(", ")}), so do not show a success state.`,
    );
  }
  const checkoutId: string | undefined = submission?.orderDetails?.checkoutId;
  return { id, status, ...(checkoutId ? { checkoutId } : {}) };
}

/**
 * The redirect-session request that turns a checkout id into the Wix-hosted checkout URL —
 * the same call the storefront's cart uses. `origin` is the site's real https origin
 * (window.location.origin) so the checkout can send the visitor back.
 * POST /headless/v1/redirect-session  { ecomCheckout: { checkoutId }, callbacks }  → { redirectSession: { fullUrl } }
 * docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
 */
export function redirectSessionBody(checkoutId: string, origin: string): Record<string, unknown> {
  return {
    ecomCheckout: { checkoutId },
    callbacks: origin ? { postFlowUrl: `${origin}/`, thankYouPageUrl: `${origin}/` } : {},
  };
}

export function redirectSessionUrl(res: Raw | null | undefined): string {
  const url: string | undefined = res?.redirectSession?.fullUrl;
  if (!url) throw new Error("forms: checkout could not start (no redirect URL returned).");
  return url;
}

/** The `details` block of a failed call, wherever the transport left it. */
function detailsOf(err: unknown): Raw {
  const e = err as Raw;
  return e?.details ?? e?.body?.details ?? e?.response?.data?.details ?? {};
}

/** Every validation entry of a failed create, flattened out of `fieldViolations[].data.errors[]`. */
function violationEntries(err: unknown): Raw[] {
  const violations: Raw[] = detailsOf(err)?.validationError?.fieldViolations ?? [];
  return violations.flatMap((v) => (v.data?.errors ?? [v]) as Raw[]);
}

/**
 * Pull per-field violations out of a failed create, keyed by input NAME so each message lands
 * on its own control. `errorPath` is the field's `target`, or a nested path like
 * `address/subdivision` — exactly how the controls are named, so it maps straight across.
 *
 * The documented entries arrive under `details.validationError.fieldViolations[]`, each with
 * its own nested `data.errors[]` — two levels deeper than the docs' shape. This flattens that.
 * The SDK error and the REST client's WixApiError both carry that block as `details`. An entry
 * flagged `useCustomErrorMessage` carries the owner's own wording — shown verbatim, as Wix does
 * (use-submit/utils.ts getFieldCustomErrorMessages).
 *
 * Two rejections here are SEED bugs, not frontend bugs — fix them in `seed/SEED.md`, never
 * by mangling the key or the value:
 *   - UNKNOWN_VALUE_ERROR on a key that IS in the schema → the field was seeded with no
 *     `validation` block, and that block is what registers the target as an accepted value.
 *   - NOT_ALLOWED_VALUE_ERROR on a choice field → the seed's `options[].value` and its
 *     validation enum disagree; the two declarations must match.
 */
export function submissionErrors(err: unknown, fields: FormFieldDto[]): Record<string, string> {
  const byTarget = new Map(fields.map((f) => [f.target, f]));
  const out: Record<string, string> = {};

  for (const entry of violationEntries(err)) {
    const path: string | undefined = entry?.errorPath;
    if (!path) continue;
    const field = byTarget.get(path.split("/")[0]);
    if (!field) continue;
    // Wix's own errorMessage is the validator's internal wording — debug only, unless the owner wrote it.
    console.debug("forms: server violation", path, entry.errorType, entry.errorMessage);
    out[path] = entry.useCustomErrorMessage && entry.errorMessage ? String(entry.errorMessage) : messageFor(entry.errorType, field, path);
  }
  return out;
}

/**
 * The FORM-level message for a failed create that no single control owns: the form was
 * switched off or hit its limit (DISABLED_FORM_ERROR, errorPath `form.properties.disabled`), an
 * application error (`details.applicationError.code`: INVALID_CAPTCHA, FORM_NOT_FOUND,
 * SITE_IS_A_TEMPLATE, FORM_RETRIEVAL_ERROR), or an owner-worded violation with no path. Null when
 * the failure is something else — the caller shows its generic wording.
 */
export function formLevelError(err: unknown, form: FormDto | null): string | null {
  const details = detailsOf(err);
  const code: string | undefined = details?.applicationError?.code ?? (err as Raw)?.code;
  switch (code) {
    case "INVALID_CAPTCHA": return "The spam check did not pass. Please try again.";
    case "FORM_NOT_FOUND": return "This form no longer exists.";
    case "SITE_IS_A_TEMPLATE": return "This site is a template and does not accept submissions.";
    case "FORM_RETRIEVAL_ERROR": return "The form could not be loaded. Please try again.";
  }
  for (const entry of violationEntries(err)) {
    if (entry.errorType === "DISABLED_FORM_ERROR" || entry.errorPath === "form.properties.disabled") {
      return form?.disabledMessage || "This form is no longer accepting submissions.";
    }
    if (entry.useCustomErrorMessage && !entry.errorPath && entry.errorMessage) return String(entry.errorMessage);
  }
  return null;
}

/** Wix's own "this is required" copy per field kind (form-fields messages_en.json). */
export function requiredMessage(f: FormFieldDto): string {
  switch (f.identifier) {
    case "CONTACTS_FIRST_NAME": case "FULL_NAME_FIRST_NAME": return "Enter a first name.";
    case "CONTACTS_LAST_NAME": case "FULL_NAME_LAST_NAME": return "Enter a last name.";
    case "CONTACTS_COMPANY": return "Enter a company name.";
    case "CONTACTS_POSITION": return "Enter a position or job title.";
    case "CONTACTS_ADDRESS": return "Enter an address.";
    case "VAT_ID": case "CONTACTS_TAX_ID": return "Enter a VAT ID number.";
  }
  switch (f.control) {
    case "email": return "Enter an email address like example@mysite.com.";
    case "phone": return "Enter a phone number.";
    case "url": return "Enter a web URL like https://www.example.com.";
    case "number": return "Enter a number.";
    case "rating": return "Choose a star rating.";
    case "date": case "datetime": return "Choose a date.";
    case "time": return "Enter a time.";
    case "select": case "radio": case "checkboxGroup": case "tags": return "Choose an option.";
    case "checkbox": return "Check the box to continue.";
    case "file": return "Upload a file.";
    case "signature": return "Sign in the box above.";
    case "address": return "Enter an address.";
    default: return "Enter an answer.";
  }
}

/** Wix's copy for an address subfield left empty (mla-* messages). */
export function addressPartMessage(sub: string): string {
  switch (sub) {
    case "country": return "Choose a country/region.";
    case "addressLine": return "Enter an address.";
    case "addressLine2": return "Enter a second address line (e.g., apartment, suite, floor).";
    case "city": return "Enter a city.";
    case "postalCode": return "Enter a zip/postal code.";
    case "subdivision": return "Choose an option.";
    case "streetName": return "Enter a street name.";
    case "streetNumber": return "Enter a house number.";
    default: return "This field is required.";
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * errorType → visitor-facing copy in Wix's own wording (messages_en.json), written from the
 * field's schema. The same table the client check uses, so a server rejection reads like the
 * inline one.
 */
export function messageFor(errorType: string, f: FormFieldDto, path: string = f.target): string {
  const v = f.validation;
  const sub = path.includes("/") ? path.split("/")[1] : undefined;
  switch (errorType) {
    case "REQUIRED_VALUE_ERROR": return sub ? addressPartMessage(sub) : requiredMessage(f);
    case "MIN_LENGTH_ERROR": case "MAX_LENGTH_ERROR": case "CHARACTER_LENGTH_RANGE_ERROR": case "EXACT_CHARACTER_LENGTH_ERROR":
      return lengthMessage(v.minLength, v.maxLength);
    case "MIN_VALUE_ERROR": case "MAX_VALUE_ERROR": case "VALUE_RANGE_ERROR":
      if (f.identifier === "CONTACTS_BIRTHDATE") return "Enter a date from January 1, 1900 to today.";
      if (f.control === "date" || f.control === "datetime" || f.control === "time") return dateRangeMessage(v.minDate, v.maxDate);
      return rangeMessage(v.minimum, v.maximum);
    case "MULTIPLE_OF_VALUE_ERROR": case "DECIMAL_POINT_ERROR": return multipleOfMessage(v.multipleOf);
    case "MIN_ITEMS_ERROR": case "MAX_ITEMS_ERROR": case "EXACT_ITEMS_NUMBER_ERROR": return itemsMessage(v.minItems, v.maxItems);
    case "PATTERN_ERROR": case "INVALID_VALUE_FOR_PATTERN_ERROR":
      return v.patternMessage ?? (sub === "postalCode" ? "Enter a valid zip/postal code." : "Enter a valid answer.");
    case "NOT_ALLOWED_VALUE_ERROR":
      if (f.control === "checkbox") return "Check the box to continue.";
      if (f.control === "phone") return "Phone numbers with this country code aren’t accepted.";
      return "The chosen value is not allowed.";
    case "INVALID_PHONE_COUNTRY_CODE_ERROR": return "Enter a valid country code.";
    case "INCOMPLETE_DATE_ERROR": return "Enter a month, day and year.";
    case "FORMAT_ERROR":
      return f.control === "email" || v.format === "EMAIL" ? "Enter an email address like example@mysite.com."
        : f.control === "phone" || v.format === "PHONE" ? "Enter a valid phone number."
        : f.control === "url" || v.format === "URL" ? "Enter a web URL like https://www.example.com."
        : f.control === "time" ? "Enter hours and minutes."
        : f.control === "date" || f.control === "datetime" ? "Enter a month, day and year."
        : "Enter a valid answer.";
    case "TYPE_ERROR": return "Enter a valid answer.";
    // A key the server does not know for this field — for an address, a subfield the chosen
    // country's template lacks. The store sends only the country's own parts, so this is rare.
    case "UNKNOWN_VALUE_ERROR": return sub ? `${humanizeSub(sub)} isn't part of an address in this country.` : "This answer isn't accepted here.";
    // The enum grows; an unmapped type degrades to safe copy rather than showing nothing.
    default: return `Please check ${f.label}.`;
  }
}

export function lengthMessage(min?: number, max?: number): string {
  if (min && max) return min === max ? `Enter exactly ${plural(min, "character", "characters")}.` : `Enter between ${min} and ${max} characters.`;
  if (min) return `Enter at least ${plural(min, "character", "characters")}.`;
  return `Enter less than ${plural(max ?? 0, "character", "characters")}.`;
}

export function rangeMessage(min?: number, max?: number): string {
  if (min != null && max != null) return `Enter a number from ${min} to ${max}.`;
  if (min != null) return `Enter a number that is ${min} or more.`;
  return `Enter a number that is ${max} or less.`;
}

export function dateRangeMessage(min?: string, max?: string): string {
  const show = (s: string) => s.replace("T", " ");
  if (min && max) return `Choose a date from ${show(min)} to ${show(max)}.`;
  if (min) return `Choose a date from ${show(min)} on.`;
  return `Choose a date up to ${show(max ?? "")}.`;
}

export function multipleOfMessage(step?: number): string {
  const decimals = String(step ?? 1).split(".")[1]?.length ?? 0;
  return decimals ? `Add ${decimals} number(s) after the decimal point.` : step && step !== 1 ? `Choose a multiple of ${step}.` : "Enter a whole number.";
}

export function itemsMessage(min?: number, max?: number): string {
  if (min && max && min === max) return `Choose ${plural(min, "option", "options")}.`;
  if (min && max) return `Choose between ${min} and ${max} options.`;
  if (min) return `Choose at least ${plural(min, "option", "options")}.`;
  return `Choose up to ${plural(max ?? 0, "option", "options")}.`;
}
