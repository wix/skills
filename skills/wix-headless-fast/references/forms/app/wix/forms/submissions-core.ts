// Submission rules — transport-agnostic, imported by BOTH transports: ./submissions.ts (the SDK)
// and the REST twin in references/forms/rest/submissions.ts. What a visitor's values become on
// the wire, which statuses mean "created", how a rejection maps back onto controls, and how an
// attachment is uploaded — all HERE, once. A created submission may arrive wrapped (`{ submission }`,
// REST) or bare (SDK), with `_id` (SDK) or `id` (REST); the mapper accepts both.
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values.md
import type { Raw } from "./forms-core";
import type { FormFieldDto, FormValues, SubmissionDto } from "./types";

/**
 * Statuses that mean the submission EXISTS — show the thank-you for all three. `CONFIRMED` is
 * recorded, `PENDING` is created but not recorded yet, `PAYMENT_WAITING` is created on a form
 * that also collects payment. Treating one as a failure invites the visitor to submit again,
 * which costs the owner duplicate entries for a submission that already exists.
 *
 * An allowlist rather than a catch-all, so a status added to the enum later cannot silently
 * render a thank-you for something that is not a submission.
 */
export const SUBMITTED_OK = new Set(["CONFIRMED", "PENDING", "PAYMENT_WAITING"]);

/** Strip visitor-added formatting from a phone number — submit this, not the raw control text. */
export const normalizePhone = (v: unknown): string => String(v ?? "").replace(/[\s()\-.]/g, "");

/** Uploads a File to a pre-signed URL and resolves to the value to submit for its field. */
export type UploadOne = (formId: string, file: File) => Promise<string>;

/**
 * A browser leaves `type` empty for extensions it does not recognize; the generic type keeps
 * the upload-URL call valid (Media Manager rejects a mime type that contradicts the extension).
 */
export const uploadMimeType = (file: File): string => file.type || "application/octet-stream";

/**
 * PUT the bytes to the generated upload URL and return the value to submit for the field.
 *
 * The submission value IS the generated upload URL — not the CDN URL the upload responds with,
 * and not a file id. The PUT goes to a pre-signed host with plain `fetch`, never through the SDK
 * or the REST client: adding the visitor's Authorization header to a pre-signed URL turns a
 * working upload into a 400.
 */
export async function putUpload(uploadUrl: string, file: File, mimeType: string = uploadMimeType(file)): Promise<string> {
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
  return uploadUrl;
}

/**
 * Upload every File sitting in the form's values and return a copy with each file field
 * replaced by its uploaded URL(s). Values already holding URLs (a retry after the server
 * rejected some OTHER field) are kept as they are, so a retry never re-uploads. `uploadOne` is
 * the transport's getMediaUploadUrl + putUpload.
 */
export async function uploadFilesWith(
  uploadOne: UploadOne,
  formId: string,
  fields: FormFieldDto[],
  values: FormValues,
): Promise<FormValues> {
  const next: FormValues = { ...values };
  for (const field of fields) {
    if (field.control !== "file" && field.control !== "signature") continue;
    const picked = ([] as unknown[]).concat(values[field.target] ?? []);
    const done: string[] = [];
    // Sequential on purpose: a visitor's uplink is the bottleneck, and a failed file should
    // stop the submit rather than race more uploads it will throw away.
    for (const item of picked) {
      if (typeof item === "string" && item) done.push(item);
      else if (typeof File !== "undefined" && item instanceof File) done.push(await uploadOne(formId, item));
    }
    next[field.target] = done;
  }
  return next;
}

/**
 * Turn the visitor's values into the map `createSubmission` expects, keyed by each field's
 * `target` — the same key the controls are bound to, so the keys come out right by
 * construction with no hand-maintained list to drift.
 *
 * Walks the FIELDS, not the values object: a stray key can never reach the API, and a field
 * the owner just added shows up the moment the schema does.
 *
 * Three value shapes: a flat value (text/choice/date), an ARRAY (multi-choice, several files),
 * an OBJECT (an address, keyed by subfield — the shape behind `address/city` error paths). An
 * empty optional field is OMITTED rather than sent as "": the server validates what it is given.
 */
export function toSubmissionValues(fields: FormFieldDto[], values: FormValues): Record<string, unknown> {
  const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
  const out: Record<string, unknown> = {};

  for (const field of fields) {
    const raw = values?.[field.target];

    if (field.control === "address") {
      const parts: Record<string, string> = {};
      const held = (raw ?? {}) as Record<string, unknown>;
      for (const { sub } of field.addressParts) {
        if (filled(held[sub])) parts[sub] = String(held[sub]).trim();
      }
      if (Object.keys(parts).length) out[field.target] = parts;
      continue;
    }

    if (field.control === "file" || field.control === "signature") {
      // Whatever the upload produced. A stray File that never went through the upload is
      // dropped rather than sent, since it would 400 the whole form.
      const urls = ([] as unknown[]).concat(raw ?? []).filter((v): v is string => typeof v === "string" && !!v);
      if (urls.length) out[field.target] = urls.length === 1 ? urls[0] : urls;
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
      value;
  }
  return out;
}

/**
 * The created submission as a DTO. Accepts the REST envelope (`{ submission }`) and the SDK's bare
 * entity; throws when nothing came back or the status is not one that means "created", so a
 * caller never shows a thank-you for something that is not a submission.
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
  return { id, status };
}

/**
 * Pull per-field violations out of a failed create, keyed by input NAME so each message lands
 * on its own control. `errorPath` is the field's `target`, or a nested path like
 * `address/subdivision` — exactly how the controls are named, so it maps straight across.
 *
 * The documented entries arrive under `details.validationError.fieldViolations[]`, each with
 * its own nested `data.errors[]` — two levels deeper than the docs' shape. This flattens that.
 * The SDK error and the REST client's WixApiError both carry that block as `details`.
 *
 * Two rejections here are SEED bugs, not frontend bugs — fix them in `seed/SEED.md`, never
 * by mangling the key or the value:
 *   - UNKNOWN_VALUE_ERROR on a key that IS in the schema → the field was seeded with no
 *     `validation` block, and that block is what registers the target as an accepted value.
 *   - NOT_ALLOWED_VALUE_ERROR on a choice field → the seed's `options[].value` and its
 *     validation enum disagree; the two declarations must match.
 */
export function submissionErrors(err: unknown, fields: FormFieldDto[]): Record<string, string> {
  const body = (err as Raw)?.details ?? (err as Raw)?.body?.details ?? {};
  const violations: Raw[] = body?.validationError?.fieldViolations ?? [];
  const byTarget = new Map(fields.map((f) => [f.target, f]));
  const out: Record<string, string> = {};

  for (const entry of violations.flatMap((v) => v.data?.errors ?? [v])) {
    const path: string | undefined = entry?.errorPath;
    if (!path) continue;
    const field = byTarget.get(path.split("/")[0]);
    if (!field) continue;
    // Wix's own errorMessage is the validator's internal wording — debug only.
    console.debug("forms: server violation", path, entry.errorType, entry.errorMessage);
    out[path] = messageFor(entry.errorType, field);
  }
  return out;
}

/** errorType → visitor-facing copy, written from the field's own schema. */
export function messageFor(errorType: string, f: FormFieldDto): string {
  const v = f.validation;
  switch (errorType) {
    case "REQUIRED_VALUE_ERROR": return `${f.label} is required.`;
    case "MIN_LENGTH_ERROR": return `${f.label} must be at least ${v.minLength} characters.`;
    case "MAX_LENGTH_ERROR": return `${f.label} must be at most ${v.maxLength} characters.`;
    case "MIN_VALUE_ERROR": return `${f.label} must be ${v.minimum ?? "higher"} or more.`;
    case "MAX_VALUE_ERROR": return `${f.label} must be ${v.maximum ?? "lower"} or less.`;
    case "PATTERN_ERROR": return `${f.label} is not in the expected format.`;
    case "NOT_ALLOWED_VALUE_ERROR": return `Choose one of the listed options for ${f.label}.`;
    case "FORMAT_ERROR":
      return v.format === "EMAIL" ? "Enter a valid email address."
        : v.format === "PHONE" ? "Use international format, starting with +."
        : v.format === "URL" ? "Enter a full URL starting with https://"
        : `Please check ${f.label}.`;
    // The enum grows: MIN/MAX_ITEMS_ERROR and DISABLED_FORM_ERROR are reachable without being
    // listed, so an unmapped type degrades to safe copy rather than showing nothing.
    default: return `Please check ${f.label}.`;
  }
}
