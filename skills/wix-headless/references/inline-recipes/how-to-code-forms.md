---
name: "How to Code Forms"
description: The frontend contract for Wix Forms — reading the live form schema (`@wix/forms` `forms.getForm`/`queryForms`/`listForms`, anonymous visitor, NO `auth.elevate`) to render fields schema-driven, then the `submissions.createSubmission(submission, options)` write path, keying the `submissions` map by each field's `target` (not label/id), why the anonymous visitor can submit with no captcha and no `auth.elevate`, why *submissions* read-back is owner-only, and the `_id` result field. Specifies the *how* (modules + exact calls + the failure modes the docs omit); which forms to render come from the request.
---
**RECIPE**: How to Code a Wix Forms Frontend (`@wix/forms`, Form Submissions v4)

A concise contract for writing the **frontend code** that renders a seeded form and submits it: **reading the live schema to build the inputs**, collecting the values, and creating a submission. **This recipe is the *how* (which modules, which calls), not the *what*** — which forms to render, how the page looks, and the framework are decided by the request you're fulfilling.

> **This recipe is for CODING the frontend, not for seeding it.** It assumes the form schema already exists (created by `setup-forms.md`) — you have each form's `formId` from the seed's `seeded.forms` map. **The field set, order, labels, `required`, validation format, and dropdown options are read live from the schema at render time** (see "Rendering" below) — the handoff carries only the `formId`. It says nothing about creating forms — only how to read, render, and submit them from frontend code.

> **Render schema-driven by default — read the schema and generate the inputs.** This is the standard path for **every** forms site and what this section documents: render inputs from the live form schema (field set, order, labels, `required`, format→type, length/pattern constraints, dropdown options) so an owner edit in the Wix dashboard reflects on the site with no code change, and so the submit map can never desync from the schema. **A form with a dropdown/enum field, or a site with more than one form, is NOT a reason to hardcode — it's the opposite:** dropdown options and per-field validation come *from* the schema, so hardcoding them is strictly more code and more drift. Each form simply reads its own schema by `formId`.
>
> **The ONLY exception is a brief that is explicitly design-led** — where the visual design is the whole point, the form is a small fixed part of a hand-crafted layout, and dashboard-editability is explicitly not a goal (e.g. the `inquiry-design` wedding-photographer brief). There you may hardcode `<input name="<target>">` from the known field set — the `target`s are still the contract (see "Submitting"). Even then, prefer schema-driven if the form has a dropdown or non-trivial validation. **If the brief doesn't call out design as the priority, render schema-driven.** "It has two forms" / "it has a dropdown" / "it's a simple contact form" are all still schema-driven.

> **⚠️ Reading rule — always append `?apiView=SDK` to every doc link below.** The Wix docs render two views of the same page. The **bare / REST view** shows the wrapped REST body (`{ submission: {…} }`) and an `id` field; the **`?apiView=SDK` view** shows the SDK call (`submissions.createSubmission(submission, options)`) and the normalized **`_id`** field. The SDK is what your frontend calls; reading the REST view leads to the wrong call signature and the `id`-vs-`_id` trap.

---

## The module and the client (read this first)

**⚠️ Two modules of `@wix/forms`, both used from the frontend:**
- **`forms`** — reads the form **schema** to render fields: `import { forms } from "@wix/forms"`, then `forms.getForm(formId)` / `forms.queryForms(query)` / `forms.listForms(namespace)`.
- **`submissions`** — writes a submission: `import { submissions } from "@wix/forms"`, then `submissions.createSubmission(submission, options)`.

(The frontend **reads** schemas and **writes** submissions; it never *creates* schemas — that's the seed.)

| Need | Package | Module / export |
|---|---|---|
| Read a form schema (render its fields) | `@wix/forms` | `forms` |
| Submit a form (create a submission) | `@wix/forms` | `submissions` |

**⚠️ CRITICAL (Gate 0, verified live 2026-07-05): a plain anonymous visitor token reads the form schema — NO `auth.elevate`, no backend, no owner creds.** `forms.getForm(formId)` / `forms.listForms("wix.form_app.form")` return **200** with the full schema (all `formFields`, `fields[]` with `target`+`validation`+`view.label`, the `steps` layout, `submitSettings`) on the same visitor client that submits. **This contradicts the docs**: the API spec lists every read method (`getForm`/`queryForms`/`listForms`/`getFormSummary`) as requiring the owner scope `WIX_FORMS.FORM_SCHEMA_READ` ("Manage Submissions"), and every SDK example ships an "(with elevated permissions)" variant. **Trust the live 200, not the permission table** — Wix grants implicit visitor read for published-site rendering. **Do NOT add `auth.elevate` to the read** (v1's Astro path did, unnecessarily); a pure SPA/static frontend can't elevate anyway and doesn't need to. Schema-driven rendering is therefore **universal — every framework, including a pure static SPA, with no server or proxy.**

**Submissions read-back stays owner-only.** Only the *schema* read is visitor-accessible. **Reading submissions back** (`querySubmissionsByNamespace`, `getSubmission`, `countSubmission`) requires the owner permission `WIX_FORMS.SUBMISSION_READ_ANY` and is **not** available to a visitor — don't try to list/confirm submissions from the frontend. The submit's resolved promise **is** your success signal (show a thank-you); the lead lands in the site owner's dashboard.

**Auth / client — framework split (the SAME client both reads the schema and submits — no elevate on either, per Gate 0):**
- **Astro (Wix-managed):** authentication is ambient. Call `forms.getForm(...)` / `forms.listForms(...)` in the page frontmatter / a server route, and `submissions.createSubmission(...)` from a server route (`src/pages/api/*.ts`) or a server action — **no `createClient`, no `OAuthStrategy`, no `clientId`, no `auth.elevate`.** (The schema read can equally run client-side; server-side in SSR is simplest so the fields are in the initial HTML.)
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client with **both** modules and reuse it — the read runs **client-side**, no server needed:
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

**⚠️ CRITICAL: do NOT call `auth.elevate` to submit.** An anonymous visitor **can** create a submission on the plain visitor token (it stamps `submitter.visitorId`). A pure SPA/static frontend has **no server and cannot elevate** anyway. (The Velo docs example wraps `createSubmission` in `auth.elevate` inside a backend `web.js` — that's the Velo hosted pattern, **not** the headless visitor path; ignore it here.)

---

## The features (build the ones the site needs)

A forms frontend is essentially one feature — **render the fields, then submit** — plus the render/validation details around it. Implement it once per form the site shows.

### Rendering the inputs (read the schema, then bind `name` = `target`)

**Read the live schema, project its `fields` into a render model, and generate one input per field.** The field's **`target`** (the immutable snake_case key — `first_name`, `email`, `message`) becomes the input's **`name`** — it's the contract the submission must use. Because the inputs are generated from the schema, the field **set, order, labels, `required`, validation format, length/pattern constraints, and dropdown options** all track the dashboard: a field the owner adds/removes/relabels — or a constraint they tighten — reflects on the site with no code change.

**1 · Fetch the schema** (visitor token, no elevate — Gate 0). `getForm` resolves to the **`Form` directly** (not `{ form }`-wrapped). Fetch by id when you have it (the handoff carries `formId`), else discover by namespace:

```js
import { forms } from '@wix/forms';   // Astro: call directly. Non-Astro: client.forms

const form = await forms.getForm(SEEDED_FORM_ID);          // from seeded.forms[].formId; returns the Form
// or discover: const { forms: list } = await forms.listForms('wix.form_app.form'); const form = list[0];
```

**2 · Project `form.fields` into a render model — read `fields[]`, NOT `formFields[]`.** ⚠️ **This is the one shape trap that decides whether custom dropdowns render at all, and it has a typing wrinkle — read this whole paragraph.** The response carries **two** field arrays:
- **`formFields[]`** — the *dashboard-materialized* subset, and the only one in the SDK's typed `Form`. A field whose `identifier` isn't a recognized `CONTACTS_*` value is **dropped from `formFields[]`** server-side. **Every dropdown falls in this bucket** (dropdowns don't map to a `CONTACTS_*` system field — `identifier: "budget"`, `"subject"`, etc.), so `formFields[]` carries **no dropdown at all**, let alone its options. A `formFields[]`-based projection silently renders zero `<select>`s.
- **`fields[]`** — the *complete* normalized list: **every** field (contact-mapped *and* custom), each with `target`, `view.label`/`view.placeholder`/**`view.options`** (the dropdown choices, as `[{id,label,value}]`), and `validation`. This is the source you want. **Caveat:** `fields[]` is returned by the endpoint at runtime but is **not in the SDK's TypeScript `Form` type** (which types only `formFields`) — access it as `(form as any).fields` / cast it. **Verify during the live eval that the visitor SDK read actually surfaces `fields[].view.options`** (Gate 0 confirmed the visitor gets the full schema via REST; confirm the SDK wrapper preserves `fields`). If a particular SDK build strips it, read the schema with a **direct visitor-token `fetch`** to `GET https://www.wixapis.com/form-schema-service/v4/forms/{formId}` instead — same 200, same `fields[]`.

**Project from `fields[]`** (shape verified live 2026-07-12):

```js
const fields = ((form /* as any */).fields ?? [])      // `fields` is runtime-present but untyped — cast in TS (see caveat above)
  .filter((f) => f.target && !f.hidden)                 // INPUT fields carry a `target`; skip the submit button
  .map((f) => ({
    target: f.target,                                    // → input `name`
    label: f.view?.label ?? f.target,
    placeholder: f.view?.placeholder ?? '',
    required: f.validation?.required ?? false,
    format: f.validation?.string?.format,                // EMAIL | PHONE | URL | UNDEFINED | …
    minLength: f.validation?.string?.minLength,          // owner-set length/pattern constraints —
    maxLength: f.validation?.string?.maxLength,          // carry them so the client validates them too,
    pattern: f.validation?.string?.pattern,              // not just the server (see "client-side validation" below)
    viewFieldType: f.view?.fieldType,                    // echoes the identifier: CONTACTS_*, TEXT_AREA, or a custom key
    options: f.view?.options?.map((o) => ({              // present ⇒ this is a dropdown/enum field
      value: o.value ?? o.label ?? '',
      label: o.label ?? o.value ?? '',
    })),
  }));
```

**3 · Render `fields.map(...)`**, deriving the control from the projected model — **a dropdown is signalled by `options`, a textarea by `viewFieldType`/`target`, the input `type` by `format`:**

```jsx
fields.map((field) => {
  // Dropdown → <select> — detected by the presence of `options` (works for custom dropdowns too)
  if (field.options?.length) {
    return (
      <label key={field.target}>{field.label}{field.required && ' *'}
        <select name={field.target} required={field.required} defaultValue="">
          <option value="" disabled>{field.placeholder || 'Select…'}</option>
          {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  // Textarea — detected by viewFieldType/target (see gotcha below), NEVER a componentType
  if (field.viewFieldType === 'TEXT_AREA' || field.target === 'message') {
    return (
      <label key={field.target}>{field.label}{field.required && ' *'}
        <textarea name={field.target} required={field.required} rows={4}
          minLength={field.minLength} maxLength={field.maxLength} />
      </label>
    );
  }
  // Text input — derive `type` from the validation format; stamp the schema's constraints
  const type =
    field.format === 'EMAIL' ? 'email' :
    field.format === 'PHONE' ? 'tel' :
    field.format === 'URL' ? 'url' : 'text';
  return (
    <label key={field.target}>{field.label}{field.required && ' *'}
      <input name={field.target} type={type} required={field.required} placeholder={field.placeholder}
        minLength={field.minLength} maxLength={field.maxLength} pattern={field.pattern} />
    </label>
  );
});
```

**⚠️ Detection signals — off `fields[].view`, never a `componentType`.**
- **Dropdown:** `field.view.options?.length` (a non-empty array). Custom dropdowns keep their options here even though they're absent from `formFields[]`. Don't look for a `"DROPDOWN"` componentType on `fields[]` — there isn't one.
- **Textarea:** `field.view.fieldType === "TEXT_AREA"` **or** `field.target === "message"`. The seed marks a textarea via `identifier: "TEXT_AREA"`, which reads back as `view.fieldType`; the underlying `componentType` is always `"TEXT_INPUT"` (there is no `"TEXT_AREA"` componentType). Keying off componentType would render every text field single-line.
- **Format:** `field.validation.string.format` reads back as `"UNDEFINED"` for unconstrained text (you seed `UNKNOWN_FORMAT`; it's stored as `UNDEFINED`) and `EMAIL`/`PHONE`/`URL`/… otherwise — map it to the input `type`.

### Validation — schema-driven on the client, authoritative on the server

The schema carries the validation rules too: `required`, the `format` (EMAIL/PHONE/URL), and `minLength`/`maxLength`/`pattern`. **Two layers, and the split matters:**

**Server (authoritative).** `createSubmission` enforces the field's `validation` block server-side. Any violation — missing required, bad email, too short/long, pattern mismatch — comes back as `err.details.validationError.fieldViolations[].data.errors[].errorPath` (= the field's `target`) with a human message (e.g. `"must have between 2 and 12 characters"`). You **must** map these back to per-input errors (see the mapping in "Submitting"); this is the backstop that always holds even if a rule is missed client-side.

**Client (schema-driven UX).** Pre-validate from the *same projected constraints* so the user gets inline feedback before a round-trip — and **derive every check from the schema, never from the field name.** ⚠️ The common mistake (seen in practice) is keying the email check on `target === "email"`; do it off `format` so an owner-added PHONE/URL/length rule is honored with no code change:

```js
function fieldError(field, raw) {
  const v = (raw ?? '').trim();
  if (field.required && !v) return `${field.label} is required.`;
  if (!v) return '';                                              // optional + empty → ok
  if (field.minLength && v.length < field.minLength) return `${field.label} must be at least ${field.minLength} characters.`;
  if (field.maxLength && v.length > field.maxLength) return `${field.label} must be at most ${field.maxLength} characters.`;
  if (field.format === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Please enter a valid email address.';
  if (field.format === 'URL'   && !/^https?:\/\/.+/.test(v)) return 'Please enter a valid URL.';
  if (field.format === 'PHONE' && !/^[+()\-\s\d]{7,}$/.test(v)) return 'Please enter a valid phone number.';
  if (field.pattern && !new RegExp(field.pattern).test(v)) return `${field.label} is not in the expected format.`;
  return '';
}
```

Run it over the projected `fields` on submit (and optionally on blur); block the submit if any returns non-empty. The `<input>`/`<textarea>` also carry `minLength`/`maxLength`/`pattern` and (for text) the format-derived `type` from the render step, so native constraints reinforce the JS checks. **Don't hardcode a fixed field list or a per-field rule** — both the render and the validation read the live schema, so a dashboard-added constraint (a new `maxLength`, a stricter `pattern`) takes effect on the site with no code change.

**The `steps` layout is Phase-2 concern — ignore it for Phase 1.** The schema also carries a `steps` layout (rows/columns/multi-page); Phase 1 renders a flat, stacked list in `fields` order and the frontend owns its own visual layout. (Honoring `steps` for side-by-side / multi-page rendering is a separate, later capability.)

**Drift-safety — why schema-driven closes the desync.** Because every input is generated from the live schema, the submit map is built from the *same* `target`s the form actually declares, so an owner-side field add/remove/relabel in the dashboard **cannot** desync the frontend from the schema: a new field renders and submits, a removed field disappears, and there is no hand-maintained `target` list to drift out of sync. The "unseeded/misspelled target → `400 additional properties`" foot-gun (below) therefore disappears for owner edits — a mismatched key can now only come from the *seed* omitting a field's `validation` block, not from stale frontend markup.

### Submitting (create a submission)

Collect the input values into a **`submissions` object keyed by `target`**, and call `createSubmission`. Doc: <https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/create-submission?apiView=SDK>

```js
import { submissions } from '@wix/forms';   // Astro: call directly. Non-Astro: client.submissions

async function submitContact(formEl) {
  const data = Object.fromEntries(new FormData(formEl)); // { first_name, email, message } — keys already = targets
  const { _id } = await submissions.createSubmission({
    formId: SEEDED_FORM_ID,          // from seeded.forms[].formId
    submissions: data,               // map of target -> value
  });
  return _id;                        // success signal; then render a thank-you
}
```

**⚠️ CRITICAL: `createSubmission` takes POSITIONAL args — `createSubmission(submission, options)`, NOT `createSubmission({ submission })`.** The first argument **is** the submission object (`{ formId, submissions }`) directly; the optional second argument is `options` (e.g. `captchaToken`). Wrapping it as `{ submission: {…} }` is the REST body shape and does not type-check against the SDK.

**⚠️ CRITICAL: the `submissions` map is keyed by each field's `target` — never by the label or the field id.** `{ submissions: { first_name: "Jane", email: "j@x.com" } }` — the keys must be the exact `target`s the schema declares. A key that isn't a schema target (a label like `"First name"`, a guessed key, a field GUID) is rejected with **`400 "must NOT have additional properties"`** (the whole submission fails, not just that field). This is why the render step binds **`name` = `target`** (from the projected schema) — a plain `FormData → Object.fromEntries` then yields the right keys for free.

**⚠️ CRITICAL: a submission of a field the seed did NOT give a validation block also 400s "additional properties" — that's a SEED bug, not a frontend bug.** Wix Forms only accepts submission keys for fields that were seeded **with a `stringOptions.validation` block** (`setup-forms.md` STEP 2). If a submit rejects a target you're sure you're spelling right (`{ additionalProperty: "message" }`), the field was seeded without a validation block — fix the **seed** (add the block), don't mangle the frontend key. Symmetrically, **omitting a `required` field** 400s with a validation error — send every required target.

**⚠️ The result id is `_id`, not `id`.** The SDK normalizes the created submission to `_id` (the REST view shows `id`). Read `result._id` if you need it; for lead capture you usually just need the promise to resolve, then show a thank-you. Do **not** call `confirmSubmission` — it's an owner-only management call and unnecessary for lead capture (the submission is recorded on create).

**⚠️ Per-field validation errors — map `fieldViolations[].data.errors[].errorPath` back to the input.** When a submit fails server-side validation (e.g. a malformed email), the rejection carries per-field detail at `err.details.validationError.fieldViolations[]`, each with a `data.errors[]` array whose `errorPath` is the field's `target` and `errorMessage` is the message. Project it into a `{ target → message }` map to show inline errors next to the right input, rather than a single form-level error:

```js
const violations = err?.details?.validationError?.fieldViolations ?? [];
const fieldErrors = {};
for (const v of violations)
  for (const fe of (v?.data?.errors ?? []))
    if (fe.errorPath && !fieldErrors[fe.errorPath]) fieldErrors[fe.errorPath] = fe.errorMessage ?? 'Invalid value';
```

### Spam protection (only if the site raised it)

The seed leaves `spamFilterProtectionLevel` at its default (`ADVANCED`), and an anonymous visitor submit **still succeeds without a captcha token** on the headless SDK path. So you normally pass **no** `options`. Only if a site is configured to *require* a CAPTCHA do you need to solve one and pass it as the second arg: `createSubmission(submission, { captchaToken })`. Don't add captcha plumbing speculatively — the default path needs none.

---

## Conclusion
A correct Wix Forms frontend:
- **reads the live schema** with the **`forms`** export of **`@wix/forms`** (`getForm`/`listForms`/`queryForms`) on the **plain visitor token — NO `auth.elevate`** (Gate 0: schema read is visitor-accessible on every framework incl. pure SPA, despite the docs marking it owner-scoped), and renders **schema-driven**: projects **`form.fields`** (the complete list — NOT `formFields`, which drops custom dropdowns) → `{ target, label, placeholder, required, format, minLength, maxLength, pattern, viewFieldType, options }` and generates one input per field so a dashboard field add/remove/relabel — or a changed constraint — reflects with no code change;
- derives the control from `fields[].view` — **`<select>`** when `view.options` is non-empty (works for custom dropdowns), **`<textarea>`** when `view.fieldType === "TEXT_AREA"` or `target === "message"` (**never** off a componentType), else an `<input>` whose `type` comes from `validation.string.format`, with `minLength`/`maxLength`/`pattern` stamped on;
- **validates schema-driven on the client and treats the server as authoritative**: pre-checks `required` + `minLength`/`maxLength`/`pattern` + format **keyed off `field.format`, never the field name**; and always maps `createSubmission`'s `fieldViolations[].data.errors[].errorPath` back to per-input errors as the backstop;
- imports the **`submissions`** export of **`@wix/forms`** and calls **`submissions.createSubmission(submission, options)`** — **positional args**, the submission object first (never `{ submission }`-wrapped);
- binds each input's **`name` = the schema's `target`** and builds the **`submissions` map keyed by `target`** (not label, not field id) — a wrong/unseeded key 400s the whole submission as "additional properties"; maps `fieldViolations[].data.errors[].errorPath` back to per-input errors;
- **only writes submissions** — reading *submissions* back is owner-only, so the resolved promise is the success signal (show a thank-you); never `confirmSubmission` (owner-only, unneeded);
- submits on the **plain visitor token with NO `auth.elevate`** (anonymous submit works; a pure SPA can't elevate anyway) and, at the default `ADVANCED` protection, **no captcha**;
- reads the created id as **`result._id`**, never `result.id`;
- treats a `400 "additional properties"` on a correctly-spelled target as a **seed** gap (the field lacks a `stringOptions.validation` block — fix `setup-forms.md`), not a frontend bug — and because inputs are schema-generated, this can no longer be caused by stale frontend markup.
