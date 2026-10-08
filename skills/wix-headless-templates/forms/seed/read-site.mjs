// What forms the site has, with their fields — read from the v4 schema (`formFields` +
// `inputOptions`, the same keys the app's forms-core.ts flattens), so this reports the fields
// the page will render.
//   node <SKILL_ROOT>/templates/forms/seed/read-site.mjs [--site <siteId>] [--limit <n>]
import { runReader } from "../../shared/seed/read-site.mjs";

const FORMS_APP_ID = "225dd912-7dea-4738-8688-4b8c6955ffc2";
const NAMESPACE = "wix.form_app.form";
const D = "https://dev.wix.com/docs/api-reference/crm/forms/form-schemas";

// inputType → its options block; the component block is `<componentType in camelCase>Options`.
const INPUT_BLOCK = {
  STRING: "stringOptions", NUMBER: "numberOptions", BOOLEAN: "booleanOptions", ARRAY: "arrayOptions",
  ADDRESS: "addressOptions", WIX_FILE: "wixFileOptions", PAYMENT: "paymentOptions", SCHEDULING: "schedulingOptions",
};
const componentBlock = (componentType) =>
  `${String(componentType ?? "").toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())}Options`;

/** A label is a string or Ricos rich content; take its text. */
function plainText(label) {
  if (typeof label === "string") return label;
  const walk = (nodes) => (nodes ?? []).map((n) => (n?.textData?.text ?? "") + walk(n?.nodes)).join("");
  return walk(label?.nodes).trim();
}

function describeField(f) {
  const input = f.inputOptions ?? {};
  const block = input[INPUT_BLOCK[input.inputType]] ?? {};
  const component = block[componentBlock(block.componentType)] ?? {};
  const label = plainText(component.label) || input.target || f.id;
  return `${label} (${f.identifier ?? block.componentType ?? "?"})${input.required ? "*" : ""}${f.hidden ? " [hidden]" : ""}`;
}

await runReader({
  vertical: "forms",
  appId: FORMS_APP_ID,
  async read(api, { limit }) {
    const r = await api.call({ method: "GET", path: `/form-schema-service/v4/forms?namespace=${encodeURIComponent(NAMESPACE)}`, docs: `${D}/list-forms` });
    const forms = (r.forms ?? []).slice(0, limit);
    return {
      formCount: (r.forms ?? []).length,
      forms: forms.map((f) => ({
        id: f.id,
        name: f.name,
        enabled: f.enabled !== false,
        fields: (f.formFields ?? []).filter((x) => x.fieldType === "INPUT").map(describeField),
        steps: (f.steps ?? []).length,
        rules: (f.formRules ?? []).length + (f.rules ?? []).length,
        submitAction: f.submitSettings?.submitSuccessAction ?? "NO_ACTION",
      })),
    };
  },
});
