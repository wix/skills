// Wix Forms schema reads (@wix/forms `forms`) over the SDK — the only file that touches a raw
// Form on this transport. Returns flat FormDto / FormFieldDto from ./types. The flattening rules
// live in ./forms-core (shared with the REST twin in references/forms/rest/); this file is the
// transport only. Copy as-is; extend by adding functions.
//
// The visitor token is enough, and the spec says otherwise. Every schema read is listed under
// the owner scope `SCOPE.FORMS.VIEW-FORM`, and returns 200 on an anonymous visitor: Wix grants
// implicit visitor access so a published site can render its own forms. Do NOT add a backend, a
// connector token, or auth.elevate to make a form load.
//
// docs: https://dev.wix.com/docs/sdk/business-solutions/forms/forms/get-form.md
// docs: https://dev.wix.com/docs/sdk/business-solutions/forms/forms/list-forms.md
// docs: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields.md
import { forms as formsModule } from "@wix/forms";
import { wixModule } from "../sdk";
import { FORMS_NAMESPACE, toForm, type Raw } from "./forms-core";
import type { FormDto } from "./types";

export { FORMS_NAMESPACE };

const forms = wixModule(formsModule);

/**
 * Read one form by id. Throws when the id is wrong or the form was deleted — a form that
 * cannot load is a setup problem, so fail loudly rather than rendering a hand-built fallback
 * that would drop real enquiries silently.
 */
export async function getForm(formId: string): Promise<FormDto> {
  const raw = (await forms.getForm(formId)) as Raw;
  if (!raw) throw new Error(`forms: form "${formId}" not found.`);
  return toForm(raw);
}

/**
 * Every form on the site, in the Wix Forms namespace. Use ONE call for several forms on a page
 * rather than a getForm each.
 *
 * Returns only ENABLED forms — a form the owner disabled vanishes from the listing rather
 * than erroring. That is usually right for a public site.
 */
export async function listForms(): Promise<FormDto[]> {
  // The namespace is POSITIONAL — an options object here is a type error, and untyped it would
  // silently list nothing.
  const res = (await forms.listForms(FORMS_NAMESPACE)) as Raw;
  return ((res?.forms ?? []) as Raw[]).map(toForm);
}
