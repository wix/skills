// Wix Forms submissions (@wix/forms `submissions`) — build the submission from the visitor's
// values, upload any attachments, create it, and turn a rejection into per-control messages.
// Copy as-is; extend by adding functions.
//
// ⚠️ The visitor token creates the submission, despite the spec. `CreateSubmission` is listed
// under the owner scope `SCOPE.DC-FORMS.MANAGE-SUBMISSIONS` and returns 200 on an anonymous
// visitor: Wix grants implicit visitor access so a published site can submit its own forms.
// Reaching for a backend here is the most common wrong turn on this vertical.
//
// ⚠️ SUBMISSIONS ARE WRITE-ONLY FROM A VISITOR. Reading them back genuinely requires the owner
// scope and 403s. The resolved create IS the confirmation — show a thank-you; the entry appears
// in the owner's dashboard. A site that must LIST what visitors submitted needs `cms` instead.
//
// docs: https://dev.wix.com/docs/sdk/business-solutions/forms/submissions/create-submission.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values.md
import { submissions as submissionsModule } from "@wix/forms";
import { wixModule } from "../sdk";
import type { FormFieldDto, FormValues, SubmissionDto } from "./types";

const submissions = wixModule(submissionsModule);

type Raw = Record<string, any>;

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

/**
 * Upload one File and return the value to submit for its field.
 *
 * ⚠️ The submission value IS the generated upload URL — not the CDN URL the upload responds
 * with, and not a file id. Get the URL, PUT the bytes to it, then send that same URL as the
 * field's value.
 *
 * The PUT goes to a pre-signed host with plain `fetch`, never through the SDK: adding the
 * visitor's Authorization header to a pre-signed URL turns a working upload into a 400.
 */
export async function uploadFile(formId: string, file: File): Promise<string> {
  // A browser leaves `type` empty for extensions it does not recognize; the generic type keeps
  // the upload-URL call valid (Media Manager rejects a mime type that contradicts the extension).
  const mimeType = file.type || "application/octet-stream";
  const res = (await submissions.getMediaUploadUrl(formId, file.name, mimeType)) as Raw;
  const uploadUrl: string | undefined = res?.uploadUrl ?? res?.url;
  if (!uploadUrl) throw new Error(`forms: no upload URL for "${file.name}".`);
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
 * rejected some OTHER field) are kept as they are, so a retry never re-uploads.
 */
export async function uploadFiles(
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
      else if (typeof File !== "undefined" && item instanceof File) done.push(await uploadFile(formId, item));
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
      // Whatever `uploadFiles` produced. A stray File that never went through the upload is
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
 * Create the submission. This is the write — and the only confirmation there is.
 *
 * ⚠️ Let a rejection throw. `submissionErrors` below turns it into per-control messages; a
 * `.catch` that swallows it costs the visitor the reason their form would not send.
 */
export async function createSubmission(
  formId: string,
  values: Record<string, unknown>,
): Promise<SubmissionDto> {
  const created = (await submissions.createSubmission({ formId, submissions: values })) as Raw;
  const submission = created?.submission ?? created;
  const id: string | undefined = submission?._id ?? submission?.id;
  if (!id) throw new Error("forms: submission failed (nothing returned).");
  const status: string = submission.status ?? "";
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
 *
 * ⚠️ Two rejections here are SEED bugs, not frontend bugs — fix them in `seed/SEED.md`, never
 * by mangling the key or the value:
 *   • UNKNOWN_VALUE_ERROR on a key that IS in the schema → the field was seeded with no
 *     `validation` block, and that block is what registers the target as an accepted value.
 *   • NOT_ALLOWED_VALUE_ERROR on a choice field → the seed's `options[].value` and its
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
function messageFor(errorType: string, f: FormFieldDto): string {
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
