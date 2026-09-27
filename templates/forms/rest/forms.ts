// Form-schema reads over REST — the twin of app/wix/forms/forms.ts. Same exports, same FormDto; the
// flattening rules come from forms-core (the SAME file the SDK transport uses, deployed flat next
// to this one by deploy.mjs --stack static), so this file is only the transport: one fetch per
// function. Both calls run with the visitor token — the schema read is listed under an owner scope
// and still returns 200 to an anonymous visitor, so a published site can render its own forms.
// Porting: keep the paths, keep the query, port the core once.
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/list-forms.md
import { wixRequest } from "./client.js";
import { FORMS_NAMESPACE, toForm, type Raw } from "./forms-core.js";
import type { FormDto } from "./types.js";

export { FORMS_NAMESPACE };

/**
 * One form by id. Throws (a WixApiError, 404 FORM_NOT_FOUND) when the id is wrong or the form was
 * deleted — a form that cannot load is a setup problem; never render a hand-built fallback.
 * GET /form-schema-service/v4/forms/{formId}  → { form }
 */
export async function getForm(formId: string): Promise<FormDto> {
  const res = await wixRequest<Raw>(`/form-schema-service/v4/forms/${encodeURIComponent(formId)}`, { method: "GET" });
  if (!res?.form) throw new Error(`forms: form "${formId}" not found.`);
  return toForm(res.form);
}

/**
 * Every ENABLED form in the Wix Forms namespace (a disabled form vanishes from the listing rather
 * than erroring). `namespace` is required — without it the call is a 400.
 * GET /form-schema-service/v4/forms?namespace=wix.form_app.form  → { forms, pagingMetadata }
 */
export async function listForms(): Promise<FormDto[]> {
  const res = await wixRequest<Raw>("/form-schema-service/v4/forms", { method: "GET", query: { namespace: FORMS_NAMESPACE } });
  return ((res?.forms ?? []) as Raw[]).map(toForm);
}
