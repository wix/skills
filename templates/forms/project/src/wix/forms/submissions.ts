// Wix Forms submissions (@wix/forms `submissions`) over the SDK — get an upload URL, create the
// submission, start the checkout a paid form needs. The rules (value shapes, accepted statuses,
// violation mapping, the upload PUT, the redirect-session body) live in ./submissions-core (shared
// with the REST twin in templates/forms/rest/); this file is the transport only. Copy as-is; extend
// by adding functions.
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
// docs: https://dev.wix.com/docs/sdk/business-solutions/forms/submissions/get-media-upload-url.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values.md
// docs: https://dev.wix.com/docs/api-reference/business-management/headless/redirects/create-redirect-session.md
import { submissions as submissionsModule } from "@wix/forms";
import { wixFetch, wixModule } from "../sdk";
import type { Raw } from "./forms-core";
import {
  SUBMITTED_OK,
  formLevelError,
  normalizePhone,
  normalizeUrl,
  putUpload,
  redirectSessionBody,
  redirectSessionUrl,
  submissionErrors,
  toSubmission,
  toSubmissionValues,
  uploadFilesWith,
  uploadMimeType,
} from "./submissions-core";
import type { FormFieldDto, FormValues, SubmissionDto, UploadedFile } from "./types";

export { SUBMITTED_OK, formLevelError, normalizePhone, normalizeUrl, submissionErrors, toSubmissionValues };

const submissions = wixModule(submissionsModule);

/** Upload one File and return the value to submit for its field ({ fileId, displayName, fileType, url }). */
export async function uploadFile(formId: string, file: File): Promise<UploadedFile> {
  const mimeType = uploadMimeType(file);
  const res = (await submissions.getMediaUploadUrl(formId, file.name, mimeType)) as Raw;
  const uploadUrl: string | undefined = res?.uploadUrl ?? res?.url;
  if (!uploadUrl) throw new Error(`forms: no upload URL for "${file.name}".`);
  return putUpload(uploadUrl, file, mimeType);
}

/** Upload every File in the form's values; returns a copy with each file field holding its uploaded entries. */
export async function uploadFiles(formId: string, fields: FormFieldDto[], values: FormValues): Promise<FormValues> {
  return uploadFilesWith(uploadFile, formId, fields, values);
}

export interface CreateSubmissionOptions {
  /** A captcha token when the site runs a captcha widget; the server answers INVALID_CAPTCHA when it wants one and got none. */
  captchaToken?: string;
}

/**
 * Create the submission. This is the write — and the only confirmation there is.
 *
 * Let a rejection throw. `submissionErrors` turns it into per-control messages and
 * `formLevelError` into the form-level one; a `.catch` that swallows it costs the visitor the
 * reason their form would not send.
 */
export async function createSubmission(
  formId: string,
  values: Record<string, unknown>,
  { captchaToken }: CreateSubmissionOptions = {},
): Promise<SubmissionDto> {
  const created = (await submissions.createSubmission(
    { formId, submissions: values },
    captchaToken ? { captchaToken } : {},
  )) as Raw;
  return toSubmission(created);
}

/**
 * The Wix-hosted checkout for a `PAYMENT_WAITING` submission — navigate the FULL document to the
 * URL. Call from the browser: the return origin must be the site's real https origin
 * (window.location.origin), never a server-derived request origin. Over wixFetch rather than the
 * @wix/redirects module so this vertical adds no dependency.
 */
export async function checkoutUrl(checkoutId: string, origin: string = typeof window !== "undefined" ? window.location.origin : ""): Promise<string> {
  const res = await wixFetch("/headless/v1/redirect-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(redirectSessionBody(checkoutId, origin)),
  });
  if (!res.ok) throw new Error(`forms: checkout could not start (${res.status}).`);
  return redirectSessionUrl((await res.json()) as Raw);
}
