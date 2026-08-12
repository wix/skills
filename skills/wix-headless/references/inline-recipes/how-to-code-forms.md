---
name: "How to Code Forms"
description: The frontend contract for Wix Forms — reading the live form schema (`@wix/forms` `forms.getForm`/`queryForms`/`listForms`, anonymous visitor, NO `auth.elevate`) and projecting its **`formFields[]`** to render inputs schema-driven, then the `submissions.createSubmission(submission, options)` write path, keying the `submissions` map by each field's `target`, why the anonymous visitor can submit with no captcha and no `auth.elevate`, why *submissions* read-back is owner-only, the `_id` result field, and mapping `fieldViolations[].errorPath`/`errorType` back to per-input copy. Specifies the *how* (modules + exact calls + the failure modes the docs omit); which forms to render come from the request.
---
**RECIPE**: How to Code a Wix Forms Frontend (`@wix/forms`, Form Submissions v4)

A concise contract for writing the **frontend code** that renders a seeded form and submits it:
**reading the live schema to build the inputs**, collecting the values, and creating a submission.
**This recipe is the *how* (which modules, which calls), not the *what*** — which forms to render,
how the page looks, and the framework are decided by the request you're fulfilling.

> **This recipe is for CODING the frontend, not for seeding it.** It assumes the form schema already
> exists (created by `setup-forms.md`) — you have each form's `formId` (and its field `target`s)
> from the seed's `seeded.forms` map. **The field set, order, labels, `required`, validation format,
> and dropdown options are read live from the schema at render time** (see "Rendering" below). It
> says nothing about creating forms — only how to read, render, and submit them from frontend code.

> **Render schema-driven by default — read the schema and generate the inputs.** This is the
> standard path for **every** forms site and what this section documents: an owner edit in the Wix
> dashboard reflects on the site with no code change, and the submit map can never desync from the
> schema. A dropdown, non-trivial validation, or several forms on one site are **not** reasons to
> hardcode — those are exactly what the schema carries, so hardcoding them is strictly more code and
> more drift. Each form simply reads its own schema by `formId`.
>
> **The ONLY exception is a brief that is explicitly design-led** — the visual design is the whole
> point, the form is a small fixed part of a hand-crafted layout, and dashboard-editability is
> explicitly not a goal (e.g. the `inquiry-design` wedding-photographer brief). There you may
> hardcode `<input name="<target>">`, but **read the actual `target`s from the schema — never guess or
> derive them from labels**: a key that isn't an exact schema `target` 400s the whole submission.

> **⚠️ Reading rule — always append `?apiView=SDK` to every doc link below.** The Wix docs render
> two views of the same page. The **bare / REST view** shows the wrapped REST body
> (`{ submission: {…} }`) and an `id` field; the **`?apiView=SDK` view** shows the SDK call
> (`submissions.createSubmission(submission, options)`) and the normalized **`_id`** field. The SDK
> is what your frontend calls; reading the REST view leads to the wrong call signature and the
> `id`-vs-`_id` trap.

---

## The module and the client (read this first)

**⚠️ Two modules of `@wix/forms`, both used from the frontend:**
- **`forms`** — reads the form **schema** to render fields: `import { forms } from "@wix/forms"`,
  then `forms.getForm(formId)` / `forms.queryForms(query)` / `forms.listForms(namespace)`.
- **`submissions`** — writes a submission: `import { submissions } from "@wix/forms"`, then
  `submissions.createSubmission(submission, options)`.

(The frontend **reads** schemas and **writes** submissions; it never *creates* schemas — that's the
seed.)

**⚠️ CRITICAL: a plain anonymous visitor token reads the form schema — NO `auth.elevate`, no
backend, no owner creds.** `forms.getForm(formId)` / `forms.listForms("wix.form_app.form")` return
**200** with the full schema (all `formFields[]` with `identifier` + `inputOptions.target` + the
`stringOptions.validation`/`componentType`/options blocks, the `steps` layout, `submitSettings`) on
the same visitor client that submits. **This contradicts the docs**: the API spec lists every read
method (`getForm`/`queryForms`/`listForms`/`getFormSummary`) as requiring the owner scope
`WIX_FORMS.FORM_SCHEMA_READ` ("Manage Submissions"), and every SDK example ships an "(with elevated
permissions)" variant. **Trust the live 200, not the permission table** — Wix grants implicit
visitor read for published-site rendering. **Do NOT add `auth.elevate` to the read** — it is
unnecessary, and a pure SPA/static frontend can't elevate anyway and doesn't need to. Schema-driven
rendering is therefore **universal — every framework, including a pure static SPA, with no server or
proxy.**

**Submissions read-back stays owner-only.** Only the *schema* read is visitor-accessible. **Reading
submissions back** (`querySubmissionsByNamespace`, `getSubmission`, `countSubmission`) requires the
owner permission `WIX_FORMS.SUBMISSION_READ_ANY` and is **not** available to a visitor — don't try
to list/confirm submissions from the frontend. The submit's resolved promise **is** your success
signal (show a thank-you); the submission lands in the site owner's dashboard.

**Auth / client — framework split (the SAME client both reads the schema and submits — no elevate on
either):**
- **Astro (Wix-managed):** authentication is ambient. Call `forms.getForm(...)` /
  `forms.listForms(...)` in the page frontmatter / a server route, and
  `submissions.createSubmission(...)` from a server route (`src/pages/api/*.ts`) or a server action
  — **no `createClient`, no `OAuthStrategy`, no `clientId`, no `auth.elevate`.** (The schema read
  can equally run client-side; server-side in SSR is simplest so the fields are in the initial
  HTML.)
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client with **both** modules and
  reuse it — the read runs **client-side**, no server needed:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { forms, submissions } from '@wix/forms';

  const client = createClient({
    modules: { forms, submissions },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  // read to render:  client.forms.getForm(formId)
  // then submit:     client.submissions.createSubmission(submission)
  ```
  The `clientId` is public, not a secret.

**⚠️ CRITICAL: do NOT call `auth.elevate` to submit.** An anonymous visitor **can** create a
submission on the plain visitor token (it stamps `submitter.visitorId`). A pure SPA/static frontend
has **no server and cannot elevate** anyway. (The Velo docs example wraps `createSubmission` in
`auth.elevate` inside a backend `web.js` — that's the Velo hosted pattern, **not** the headless
visitor path; ignore it here.)

---

## The features (build the ones the site needs)

A forms frontend is essentially one feature — **render the fields, then submit** — plus the
render/validation details around it. Implement it once per form the site shows.

### Rendering the inputs (read the schema, then bind `name` = `target`)

**Read the live schema, project its `formFields` into a render model, and generate one input per
field.** The field's **`target`** (at `inputOptions.target` — the immutable lowercase snake_case
key the seed authored, e.g. `first_name`, `message`) becomes the input's **`name`** —
it's the contract the submission must use. Because the inputs are generated from the schema, the
field **set, order, labels, `required`, validation format, length/pattern constraints, and dropdown
options** all track the dashboard: a field the owner adds/removes/relabels — or a constraint they
tighten — reflects on the site with no code change.

**1 · Fetch the schema** (visitor token, no elevate). Fetch by id when you have it (the handoff
carries `formId`), else discover by namespace. **Note the return shapes differ:** `getForm` resolves
to the **`Form` directly**, while `listForms` resolves to **`{ forms }`**.

```js
import { forms } from '@wix/forms';   // Astro: call directly. Non-Astro: client.forms

// ONE form → getForm resolves to the Form directly (not `{ form }`-wrapped)
const form = await forms.getForm(SEEDED_FORM_ID);          // from seeded.forms[].formId

// SEVERAL forms on a page → ONE listForms call, not one getForm each.
// Signature is listForms(namespace, options); `formIds` takes up to 100 ids.
const { forms: list } = await forms.listForms('wix.form_app.form', { formIds: SEEDED_FORM_IDS });

// No ids to hand? Discover every form in the namespace:
const { forms: all } = await forms.listForms('wix.form_app.form');
```

> **`listForms` returns only *enabled* forms by default** — usually what you want on a public site,
> but it does mean a form the owner disabled silently vanishes from a discovery listing rather than
> erroring.

**2 · Project `form.formFields` into a render model.**

```js
// Display order comes from steps[], not from formFields[] (About Form Fields, "Field order comes
// from the layout") — including the breakpoint fallback below.
const order = new Map(
  (form.steps ?? [])
    .flatMap((s) => s.layout?.large?.items ?? s.layout?.medium?.items ?? s.layout?.small?.items ?? [])
    .sort((a, b) => (a.row - b.row) || (a.column - b.column))
    .map((item, i) => [item.fieldId, i]),
);

const camel = (e) => (e ?? '').toLowerCase().replace(/_(.)/g, (_, c) => c.toUpperCase());

// The input types THIS renderer handles. BOOLEAN (checkbox), WIX_FILE (file upload / signature),
// PAYMENT and SCHEDULING need their own controls — a checkbox's label is a Ricos rich-content
// OBJECT, not a string, so letting one fall through to the text branch prints `[object Object]`
// (or throws in React). Skip them explicitly; add a branch when a brief needs one.
// ⚠️ A skipped field that is `required` makes the form UNSUBMITTABLE (the server will demand it), so
// log that case loudly and write the branch — a consent CHECKBOX is the one you'll hit first.
const RENDERABLE = new Set(['STRING', 'NUMBER', 'ARRAY', 'ADDRESS']);

const inputs = (form.formFields ?? [])
  .filter((f) => f.fieldType === 'INPUT' && !f.hidden   // the submit button is fieldType: 'DISPLAY'
    && RENDERABLE.has(f.inputOptions?.inputType))
  .map((f) => {
    const io = f.inputOptions ?? {};
    // ONE naming rule for BOTH nesting levels (About Form Fields, "How a field is composed"):
    // camelCase the enum value and append `Options` — `inputType` names the outer block,
    // `componentType` the sub-block inside it. DERIVE both; a hardcoded `??` chain of block names
    // silently misses types (TIME_INPUT, DATE_TIME, RATING_INPUT, …) and reads back no label.
    const to = io[`${camel(io.inputType)}Options`] ?? {};        // stringOptions / arrayOptions / …
    const comp = to[`${camel(to.componentType)}Options`] ?? {};  // textInputOptions / dropdownOptions / …
    const val = to.validation ?? {};
    return {
      id: f.id,                                          // used only to order by steps[] below
      target: io.target,                                 // → input `name` (THE submission key)
      inputType: io.inputType,
      label: comp.label ?? io.target,
      placeholder: comp.placeholder ?? '',
      defaultValue: comp.default,                        // owner-set prefill; undefined → none
      required: io.required ?? false,                    // NOTE: on inputOptions, not inside validation
      format: val.format,                                // EMAIL | PHONE | URL | UNKNOWN_FORMAT | …
      minLength: val.minLength,                          // owner-set length/pattern constraints —
      maxLength: val.maxLength,                          // carry them so the client validates them too,
      pattern: val.pattern,                              // not just the server (see "validation" below)
      identifier: f.identifier,                          // per the field table in About Form Fields
      componentType: to.componentType,
      multiple: io.inputType === 'ARRAY',                // multi-choice → submits an ARRAY
      options: comp.options?.map((o) => ({ value: o.value, label: o.label ?? o.value })),
      // PHONE may narrow or preselect the country (both ISO-3166 alpha-2):
      allowedCountryCodes: val.phoneOptions?.allowedCountryCodes,
      defaultCountryCode: comp.defaultCountryCode,
      // ADDRESS fields submit a NESTED OBJECT, not a string. validation.fields lists the subfields
      // and their required-ness; only addressLine2 has a visibility setting, so the filter below
      // hides just that one. `false` for every non-address field.
      addressParts: io.inputType === 'ADDRESS' && Object.entries(val.fields ?? {})
        .filter(([sub]) => comp.fieldSettings?.[sub]?.show !== false)
        .map(([sub, cfg]) => ({ sub, required: cfg?.required ?? false })),
      allowedCountries: val.allowedCountries,            // ADDRESS: narrows the country <select>
    };
  })
  // A field the owner never placed in the layout sorts LAST, not first — it still stores values.
  .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
```

[About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields)
documents which `identifier` pairs with which component, which options block each combination nests
in, and what each field submits — read it rather than guessing a block name. A number, address or
multi-choice field's `format`/`minLength` come back `undefined`: those constraints exist only on a
`STRING` field's validation.

**⚠️ Two paths the projection gets wrong most often:** `required` is at **`inputOptions.required`**,
*not* inside the validation block; and unconstrained text reads back as **`UNKNOWN_FORMAT`**, so
never test for `UNDEFINED`.

**3 · Render `inputs.map(...)`**, deriving the control from the projected model — **a dropdown is
signalled by `componentType`, a textarea by `identifier`, the input `type` by `format`:**

```jsx
inputs.map((field) => {
  // Address (MULTILINE_ADDRESS) → a GROUP of sub-inputs; its submission value is an OBJECT.
  // Name each sub-input `${target}/${sub}` — that is EXACTLY the server's error path for a nested
  // field (e.g. "address/subdivision"), so the submit step nests them back AND a per-subfield
  // server error maps straight onto the right control (see "Submitting" and the error mapping below).
  // NB: `country` and `subdivision` are country-dependent enums, not free text (see the ⚠️ note) —
  // render `country` as a <select> (your own, over an ISO-3166 alpha-2 list, narrowed to
  // field.allowedCountries when that's non-empty) rather than a free-text input.
  if (field.addressParts) {
    return (
      <fieldset key={field.target}>
        <legend>{field.label}{field.required && ' *'}</legend>
        {field.addressParts.map(({ sub, required }) => {
          const name = `${field.target}/${sub}`;            // == the server errorPath for this subfield
          return (
            <label key={sub}>{sub}{required && ' *'}         {/* humanize `sub` for display as you like */}
              {sub === 'country'
                ? <CountrySelect name={name} required={required} allowed={field.allowedCountries} />
                : <input name={name} required={required} />}
              {fieldErrors[name] && <small className="field-error">{fieldErrors[name]}</small>}
            </label>
          );
        })}
      </fieldset>
    );
  }
  // Radio group (single choice) → radios sharing name=target; submits a single string
  if (field.componentType === 'RADIO_GROUP') {
    return (
      <fieldset key={field.target}><legend>{field.label}{field.required && ' *'}</legend>
        {field.options.map((o) => (
          <label key={o.value}><input type="radio" name={field.target} value={o.value}
            defaultChecked={o.value === field.defaultValue} required={field.required} /> {o.label}</label>
        ))}
      </fieldset>
    );
  }
  // Checkbox group (multi choice, inputType ARRAY) → checkboxes sharing name=target; submits an ARRAY
  if (field.multiple) {
    return (
      <fieldset key={field.target}><legend>{field.label}{field.required && ' *'}</legend>
        {field.options.map((o) => (
          <label key={o.value}><input type="checkbox" name={field.target} value={o.value} /> {o.label}</label>
        ))}
      </fieldset>
    );
  }
  // Dropdown → <select> — a single-choice STRING field
  if (field.componentType === 'DROPDOWN') {
    return (
      <label key={field.target}>{field.label}{field.required && ' *'}
        <select name={field.target} required={field.required} defaultValue={field.defaultValue ?? ''}>
          <option value="" disabled>{field.placeholder || 'Select…'}</option>
          {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  // Textarea — detected by `identifier` (see gotcha below), NEVER by componentType
  if (field.identifier === 'TEXT_AREA') {
    return (
      <label key={field.target}>{field.label}{field.required && ' *'}
        <textarea name={field.target} required={field.required} rows={4} defaultValue={field.defaultValue}
          minLength={field.minLength} maxLength={field.maxLength} />
      </label>
    );
  }
  // Text/date input — derive `type` from the validation format; stamp the schema's constraints.
  // DATE_INPUT and DATE_PICKER are both format 'DATE' → <input type="date"> (submits a date string).
  const type =
    field.componentType === 'NUMBER_INPUT' ? 'number' :  // NUMBER field — no format; empty validation
    field.format === 'EMAIL' ? 'email' :
    field.format === 'PHONE' ? 'tel' :
    field.format === 'URL' ? 'url' :
    field.format === 'DATE' ? 'date' :
    field.format === 'TIME' ? 'time' :
    field.format === 'DATE_TIME' ? 'datetime-local' : 'text';
  // inputMode picks the right on-screen keyboard on mobile; undefined → attribute omitted
  // (date/time use the native picker, so no inputMode).
  const inputMode =
    type === 'number' ? 'decimal' :
    type === 'tel' ? 'tel' :
    type === 'email' ? 'email' :
    type === 'url' ? 'url' : undefined;
  // `defaultValue` is the owner's prefill from the schema — dropping it loses a dashboard setting.
  return (
    <label key={field.target}>{field.label}{field.required && ' *'}
      <input name={field.target} type={type} inputMode={inputMode} required={field.required}
        defaultValue={field.defaultValue} placeholder={field.placeholder}
        minLength={field.minLength} maxLength={field.maxLength} pattern={field.pattern} />
    </label>
  );
});
```

**Show the expected shape in the `placeholder`, not a second line of copy.** `format` tells you what
a constrained field wants, so surface an example up front — but reuse the `placeholder` the render
already passes rather than adding a separate hint element that just duplicates the inline error. When
the schema's `placeholder` is empty for a constrained field, synthesize one from `format` (PHONE →
`phoneExample(field)`, the reserved example for the field's own country — see `PHONE_EXAMPLE` under
Validation; URL → `https://…`). The example prevents the `must match format "phone"` error
without a redundant help line under every field.

**⚠️ Detection signals — `identifier` and `componentType` are INDEPENDENT axes**, because several
fields share one general-purpose component
([About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields),
"Some component types serve several fields"). Switch on whichever axis distinguishes the control you
are rendering — and **never on the `target` name**: a rename silently breaks name-based detection,
while `identifier` and `componentType` stay authoritative. Three that bite in practice:

- **`<textarea>` → `identifier === "TEXT_AREA"`.** `componentType` is `TEXT_INPUT` for short *and*
  long answer, so keying off it renders every long-text field single-line.
- **`country` / `subdivision` are country-dependent enums the schema does not enumerate**, so a plain
  `<input>` invites a rejection. Render **`country` as a `<select>`** (narrowed to
  `allowedCountries` when non-empty) and, ideally, **`subdivision` as a country-dependent
  `<select>`** from an ISO-3166-2 / Wix subdivision dataset. If you must keep them text, **leave
  `subdivision` optional** and rely on the mapped inline error.
- **`IMAGE_CHOICE` looks exactly like multi-choice** (`ARRAY` + `CHECKBOX_GROUP`), so it renders as
  plain checkboxes here. Only `identifier` distinguishes it — branch on that if the brief wants the
  images.

### Validation — schema-driven on the client, authoritative on the server

The schema carries the validation rules too: `required`, the `format` (EMAIL/PHONE/URL), and
`minLength`/`maxLength`/`pattern`. **Two layers, and the split matters:**

**Server (authoritative).** `createSubmission` enforces the field's `validation` block server-side.
Any violation — missing required, bad email, too short/long, pattern mismatch — comes back under
`err.details.validationError.fieldViolations[]` with an `errorPath` and an `errorType`. You **must**
map these back to per-input errors (see the mapping in "Submitting"); this is the backstop that
always holds even if a rule is missed client-side.

**Client (schema-driven UX).** Pre-validate from the *same projected constraints* so the user gets
inline feedback before a round-trip — and **derive every check from the schema, never from the field
name.** ⚠️ The common mistake (seen in practice) is keying the email check on `target === "email"`;
do it off `format` so an owner-added PHONE/URL/length rule is honored with no code change:

**⚠️ No user-visible example value may be hardcoded to one locale.** Phone, postcode/ZIP, currency,
date or address examples in placeholders, hint text and error copy all derive from the **site's
country** — a `+44`- or US-only example shipped to every site is a locale bug, not a default. And an
illustrative *phone* number must come from that country's **regulator-reserved fictional range**,
never a plausible-looking one: a real number risks reaching a real person.

**Resolve `SITE_COUNTRY` once** (ISO-3166 alpha-2), in this order, and reuse it:

1. the site context you already hold, if the run fetched one — `sites[].properties.locale.country`;
2. else the Site Properties API — `GET https://www.wixapis.com/site-properties/v4/properties` →
   `properties.locale.country` (SDK: `@wix/business-tools` `siteProperties.getSiteProperties()`);
3. else infer from the brief (a stated location, an address, a phone dialling code);
4. else **default `US`**.

```js
// Phone example shown to visitors (placeholder + error copy), derived from SITE_COUNTRY — NEVER
// hardcoded to one locale. Every value is a regulator-RESERVED fictional number for that country, so
// no real subscriber is ever printed — and being display-only it needn't pass Wix's E.164 check
// (submitting one would 400; see the sidebar). Add a market only after verifying its reserved range
// in the national numbering plan — never invent a number.
const PHONE_EXAMPLE = {
  US: '+1 201 555 0123', CA: '+1 416 555 0123', // NANP 555-0100–0199 reserved for fiction
  GB: '+44 7700 900123',                         // Ofcom drama range 07700 900xxx
  IE: '+353 20 910 0001',                        // ComReg reserved 020 91x xxxx
  AU: '+61 491 570 006',                         // ACMA reserved mobile range
  FR: '+33 1 99 00 00 01',                       // ARCEP Île-de-France 01 99 00 xx xx reserved
  DE: '+49 30 23125 000',                        // BNetzA Berlin 030 23125 xxx reserved
  SE: '+46 70 174 06 05',                        // PTS reserved 070 174 06xx
  KR: '+82 2 540 0000',                          // Seoul 02-540-xxxx reserved
};
// A PHONE field may narrow or preselect its country (`allowedCountryCodes` / `defaultCountryCode`,
// both projected above). Prefer the FIELD's country over the site's, so the example shown is one the
// field would actually accept; fall back to the site's, then to US (the default above).
const phoneCountry = (field) =>
  field.defaultCountryCode ?? field.allowedCountryCodes?.[0] ?? SITE_COUNTRY;
const phoneExample = (field) => PHONE_EXAMPLE[phoneCountry(field)] ?? PHONE_EXAMPLE.US;

function fieldError(field, raw) {
  const v = (raw ?? '').trim();
  if (field.required && !v) return `${field.label} is required.`;
  if (!v) return '';                                              // optional + empty → ok
  if (field.minLength && v.length < field.minLength) return `${field.label} must be at least ${field.minLength} characters.`;
  if (field.maxLength && v.length > field.maxLength) return `${field.label} must be at most ${field.maxLength} characters.`;
  if (field.format === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Please enter a valid email address.';
  if (field.format === 'URL'   && !/^https?:\/\/.+/.test(v)) return 'Please enter a valid URL.';
  // PHONE is E.164 server-side: leading +, country code, digits only. Strip formatting first —
  // visitors add spaces, dashes and parens, and rejecting those is a UX bug, not validation.
  // Submit the NORMALIZED value, not the raw one.
  const phone = v.replace(/[\s()\-.]/g, '');
  if (field.format === 'PHONE' && !/^\+[1-9]\d{6,14}$/.test(phone))
    return `Use international format, e.g. ${phoneExample(field)}.`;
  if (field.pattern && !new RegExp(field.pattern).test(v)) return `${field.label} is not in the expected format.`;
  return '';
}
```

**⚠️ A client check that is laxer than the server's is worse than none** — it guarantees the visitor
learns about the problem only after a round trip, in the server's wording rather than yours. Every
rule here must be at least as strict as the server's, and the value you submit must be the normalized
one the check passed.

Run it over the projected `inputs` on submit (and on blur — see UX below); block the submit if any
returns non-empty. The `<input>`/`<textarea>` also carry `minLength`/`maxLength`/`pattern` and (for
text) the format-derived `type` from the render step, so native constraints reinforce the JS checks.
**Don't hardcode a fixed field list or a per-field rule** — both the render and the validation read
the live schema, so a dashboard-added constraint (a new `maxLength`, a stricter `pattern`) takes
effect on the site with no code change.

> **`PHONE` is E.164, validated in two layers.** First the shape — leading `+`, country code, digits
> only; spaces, dashes, parens and a national leading `0` all fail with `must match format "phone"`.
> Then a per-country length/prefix check — `+99889899889` returns `Phone number for the country code
> provided is invalid`. A number in a country's *reserved* range — including the fictional example we
> show — is rejected with the misleading `Phone number's country code must correspond to one from
> allowed countries`; **the country is fine, the number isn't.** An allow-list *does* exist
> (`validation.phoneOptions.allowedCountryCodes`, projected as `allowedCountryCodes`), but it is not
> what fires here — widening or clearing it won't help. Never submit the example: it's display-only.

**Take only the ORDER from `steps[]`, not the geometry** — `width`, multi-column and multi-page are a
Phase-2 concern the frontend's own layout replaces.

### Submitting (create a submission)

Collect the input values into a **`submissions` object keyed by `target`**, and call
`createSubmission`. Doc:
<https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/create-submission?apiView=SDK>

```js
import { submissions } from '@wix/forms';   // Astro: call directly. Non-Astro: client.submissions

async function submitContact(formEl) {
  // Flat fields land as `target` → value. Address sub-inputs are named `target/sub`, so fold any
  // slashed key back into a nested object — the shape an ADDRESS field's `target` expects.
  const arrayTargets = new Set(inputs.filter((f) => f.multiple).map((f) => f.target)); // multi-choice targets
  const values = {};
  for (const [name, value] of new FormData(formEl)) {
    const slash = name.indexOf('/');                               // address sub-inputs are `target/sub`
    if (slash !== -1) { (values[name.slice(0, slash)] ??= {})[name.slice(slash + 1)] = value; continue; } // → { sub: value }
    if (arrayTargets.has(name)) (values[name] ??= []).push(value); // multi-choice → ARRAY of checked values
    else values[name] = value;                                     // single value: text / dropdown / radio / …
  }
  const { _id, status } = await submissions.createSubmission({
    formId: SEEDED_FORM_ID,          // from seeded.forms[].formId
    submissions: values,             // map of target -> value (or -> nested object, for an address)
  });
  return { _id, status };            // CONFIRMED → render a thank-you (see the status note below)
}
```

**⚠️ CRITICAL: `createSubmission` takes POSITIONAL args — `createSubmission(submission, options)`,
NOT `createSubmission({ submission })`.** The first argument **is** the submission object
(`{ formId, submissions }`) directly; the optional second argument is `options` (e.g.
`captchaToken`). Wrapping it as `{ submission: {…} }` is the REST body shape and does not type-check
against the SDK.

**The `submissions` map is keyed by each field's `target`** — see
[About Submission Values](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values)
for the keys and the per-`inputType` value shapes. This is why the render step binds **`name` =
`target`** from the projected schema: collecting `FormData` then yields the right keys by
construction, with no hand-maintained list to drift.

**⚠️ Two rejections that are SEED bugs, not frontend bugs** — don't mangle the frontend key or value:
- An `UNKNOWN_VALUE_ERROR` on a key that *is* in the schema means the field was seeded without a
  `validation` block, and that block is what registers the target as an accepted value (About Form
  Fields, "Validation"). It only surfaces once someone actually fills that field in, since an empty
  value is dropped before validation.
- A `NOT_ALLOWED_VALUE_ERROR` on a choice field means the seed's `options[].value` and its validation
  enum disagree — the two declarations must match (About Form Fields, "Choice fields").

Both are fixed in `setup-forms.md` STEP 2.

**⚠️ A resolved promise is not always a recorded submission.** Read `status` from the result: for the
Wix Forms namespace it is `CONFIRMED` (recorded — show the thank-you), but a form that collects
payment returns `PAYMENT_WAITING` and some namespaces return `PENDING`, neither of which is recorded
or visible to the owner yet
([Submission status](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/introduction#submission-status)).
Since this renderer skips `PAYMENT` fields, treat anything other than `CONFIRMED` as "not done yet"
rather than showing a success state.

**⚠️ Per-field validation errors — the SDK buries them two levels deeper than the docs' shape.** The
documented entries (`errorPath`, `errorType`, `errorMessage`, `params` — see
[Validation errors](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/introduction#validation-errors))
arrive under **`err.details.validationError.fieldViolations[]`, each with its own `data.errors[]`
array**. Flatten that and **name each input by its `errorPath`** so the message lands on the right
control instead of only a form-level banner — that is why the address render names its sub-inputs
`${target}/${sub}`, matching the server's own nested path. Then write every message from `errorType`
plus the field's projected schema (`label`, `format`, `minLength`/`maxLength`); the docs' rule against
showing `errorMessage` is hard here — it goes to `console.debug` only:

```js
const FORMAT_COPY = {           // used for FORMAT_ERROR, keyed by the field's validation format
  EMAIL: () => 'Enter a valid email address.',
  PHONE: (f) => `Use international format, e.g. ${phoneExample(f)}.`,  // field/site-derived country
  URL:   () => 'Enter a full URL starting with https://',
  DATE:  () => 'Choose a valid date.',
};
const COPY = {                  // errorType → visitor-facing copy
  REQUIRED_VALUE_ERROR:   (f) => `${f.label} is required.`,
  MIN_LENGTH_ERROR:       (f) => `${f.label} must be at least ${f.minLength} characters.`,
  MAX_LENGTH_ERROR:       (f) => `${f.label} must be at most ${f.maxLength} characters.`,
  FORMAT_ERROR:           (f) => FORMAT_COPY[f.format]?.(f) ?? `Please check ${f.label}.`,
  PATTERN_ERROR:          (f) => `${f.label} is not in the expected format.`,
  NOT_ALLOWED_VALUE_ERROR:(f) => `Choose one of the listed options for ${f.label}.`, // seed gap — see above
  TYPE_ERROR:             (f) => `Please check ${f.label}.`,
  UNKNOWN_VALUE_ERROR:    (f) => `Please check ${f.label}.`,   // usually a seed gap — see above
};

// Unrecognized errorType MUST degrade to safe copy — the enum grows, and MIN/MAX_VALUE_ERROR,
// MIN/MAX_ITEMS_ERROR and DISABLED_FORM_ERROR are all reachable without being mapped above.
function copyFor(field, fe) {
  const write = COPY[fe.errorType];
  if (write) return write(field);
  console.debug('unmapped form validation error', fe.errorPath, fe.errorType, fe.errorMessage);
  return field ? `Please check ${field.label}.` : 'Please check the highlighted fields.';
}

const fieldErrors = {};                                     // errorPath → visitor-facing copy
for (const v of (err?.details?.validationError?.fieldViolations ?? []))
  for (const fe of (v?.data?.errors ?? [])) {
    if (!fe.errorPath || fieldErrors[fe.errorPath]) continue;
    // Nested paths (`address/subdivision`, `attachments/0/fileId`) belong to the field named by the
    // FIRST segment; `fieldByTarget` is the projected `inputs` indexed by `target`.
    fieldErrors[fe.errorPath] = copyFor(fieldByTarget[fe.errorPath.split('/')[0]], fe);
  }
```

`fieldErrors` is then exactly what the render reads (`fieldErrors[name]`), keyed by the same string
the inputs are named with.

### UX — validate as they go, show the state on the field

**Validate on blur, not only on submit.** Making a visitor reach the submit button to learn that a
field they left three inputs ago is wrong is a poor experience — catch it as they leave the field.
Run `fieldError` on each control's `blur`; once a field has been flagged, re-run on `input` so the
message clears the moment they fix it. **Don't** validate on the first keystroke of an untouched field — that flags a
required field red before they've had a chance to type. Submit still runs the full pass as the
backstop.

**Show invalid state on the control, not only in the error text.** A message under a tall form is
easy to miss — give the control itself a visible affordance. Key it off the **same `aria-invalid`
attribute** the validation already sets (per Accessibility below), so the visual and the assistive-tech
state can't drift:

```css
input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"],
fieldset[aria-invalid="true"] { border-color: #c0392b; outline-color: #c0392b; }
```

For a choice group the attribute is on the `<fieldset>`, so style that — and clear it the same way it
was set: when `fieldError` returns empty, remove `aria-invalid` and the border goes with it. Don't
track a separate `.has-error` class in parallel; one source of truth avoids a field that looks valid
but reads invalid (or the reverse).

### Accessibility (the inputs are generated — one slip lands on every field)

Because every control is generated from the schema, an accessibility mistake is systematic: it hits
every field of every form. The render model already carries what's needed
(`target`, `label`, `required`, `options`) — wire it up.

**Associate each error with its control.** Give the error a deterministic id from the *same key as
the errorPath* (`err-${target}`, nested `err-${target}/${sub}`) and point the control at it with
`aria-describedby`. The error element must:
- be `role="alert"` (or `aria-live="polite"`) so a message appearing *after* submit is announced —
  `aria-describedby` alone only reads on focus;
- **persist in the DOM**, emptied/filled — conditionally rendering it (`{err && …}`) destroys the
  live region and nothing is announced; hide the empty state with CSS (`.error:empty{display:none}`),
  never by unmounting;
- carry `aria-invalid` **only when invalid** — pass `undefined`, not `"false"`, so a clean field has
  no attribute.

```jsx
const errorId = `err-${field.target}`;   // nested: `err-${target}/${sub}` — same key as errorPath
<input name={field.target} aria-describedby={errorId} aria-invalid={Boolean(err) || undefined} … />
<p className="error" id={errorId} role="alert">{err}</p>
```

**A choice group's error attaches to the `<fieldset>`, not a radio.** Radio (`RADIO_GROUP`) and
multi-choice (`inputType: "ARRAY"`) groups have no single control to describe — put `aria-describedby`
(and `aria-required` for a required group) on the fieldset the render already emits; pointing it at
one radio leaves the message unreachable from the other options.

**⚠️ Marking a group invalid is a `RadioNodeList` trap.** `form.elements.namedItem(target)` returns
an `HTMLElement` for a text field or `<select>`, but a **`RadioNodeList`** for a radio/checkbox group
— so a guard like `if (control instanceof HTMLElement)` silently skips every choice group (the visual
`.has-error` styling still applies, so it's easy to miss). Handle both shapes:

```js
const control = form.elements.namedItem(target);
const nodes = control instanceof RadioNodeList ? Array.from(control)
            : control instanceof HTMLElement ? [control] : [];
for (const node of nodes)
  message ? node.setAttribute('aria-invalid', 'true') : node.removeAttribute('aria-invalid');
```

**On a blocked submit, focus the first invalid control — don't just scroll to it.** `scrollIntoView`
moves the viewport and nothing else; a keyboard/screen-reader user is left where they were. Focusing
it lets `role="alert"` / `aria-describedby` announce what failed.

```js
form.querySelector('[aria-invalid="true"]')?.focus();   // for a group, that's its first radio
```

**Required needs more than the `*`.** The bare ` *` the render adds is read as "star" or skipped —
keep it but hide it from AT (`aria-hidden="true"`) and let the control's `required` attribute (or
`aria-required` on a group) carry the meaning. Do both; never the glyph alone.

**Every control needs a real name.** The projection falls back to `label ?? target`, so a seed that
omits a label announces as `person_name` — render a real `<label>`; a `placeholder` is not a label
(it disappears on input and fails contrast).

**Announce success too.** Swapping the form for a thank-you block is a silent DOM change — give the
success region `role="status"` (or move focus to its heading with `tabindex="-1"`), or the user is
left on a button that appears to have done nothing.

Don't reach for `role="form"`, an `aria-label` on a native input that already has a `<label>`, or a
custom `role="radio"` — native radios inside a `<fieldset>` are already a correct radiogroup with
arrow-key selection.

### Spam protection (only if the site raised it)

The seed leaves `spamFilterProtectionLevel` at its default (`ADVANCED`), and an anonymous visitor
submit **still succeeds without a captcha token** on the headless SDK path. So you normally pass
**no** `options`. Only if a site is configured to *require* a CAPTCHA do you need to solve one and
pass it as the second arg: `createSubmission(submission, { captchaToken })`. Don't add captcha
plumbing speculatively — the default path needs none.

---

## Conclusion
A correct Wix Forms frontend:
- **reads the live schema** with the **`forms`** export of **`@wix/forms`**
  (`getForm`/`listForms`/`queryForms`) on the **plain visitor token — NO `auth.elevate`**: the schema
  read is visitor-accessible on every framework incl. a pure SPA, despite the docs marking it
  owner-scoped;
- renders **schema-driven** — projects `form.formFields` into a render model and generates one input
  per field, ordered by `steps[]`, so a dashboard field add/remove/relabel or a tightened constraint
  reflects with no code change. **Derives both options-block names** from the `inputType` /
  `componentType` enums rather than hardcoding a fallback chain, carries the owner's `default`
  prefill, and **skips the input types it has no control for** (`BOOLEAN`, `WIX_FILE`, `PAYMENT`,
  `SCHEDULING`) instead of letting them fall through to a text input;
- **validates schema-driven on the client and treats the server as authoritative**: pre-checks
  `required` + `minLength`/`maxLength`/`pattern` + format **keyed off `field.format`, never the
  field name**, with each client rule **at least as strict as the server's** and the **normalized**
  value (e.g. E.164 phone) submitted — never the raw one; always maps `createSubmission`'s
  `fieldViolations[].data.errors[].errorPath` back to per-input errors as the backstop, writes every
  visitor-facing message from **`errorType`** plus the field's projected schema (**never** parsing or
  displaying the validator's `errorMessage`), and defaults an unrecognized `errorType` to safe copy;
- shows any user-visible example — a phone number above all — for the **field's own** country
  (`allowedCountryCodes` / `defaultCountryCode`, else the site's), always from that country's
  regulator-reserved fictional range, and never submits it;
- imports the **`submissions`** export of **`@wix/forms`** and calls
  **`submissions.createSubmission(submission, options)`** — **positional args**, the submission
  object first (never `{ submission }`-wrapped) — binding each input's **`name` = the schema's
  `target`** so the `submissions` map is keyed by `target` by construction;
- submits on the **plain visitor token with NO `auth.elevate`** (anonymous submit works; a pure SPA
  can't elevate anyway) and, at the default `ADVANCED` protection, **no captcha**;
- **only writes submissions** — reading them back is owner-only — and treats
  **`status === "CONFIRMED"`**, not a resolved promise, as the signal to show the thank-you; reads
  the created id as **`result._id`**, never `result.id`;
- is **accessible by construction** (the inputs are generated, so a slip repeats on every field):
  each error carries a deterministic id from its `errorPath` and is referenced by `aria-describedby`
  + `role="alert"` and persisted (not conditionally unmounted); a choice group's error and
  `aria-invalid` attach to the `<fieldset>` (mind the `RadioNodeList` from `form.elements.namedItem`);
  a blocked submit **focuses** the first invalid control; `required` is programmatic, not just `*`;
  and the success state is announced (`role="status"`);
- treats an `UNKNOWN_VALUE_ERROR` on a correctly-spelled target, or a `NOT_ALLOWED_VALUE_ERROR` on a
  choice field, as a **seed** gap to fix in `setup-forms.md` — not a frontend bug.
