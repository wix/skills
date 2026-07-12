---
name: "Setup Forms"
description: Initializes a Wix Forms backend — deletes the install's default sample form, then creates one lead-capture form schema per requested form (fields + human-readable `target` keys + each INPUT's `CONTACTS_*` system `identifier` + a `steps` layout, so the form and its submissions render in the dashboard, `namespace` wix.form_app.form) and verifies each persisted via the form summary. Specifies the *how* (calls + format); which forms, their fields, and counts come from the request.
---
**RECIPE**: Business Recipe – Initial Setup for Wix Forms (Form Schemas v4)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`. Send `wix-site-id: <SITE_ID>` on every call.

A concise checklist for preparing any new Wix site that uses the **Wix Forms** app to capture leads (contact / inquiry / signup / RSVP-style forms).
**Notice** this recipe is for **initial backend setup ONLY**, not for coding the frontend.

> **This recipe is the *how*, not the *what*.** How many forms, each form's fields, and their labels come from the request you're fulfilling. This recipe only specifies the calls and the request format; it does not decide which forms or fields to create.

> **API surfaces:** Wix Forms is a **standalone CRM API** — a form **schema** (the field definitions) is created on the **Form Schemas v4** service at `https://www.wixapis.com/form-schema-service/v4/forms`. In the docs portal this lives under **CRM ▸ Forms ▸ Form Schemas**, *not* under Business Solutions. This is **NOT** the events/bookings per-event registration form (a different thing). The Forms app's `appDefId` is `225dd912-7dea-4738-8688-4b8c6955ffc2`; an `UNSUPPORTED_FORM_NAMESPACE` error means the app isn't installed. Call the **public** host shown above (no `/_api/` prefix). There is no bulk endpoint — one POST per form.

---

## Article: Steps for Setting Up Wix Forms
**YOU MUST** complete the steps in order, without requiring additional user input: clean the default form (STEP 1) **before** creating yours (STEP 2), then verify (STEP 3).

**⚠️ CRITICAL ORDER REQUIREMENT: clean any pre-existing forms FIRST (STEP 1), before creating any form.** Listing-then-deleting before you create guarantees every id you delete is a pre-existing form, never one you just created — and it prevents a name collision (see STEP 1).

### STEP 1: Clean — remove any pre-existing (install-default) forms

A freshly installed Wix Forms app **may ship a default "Get in touch" form** (a contact form with `first_name` / `email` / `message` fields). Its presence is **not deterministic** — some fresh installs ship it and others don't, so it appears provisioning/timing-dependent. Rather than assume, **list what's actually there and delete whatever comes back** — this is a safe no-op when the list is empty.

1. **List the existing forms** — `GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form`. `namespace` is a **required** query param. Collect every `form.id` from the response (`forms[].id`). On a fresh install this is **either empty or the single default form** — both are fine.
2. **Delete each** — `DELETE https://www.wixapis.com/form-schema-service/v4/forms/{formId}` (one call per id; returns `200 {}`). Because the list ran **before** any create, every id returned is a pre-existing form — safe to delete. If the list was empty, issue no DELETE (a correct no-op).

**⚠️ Why clean even though it's often a no-op: when the default "Get in touch" form IS present, form names collide and the service silently auto-suffixes.** Form names must be unique; if the request's form is also called "Get in touch" and a default exists that you didn't clean, the create succeeds but your form is renamed **"Get in touch 1"**, quietly diverging from the name the frontend expects. Cleaning first removes that hazard whenever the default happens to be present. (With the default present, a second "Get in touch" create comes back renamed "Get in touch 1".)

### STEP 2: Create each form schema (fields + targets)

Create the forms the request names — **one POST per form** to `POST https://www.wixapis.com/form-schema-service/v4/forms`. **How many forms, and each form's fields/labels, come from the request you're fulfilling — this step only gives the call and the required format.** (There is no bulk-create; issue one call per form. Forms are independent — no shared revision — so concurrent creates are safe, but typically it's just one form.)

**⚠️ CRITICAL: every field needs a client-generated LOWERCASE GUID `id` — GENERATE IT IN THE SHELL, never type one from memory.** Each `formFields[].id` must be a distinct valid GUID (two the same → `400 DUPLICATED_FIELD_IDS`). Generate one per INPUT field **plus** one for the submit button and one for the layout step. **Generate them LOWERCASE** — each id is referenced twice (once as `formFields[].id`, once as the layout's `steps[].layout.large.items[].fieldId`) and they must match, but the server **lowercases** stored field ids; an uppercase `uuidgen` id in the layout would no longer match the stored field id and the dashboard layout would break. So lowercase at generation:

```bash
# lowercase GUIDs — uuidgen (lowercased), with python3 / node fallbacks (both already lowercase)
lc() { uuidgen 2>/dev/null | tr 'A-Z' 'a-z' || python3 -c 'import uuid;print(uuid.uuid4())' || node -e 'console.log(crypto.randomUUID())'; }
F1=$(lc); F2=$(lc); F3=$(lc)   # one per INPUT field
SUBMIT=$(lc)                   # the submit-button (DISPLAY) field
STEP=$(lc)                     # the layout step (page)
```

**Request body shape** (a 3-field contact form — repeat/adjust the INPUT `formFields[]` and the matching layout `items[]` per the request):

```json
{
  "form": {
    "name": "Get in touch",
    "namespace": "wix.form_app.form",
    "formFields": [
      { "id": "$SUBMIT", "hidden": false, "identifier": "SUBMIT_BUTTON", "fieldType": "DISPLAY",
        "displayOptions": { "displayFieldType": "PAGE_NAVIGATION", "pageNavigationOptions": { "nextPageText": "Next", "previousPageText": "Back", "submitText": "Submit" } } },
      { "id": "$F1", "hidden": false, "identifier": "CONTACTS_FIRST_NAME", "fieldType": "INPUT", "inputOptions": {
          "target": "first_name", "pii": true, "required": true, "inputType": "STRING", "readOnly": false,
          "stringOptions": { "validation": { "format": "UNKNOWN_FORMAT", "enum": [] }, "componentType": "TEXT_INPUT", "textInputOptions": { "label": "First name", "showLabel": true } } } },
      { "id": "$F2", "hidden": false, "identifier": "CONTACTS_EMAIL", "fieldType": "INPUT", "inputOptions": {
          "target": "email", "pii": true, "required": true, "inputType": "STRING", "readOnly": false,
          "stringOptions": { "validation": { "format": "EMAIL", "enum": [] }, "componentType": "TEXT_INPUT", "textInputOptions": { "label": "Email", "showLabel": true } } } },
      { "id": "$F3", "hidden": false, "identifier": "CONTACTS_PHONE", "fieldType": "INPUT", "inputOptions": {
          "target": "phone", "pii": true, "required": false, "inputType": "STRING", "readOnly": false,
          "stringOptions": { "validation": { "format": "PHONE", "enum": [] }, "componentType": "TEXT_INPUT", "textInputOptions": { "label": "Phone", "showLabel": true } } } }
    ],
    "steps": [
      { "id": "$STEP", "name": "Page 1", "layout": { "large": { "items": [
        { "fieldId": "$F1", "row": 0, "column": 0, "width": 12, "height": 1 },
        { "fieldId": "$F2", "row": 1, "column": 0, "width": 12, "height": 1 },
        { "fieldId": "$F3", "row": 2, "column": 0, "width": 12, "height": 1 },
        { "fieldId": "$SUBMIT", "row": 3, "column": 0, "width": 12, "height": 1 }
      ], "sections": [] } } }
    ],
    "enabled": true
  }
}
```

**⚠️ CRITICAL FORMAT REQUIREMENTS:**
- **`namespace` MUST be `"wix.form_app.form"`** (the Wix Forms namespace) — any other value fails with `400 UNSUPPORTED_FORM_NAMESPACE`. It is immutable after create.
- **Every INPUT field MUST carry a non-empty `target`** — the human-readable key the frontend binds to (input `name` = `target`). An empty/missing target fails with `400 UNSUPPORTED_FIELD_TARGETS_NAME` (`MISSING_FIELD_TARGETS`). Targets are **immutable** (set once).
- **Targets MUST be unique within a form** — two fields sharing a target → `400 DUPLICATED_FIELD_TARGETS`. Use lowercase snake_case keys the frontend can reuse verbatim (`first_name`, `email`, `phone`, `message`).
- **Field envelope:** each field is `{ id, hidden: false, identifier: "<CONTACTS_*>", fieldType: "INPUT", inputOptions: { target, readOnly: false, inputType: "STRING", stringOptions: { validation: { format, enum: [] }, componentType: "TEXT_INPUT", textInputOptions: { label, showLabel } } } }`. The `identifier` is MANDATORY for dashboard rendering — see the CRITICAL identifier block below. Use `inputType: "STRING"` + `componentType: "TEXT_INPUT"` for text fields. Set `required: true` on the fields the form must collect (defaults to `false`); mark `pii: true` on personal fields (name/email/phone).

**Dropdown (enum) fields — concrete envelope.** A dropdown is still `inputType: "STRING"`; only the `componentType` and its options block change. Set `componentType: "DROPDOWN"` and put the choices under `stringOptions.dropdownOptions.options` as `{ id, label, value }` — the `value` is what a submission stores (keep it a stable machine key), and **every option needs its own lowercase GUID `id`** (see the CRITICAL below). Keep the `validation` block as with any field (a plain dropdown reads back `format: UNDEFINED`, so write `UNKNOWN_FORMAT`):

```jsonc
// generate an option GUID per choice in the shell, same lc() helper as the field ids:
//   O1=$(lc); O2=$(lc); O3=$(lc)
{ "id": "$F4", "hidden": false, "identifier": "budget", "fieldType": "INPUT", "inputOptions": {
    "target": "budget", "required": false, "inputType": "STRING", "readOnly": false,
    "stringOptions": {
      "validation": { "format": "UNKNOWN_FORMAT", "enum": [] },
      "componentType": "DROPDOWN",
      "dropdownOptions": {
        "label": "Budget", "showLabel": true, "placeholder": "Select a range",
        "options": [
          { "id": "$O1", "label": "Under $1k", "value": "under_1k" },
          { "id": "$O2", "label": "$1k–$5k",   "value": "1k_5k" },
          { "id": "$O3", "label": "$5k+",      "value": "5k_plus" }
        ]
      } } } }
```

Add a matching `steps[].layout.large.items[]` entry for its `fieldId` like any other field.

**⚠️ CRITICAL: every dropdown `options[]` entry MUST carry its own lowercase GUID `id` — a create without it 400s `options[N].id is not a valid GUID / must not be empty`.** The API spec marks the option `id` optional (it's for Multilingual translation), but the create validator **rejects an option with no `id`**. Generate one GUID per option in the shell (the same `lc()` helper used for field ids), exactly as you do for field/step ids — never type one from memory.

**⚠️ A custom dropdown's options round-trip in `fields[].view.options`, NOT `formFields[]` — and the frontend reads them from there.** Verified live (2026-07-12): a dropdown whose `identifier` is a plain custom key (like `"budget"` — dropdowns rarely map to a `CONTACTS_*` system field) is **dropped from `formFields[]` by the identifier→dashboard rule below**, so it does **not** show in the Wix dashboard summary — *but its data is fully captured and its options survive under `form.fields[].view.options` as `[{ id, label, value }]`* (alongside `view.label` / `view.placeholder`). That's exactly where the schema-driven frontend reads dropdown choices from (`how-to-code-forms.md` projects `fields[]`, not `formFields[]`), so **a custom dropdown renders and submits correctly on the headless site even though the dashboard doesn't list it.** So: seed the dropdown as the request needs; verify persistence on the GET round-trip (STEP 3) by asserting the field appears in `fields[]` with a non-empty `view.options`; and — as with any custom (non-`CONTACTS_*`) field — do **not** claim the dashboard fully renders it (platform limitation, same as the CRITICAL identifier block). If a dropdown *does* map cleanly to a contact field, give it the matching `CONTACTS_*` identifier and it will also show in the dashboard.

Other richer types (number, checkbox group, date) follow the same envelope with a different `inputType`/`stringOptions`/`arrayOptions` — but plain STRING text + dropdowns cover the lead-capture case.

**⚠️ CRITICAL: every field MUST carry a `stringOptions.validation` block, or the field is NOT submittable — a visitor submission of it fails with `400 "must NOT have additional properties"`.** The submission validator builds its allowed-keys schema **only from fields that have a `validation` block**. A field created without one exists on the form and even renders, but any submission that includes its `target` is rejected as an unknown property (and `required` is silently dropped too) — the form looks fine but silently rejects real submissions. So give **every** field a `validation` block:
  - Plain text / name / message → `"validation": { "format": "UNKNOWN_FORMAT", "enum": [] }`.
  - Email → `"validation": { "format": "EMAIL", "enum": [] }`; phone → `"PHONE"`; URL → `"URL"`. (Full `format` enum: `UNKNOWN_FORMAT`, `DATE`, `TIME`, `DATE_TIME`, `EMAIL`, `URL`, `UUID`, `PHONE`, `URI`, `HOSTNAME`, `COLOR_HEX`, `CURRENCY`, `LANGUAGE`, `DATE_OPTIONAL_TIME`.)
  - **Use `UNKNOWN_FORMAT`, NOT `UNDEFINED`, on write.** The create/GET response echoes an unconstrained format back as `"UNDEFINED"` (and the docs' create example shows `"format": "UNDEFINED"`), but sending `"UNDEFINED"` on **create** fails with `400 "format enum must be in […]"` — `UNDEFINED` is the read-back value, not a writable one. Write `UNKNOWN_FORMAT`; it stores and reads back as `UNDEFINED`.
  - **Length & pattern constraints go in the SAME `validation` block — seed them when the request asks for field rules.** `stringOptions.validation` also accepts `minLength` (int), `maxLength` (int), and `pattern` (a regex string) alongside `format`/`enum`. A request like "first name 2–40 chars", "message at least 20 chars", or "note capped at 500" maps directly to these. Verified live (2026-07-12): `"validation": { "format": "UNKNOWN_FORMAT", "enum": [], "minLength": 2, "maxLength": 12, "pattern": "^[A-Za-z ]+$" }` persists and reads back under `validation.string.{minLength,maxLength,pattern}`. **These constraints are enforced server-side by `createSubmission`** — a violating submit is rejected with a field violation (`errorPath` = the field's `target`, e.g. message `"must have between 2 and 12 characters"`), which the frontend surfaces inline (see `how-to-code-forms.md`). The frontend also reads them from the schema to pre-validate client-side, so seeding them is what makes owner-set field rules flow through with no code change. `pattern` is a standard JS-style regex; omit it unless the request calls for a specific character rule.
- `required` (at `inputOptions` level) lands in `validation.required` — but **only takes effect if the field has a `validation` block** (no block ⇒ `required` is dropped along with the field's submittability). This is another reason every field needs the block.
- If a create fails transiently on a fresh site (`5xx`, or an identity/propagation error right after install — the install returns `appInstance.status: "UNKNOWN"` until it propagates), retry the same call **once**; do not loop. (Creates typically succeed immediately, but keep the retry-once safety net.)

**⚠️ CRITICAL: include a `steps` layout + a `SUBMIT_BUTTON` DISPLAY field, or the Wix dashboard shows every submission EMPTY.** The form is technically submittable with INPUT fields alone — the submission *data* stores fine either way, and the headless frontend renders its own UI — BUT the Wix **Forms dashboard** (`Customers & Leads ▸ Forms & Submissions`) renders each submission's values against the form's **layout** (`formFields` + `steps`). A form seeded **without** a layout stores complete submissions that the dashboard displays as **blank** ("—" summary, empty details panel), so the site owner can't read their leads in the UI — it looks broken even though the data is intact. So always seed the layout:
  - Add a **`SUBMIT_BUTTON`** DISPLAY field (`fieldType: "DISPLAY"`, `displayOptions.displayFieldType: "PAGE_NAVIGATION"`) to `formFields`.
  - Add a **single `steps` entry** whose `layout.large.items[]` places **every** field (each INPUT + the submit button) by `fieldId`, one per row.
  - **Each `items[].fieldId` MUST equal the corresponding `formFields[].id`** — this is why the ids are generated **lowercase** up front (the server lowercases stored field ids; an uppercased layout `fieldId` would no longer match and the dashboard layout silently breaks).
  - A **single create call with the layout persists it** — no follow-up PATCH needed. (Omitting the layout is the cause of blank dashboard submissions; adding it via PATCH to an already-created form also fixes them retroactively.)

**⚠️⚠️ CRITICAL: every INPUT field MUST carry a system `identifier`, or it is DROPPED FROM `formFields[]` and NEVER shows in the dashboard.** This is the #1 dashboard-blank cause and it is SEPARATE from (and stronger than) the layout requirement above — a form can have a perfect `steps` layout and still be blank. On create, the server keeps an INPUT field's component in `formFields[]` **only if its `identifier` is a recognized system value.** Without a recognized identifier (no identifier, a custom string, an extended-field key like `custom.x`, or a GUID — all fail) the field is normalized into the legacy `fields[]` array **only**, `formFields[]` comes back holding just the `SUBMIT_BUTTON`, and `GET .../{formId}/summary` returns **zero fields** → the Wix dashboard renders the form and every submission **blank**. (The public headless site still submits fine — the submission service matches by `target` — so this defect is invisible from the frontend; you must verify it server-side in STEP 3.)
  - **Map each field to its contact identifier.** Set `identifier` on every INPUT field to the `CONTACTS_*` value for what it collects. Verified working: `CONTACTS_FIRST_NAME`, `CONTACTS_LAST_NAME`, `CONTACTS_EMAIL`, `CONTACTS_PHONE`. (The contacts schema has more system fields — address, company, birthdate, etc.; use the matching `CONTACTS_*` identifier. `SUBMIT_BUTTON` is the identifier for the DISPLAY submit field.)
  - **⚠️ Custom (non-contact) fields do NOT render in the dashboard via this API.** A field with no matching `CONTACTS_*` identifier (e.g. "medical conditions", "fitness goal", a waiver checkbox) cannot be made to appear in the Wix Forms dashboard through `form-schema-service/v4/forms` — registering a Contacts extended field and referencing its `custom.<key>` does **not** work. Such fields still store submission data correctly (frontend + `fields[]` + submission records) but the owner won't see them in the dashboard UI. **So: for lead-capture forms the request should lean on contact-mappable fields (name / email / phone / address / company / birthdate). If the request genuinely needs custom fields, seed them anyway (data is captured) but do NOT report the dashboard as fully rendering — only the contact-mapped fields will show.** This is a platform limitation, not a seed bug; surface it rather than silently shipping a half-blank dashboard.
  - Also set `hidden: false` on each field and `readOnly: false` in `inputOptions` (matches the shape shown in the docs).

**⚠️ Do NOT rely on `postSubmissionTriggers.upsertContact` (contact mapping) through this endpoint — it is SILENTLY DROPPED.** The docs' create example includes a `postSubmissionTriggers.upsertContact.fieldsMapping` block to auto-create a CRM contact from a submission. Live, the create returns `200` **but the trigger is not persisted** (absent from a follow-up GET — the same silent-drop pattern as CMS multi-refs at insert). Don't depend on it in the seed. You don't need it: **form submissions are recorded against the schema regardless**, so leads are captured by the seeded form's `formId` on their own. The seed's job ends at the schema + targets.

**⚠️ Reading the response — read the field `target`s from `form.fields[]`; the layout persists under `form.formFields[]` + `form.steps[]`.** A successful create returns `200` with:

```json
{ "form": {
    "id": "<formId>",
    "fields": [
      { "id": "<field-id>", "target": "first_name", "view": { "label": "First name" }, "pii": true },
      { "id": "<field-id>", "target": "email", "validation": { "string": { "format": "EMAIL" }, "required": true } }
    ],
    "formFields": [ /* the field components incl. the submit button */ ],
    "steps": [ /* the layout you sent */ ],
    "namespace": "wix.form_app.form", "name": "Get in touch", "enabled": true
} }
```

Read the **`form.id`** (→ the `formId` to keep and hand to the frontend) and each **`form.fields[].target`** (→ the input `name`s the frontend renders). **All** field definitions are normalized into **`fields[]`** (read `target`s here) — but **`formFields[]` only echoes back the components the server materialized: the `SUBMIT_BUTTON` plus each INPUT that carried a recognized `CONTACTS_*` identifier** (see the CRITICAL identifier block above). `steps` echoes the layout you sent. So `fields[]` having all N fields does NOT mean the dashboard will render them — `formFields[]` / summary is the dashboard-truth source. The field `id`s are echoed **lowercased** — which is exactly why you generated them lowercase, so the `steps[].…fieldId`s still match. Downstream, the frontend binds by **`target`**, never by field id.

### STEP 3: Verify each form persisted (mandatory)

A `200` on create is not proof the form is queryable. After creating, **list once** and confirm every seeded form is present with its targets:

`GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form` — for each form you created, confirm its `id` appears, its `fields[].target` set matches what you sent, and its **`steps`** is non-empty (a `steps: []` means the layout didn't persist).

**⚠️ Then verify the dashboard will actually render — call `GET https://www.wixapis.com/form-schema-service/v4/forms/{formId}/summary` and assert `formSummary.fields` is NON-EMPTY and its count equals the number of contact-mapped INPUT fields you seeded.** This is the reliable dashboard-truth check: the summary returns exactly the fields the Wix dashboard shows (i.e. the `formFields[]` components, minus the submit button). A `summary.fields: []` (or a count short of your contact-mapped inputs) means the identifier mapping failed and the dashboard is blank for those fields — **do not report success; fix the `identifier`s (STEP 2 CRITICAL block) and re-create.** Expect the summary count to equal your contact-mappable fields only; if the form has custom (non-`CONTACTS_*`) fields, they will be legitimately absent from the summary (platform limitation) — call that out in the handoff rather than treating it as a pass or a hard failure.

If a form is missing, its layout didn't persist, or its summary is unexpectedly empty, re-create it once and re-verify; if it still fails, surface the response verbatim rather than reporting success.

**Keep** per form: the **`formId`** and the ordered list of field **`target`** keys (with each field's label and `required`) — that map is the producer for the coding handoff (the frontend sets each input's `name` = `target` and submits against the `formId`).

---

## Conclusion
Following these steps **in order** sets up a Wix Forms backend:
- Starts from a **clean form list** — any pre-existing form (the install's occasional default "Get in touch") is listed-then-deleted first (a safe no-op when none exists), avoiding the silent name-collision auto-suffix when a default is present.
- Contains exactly the forms the request calls for, each created in the **`wix.form_app.form`** namespace with unique, non-empty, immutable **`target`** keys per field.
- **Every field carries a `stringOptions.validation` block** (`UNKNOWN_FORMAT` for plain text, `EMAIL`/`PHONE`/… otherwise) — without it the field is created but **not submittable** (visitor submissions 400 as "additional properties"). This is what makes the seeded form actually accept the frontend's submissions.
- Each form is created **with a `steps` layout + a `SUBMIT_BUTTON`**, AND **every INPUT field carries its `CONTACTS_*` system `identifier`** — both are required for the site owner's **Wix dashboard to render** the form and its submissions. A field with no recognized identifier is dropped from `formFields[]`/summary and shows blank (the data is still stored). Custom (non-contact) fields cannot render in the dashboard via this API (platform limitation) — captured as data only.
- Dashboard rendering is **verified via `GET .../forms/{formId}/summary`** (non-empty, count == contact-mapped inputs), not merely by `steps` being present.
- Contact-mapping (`postSubmissionTriggers`) is **not** relied upon (silently dropped here); submissions are captured against the schema regardless.
- Every form is **verified present** via a namespace list before completion.
- **Keep** per form the `formId` and its field `target` keys — the producer for the coding handoff.
