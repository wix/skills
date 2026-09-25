// Wix Forms submissions (@wix/forms `submissions`) over the SDK — get an upload URL, create the
// submission. The rules (value shapes, accepted statuses, violation mapping, the upload PUT) live
// in ./submissions-core (shared with the REST twin in references/forms/rest/); this file is the
// transport only. Copy as-is; extend by adding functions.
//
// The visitor token creates the submission, despite the spec. `CreateSubmission` is listed under
// the owner scope `SCOPE.DC-FORMS.MANAGE-SUBMISSIONS` and returns 200 on an anonymous visitor: Wix
// grants implicit visitor access so a published site can submit its own forms. Reaching for a
// backend here is the most common wrong turn on this vertical.
//
// SUBMISSIONS ARE WRITE-ONLY FROM A VISITOR. Reading them back genuinely requires the owner
// scope and 403s. The resolved create IS the confirmation — show a thank-you; the entry appears
// in the owner's dashboard. A site that must LIST what visitors submitted needs `cms` instead.
//
// docs: https://dev.wix.com/docs/sdk/business-solutions/forms/submissions/create-submission.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values.md
import { submissions as submissionsModule } from "@wix/forms";
import { wixModule } from "../sdk";
import type { Raw } from "./forms-core";
import {
  SUBMITTED_OK,
  normalizePhone,
  putUpload,
  submissionErrors,
  toSubmission,
  toSubmissionValues,
  uploadFilesWith,
  uploadMimeType,
} from "./submissions-core";
import type { FormFieldDto, FormValues, SubmissionDto } from "./types";

export { SUBMITTED_OK, normalizePhone, submissionErrors, toSubmissionValues };

const submissions = wixModule(submissionsModule);

/** Upload one File and return the value to submit for its field (the upload URL itself). */
export async function uploadFile(formId: string, file: File): Promise<string> {
  const mimeType = uploadMimeType(file);
  const res = (await submissions.getMediaUploadUrl(formId, file.name, mimeType)) as Raw;
  const uploadUrl: string | undefined = res?.uploadUrl ?? res?.url;
  if (!uploadUrl) throw new Error(`forms: no upload URL for "${file.name}".`);
  return putUpload(uploadUrl, file, mimeType);
}

/** Upload every File in the form's values; returns a copy with each file field holding its URL(s). */
export async function uploadFiles(formId: string, fields: FormFieldDto[], values: FormValues): Promise<FormValues> {
  return uploadFilesWith(uploadFile, formId, fields, values);
}

/**
 * Create the submission. This is the write — and the only confirmation there is.
 *
 * Let a rejection throw. `submissionErrors` turns it into per-control messages; a `.catch`
 * that swallows it costs the visitor the reason their form would not send.
 */
export async function createSubmission(formId: string, values: Record<string, unknown>): Promise<SubmissionDto> {
  const created = (await submissions.createSubmission({ formId, submissions: values })) as Raw;
  return toSubmission(created);
}
