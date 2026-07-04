---
name: "Setup Forms"
description: Initializes a Wix Forms backend — deletes the install's default sample form, then creates one lead-capture form schema per requested form (fields + human-readable `target` keys + a `steps` layout so submissions render in the dashboard, `namespace` wix.form_app.form) and verifies each persisted. Specifies the *how* (calls + format); which forms, their fields, and counts come from the request (via `SEED.md` §3).
---
**RECIPE**: Business Recipe – Initial Setup for Wix Forms (Form Schemas v4)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`. Send `wix-site-id: <SITE_ID>` on every call.

A concise checklist for preparing any new Wix site that uses the **Wix Forms** app to capture leads (contact / inquiry / signup / RSVP-style forms).
**Notice** this recipe is for **initial backend setup ONLY**, not for coding the frontend.

> **This recipe is the *how*, not the *what*.** How many forms, each form's fields, and their labels come from the request you're fulfilling (via `SEED.md` §3). This recipe only specifies the calls and the request format; it does not decide which forms or fields to create.

> **API surfaces:** Wix Forms is a **standalone CRM API** — a form **schema** (the field definitions) is created on the **Form Schemas v4** service at `https://www.wixapis.com/form-schema-service/v4/forms`. In the docs portal this lives under **CRM ▸ Forms ▸ Form Schemas**, *not* under Business Solutions. This is **NOT** the events/bookings per-event registration form (a different thing). The Forms app's `appDefId` is `225dd912-7dea-4738-8688-4b8c6955ffc2`; an `UNSUPPORTED_FORM_NAMESPACE` error means the app isn't installed. Call the **public** host shown above (no `/_api/` prefix). There is no bulk endpoint — one POST per form.

---

## Article: Steps for Setting Up Wix Forms
**YOU MUST** complete the steps in order, without requiring additional user input: clean the default form (STEP 1) **before** creating yours (STEP 2), then verify (STEP 3).

**⚠️ CRITICAL ORDER REQUIREMENT: clean any pre-existing forms FIRST (STEP 1), before creating any form.** Listing-then-deleting before you create guarantees every id you delete is a pre-existing form, never one you just created — and it prevents a name collision (see STEP 1).

### STEP 1: Clean — remove any pre-existing (install-default) forms

A freshly installed Wix Forms app **may ship a default "Get in touch" form** (a contact form with `first_name` / `email` / `message` fields). Its presence is **not deterministic** — it was present on one freshly provisioned site and **absent** on another (polled repeatedly past the install-propagation window), so it appears provisioning/timing-dependent. Rather than assume, **list what's actually there and delete whatever comes back** — this is a safe no-op when the list is empty.

1. **List the existing forms** — `GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form`. `namespace` is a **required** query param. Collect every `form.id` from the response (`forms[].id`). On a fresh install this is **either empty or the single default form** — both are fine.
2. **Delete each** — `DELETE https://www.wixapis.com/form-schema-service/v4/forms/{formId}` (one call per id; returns `200 {}`). Because the list ran **before** any create, every id returned is a pre-existing form — safe to delete. If the list was empty, issue no DELETE (a correct no-op).

**⚠️ Why clean even though it's often a no-op: when the default "Get in touch" form IS present, form names collide and the service silently auto-suffixes.** Form names must be unique; if the request's form is also called "Get in touch" and a default exists that you didn't clean, the create succeeds but your form is renamed **"Get in touch 1"**, quietly diverging from the name the frontend expects. Cleaning first removes that hazard whenever the default happens to be present. (Observed live: with the default present, a second "Get in touch" create came back as "Get in touch 1".)

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
      { "id": "$SUBMIT", "identifier": "SUBMIT_BUTTON", "fieldType": "DISPLAY",
        "displayOptions": { "displayFieldType": "PAGE_NAVIGATION", "pageNavigationOptions": { "nextPageText": "Next", "previousPageText": "Back", "submitText": "Submit" } } },
      { "id": "$F1", "fieldType": "INPUT", "inputOptions": {
          "target": "first_name", "pii": true, "required": true, "inputType": "STRING",
          "stringOptions": { "validation": { "format": "UNKNOWN_FORMAT", "enum": [] }, "componentType": "TEXT_INPUT", "textInputOptions": { "label": "First name", "showLabel": true } } } },
      { "id": "$F2", "fieldType": "INPUT", "inputOptions": {
          "target": "email", "pii": true, "required": true, "inputType": "STRING",
          "stringOptions": { "validation": { "format": "EMAIL", "enum": [] }, "componentType": "TEXT_INPUT", "textInputOptions": { "label": "Email", "showLabel": true } } } },
      { "id": "$F3", "fieldType": "INPUT", "inputOptions": {
          "target": "message", "required": false, "inputType": "STRING",
          "stringOptions": { "validation": { "format": "UNKNOWN_FORMAT", "enum": [] }, "componentType": "TEXT_INPUT", "textInputOptions": { "label": "Message", "showLabel": true } } } }
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
- **Field envelope:** each field is `{ id, fieldType: "INPUT", inputOptions: { target, inputType: "STRING", stringOptions: { validation: { format, enum: [] }, componentType: "TEXT_INPUT", textInputOptions: { label, showLabel } } } }`. Use `inputType: "STRING"` + `componentType: "TEXT_INPUT"` for text fields. Set `required: true` on the fields the form must collect (defaults to `false`); mark `pii: true` on personal fields (name/email/phone). Richer field types (number, dropdown, checkbox group) follow the same envelope with a different `inputType`/`stringOptions`/`arrayOptions` — but plain STRING text covers the lead-capture case.

**⚠️ CRITICAL: every field MUST carry a `stringOptions.validation` block, or the field is NOT submittable — a visitor submission of it fails with `400 "must NOT have additional properties"`.** The submission validator builds its allowed-keys schema **only from fields that have a `validation` block**. A field created without one exists on the form and even renders, but any submission that includes its `target` is rejected as an unknown property (and `required` is silently dropped too) — the form looks fine but silently rejects real submissions. So give **every** field a `validation` block:
  - Plain text / name / message → `"validation": { "format": "UNKNOWN_FORMAT", "enum": [] }`.
  - Email → `"validation": { "format": "EMAIL", "enum": [] }`; phone → `"PHONE"`; URL → `"URL"`. (Full `format` enum: `UNKNOWN_FORMAT`, `DATE`, `TIME`, `DATE_TIME`, `EMAIL`, `URL`, `UUID`, `PHONE`, `URI`, `HOSTNAME`, `COLOR_HEX`, `CURRENCY`, `LANGUAGE`, `DATE_OPTIONAL_TIME`.)
  - **Use `UNKNOWN_FORMAT`, NOT `UNDEFINED`, on write.** The create/GET response echoes an unconstrained format back as `"UNDEFINED"` (and the docs' create example shows `"format": "UNDEFINED"`), but sending `"UNDEFINED"` on **create** fails with `400 "format enum must be in […]"` — `UNDEFINED` is the read-back value, not a writable one. Write `UNKNOWN_FORMAT`; it stores and reads back as `UNDEFINED`.
- `required` (at `inputOptions` level) lands in `validation.required` — but **only takes effect if the field has a `validation` block** (no block ⇒ `required` is dropped along with the field's submittability). This is another reason every field needs the block.
- If a create fails transiently on a fresh site (`5xx`, or an identity/propagation error right after install — the install returns `appInstance.status: "UNKNOWN"` until it propagates), retry the same call **once**; do not loop. (Create succeeded immediately in live testing, but keep the retry-once safety net.)

**⚠️ CRITICAL: include a `steps` layout + a `SUBMIT_BUTTON` DISPLAY field, or the Wix dashboard shows every submission EMPTY.** The form is technically submittable with INPUT fields alone — the submission *data* stores fine either way, and the headless frontend renders its own UI — BUT the Wix **Forms dashboard** (`Customers & Leads ▸ Forms & Submissions`) renders each submission's values against the form's **layout** (`formFields` + `steps`). A form seeded **without** a layout stores complete submissions that the dashboard displays as **blank** ("—" summary, empty details panel), so the site owner can't read their leads in the UI — it looks broken even though the data is intact. So always seed the layout:
  - Add a **`SUBMIT_BUTTON`** DISPLAY field (`fieldType: "DISPLAY"`, `displayOptions.displayFieldType: "PAGE_NAVIGATION"`) to `formFields`.
  - Add a **single `steps` entry** whose `layout.large.items[]` places **every** field (each INPUT + the submit button) by `fieldId`, one per row.
  - **Each `items[].fieldId` MUST equal the corresponding `formFields[].id`** — this is why the ids are generated **lowercase** up front (the server lowercases stored field ids; an uppercased layout `fieldId` would no longer match and the dashboard layout silently breaks).
  - A **single create call with the layout persists it** (verified) — no follow-up PATCH needed. (Omitting the layout was the confirmed cause of blank dashboard submissions; adding it via PATCH to an already-created form also fixes them retroactively.)

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

Read the **`form.id`** (→ the `formId` to keep and hand to the frontend) and each **`form.fields[].target`** (→ the input `name`s the frontend renders). The field definitions are normalized into **`fields`** (read `target`s here); because you sent a layout, **`formFields`** (the components) and **`steps`** (the layout) come back **populated** (a form seeded without a layout returns them empty — that's the blank-dashboard case above). The field `id`s are echoed **lowercased** — which is exactly why you generated them lowercase, so the `steps[].…fieldId`s still match. Downstream, the frontend binds by **`target`**, never by field id.

### STEP 3: Verify each form persisted (mandatory)

A `200` on create is not proof the form is queryable. After creating, **list once** and confirm every seeded form is present with its targets:

`GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form` — for each form you created, confirm its `id` appears, its `fields[].target` set matches what you sent, and its **`steps`** is non-empty (the layout persisted — a `steps: []` here means the dashboard will show blank submissions). If a form is missing or its layout didn't persist, re-create it once and re-verify; if it still fails, surface the response verbatim rather than reporting success.

**Keep** per form: the **`formId`** and the ordered list of field **`target`** keys (with each field's label and `required`) — that map is the producer for the coding handoff (the frontend sets each input's `name` = `target` and submits against the `formId`).

---

## Conclusion
Following these steps **in order** sets up a Wix Forms backend:
- Starts from a **clean form list** — any pre-existing form (the install's occasional default "Get in touch") is listed-then-deleted first (a safe no-op when none exists), avoiding the silent name-collision auto-suffix when a default is present.
- Contains exactly the forms the request calls for, each created in the **`wix.form_app.form`** namespace with unique, non-empty, immutable **`target`** keys per field.
- **Every field carries a `stringOptions.validation` block** (`UNKNOWN_FORMAT` for plain text, `EMAIL`/`PHONE`/… otherwise) — without it the field is created but **not submittable** (visitor submissions 400 as "additional properties"). This is what makes the seeded form actually accept the frontend's submissions.
- Each form is created **with a `steps` layout + a `SUBMIT_BUTTON`** whose `fieldId`s match the (lowercase) field ids — so the site owner's **Wix dashboard renders each submission's values** (a form seeded without a layout stores the data fine but the dashboard shows every submission blank).
- Contact-mapping (`postSubmissionTriggers`) is **not** relied upon (silently dropped here); submissions are captured against the schema regardless.
- Every form is **verified present** via a namespace list before completion.
- **Keep** per form the `formId` and its field `target` keys — the producer for the coding handoff.
