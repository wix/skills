---
name: "Create Form"
description: "Creates a visitor-fillable Wix form with Form Schemas v4 — a contact or enquiry form, a signup or waitlist, an application, a survey, a quote request, and forms whose submissions create a contact. Ships the create request plus the silent breakers that leave a form empty or invisible. Changing an existing form is Update Form."
---
# RECIPE: Create a Wix Form

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`. Send `wix-site-id: <SITE_ID>` when the token is account-scoped.

Any form a visitor fills in — contact, signup, application, survey — in the **Forms & Submissions** dashboard, placeable in the Editor. Submissions become CRM contacts only via the per-field `contactMapping`. Event RSVPs belong to **Wix Events** ([Create Event](../events/create-wix-event.md)); booking forms to **Wix Bookings**.

**Non-negotiable**: never compose form and field payloads form memory, never guess their shape. Follow this recipe steps.

**Four things return a `200` and produce a form that is empty, wrong or invisible:** the wrong Forms app (STEP 0), a namespace other than `wix.form_app.form` (STEP 2), an invented `identifier` (STEP 1), any field left out of `steps[].layout` (STEP 2). Nothing errors, so get them right first time, and **never create throwaway "test" forms to probe the shape** — the form allowance is finite. Assemble it whole, POST once, verify.

---

## STEP 0: Confirm the app

Wix Forms **(New)** is `225dd912-7dea-4738-8688-4b8c6955ffc2` (automation trigger `wix_form_app-form_submitted`). `14ce1214-b278-a7e4-1373-00cebd1bef7c` is the **Old** app: never install it, and never read its presence as satisfying this API — you get `UNSUPPORTED_FORM_NAMESPACE`, and automations fail `FAILED_PRECONDITION: "Forms app is not installed"` though *an* app named Wix Forms is there.

```bash
curl -X GET 'https://www.wixapis.com/apps-installer-service/v1/app-instances' -H 'Authorization: <AUTH>'
```

If `225dd912-…` is absent, install it ([Install Wix Apps](../app-installation/install-wix-apps.md)); a fresh install reports `status: "UNKNOWN"` until it propagates, so retry an identity error **once**.

> **⚠️ Never size the form from `/v4/forms/providers-config`.** Its `restrictions` are the provider app's, declared once for **all** sites: a free site reports `maxFields: 150` there while the create rejects at 10. **The create is the only authority** — on a count error see § Plan caps.

---

## STEP 1: Compose the fields

1. Use the example table below to find the most relevant payload example. Do not start authoring payload from scratch.
2. Retrieve [create-form.md](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form.md) and find chosen example's payload, e.g.:

    ```bash
    EXAMPLE='Create a contact form'   # any Example name from the table below
    curl -sS 'https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form.md' \
      | awk -v h="### $EXAMPLE" '/^### /{p=($0==h)} p'
    ```

3. Copy relevant form fields, adapt and configure to match user's request, generate GUIDs, validation, etc.
4. If needed, read [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) - a definitive guide to form field configuration — it owns the `identifier` / `inputType` / `componentType` table and the `contactField` values

| Example name                           | Use it for |
|----------------------------------------|---|
| `Create a contact form`                | Name, email, phone, message, opt-in — contact-mapped |
| `Create a form with conditional logic` | Show, hide or require a field based on another answer (`formRules`) |
| `Create a customer feedback survey`    | Star rating, radio, checkbox group, rich-text intro |
| `Create a client onboarding form`      | Dropdown with a custom "other", tags, image choice, number, password |
| `Create a delivery scheduling form`    | Single-line address, date picker, time |
| `Create a billing details form`        | Company, tax ID, structured multi-line address |
| `Create a job application form`        | Job title, portfolio URL, birthdate, start date |
| `Create a waiver form`                 | Rich-text terms, file upload, signature — Core plan |
| `Create a donation form`               | Suggested and custom donation amounts — Core plan |
| `Create a product order form`          | Sell products, fixed fee — Core plan + Wix eCommerce |
| `Create a consultation booking form`   | Appointment slot picker — Wix Meetings |
| `Create a service booking form`        | Bookable service and extras — Wix Services |

**Keep these exactly as the example has them:**

- **`identifier`** — a predefined value from § Field types (`CONTACTS_FIRST_NAME`, `CONTACTS_LAST_NAME`, `CONTACTS_EMAIL`, `CONTACTS_PHONE`, `TEXT_INPUT`, `TEXT_AREA`, `DROPDOWN`, `RADIO_GROUP`, `CHECKBOX_GROUP`, `SUBMIT_BUTTON`, …). An invented one (`"product_name"`) stores and accepts submissions, but the **editor can't render it** and a form of them opens **empty**. The user's wording goes in the `label`, not here.
- **`inputType` and `componentType`** — both from one row of that table. Never adapt one kind's block into another's: an invalid pair (`STRING` + `CHECKBOX_GROUP`) builds no view and the field **disappears with no error**.
- **`contactMapping.contactField` + `pii: true`** — every field holding contact data carries them by default, so submissions create or update a contact. **Never `postSubmissionTriggers.upsertContact`**, which configures nothing.

**Change these — the examples' values are placeholders:**

- **`id`** — a fresh lowercase GUID per field (`uuidgen | tr 'A-Z' 'a-z'`). The examples' GUIDs are fixed, so two fields copied from one example collide (`DUPLICATED_FIELD_IDS`); the server also lowercases `id`, so an **uppercase** one stops matching its layout `fieldId` and the field is silently unplaced.
- **`target`** — the immutable submission key, unique lowercase `snake_case` (`first_name_f409`), held by every submission. Two fields sharing one is accepted and silently stores nothing for all but one (`DUPLICATED_FIELD_TARGETS`).
- **Every field setting** — presentation and behaviour live together in the field's component block (`textInputOptions`, `dropdownOptions`, `appointmentOptions`, …): `label` and `showLabel`, `placeholder` and `showPlaceholder`, `defaultValue`, plus kind-specific ones the examples carry — `numberOfColumns` and `customOption` on choice fields, `submitText` on the button, `use24HourFormat` / `firstDayOfWeek` / `showDateLabels` on date and time, `autocompleteEnabled` and `fieldSettings` on addresses, `durationInMinutes` / `staffIds` / `manualApprovalRequired` on appointment, `buttonText` and `explanationText` on file upload. Set each to what the user asked; any example phone number, postcode, currency or date is visitor-visible, so it follows the site's country.
- **`required`** — the one setting that is **not** in the component block: it sits at `inputOptions.required`, beside `target` and `inputType`. Inside `validation` it is accepted and **silently discarded**, and `validation` — a sibling of the component block, not part of it — carries value constraints only (`format`, `minLength`, `enum`, `items`, `uploadFileFormats`, `fileLimit`).
- **Each choice option's `id`** — its own fresh GUID (a slug is rejected — `options[N].id is not a valid GUID`), with `validation.enum` listing exactly the `value`s you kept.
- **Real entity IDs** — the service, product and appointment examples embed placeholder GUIDs: `servicesDropdownOptions.options[].id` / `value` and its `validation.enum`, `paymentOptions.validation.products[].id`, `appointmentOptions.staffIds`. Read the real IDs off the site first; a stale one renders an empty picker.

**A choice field declares its choices twice, and both must agree**: the `options[]` block (each with `id`, `value`, `label`) and `validation.enum` for `STRING`, or `validation.items.stringOptions.enum` + `itemType` for `ARRAY`. **An empty `validation` is a free-text field, not a dropdown** — accepted with a `200`.

> **⚠️ The `identifier`, not the `componentType`, routes a field to its renderer.** `identifier: "TEXT_INPUT"` with `componentType: "DROPDOWN"` returns `200` and comes back a `TEXT_INPUT` carrying `textInputOptions` — diagnose by which options block came home; re-adding the field with that identifier reproduces it.
>
> **⚠️ An ARRAY field fails *after* creation.** A malformed `arrayOptions.validation.items` reads back and summarizes fine, but **every** submission `400`s — set both `items.itemType` and `items.stringOptions.enum` and prove it with a real submission.

---

## STEP 2: One POST, all fields

**`namespace` is `wix.form_app.form`.** Under any other — notably the **non-existent `wix.form_platform.form`** — the form reads back fine over the API but is **completely invisible** in the dashboard and Editor.

**Every field, `SUBMIT_BUTTON` included, must sit in `steps[].layout`** — one item per field, its `fieldId` matching that field's `id`, lowercase GUIDs on both sides. An unplaced field stores values but renders **empty**.

```bash
curl -X POST 'https://www.wixapis.com/form-schema-service/v4/forms' \
  -H 'Content-Type: application/json' -H 'Authorization: <AUTH>' \
  -d '{ "form": {
    "name": "Contact form",
    "namespace": "wix.form_app.form",
    "formFields": [ ...one object per field, composed in STEP 1, with a SUBMIT_BUTTON
                    among them... ],
    "steps": [
      { "id": "<fresh guid>", "name": "Page 1", "layout": { "large": { "items": [
        { "fieldId": "<field 1 id>", "row": 0, "column": 0, "width": 12, "height": 1 },
        { "fieldId": "<field 2 id>", "row": 1, "column": 0, "width": 6,  "height": 1 },
        { "fieldId": "<submit id>",  "row": 2, "column": 6, "width": 6,  "height": 1 }
      ] } } }
    ]
  } }'
```

Fields sharing a `row` split it by `column` + `width` out of 12. Read `form.id` (the `formId`) and `form.name` — **names are unique per namespace**, so a collision silently saves a numbered variation.

---

## STEP 3: Verify (mandatory)

**A `200` proves nothing — every failure mode above returns one.**
1. **`GET /form-schema-service/v4/forms?namespace=wix.form_app.form&formIds=<formId>`** and diff: `formFields[]` covers **every** field, `steps` **places every one**, each `inputOptions.required` survived (a misplaced one is dropped silently), and **every returned `identifier` is a § Field types value** (an invented one survives this read intact, so nothing flags it). `namespace` is a **required query parameter**: omitting it returns `400 namespace has size 0, expected 10 or more`, a violation naming a field — fix the URL, not the payload.
2. **`GET /form-schema-service/v4/forms/<formId>/summary`. Assert `formSummary.fields` is NON-EMPTY and counts every input field sent** (`formFields[]` minus `SUBMIT_BUTTON` and display fields). Short or empty means the owner opens the Editor to an **empty form**: fix the placement or GUID casing, re-verify, **don't report success**.
3. **With an ARRAY field** (`CHECKBOX_GROUP` / `TAGS`), prove it accepts data — `POST /form-submission-service/v4/submissions` with `{ "submission": { "formId": "<formId>", "submissions": { "<target>": ["Option 1"] } } }` must return `200`, not `400 SUBMISSION_VALIDATION`; then `DELETE .../v4/submissions/{submissionId}`.
4. **Hand back the links** ([Forms Dashboard Navigation](./forms-dashboard-navigation.md)): `https://manage.wix.com/dashboard/{metaSiteId}/wix-forms/form/{formId}`, and that path + `/submissions`.

Changing it later is a `PATCH` ([Update Form](./update-form.md)), never a delete-and-recreate.

---

## Plan caps

A cap returns a real `400` and **blocks the run**: no schema means no `formId`, no `target`. **Never engineer around one** — above all **never split a form across several schemas**, which trades one submission record for several and burns more allowance. Put the choice to the user — reduce, or upgrade — with the MSID and upgrade link, then create and verify.

`Field count reached its limit of N` is the premium cap, counting **`INPUT` fields only** (free sites cap at 10); `FORM_FIELDS_COUNT_EXCEEDED` is the schema-service cap, counting **all** fields. Steps, conditions and total forms are capped too; file upload, signature and payment fields need a **Core plan or higher** — **never inline files as base64**. To free a slot delete only the install's own sample ("Get in touch"); anything else may be real content, so **ask first**.
