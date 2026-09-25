// Wix Forms schema reads — the only file that touches a raw Form on this transport. Returns flat
// FormDto / FormFieldDto from ./types. The flattening rules live in ./forms-core (shared with the
// REST twin in references/forms/rest/); this file is the transport only. Copy as-is; extend by
// adding functions.
//
// The reads go over `wixFetch` (the SDK's own authenticated fetch), NOT the `forms` module of
// @wix/forms: that generated module is 15 MB. Bundled server-side it pushes a Wix deploy past its
// size limit (HTTP 413 on release); bundled client-side every visitor downloads it. The
// submissions module (./submissions.ts) is 100 KB and stays on the SDK.
//
// The visitor token is enough, and the spec says otherwise. Every schema read is listed under
// the owner scope `SCOPE.FORMS.VIEW-FORM`, and returns 200 on an anonymous visitor: Wix grants
// implicit visitor access so a published site can render its own forms. Do NOT add a backend, a
// connector token, or auth.elevate to make a form load.
//
// docs: https://dev.wix.com/docs/sdk/business-solutions/forms/forms/get-form.md
// docs: https://dev.wix.com/docs/sdk/business-solutions/forms/forms/list-forms.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields.md
import { wixFetch } from "../sdk";
import { FORMS_NAMESPACE, toForm, type Raw } from "./forms-core";
import type { FormDto } from "./types";

export { FORMS_NAMESPACE };

async function getJson(path: string): Promise<Raw> {
  const res = await wixFetch(path);
  if (!res.ok) throw new Error(`forms: GET ${path} failed (${res.status}).`);
  return (await res.json()) as Raw;
}

/**
 * Read one form by id. Throws when the id is wrong or the form was deleted — a form that
 * cannot load is a setup problem, so fail loudly rather than rendering a hand-built fallback
 * that would drop real enquiries silently.
 */
export async function getForm(formId: string): Promise<FormDto> {
  // GET /form-schema-service/v4/forms/{formId} → { form }; 404 FORM_NOT_FOUND on a wrong id.
  const res = await getJson(`/form-schema-service/v4/forms/${encodeURIComponent(formId)}`);
  if (!res?.form) throw new Error(`forms: form "${formId}" not found.`);
  return toForm(res.form as Raw);
}

/**
 * Every form on the site, in the Wix Forms namespace. Use ONE call for several forms on a page
 * rather than a getForm each.
 *
 * Returns only ENABLED forms — a form the owner disabled vanishes from the listing rather
 * than erroring. That is usually right for a public site.
 */
export async function listForms(): Promise<FormDto[]> {
  // GET /form-schema-service/v4/forms?namespace=… → { forms }; the namespace is required (400 without).
  const res = await getJson(`/form-schema-service/v4/forms?namespace=${encodeURIComponent(FORMS_NAMESPACE)}`);
  return ((res?.forms ?? []) as Raw[]).map(toForm);
}
