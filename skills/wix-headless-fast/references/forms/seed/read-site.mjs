// What forms the site has, with their fields.
//   node <SKILL_ROOT>/references/forms/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const FORMS_APP_ID = "225dd912-7dea-4738-8688-4b8c6955ffc2";
const NAMESPACE = "wix.form_app.form";
const D = "https://dev.wix.com/docs/api-reference/crm/forms/form-schemas";

await runReader({
  vertical: "forms",
  appId: FORMS_APP_ID,
  async read(api, { limit }) {
    const r = await api.call({ method: "GET", path: `/form-schema-service/v4/forms?namespace=${encodeURIComponent(NAMESPACE)}`, docs: `${D}/list-forms` });
    const forms = (r.forms ?? []).slice(0, limit);
    return {
      formCount: (r.forms ?? []).length,
      forms: forms.map((f) => ({ id: f.id, name: f.name, fields: (f.fields ?? []).filter((x) => !x.hidden).map((x) => `${x.view?.label ?? x.target ?? x.id} (${x.view?.fieldType ?? "?"})${x.validation?.required ? "*" : ""}`), steps: (f.steps ?? []).length })),
    };
  },
});
