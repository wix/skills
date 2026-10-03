// Generates app/wix/forms/address-templates.generated.ts: which subfields a multi-line address has
// in each country, in Wix's own order, and each country's subdivisions (states, provinces, regions)
// with their names. Wix's address field renders a different layout per country (Israel: street name
// + number, no subdivision; the United States: one address line and a state) and the submission API
// rejects any other subfield as "additional properties", so the storefront must follow the same
// templates. Three sources, all Wix's own:
//   - @wix/headless-forms (npm, public): the country → template map its form service uses
//     (dist/services/utils/address-forms.js; the same map as Wix's internal form-multiline-address)
//   - the template forms themselves, from the public form-template endpoint Wix's own form
//     components call at runtime (no authentication; namespace wix.form_platform.form)
//   - @wix/locale-dataset-data (Wix's npm registry, the default inside Wix; no token): subdivisions
//     per country and their English names
// Run by hand when Wix changes any of them; the output is committed. Needs npm and the network,
// no Wix login:
//   node templates/forms/tooling/address-templates.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "app", "wix", "forms", "address-templates.generated.ts");

const tmp = mkdtempSync(join(tmpdir(), "wix-address-"));
const pack = (name) => {
  const file = execFileSync("npm", ["pack", name, "--silent"], { cwd: tmp, encoding: "utf8" }).trim().split("\n").pop();
  const dir = join(tmp, file.replace(/\.tgz$/, ""));
  execFileSync("mkdir", ["-p", dir]);
  execFileSync("tar", ["xzf", join(tmp, file), "-C", dir]);
  return join(dir, "package");
};

// 1 · country → template, from Wix's own headless form components. The module imports the SDK at
// the top, so its two constants are read from the source text rather than by importing it.
const hf = pack("@wix/headless-forms");
const hfVersion = JSON.parse(readFileSync(join(hf, "package.json"), "utf8")).version;
const addressForms = readFileSync(join(hf, "dist", "services", "utils", "address-forms.js"), "utf8");
const mapSource = addressForms.match(/ADDRESS_FORM_ID_BY_COUNTRY\s*=\s*(\{[^}]*\})/)?.[1];
const DEFAULT_COUNTRY = addressForms.match(/DEFAULT_COUNTRY\s*=\s*'([A-Z_]+)'/)?.[1];
if (!mapSource || !DEFAULT_COUNTRY) throw new Error("@wix/headless-forms: ADDRESS_FORM_ID_BY_COUNTRY or DEFAULT_COUNTRY not found in address-forms.js");
const ADDRESS_FORM_ID_BY_COUNTRY = Object.fromEntries([...mapSource.matchAll(/([A-Z_]+):\s*'([0-9a-f-]{36})'/g)].map((m) => [m[1], m[2]]));

// 2 · the template forms, from the same public endpoint Wix's form components fetch at runtime
// (@wix/headless-forms services/utils/address-forms.js): all twelve in one call, no token.
const formIds = [...new Set(Object.values(ADDRESS_FORM_ID_BY_COUNTRY))];
const url = `https://www.wixapis.com/form-template-service/v1/templates?${formIds.map((id) => `templateIds=${id}`).join("&")}&namespace=wix.form_platform.form`;
const res = await fetch(url);
const json = await res.json().catch(() => ({}));
if (!res.ok || !Array.isArray(json.templates)) throw new Error(`form templates: ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
const templates = {};
const nameByFormId = {};
for (const id of formIds) {
  const form = json.templates.find((t) => t.id === id);
  if (!form) throw new Error(`template form ${id} missing from the response`);
  const name = String(form.name ?? id).replace(/^MLA_/, "");
  nameByFormId[id] = name;
  templates[name] = (form.fields ?? []).map((f) => ({ sub: f.target, required: Boolean(f.validation?.required), hidden: Boolean(f.hidden) }));
}
const byCountry = Object.fromEntries(Object.entries(ADDRESS_FORM_ID_BY_COUNTRY).filter(([c]) => c !== DEFAULT_COUNTRY).map(([c, id]) => [c, nameByFormId[id]]));

// 3 · country names and subdivisions, in English, from Wix's locale dataset. The names are shipped as
// data because Intl.DisplayNames spells a few of them differently in Node and in the browser (Hong
// Kong, Macao, Palestine, the Falklands), and a server-rendered list that the browser re-renders
// differently is a React hydration mismatch that throws the whole form's server render away.
const ld = pack("@wix/locale-dataset-data");
const ldVersion = JSON.parse(readFileSync(join(ld, "package.json"), "utf8")).version;
const data = JSON.parse(readFileSync(join(ld, "resources", "data.json"), "utf8"));
const en = JSON.parse(readFileSync(join(ld, "resources", "translations", "messages_en.json"), "utf8"));
const countryNames = {};
const subdivisions = {};
for (const c of data.countries) {
  if (en[c.displayName]) countryNames[c.shortKey] = en[c.displayName].trim();
  if (!c.subdivisions?.list?.length) continue;
  subdivisions[c.shortKey] = {
    label: en[c.subdivisions.displayName] ?? "Region",
    list: c.subdivisions.list.map((s) => [s.key, en[s.displayName] ?? s.key]),
  };
}

const body = `// Generated by templates/forms/tooling/address-templates.mjs on ${new Date().toISOString().slice(0, 10)}
// from @wix/headless-forms ${hfVersion} (country → template), the ${formIds.length} template forms
// (wix.form_platform.form, from the public form-template endpoint) and @wix/locale-dataset-data ${ldVersion}
// (country names, subdivisions). Do not edit; re-run the generator.
export interface AddressTemplatePart { sub: string; required: boolean; hidden: boolean }
export interface AddressSubdivisions { label: string; list: [code: string, name: string][] }
export const ADDRESS_TEMPLATES: {
  defaultTemplate: string;
  byCountry: Record<string, string>;
  templates: Record<string, AddressTemplatePart[]>;
  countryNames: Record<string, string>;
  subdivisions: Record<string, AddressSubdivisions>;
} = ${JSON.stringify({ defaultTemplate: nameByFormId[ADDRESS_FORM_ID_BY_COUNTRY[DEFAULT_COUNTRY]], byCountry, templates, countryNames, subdivisions })};
`;
writeFileSync(OUT, body);
console.log(JSON.stringify({ wrote: OUT, templates: Object.keys(templates), countriesMapped: Object.keys(byCountry).length, countriesNamed: Object.keys(countryNames).length, countriesWithSubdivisions: Object.keys(subdivisions).length, bytes: body.length }));
