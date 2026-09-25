// Submissions over REST — the twin of app/wix/forms/submissions.ts. Same exports, same
// SubmissionDto; the rules come from submissions-core (the SAME file the SDK transport uses,
// deployed flat next to this one). Both calls run with the visitor token: `CreateSubmission` is
// listed under an owner scope and still returns 200 to an anonymous visitor, so a published site
// can submit its own forms. Submissions are write-only from a visitor — the resolved create IS
// the confirmation. A rejection throws a WixApiError whose `details` block `submissionErrors`
// maps onto the controls; let it throw.
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/create-submission.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/get-media-upload-url.md
import { wixRequest } from "./client.js";
import type { Raw } from "./forms-core.js";
import {
  SUBMITTED_OK,
  normalizePhone,
  putUpload,
  submissionErrors,
  toSubmission,
  toSubmissionValues,
  uploadFilesWith,
  uploadMimeType,
} from "./submissions-core.js";
import type { FormFieldDto, FormValues, SubmissionDto } from "./types.js";

export { SUBMITTED_OK, normalizePhone, submissionErrors, toSubmissionValues };

const SUBMISSIONS = "/form-submission-service/v4/submissions";

/**
 * Upload one File and return the value to submit for its field (the upload URL itself).
 * POST /form-submission-service/v4/submissions/media-upload-url  { formId, filename, mimeType }  → { uploadUrl }
 * then PUT the bytes to that URL with plain fetch (submissions-core.putUpload).
 */
export async function uploadFile(formId: string, file: File): Promise<string> {
  const mimeType = uploadMimeType(file);
  const res = await wixRequest<Raw>(`${SUBMISSIONS}/media-upload-url`, { body: { formId, filename: file.name, mimeType } });
  const uploadUrl: string | undefined = res?.uploadUrl;
  if (!uploadUrl) throw new Error(`forms: no upload URL for "${file.name}".`);
  return putUpload(uploadUrl, file, mimeType);
}

/** Upload every File in the form's values; returns a copy with each file field holding its URL(s). */
export async function uploadFiles(formId: string, fields: FormFieldDto[], values: FormValues): Promise<FormValues> {
  return uploadFilesWith(uploadFile, formId, fields, values);
}

/**
 * Create the submission — the write, and the only confirmation there is. `values` is
 * toSubmissionValues(fields, values): every key a field `target`, every value in that field's
 * shape. A 400 carries details.validationError.fieldViolations[].data.errors[] (errorPath,
 * errorType) on the thrown WixApiError.
 * POST /form-submission-service/v4/submissions  { submission: { formId, submissions } }  → { submission: { id, status, … } }
 */
export async function createSubmission(formId: string, values: Record<string, unknown>): Promise<SubmissionDto> {
  const created = await wixRequest<Raw>(SUBMISSIONS, { body: { submission: { formId, submissions: values } } });
  return toSubmission(created);
}
