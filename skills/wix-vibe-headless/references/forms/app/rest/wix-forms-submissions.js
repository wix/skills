import { wixApiRequest } from "./wix-client.js";
import { normalizePhone } from "./wix-forms.js";
import { targetOf, inputTypeOf, isMulti, isFile, isAddress, addressPartsOf, validationOf } from "@/lib/wix-form-schema-utils";

/**
 * Wix Forms — the SUBMISSION: turn the form's values into the shape the API expects, create the
 * submission, and map the server's per-field violations back onto controls. Same plain anonymous
 * visitor token as the schema read in `wix-forms.js` — no SDK, no backend, no elevate.
 *
 * ⚠️ CRITICAL — the visitor token creates the submission, despite the spec. `CreateSubmission` is
 * listed under the owner scope `SCOPE.DC-FORMS.MANAGE-SUBMISSIONS`, and in practice returns 200 on
 * an anonymous visitor token: Wix grants implicit visitor access so a published site can submit its
 * own forms. Reaching for a backend here is the most common wrong turn on this vertical.
 *
 * ⚠️ SUBMISSIONS ARE WRITE-ONLY FROM THE BROWSER. Reading them back
 * (`querySubmissionsByNamespace`, `getSubmission`, `countSubmission`) genuinely requires the owner
 * scope `WIX_FORMS.SUBMISSION_READ_ANY` and 403s for a visitor. The resolved `createSubmission`
 * promise IS the success signal — show a thank-you; the submission appears in the owner's dashboard.
 * A site that must LIST what visitors submitted needs the `cms` vertical instead.
 *
 * Submit values: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values.md
 * Upload URL:    https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/get-media-upload-url.md
 * Create:        https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/create-submission.md
 */

/**
 * Submission statuses that mean the submission EXISTS — show the thank-you. `CONFIRMED` is recorded,
 * `PENDING` is created but not recorded yet, and `PAYMENT_WAITING` is created on a form that also
 * collects payment. See `createSubmission` for why this is an allowlist rather than a catch-all.
 */
export const SUBMITTED_OK = new Set(["CONFIRMED", "PENDING", "PAYMENT_WAITING"]);

/**
 * Get a signed URL to upload one file for a form submission — the FORMS-scoped wrapper around the
 * Media Manager's upload URL, so a visitor can attach a file without the Manage-Media credential a
 * direct `site-media` call would demand (that one 403s for a visitor; this one is listed under the
 * same `SCOPE.FORMS.VIEW-FORM` as the schema read).
 * Reference: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/get-media-upload-url.md
 *
 * @param {string} formId
 * @param {string} filename  Including the extension — Wix reads the type from it.
 * @param {string} mimeType  e.g. "image/png". A browser gives you `file.type`.
 * @returns {Promise<string>}  The signed upload URL.
 */
export async function getMediaUploadUrl(formId, filename, mimeType) {
  const res = await wixApiRequest("/form-submission-service/v4/submissions/media-upload-url", {
    method: "POST",
    body: { formId, filename, mimeType },
  });
  if (!res?.uploadUrl) throw new Error(`Could not get an upload URL for "${filename}".`);
  return res.uploadUrl;
}

/**
 * Upload one `File` and return the value to submit for its field.
 *
 * ⚠️ The submission value IS the generated `uploadUrl` — not the CDN URL the upload responds with,
 * and not a file id. That's Wix's own contract (see the "media file" example on Create Submission
 * and the "Submit a form with media" sample flow): get the URL, PUT the bytes to it, then send that
 * same URL as the field's value.
 *
 * The PUT goes straight to Wix's upload host on a signed URL, so it uses plain `fetch` — NOT
 * `wixApiRequest`: adding the visitor's Authorization header to a pre-signed URL is what turns a
 * working upload into a 400.
 *
 * @param {string} formId
 * @param {File} file  From an `<input type="file">`.
 * @returns {Promise<string>}  The value to put in the submission for this field.
 */
export async function uploadSubmissionFile(formId, file) {
  // A browser leaves `type` empty for extensions it doesn't recognize; the generic type keeps the
  // upload-URL call valid (Media Manager rejects a mime type that contradicts the extension).
  const mimeType = file.type || "application/octet-stream";
  const uploadUrl = await getMediaUploadUrl(formId, file.name, mimeType);
  const res = await fetch(`${uploadUrl}?filename=${encodeURIComponent(file.name)}`, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: file,
  });
  if (!res.ok) {
    // Media Manager's own codes land here: FILE_SIZE_OVER_LIMIT, UNSUPPORTED_FILE_FORMAT,
    // MISMATCH_MIME_TYPE, ZERO_FILE_SIZE, SITE_QUOTA_EXCEEDED.
    throw new Error(`Could not upload "${file.name}" (${res.status}). Check its size and file type.`);
  }
  return uploadUrl;
}

/**
 * Upload every `File` sitting in the form's state and return a copy of `values` with each file
 * field replaced by its submitted value(s). Run this BEFORE `toSubmissionValues` — a `File` object
 * is not something the submission API accepts.
 *
 * @param {string} formId
 * @param {object[]} fields  The render model.
 * @param {Record<string, unknown>} values
 * @returns {Promise<Record<string, unknown>>}
 */
export async function uploadFormFiles(formId, fields, values) {
  const next = { ...values };
  for (const field of fields) {
    if (!isFile(field)) continue;
    const target = targetOf(field);
    const picked = [].concat(values[target] ?? []).filter((f) => f instanceof File);
    const uploaded = [];
    // Sequential on purpose: a visitor's uplink is the bottleneck, and a failed file should stop
    // the submit rather than race three more uploads it will throw away.
    for (const file of picked) uploaded.push(await uploadSubmissionFile(formId, file));
    next[target] = uploaded;
  }
  return next;
}

/**
 * Turn the form's state into the `submissions` map `createSubmission` expects — keyed by each
 * field's `target`, which is the same key the controls are bound to, so the keys come out right by
 * construction with no hand-maintained list to drift.
 *
 * Walks the SCHEMA, not the state object: a stray key in `values` can never reach the API, and a
 * field the owner added shows up the moment the schema does.
 *
 * The three value shapes and their per-`inputType` rules
 * (https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values.md):
 *   • flat value  — text / dropdown / radio / date / time. NUMBER submits a number and PHONE the
 *                   normalized E.164 string, never the raw control text.
 *   • ARRAY       — a multi-choice field, holding the checked option values.
 *   • OBJECT      — an ADDRESS, keyed by subfield (`city`, `country`, …), which is also the shape
 *                   behind the server's nested `address/city` error paths.
 * An empty optional field is OMITTED rather than sent as "" — the server validates what it's given.
 *
 * @param {object[]} fields  The render model, from `hooks/useWixForm.js`.
 * @param {Record<string, unknown>} values  The form's state, keyed by `target`.
 * @returns {Record<string, unknown>}
 */
export function toSubmissionValues(fields, values) {
  const filled = (v) => v !== undefined && v !== null && String(v).trim() !== "";
  const out = {};
  for (const field of fields) {
    const target = targetOf(field);
    const raw = values?.[target];

    if (isAddress(field)) {
      const parts = {};
      for (const { sub } of addressPartsOf(field)) {
        if (filled(raw?.[sub])) parts[sub] = String(raw[sub]).trim();
      }
      if (Object.keys(parts).length) out[target] = parts;
      continue;
    }

    if (isMulti(field)) {
      const picked = (Array.isArray(raw) ? raw : []).filter(filled);
      if (picked.length) out[target] = picked;
      continue;
    }

    // A file field carries what `uploadFormFiles` produced — the upload URL(s). One file submits the
    // bare string (the shape Wix's own example uses); several submit an array. A stray `File` that
    // never went through the upload is dropped rather than sent, since it would 400 the whole form.
    if (isFile(field)) {
      const urls = [].concat(raw ?? []).filter((v) => typeof v === "string" && v);
      if (urls.length) out[target] = urls.length === 1 ? urls[0] : urls;
      continue;
    }

    if (!filled(raw)) continue;
    const value = typeof raw === "string" ? raw.trim() : raw;
    out[target] =
      inputTypeOf(field) === "NUMBER" ? Number(value) :
      validationOf(field).format === "PHONE" ? normalizePhone(value) : value;
  }
  return out;
}

/**
 * Create a submission. This is the write — and the ONLY confirmation you get, since a visitor can't
 * read submissions back.
 * Reference: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/create-submission.md
 *
 * ⚠️ EVERY status this resolves on is a created submission — `CONFIRMED` (recorded), `PENDING`
 * (created, not recorded yet) and `PAYMENT_WAITING` (created on a form that also collects payment).
 * Show the thank-you for all three. Treating one as a failure invites the visitor to submit again,
 * which costs the owner duplicate entries for a submission that already exists.
 *
 * `PAYMENT_WAITING` still leaves the visitor a payment step, but the SUBMIT succeeded — surface the
 * payment inside the success state, never as a failed submission. A form only reaches this status if
 * the UI rendered a PAYMENT field, so read the returned `status` when you build one.
 * Success stays an ALLOWLIST rather than a catch-all, so a status added to the enum later can't
 * silently render a thank-you for something that isn't a submission.
 *
 * ⚠️ REST returns `submission.id` — the SDK's normalized `_id` does not exist here.
 *
 * @param {string} formId
 * @param {Record<string, unknown>} values  Map of `target` → value, from `toSubmissionValues`.
 * @returns {Promise<{ id: string, status: string }>}
 */
export async function createSubmission(formId, values) {
  const res = await wixApiRequest("/form-submission-service/v4/submissions", {
    method: "POST",
    body: { submission: { formId, submissions: values } },
  });
  const submission = res?.submission;
  if (!submission?.id) throw new Error("Submission failed (no submission returned).");
  if (!SUBMITTED_OK.has(submission.status)) {
    throw new Error(
      `Submission status is "${submission.status}" — not one of the statuses that mean the ` +
        `submission was created (${[...SUBMITTED_OK].join(", ")}), so don't show a success state. ` +
        `Check the Submission status docs before adding it to SUBMITTED_OK.`,
    );
  }
  return { id: submission.id, status: submission.status };
}

/**
 * Pull the per-field violations out of a failed `createSubmission`.
 *
 * The documented entries (`errorPath`, `errorType`, `errorMessage`, `params`) arrive under
 * `details.validationError.fieldViolations[]`, each with its own nested `data.errors[]` array —
 * two levels deeper than the docs' shape. This flattens that; turning a violation into words a
 * visitor should read is the UI's job (`mapSubmissionErrors` in `hooks/useWixForm.js`).
 *
 * `errorPath` is the field's `target`, or a nested path like `address/subdivision` or
 * `attachments/0/fileId` — which is exactly how the controls are named, so it maps straight across.
 *
 * Reference: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/introduction#validation-errors
 *
 * @param {Error & { body?: object }} err  From `createSubmission`; the REST body is on `err.body`.
 * @returns {{ errorPath: string, errorType: string, errorMessage?: string }[]}  Empty when the
 *   failure wasn't a validation error at all (a network drop, a 500).
 */
export function submissionViolations(err) {
  const violations =
    err?.body?.details?.validationError?.fieldViolations ??
    err?.details?.validationError?.fieldViolations ??
    [];
  return violations
    .flatMap((violation) => violation.data?.errors ?? [violation])
    .filter((entry) => entry?.errorPath);
}
