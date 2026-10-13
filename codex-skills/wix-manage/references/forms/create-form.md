---
name: "Create Form"
description: "Creates a visitor-fillable Wix form with Form Schemas v4 — a contact or enquiry form, a signup or waitlist, an application, a survey, a quote request, and forms whose submissions create a contact. Ships a complete create request, plus the field table for every kind Wix supports — dropdown, choice, file upload, rating, address, payment, and the silent breakers that produce an empty or invisible form. Changing a form that already exists is Update Form."
---
# RECIPE: Create a Wix Form

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`. Send `wix-site-id: <SITE_ID>` when the token is account-scoped.

Create a form on a Wix site that appears in the **Forms & Submissions** dashboard and can be placed in the Editor. Wix Forms backs **any form a visitor fills in** — a contact or enquiry form, a signup or waitlist, an application, a survey, a quote request, a registration questionnaire, etc. Whether a submission also becomes a CRM contact is the optional per-field `contactMapping` (§ Contact fields).

**Two exceptions — route there instead:**

| The ask                   | Owner |
|---------------------------|-------|
| RSVP to an event          | **Wix Events**, which ships its own registration form — [Create Event](../events/create-wix-event.md) |
| A bookable service's form | **Wix Bookings** |

**Flow:** STEP 0 confirm the app, read the caps → STEP 1 compose the fields → STEP 2 one POST, all fields → STEP 3 verify the read-back (**mandatory** — the `200` proves nothing).

---

## Silent breakers

Four things are accepted with a **`200`** and produce a form that is empty, wrong, or invisible. There is no error to react to, so get them right on the first call — each is settled in the step named after it.

1. **App — Wix Forms (New) `225dd912-7dea-4738-8688-4b8c6955ffc2` (STEP 0 · 1).** `14ce1214-b278-a7e4-1373-00cebd1bef7c` is the **Old** app: never install it, and never treat its presence as satisfying this API. *Get it wrong:* `UNSUPPORTED_FORM_NAMESPACE`; automations whose trigger belongs to the new app report "Forms app is not installed" even though *an* app named Wix Forms is installed.

2. **Namespace — `wix.form_app.form` (STEP 2).** *Get it wrong:* a form under any other namespace (notably the **non-existent `wix.form_platform.form`**) reads back fine over the API and is **completely invisible** in the Forms dashboard and the Editor.

3. **`identifier` — one of the predefined values in [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) § Field types.** *Get it wrong:* the field works over the API but the **Wix Forms editor cannot render it**, so the owner can't see or edit it. A form whose fields all carry invented identifiers opens **empty** in the editor.

4. **Layout — every field, `SUBMIT_BUTTON` included, placed in `steps[].layout`, with lowercase GUIDs on both sides.** *Get it wrong:* the form appears in the Editor's form picker but renders **empty** — fields still store values, but nothing shows.

**Never create throwaway "test" forms to probe the shape.** The site's form allowance is finite (§ Plan caps), and probing burns it. Assemble the whole form and POST once, then verify (STEP 3).

---

## STEP 0: Preflight — confirm the app, then read the caps

**1 · Confirm Wix Forms (New) is installed.**

```bash
curl -X GET \
  'https://www.wixapis.com/apps-installer-service/v1/app-instances' \
  -H 'Authorization: <AUTH>'
```

Look for `225dd912-7dea-4738-8688-4b8c6955ffc2` in the response — see [List Installed Apps](../app-installation/list-installed-apps.md). If it isn't installed, install **`225dd912-7dea-4738-8688-4b8c6955ffc2`** via the [Install Wix Apps](../app-installation/install-wix-apps.md) recipe. A fresh install returns `appInstance.status: "UNKNOWN"` until it propagates; if the first create fails with an identity/propagation error, retry **once** — do not loop.

**2 · Confirm the namespace is available** — [List Forms Providers Configs](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/list-forms-providers-configs):

```bash
curl -X GET \
  'https://www.wixapis.com/form-schema-service/v4/forms/providers-config' \
  -H 'Authorization: <AUTH>'
```

Use this to confirm `wix.form_app.form` is among the namespaces the site can create form schemas in. **Do not use it to decide how many fields you can build.**

> **⚠️ `restrictions` here are NOT the site's limits.** A provider app declares them **once, for all sites**, in its app dashboard — so `maxForms` / `maxFields` / `maxDeletedForms` describe the app, not this site. The Wix Forms app separately derives the site's **real** form, field, step, condition and email-recipient limits (and whether premium-only field types are allowed) from its **premium plan**, and enforces them itself on every create and update. A missing `restrictions` object means default platform limits apply — not "unlimited".
>
> This is why free and unpublished sites have been seen reporting `maxFields: 150` / `maxForms: 150` here while the create rejects with **`Field count reached its limit of 10`** and **`Steps count reached its limit of 3`**. The config is not wrong; it answers a different question. **The create call is the only authority on what a site allows** — build the form you were asked for, and if it returns a count error, go to § Plan caps and put the choice to the user. A rejected create costs nothing: it consumes no form slot, so reading its errors is not "probing" (that rule is about leaving throwaway forms behind).

**3 · Only if you need a free slot:** list what exists — `GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&fieldsets=METADATA` (repeat with `&enabled=false`) — and `DELETE https://www.wixapis.com/form-schema-service/v4/forms/{formId}` **only** for forms that are obviously the install's own default sample (a "Get in touch" form with `first_name` / `email` / `message`). The site may hold the owner's **real** forms. If it isn't obviously sample data, **ask the user first** — never delete real content unprompted.

---

## STEP 1: Compose the fields

**Read [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) before composing anything.** It is the authority on every field-level rule and is not repeated here: the `identifier` / `inputType` / `componentType` table for every field kind, how the two nested block names are derived, choice fields' twin declarations, Ricos checkbox labels, display fields, the `contactField` values and their extra-detail keys, the layout that orders fields (including matching a lowercase `id` with a lowercase `fieldId`), and which fields need a premium plan or another Wix app. Value shapes on the way back out are [About Submission Values](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values).

The rules below are the ones those articles don't state.

> **⚠️ "Must agree" is literal, and this is the one thing that really does make a field vanish.** The server builds a field's renderable view by dispatching on its `componentType` *within* its `inputType`. A pair that isn't valid together — `inputType: STRING` with `componentType: CHECKBOX_GROUP`, say — produces no view, and the field disappears without an error. Take both values from the same row of § Field types; never mix rows.

- **`required` goes at `inputOptions.required`** — beside `target` and `inputType` — **NOT** inside `validation`. A `required` key inside `stringOptions.validation` (or any `<inputType>Options.validation`) is accepted at create and **silently discarded**: the form ships with nothing mandatory and no error anywhere. `validation` carries value constraints only (`format`, `enum`, `minimum`, `minLength`, `items`). The one exception is the multi-line address field, whose per-subfield flags genuinely live at `addressOptions.validation.fields.<sub>.required` (subfield **visibility** is separate, at `multilineAddressOptions.fieldSettings.addressLine2.show`).
- **`id` must be a fresh lowercase GUID.** Generate them in the shell (`uuidgen | tr 'A-Z' 'a-z'`) — never type one from memory, never reuse the examples here. The server stores `id` lowercase: an **uppercase** `id` still saves, but the layout's `fieldId` no longer matches it, so the field is **silently unplaced** and the form renders empty.
- **`target` is the immutable submission key** — a unique lowercase `snake_case` string per field (e.g. `first_name_f409`). It is the contract every submission and every frontend binding uses.
- **Every example value you author is visitor-visible.** A `placeholder`, label or hint carrying a phone number, postcode, currency or date must follow the **site's** country, not a US/UK default.

### Choice fields — the identifier is what routes the renderer

**A choice field declares its choices twice, and both declarations are required.** Every option carries its own lowercase GUID `id`, a `value` and a `label`; `validation.enum` (for `STRING`) or `validation.items.stringOptions.enum` + `itemType` (for `ARRAY`) lists every one of those `value`s. **An empty `validation` is a free-text field, not a dropdown** — the general "always include `validation`, even as `{}`" rule does not apply to a choice field, and getting this wrong is accepted with a `200`.

> **⚠️ A choice field whose `identifier` isn't the choice kind is stored as a plain text input.** `identifier: "TEXT_INPUT"` with `componentType: "DROPDOWN"` returns `200` and comes back as a `TEXT_INPUT` carrying `textInputOptions`: the identifier, not the `componentType`, routes the field to its renderer. **Diagnose it by which options block came home** — `textInputOptions` where you sent `dropdownOptions`, with a well-formed block and `enum`, means the `identifier`. Re-sending it, or delete-and-re-add with the same identifier, reproduces it.

> **⚠️ ARRAY fields fail *after* creation.** A malformed `arrayOptions.validation.items` (missing `itemType`, empty or omitted `items`) lists fine and counts in the summary, so STEP 3's checks 1–2 both pass — but **every** submission to the form then `400`s. STEP 3 check 3 (a live test submission) is the only proof.

A dropdown, in full — copy this and swap the label, target, options and every GUID:

```json
{
  "id": "a4f0c9d2-1e77-4b3e-9a52-7c1d8f6b4e30",
  "identifier": "DROPDOWN",
  "fieldType": "INPUT",
  "inputOptions": {
    "target": "job_industry_7f2b",
    "required": false,
    "inputType": "STRING",
    "stringOptions": {
      "validation": { "enum": ["Technology", "Healthcare", "Finance", "Other"] },
      "componentType": "DROPDOWN",
      "dropdownOptions": {
        "label": "Job industry",
        "showLabel": true,
        "options": [
          { "id": "1b8e5a71-3c04-4f9a-9d62-08b7a5cf3e41", "label": "Technology", "value": "Technology" },
          { "id": "6d29c4b8-7f15-4a20-8e93-b04d7e2a9c58", "label": "Healthcare", "value": "Healthcare" },
          { "id": "c37fa910-52d6-4e8b-b1a7-9f4c60d38e2b", "label": "Finance", "value": "Finance" },
          { "id": "e8b1d6c4-90a3-42f7-8c05-3d7e15b9a642", "label": "Other", "value": "Other" }
        ]
      }
    }
  }
}
```

### Contact fields

> **⚠️ Never use `postSubmissionTriggers.upsertContact` to map contacts** Older recipes and samples used it, but it is a noop / response-only. Use per-field `contactMapping` instead.

---

## STEP 2: Create the form — one POST, all fields

**[Create Form](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form) ships complete request examples** for a dozen form types (contact, survey, order, job application, booking, donation, waiver, billing …) — start from the closest one rather than assembling from scratch.

```bash
curl -X POST \
  'https://www.wixapis.com/form-schema-service/v4/forms' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{
    "form": {
      "name": "Contact form",
      "namespace": "wix.form_app.form",
      "formFields": [
        {
          "id": "d7665e98-a7c4-4829-c104-fb856883e043",
          "identifier": "CONTACTS_FIRST_NAME",
          "fieldType": "INPUT",
          "inputOptions": {
            "target": "first_name_f409",
            "pii": true,
            "contactMapping": { "contactField": "FIRST_NAME" },
            "inputType": "STRING",
            "stringOptions": {
              "validation": {},
              "componentType": "TEXT_INPUT",
              "textInputOptions": { "label": "First name", "showLabel": true }
            }
          }
        },
        {
          "id": "740e294e-6ee4-4cda-c902-823002064985",
          "identifier": "CONTACTS_LAST_NAME",
          "fieldType": "INPUT",
          "inputOptions": {
            "target": "last_name_b88c",
            "pii": true,
            "contactMapping": { "contactField": "LAST_NAME" },
            "inputType": "STRING",
            "stringOptions": {
              "validation": {},
              "componentType": "TEXT_INPUT",
              "textInputOptions": { "label": "Last name", "showLabel": true }
            }
          }
        },
        {
          "id": "19768973-65be-4a6f-b3de-57cfb1da48db",
          "identifier": "CONTACTS_EMAIL",
          "fieldType": "INPUT",
          "inputOptions": {
            "target": "email_673d",
            "pii": true,
            "required": true,
            "contactMapping": { "contactField": "EMAIL", "emailInfo": { "tag": "UNTAGGED" } },
            "inputType": "STRING",
            "stringOptions": {
              "validation": { "format": "EMAIL" },
              "componentType": "TEXT_INPUT",
              "textInputOptions": { "label": "Email", "showLabel": true }
            }
          }
        },
        {
          "id": "95d528a8-8f3d-4692-7363-44db1f96ca18",
          "identifier": "CONTACTS_PHONE",
          "fieldType": "INPUT",
          "inputOptions": {
            "target": "phone_6a4b",
            "pii": true,
            "contactMapping": { "contactField": "PHONE", "phoneInfo": { "tag": "UNTAGGED" } },
            "inputType": "STRING",
            "stringOptions": {
              "validation": { "format": "PHONE" },
              "componentType": "PHONE_INPUT",
              "phoneInputOptions": { "label": "Phone", "showLabel": true }
            }
          }
        },
        {
          "id": "bbecbd37-ca52-4fa6-a92c-90e70aa4ec2a",
          "identifier": "TEXT_AREA",
          "fieldType": "INPUT",
          "inputOptions": {
            "target": "message_7634",
            "inputType": "STRING",
            "stringOptions": {
              "validation": {},
              "componentType": "TEXT_INPUT",
              "textInputOptions": { "label": "Your message", "showLabel": true }
            }
          }
        },
        {
          "id": "2e56791e-926e-48fd-37d0-0ad60a27736d",
          "identifier": "SUBMIT_BUTTON",
          "fieldType": "DISPLAY",
          "displayOptions": {
            "displayFieldType": "PAGE_NAVIGATION",
            "pageNavigationOptions": { "submitText": "Send" }
          }
        }
      ],
      "steps": [
        {
          "id": "a26d12fc-ed7a-4b7f-90e4-994f3ad56e4b",
          "name": "Page 1",
          "layout": {
            "large": {
              "items": [
                { "fieldId": "d7665e98-a7c4-4829-c104-fb856883e043", "row": 0, "column": 0, "width": 6,  "height": 1 },
                { "fieldId": "740e294e-6ee4-4cda-c902-823002064985", "row": 0, "column": 6, "width": 6,  "height": 1 },
                { "fieldId": "19768973-65be-4a6f-b3de-57cfb1da48db", "row": 1, "column": 0, "width": 12, "height": 1 },
                { "fieldId": "95d528a8-8f3d-4692-7363-44db1f96ca18", "row": 2, "column": 0, "width": 12, "height": 1 },
                { "fieldId": "bbecbd37-ca52-4fa6-a92c-90e70aa4ec2a", "row": 3, "column": 0, "width": 12, "height": 1 },
                { "fieldId": "2e56791e-926e-48fd-37d0-0ad60a27736d", "row": 4, "column": 6, "width": 6,  "height": 1 }
              ]
            }
          }
        }
      ],
      "submitSettings": {
        "submitSuccessAction": "THANK_YOU_MESSAGE",
        "thankYouMessageOptions": {
          "durationInSeconds": 8,
          "richContent": {
            "nodes": [
              {
                "type": "PARAGRAPH",
                "id": "ctf1a20",
                "nodes": [
                  { "type": "TEXT", "id": "", "nodes": [], "textData": { "text": "Thanks for reaching out. We will get back to you soon.", "decorations": [] } }
                ],
                "paragraphData": { "textStyle": { "textAlignment": "CENTER" } }
              }
            ]
          }
        }
      }
    }
  }'
```

Read `form.id` from the response — that is the `formId` to keep. Also read back `form.name`: **names are unique per namespace**, and a colliding name is silently saved as a numbered variation rather than erroring.

> `spamFilterProtectionLevel` defaults to `ADVANCED`; set it only to change that.

**A `200` proves nothing. Always run STEP 3.** Every failure mode in § Silent breakers returns `200`.

---

## STEP 3: Verify the form persisted (mandatory)

**1 · List it back** and diff against what you sent:

```bash
curl -X GET \
  'https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&formIds=<formId>' \
  -H 'Authorization: <AUTH>'
```

Confirm the `id` appears, that `formFields[]` covers **every** field you sent, that `steps` is non-empty and **places every field**, and that each field's `inputOptions.required` matches what you sent — a misplaced `required` is dropped silently and this read-back is the only signal.

**Also assert every returned `formFields[].identifier` is a value from [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) § Field types.** An invented identifier survives this read-back intact — it is stored and returned like any other — so nothing else here flags it, and the field is invisible to the owner in the editor. This is a pure string comparison against the table; it needs no extra call.

**2 · Verify the dashboard and Editor will actually render it:**

```bash
curl -X GET \
  'https://www.wixapis.com/form-schema-service/v4/forms/<formId>/summary' \
  -H 'Authorization: <AUTH>'
```

**Assert `formSummary.fields` is NON-EMPTY, with a count equal to every input field you sent** (`formFields[]` minus `SUBMIT_BUTTON` and any other `DISPLAY` field). A 5-input form returns all 5 — **including non-contact dropdowns and long-answer fields**, so do not expect only the contact-mapped ones.

**This is the dashboard-truth check for *placement*.** `summary.fields: []`, or a count short of your inputs, means the owner opens the Editor's form picker and sees an **empty form**. **Do not report success** — fix the layout placement or the GUID casing, then re-verify.

> **⚠️ Do not lean on this check to catch a bad `identifier`.** Whether an unrecognized identifier is omitted from `formSummary.fields` is **unverified** — it may well be counted here and still be unrenderable in the editor. Check `identifier`s explicitly in step 1; treat this step as covering placement only.

**3 · If the form has an ARRAY field (`CHECKBOX_GROUP` / `TAGS` / `IMAGE_CHOICE`), send one real submission.** Checks 1–2 both pass on a malformed `arrayOptions.validation.items` while every submission `400`s:

```bash
curl -X POST \
  'https://www.wixapis.com/form-submission-service/v4/submissions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{ "submission": { "formId": "<formId>", "submissions": { "email_673d": "test@example.com", "multi_choice_a1b2": ["Option 1"] } } }'
```

Assert `200`, not `400 SUBMISSION_VALIDATION`. Then delete the test submission (`DELETE https://www.wixapis.com/form-submission-service/v4/submissions/{submissionId}`) so the owner's dashboard stays clean.

**4 · Hand back the dashboard links** (see [Forms Dashboard Navigation](./forms-dashboard-navigation.md)):

```
Edit it here:      https://manage.wix.com/dashboard/{metaSiteId}/wix-forms/form/{formId}
See submissions:   https://manage.wix.com/dashboard/{metaSiteId}/wix-forms/form/{formId}/submissions
```

---

## Changing a form that already exists

Adding, relabelling, re-requiring, reordering or retiring a field on a live form is a `PATCH`, not a second create — see **[Update Form](./update-form.md)**. Never delete-and-recreate: the `formId` is what everything downstream holds.

---

## Plan caps — surface the choice, never engineer around it

These limits return a real `400` on create. **Do not work around any of them. Put the choice to the user — reduce, or upgrade — with the MSID and the upgrade link, wait for their answer, then create and verify.**

- **Field count** — **two different caps count two different things, so check which error you got:**
  - `Field count reached its limit of N` — the **premium** cap, enforced by the Wix Forms app from
    the site's plan. It counts **`INPUT` fields only** — display elements and the `SUBMIT_BUTTON` do
    **not** count against it. This is the one free sites hit at 10.
  - `FORM_FIELDS_COUNT_EXCEEDED` — the schema-service cap (`providers-config`'s `maxFields`), which
    counts **all** fields **including** display elements and the submit button.

For either: **do NOT split the form across several schemas** to dodge it — that trades one submission record for several and consumes more of the site's form allowance. Reduce the field count, or upgrade.
- **Step count** (`Steps count reached its limit of N`) — the premium cap on `steps.length`. Collapse the form into fewer pages, or upgrade. There is **no schema-service equivalent**, so this error never appears in the Create Form error table.
- **Condition count** (`formRules.length`) — also premium-capped, and also absent from the Create Form error table.
- **Form count** (`NAMESPACE_FORMS_COUNT_EXCEEDED`, `NAMESPACE_DELETED_FORMS_COUNT_EXCEEDED`, or `FORM_SIZE_EXCEEDED` for a single oversized schema) — the site hit its total-form (or trash-bin) cap. Independently of the plan, `formFields` has a hard ceiling of 500 items. Upgrade, or free a slot per STEP 0 · 3 — deleting only what is clearly install sample data.
- **Premium fields** — file upload, signature and all four payment fields need a **Core plan or higher**; payment fields additionally need **Wix eCommerce**. Appointment needs **Wix Meetings**; the service pickers need **Wix Services**. A create including one of these on a site without the plan or app **fails**. **Do NOT suggest inlining files as base64** — it stores no real file, gives the owner nothing usable, and blows past submission size limits. Drop the field, or upgrade.

> **⚠️ A plan cap is a hard block on the run, not a "note it and continue" precondition.** The schema does not exist, so neither does its `formId` or its field `target`s. Nothing that depends on the form — a frontend binding, an automation, a submissions view — can be built "in the meantime" without guessing.

---

## Automations on form submission

To auto-respond to submissions, the automation's trigger belongs to the **app that owns the form** — and the two Forms apps have different trigger keys:

| App | `appId` | Trigger key for "Form submitted" |
|---|---|---|
| **Wix Forms (New)** | `225dd912-7dea-4738-8688-4b8c6955ffc2` | `wix_form_app-form_submitted` |

**The app and the key must be the same generation.** A form created on Form Schemas v4 belongs to the New app, so its automation must use `wix_form_app-form_submitted` **and** the New app must be the installed one. `FAILED_PRECONDITION: "Forms app is not installed on the site"` on an automation create, on a site where Wix Forms visibly *is* installed, means the **Old** app is installed and the New one isn't — fix that at STEP 0 · 1, not by swapping trigger keys.

Confirm the pair against the site rather than typing it from memory: [Query Triggers](https://dev.wix.com/docs/api-reference/business-management/automations/triggers/trigger-catalog/query-triggers) filtered by `appId`, or [Get Trigger By App Id And Key](https://dev.wix.com/docs/api-reference/business-management/automations/triggers/trigger-catalog/get-trigger-by-app-id-and-key).

---

## Troubleshooting

| Error / symptom | Cause | Fix |
|---|---|---|
| `UNSUPPORTED_FORM_NAMESPACE`, or `Permissions for given namespace not found` | Wix Forms **(New)** not installed, or a namespace other than `wix.form_app.form` | Install `225dd912-7dea-4738-8688-4b8c6955ffc2`; use `wix.form_app.form` |
| Form reads back fine over the API but is **invisible** in the Forms dashboard and Editor | Created under a non-dashboard namespace — typically the non-existent `wix.form_platform.form` | Re-create under `wix.form_app.form`. A namespace query returning **0 results is not proof it is unusable** — it may simply be empty |
| Automation create fails `FAILED_PRECONDITION: Forms app is not installed` although Wix Forms is installed | The **Old** Forms app (`14ce1214-…`) is installed; the New app's trigger `wix_form_app-form_submitted` needs `225dd912-…` | Install `225dd912-…` — do **not** try to fix it by swapping in the Old app's key `wix_forms-form_submit`. See § Automations on form submission |
| Form appears in the Editor's form picker but renders **empty** | Fields not placed in `steps[].layout`, or an **uppercase** `id` whose stored lowercase form no longer matches `fieldId` | Place every field (incl. `SUBMIT_BUTTON`); use lowercase GUIDs on both sides; re-verify with `/summary` |
| Field is returned by the API and accepts submissions, but the owner **cannot see or edit it in the Wix Forms editor** (a whole form of them opens **empty**) | Invented `identifier` (e.g. `"product_name"`) — accepted and stored, but unrecognized by the editor | Use a value from [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) § Field types; put the user's wording in the component's `label`. Assert identifiers in STEP 3 · 1 — no other check catches this |
| Field vanishes entirely from the created form | `componentType` not valid for the field's `inputType` — the server builds no view for it | Match the `inputType` / `componentType` pair in [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) § Field types |
| Choice field renders as a plain text box, and reads back with `textInputOptions` | `identifier` was `TEXT_INPUT` rather than `DROPDOWN` / `RADIO_GROUP` — `componentType` alone doesn't route the renderer | Set `identifier` to the choice kind and re-send the field. Deleting and re-adding it with the same `identifier` reproduces the fallback |
| `options[N].id is not a valid GUID` on a create or `PATCH` | Option `id`s were readable slugs (`tech-opt-1`) or omitted — each needs its own lowercase GUID, client-generated | Generate one GUID per option (`uuidgen`); the field's own `id` being a GUID is not enough |
| Choice field renders as a plain text box | `radioGroupOptions` / `dropdownOptions` malformed — wrong key (`choices` instead of `options`), an option missing its GUID `id`, or an empty `validation.enum` | Match [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) § Choice fields exactly: `componentType` inside the `inputType` block, every option with a lowercase GUID `id`, `validation.enum` listing all values |
| Form lists and summarizes fine, but **every** submission returns `400` | ARRAY field with malformed `arrayOptions.validation.items` — missing `itemType`, or empty/omitted `items` | Set both `items.itemType` and `items.stringOptions.enum`; prove it with STEP 3 · 3 |
| Every field reads back `required: false` | `required` placed inside `validation` instead of `inputOptions` | Move it to `inputOptions.required`; fix with a `PATCH` ([Update Form](./update-form.md)) rather than re-creating |
| Contacts are never created or updated on submission | Used `postSubmissionTriggers.upsertContact` (absent from the current v4 contract — it configures nothing) | Set per-field `inputOptions.contactMapping.contactField` + `pii: true` |
| `400 namespace has size 0, expected 10 or more` / `namespace must not be empty` on a read | The `namespace` **query parameter** was omitted from `GET .../v4/forms` (or from the `query` filter) — it is required on every read, and the violation naming a field makes it look like a body problem | Add `?namespace=wix.form_app.form` to the read; leave the payload alone |
| `Unrecognized value passed for enum` | Invented `componentType` (e.g. `LONG_TEXT_INPUT`) | Use the `componentType` from [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) § Field types — a long answer is `identifier: TEXT_AREA` with `componentType: TEXT_INPUT` |
| `Field count reached its limit of N` / `FORM_FIELDS_COUNT_EXCEEDED` | The site's premium-plan field cap, enforced by the Wix Forms app — unrelated to the app-declared `maxFields` in `providers-config` | § Plan caps: reduce or upgrade. Never split across schemas |
| `Steps count reached its limit of N` | Plan's per-form step cap | Collapse to fewer pages, or upgrade |
| `NAMESPACE_FORMS_COUNT_EXCEEDED` | Site hit its total-form cap | § Plan caps: upgrade, or free a slot (STEP 0 · 3) |
| `DUPLICATED_FIELD_TARGETS` / `DUPLICATED_FIELD_IDS` / `MISSING_FIELD_TARGETS` | Reused `target` or `id`, or omitted `target` | Give every field a unique lowercase GUID `id` and a unique `snake_case` `target` |
| Form saved under a different name than requested | Names are unique per namespace; a collision saves a numbered variation | Read `name` from the response and report the actual name |

---

## Related Documentation

- [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) — the authoritative field-composition guide
- [Create Form](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form) — complete request examples for a dozen form types
- [Form object](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/form-object) · [Update Form](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/update-form) · [Get Form Summary](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form-summary) · [List Forms Providers Configs](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/list-forms-providers-configs)
- [Form Schemas API Introduction](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/introduction) — including the namespaces of apps made by Wix
- [Form Submissions API](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/introduction) · [About Submission Values](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values)
- [Forms Dashboard Navigation](./forms-dashboard-navigation.md) · [Install Wix Apps](../app-installation/install-wix-apps.md)
