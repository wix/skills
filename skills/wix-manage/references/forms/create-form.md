---
name: "Create Form"
description: "Creates a visitor-fillable Wix form with Form Schemas v4 — a contact or enquiry form, a signup or waitlist, an application, a survey, a quote request, and forms whose submissions create a contact. Ships a complete create request and the field table for the common kinds, with the value each one submits — dropdown, single and multi choice, date and time, number, consent and email-subscription (GDPR marketing) checkboxes — plus multi-page forms and the silent breakers that produce an empty or invisible form. Changing a form that already exists is Update Form."
---
# RECIPE: Create a Wix Form

**Every request and field in this recipe is complete and was verified live: send it as written, with no docs search, article or schema lookup.** Only the kinds listed as "Other kinds" in § Field types need [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields).

Each call's method page and the response fields the next step reads are below. Cite these pages as the calls' docs sources; none needs a search.

| Step | Call | Method page | Read from the response |
|---|---|---|---|
| 0 · 2 | `GET https://www.wixapis.com/form-app-service/v4/restrictions` | [Get Restrictions](https://dev.wix.com/docs/api-reference/crm/forms/form-restrictions/get-restrictions) | `restrictions.formsLimit.limit`, `restrictions.fieldsLimit.limit`, `totalFormCount` |
| 2 | `POST https://www.wixapis.com/form-schema-service/v4/forms` | [Create Form](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form) | `form.id`, `form.name` |
| 3 · 1 | `GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&formIds=<formId>` | [List Forms](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/list-forms) | `forms[0].formFields`, `forms[0].steps` |
| 3 · 2 | `GET https://www.wixapis.com/form-schema-service/v4/forms/<formId>/summary` | [Get Form Summary](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form-summary) | `formSummary.fields` |
| 3 · 3 | `POST https://www.wixapis.com/form-submission-service/v4/submissions` | [Create Submission](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/create-submission) | `submission.id` |
| 3 · 3 | `DELETE https://www.wixapis.com/form-submission-service/v4/submissions/<submissionId>` | [Delete Submission](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/delete-submission) | `200` with an empty body |

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`. Send `wix-site-id: <SITE_ID>` when the token is account-scoped.

Create a form on a Wix site that appears in the **Forms & Submissions** dashboard and can be placed in the Editor. Wix Forms backs **any form a visitor fills in** — a contact or enquiry form, a signup or waitlist, an application, a survey, a quote request, a registration questionnaire, etc. Whether a submission also becomes a CRM contact is the optional per-field `contactMapping` (§ Contact fields).

**Two exceptions — route there instead:**

| The ask | Owner |
|---|---|
| RSVP to an event | **Wix Events**, which ships its own registration form — [Create Event](../events/create-wix-event.md) |
| A bookable service's form | **Wix Bookings** |

**Flow:** STEP 0 confirm the app, read the caps → STEP 1 compose the fields → STEP 2 one POST, all fields → STEP 3 verify the read-back (**mandatory** — the `200` proves nothing).

---

## Silent breakers

Four things are accepted with a **`200`** and produce a form that is empty, wrong, or invisible. There is no error to react to, so get them right on the first call — each is settled in the step named after it.

1. **App — Wix Forms (New) `225dd912-7dea-4738-8688-4b8c6955ffc2` (STEP 0 · 1).** `14ce1214-b278-a7e4-1373-00cebd1bef7c` is the **Old** app: never install it or treat it as enough. *Get it wrong:* `UNSUPPORTED_FORM_NAMESPACE`, and automations report "Forms app is not installed".

2. **Namespace — `wix.form_app.form` (STEP 2).** *Get it wrong:* a form under any other namespace (notably the **non-existent `wix.form_platform.form`**) reads back fine over the API and is **completely invisible** in the Forms dashboard and the Editor.

3. **`identifier` — one of the predefined values in § Field types (STEP 1).** *Get it wrong:* the field works over the API but the **Wix Forms editor cannot render it**, so the owner can't see or edit it. A form whose fields all carry invented identifiers opens **empty** in the editor.

4. **Layout — every field, `SUBMIT_BUTTON` included, placed in `steps[].layout`, with lowercase GUIDs on both sides.** *Get it wrong:* the form appears in the Editor's form picker but renders **empty** — fields still store values, but nothing shows.

**Never create throwaway "test" forms to probe the shape**: the form allowance is finite (§ Plan caps). Assemble the whole form, POST once, then verify (STEP 3).

---

## STEP 0: Preflight — confirm the app, then read the caps

**1 · Confirm Wix Forms (New) is installed.**

```bash
curl -X GET \
  'https://www.wixapis.com/apps-installer-service/v1/app-instances' \
  -H 'Authorization: <AUTH>'
```

Look for `225dd912-7dea-4738-8688-4b8c6955ffc2` in the response — see [List Installed Apps](../app-installation/list-installed-apps.md). If it isn't installed, install **`225dd912-7dea-4738-8688-4b8c6955ffc2`** via the [Install Wix Apps](../app-installation/install-wix-apps.md) recipe. A fresh install returns `appInstance.status: "UNKNOWN"` until it propagates; if the first create fails with an identity/propagation error, retry **once** — do not loop.

**2 · Read the site's caps** — [Get Restrictions](https://dev.wix.com/docs/api-reference/crm/forms/form-restrictions/get-restrictions):

```bash
curl -X GET \
  'https://www.wixapis.com/form-app-service/v4/restrictions' \
  -H 'Authorization: <AUTH>'
```

The response holds the plan's limits and the form count. A free site returned `restrictions.formsLimit.limit: 4`, `fieldsLimit.limit: 10`, `stepsLimit.limit: 3`, `rulesLimit.limit: 3`, `features: []` and `totalFormCount: 1`.

- `fieldsLimit` counts `INPUT` fields per form; display fields and the submit button do not count. A request with more input fields than the limit fails, so put the choice to the user before the create (§ Plan caps).
- `totalFormCount` equal to `formsLimit.limit` means no free slot (STEP 0 · 3).
- `features` was empty on a free site. Do not decide plan gating from it: the create's error is the gate for premium fields (§ Plan caps).

> **⚠️ Do not read the caps from List Forms Providers Configs.** Its `restrictions` (`maxFields: 151` on a free site) are what the app declares for all sites, not this site's limits.

**3 · Only if you need a free slot:** list what exists — `GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&fieldsets=METADATA` (repeat with `&enabled=false`) — and `DELETE https://www.wixapis.com/form-schema-service/v4/forms/{formId}` **only** for forms that are obviously the install's own default sample (a "Get in touch" form with `first_name` / `email` / `message`). The site may hold the owner's **real** forms. If it isn't obviously sample data, **ask the user first** — never delete real content unprompted.

---

## STEP 1: Compose the fields

Build each field from one row of § Field types and this template. Block names are the enum in camelCase plus `Options`: `inputType: STRING` → `stringOptions`, `componentType: DATE_TIME` → `dateTimeOptions`.

```json
{ "id": "<fresh lowercase GUID>", "identifier": "<identifier>", "fieldType": "INPUT",
  "inputOptions": { "target": "<snake_case_key_with_suffix>", "required": false, "inputType": "<inputType>",
    "<inputType block>": { "validation": {}, "componentType": "<componentType>",
      "<component block>": { "label": "<label>", "showLabel": true } } } }
```

### Field types

| Field | `identifier` | `inputType` | `componentType` | `validation` |
|---|---|---|---|---|
| Short answer / Long answer (paragraph) | `TEXT_INPUT` / `TEXT_AREA` | `STRING` | `TEXT_INPUT` | `{}` |
| First name / Last name / Company / Job title | `CONTACTS_FIRST_NAME` / `CONTACTS_LAST_NAME` / `CONTACTS_COMPANY` / `CONTACTS_POSITION` | `STRING` | `TEXT_INPUT` | `{}` |
| Email | `CONTACTS_EMAIL` | `STRING` | `TEXT_INPUT` | `{ "format": "EMAIL" }` |
| Phone | `CONTACTS_PHONE` | `STRING` | `PHONE_INPUT` | `{ "format": "PHONE" }` |
| Address, one line | `CONTACTS_ADDRESS` | `STRING` | `TEXT_INPUT` | `{}` |
| Link | `URL_INPUT` | `STRING` | `TEXT_INPUT` | `{ "format": "URL" }` |
| Number / Rating (1–5) | `NUMBER_INPUT` / `RATING_INPUT` | `NUMBER` | `NUMBER_INPUT` / `RATING_INPUT` | `{}`, or `minimum` / `maximum` |
| Date / Birthdate / Date picker | `DATE_INPUT` / `CONTACTS_BIRTHDATE` / `DATE_PICKER` | `STRING` | `DATE_INPUT` / `DATE_INPUT` / `DATE_PICKER` | `{ "format": "DATE" }` |
| Time / Date and time | `TIME_INPUT` / `DATE_TIME_INPUT` | `STRING` | `TIME_INPUT` / `DATE_TIME` | `{ "format": "TIME" }` / `{ "format": "DATE_TIME" }` |
| Dropdown / Single choice | `DROPDOWN` / `RADIO_GROUP` | `STRING` | `DROPDOWN` / `RADIO_GROUP` | `enum` (§ Choice fields) |
| Multi choice / Tag picker | `CHECKBOX_GROUP` / `TAGS` | `ARRAY` | `CHECKBOX_GROUP` / `TAGS` | `items` (§ Choice fields) |
| Checkbox: agree / subscribe to emails | `CHECKBOX` / `CONTACTS_SUBSCRIBE` | `BOOLEAN` | `CHECKBOX` | `{}` (§ Checkboxes) |
| Text block / Submit button | `RICH_TEXT` / `SUBMIT_BUTTON` | `fieldType: DISPLAY` | — | — |

Other kinds (tax ID, multi-line address, image choice, file upload, signature, payment, appointment, service pickers) and their blocks are in [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) § Field types. File upload, signature and payment fields need a premium plan (§ Plan caps).

A submission must send a date as `2026-12-05`, a time as `14:30:00`, a date and time as `2026-12-05T14:30:00`, a link with `https://`, and a number as a JSON number. `14:30`, `05/12/2026` and `"25"` are rejected.

The rules below apply to every field.

- **Send `validation` on every input field**, as `{}` when the row has no `format` (choice fields excepted, § Choice fields).

> **⚠️ Take `inputType` and `componentType` from the same row; never mix rows.** A pair that isn't valid together (`STRING` with `CHECKBOX_GROUP`, say) is stored with no view, and the field disappears without an error.

- **`required` goes at `inputOptions.required`** — beside `target` and `inputType` — **NOT** inside `validation`, where it is accepted and **silently discarded**. `validation` carries value constraints only (`format`, `enum`, `minimum`, `minLength`, `items`).
- **`id` must be a fresh lowercase GUID** (`uuidgen | tr 'A-Z' 'a-z'`) — never typed from memory, never reused from the examples. An **uppercase** `id` is stored lowercase, so the layout's `fieldId` no longer matches and the field is **silently unplaced**.
- **`target` is the immutable submission key** — a unique lowercase `snake_case` string per field (e.g. `first_name_f409`).
- **Every example value you author is visitor-visible.** A `placeholder`, label or hint carrying a phone number, postcode, currency or date must follow the **site's** country, not a US/UK default.

### Choice fields — the identifier is what routes the renderer

**A choice field declares its choices twice, and both declarations are required.** Every option carries its own lowercase GUID `id`, a `value` and a `label`; `validation.enum` (for `STRING`) or `validation.items.stringOptions.enum` + `itemType` (for `ARRAY`) lists every one of those `value`s. **An empty `validation` is a free-text field, not a dropdown**, and it is accepted with a `200`.

> **⚠️ A choice field whose `identifier` isn't the choice kind is stored as a plain text input.** `identifier: "TEXT_INPUT"` with `componentType: "DROPDOWN"` returns `200` and reads back carrying `textInputOptions`: the identifier routes the renderer. Fix the `identifier`; re-sending the same field reproduces it.

> **⚠️ ARRAY fields fail *after* creation.** A malformed `arrayOptions.validation.items` (missing `itemType`, empty `items`) passes STEP 3's checks 1–2, but **every** submission then `400`s. STEP 3 check 3 is the only proof.

A dropdown, in full — copy this and swap the label, target, options and every GUID:

```json
{ "id": "a4f0c9d2-1e77-4b3e-9a52-7c1d8f6b4e30", "identifier": "DROPDOWN", "fieldType": "INPUT",
  "inputOptions": { "target": "job_industry_7f2b", "required": false, "inputType": "STRING",
    "stringOptions": {
      "validation": { "enum": ["Technology", "Healthcare", "Other"] },
      "componentType": "DROPDOWN",
      "dropdownOptions": { "label": "Job industry", "showLabel": true, "options": [
        { "id": "1b8e5a71-3c04-4f9a-9d62-08b7a5cf3e41", "label": "Technology", "value": "Technology" },
        { "id": "6d29c4b8-7f15-4a20-8e93-b04d7e2a9c58", "label": "Healthcare", "value": "Healthcare" },
        { "id": "e8b1d6c4-90a3-42f7-8c05-3d7e15b9a642", "label": "Other", "value": "Other" } ] } } } }
```

A single choice is the same field with `RADIO_GROUP` as `identifier` and `componentType`, `radioGroupOptions` as the block, and `"numberOfColumns": "ONE"` beside `options`.

A multi choice ("select all that apply"), in full. It is an `ARRAY` field: the accepted values go in `validation.items`, with `itemType` beside the `enum`, and it submits an array of option `value`s:

```json
{ "id": "2c214269-7388-45b8-a715-39bc9eef044e", "identifier": "CHECKBOX_GROUP", "fieldType": "INPUT",
  "inputOptions": { "target": "interests_2c21", "required": false, "inputType": "ARRAY",
    "arrayOptions": {
      "validation": { "items": { "itemType": "STRING", "stringOptions": { "enum": ["Workshops", "Newsletter"] } } },
      "componentType": "CHECKBOX_GROUP",
      "checkboxGroupOptions": { "label": "Interests", "showLabel": true, "numberOfColumns": "ONE", "options": [
        { "id": "4a232317-ce32-4b22-a27f-2e4d5e0bbfb7", "label": "Workshops", "value": "Workshops" },
        { "id": "eda654b5-3eec-4ea9-b4ab-82e2b0fc78d4", "label": "Newsletter", "value": "Newsletter" } ] } } } }
```

A date field, in full (`DATE_PICKER` shows a calendar; swap both values for it):

```json
{ "id": "ff4c5e97-180b-410b-bf31-9c0ee0a255f5", "identifier": "DATE_INPUT", "fieldType": "INPUT",
  "inputOptions": { "target": "event_date_ff4c", "required": false, "inputType": "STRING",
    "stringOptions": { "validation": { "format": "DATE" }, "componentType": "DATE_INPUT",
      "dateInputOptions": { "label": "Event date", "showLabel": true } } } }
```

A tag picker is the same with `TAGS`, `tagsOptions` and `"numberOfColumns": "ZERO"`.

### Checkboxes — consent and email subscription

| The user asks for | Field |
|---|---|
| "Agree to the terms / privacy policy", a waiver, any box the visitor must tick to send | `CHECKBOX`, with `"required": true` |
| "Permission to send newsletters / mailings / offers", "GDPR consent to marketing", "subscribe" | `CONTACTS_SUBSCRIBE`, with the `SUBSCRIPTION` contact mapping. Keep it optional, so a visitor can send the form without opting in |
| Both | A required `CHECKBOX` and an optional `CONTACTS_SUBSCRIBE` |

A ticked `CONTACTS_SUBSCRIBE` sets the email of the submission's contact to `subscriptionStatus: SUBSCRIBED`; unticked leaves it `NOT_SET`. Keep a `CONTACTS_EMAIL` field on the form. A plain `CHECKBOX` stores `true` / `false` and subscribes nobody.

The label is a rich-content object inside `checkboxOptions`. `validation: {}` goes in `booleanOptions`, beside `componentType`: on a `CONTACTS_SUBSCRIBE` field, a missing or misplaced `validation` rejects the create with `400 Upsert contact trigger SUBSCRIPTION field with target <target> doesn't have correct validation set`.

```json
{ "id": "b946e4b0-1062-45c4-a88b-cca6191d6128", "identifier": "CONTACTS_SUBSCRIBE", "fieldType": "INPUT",
  "inputOptions": { "target": "subscribe_b946", "pii": true,
    "contactMapping": { "contactField": "SUBSCRIPTION", "subscriptionInfo": { "subscriptionChannels": ["EMAIL"] } },
    "inputType": "BOOLEAN",
    "booleanOptions": { "validation": {}, "componentType": "CHECKBOX",
      "checkboxOptions": { "label": { "nodes": [ { "type": "PARAGRAPH", "id": "p1a0003",
        "nodes": [ { "type": "TEXT", "id": "", "nodes": [], "textData": { "text": "Yes, send me news and offers by email.", "decorations": [] } } ],
        "paragraphData": { "textStyle": { "textAlignment": "AUTO" } } } ] } } } } }
```

A required agreement checkbox, in full — no `pii`, no `contactMapping`:

```json
{ "id": "a609e40e-8ad1-4cc5-9c8c-85b2756e4fa9", "identifier": "CHECKBOX", "fieldType": "INPUT",
  "inputOptions": { "target": "privacy_consent_a609", "required": true, "inputType": "BOOLEAN",
    "booleanOptions": { "validation": {}, "componentType": "CHECKBOX",
      "checkboxOptions": { "label": { "nodes": [ { "type": "PARAGRAPH", "id": "p1a0002",
        "nodes": [ { "type": "TEXT", "id": "", "nodes": [], "textData": { "text": "I agree to the privacy policy.", "decorations": [] } } ],
        "paragraphData": { "textStyle": { "textAlignment": "AUTO" } } } ] } } } } }
```

To link a policy the user gave you, split the label text and give the linked part a decoration:

```json
{ "type": "TEXT", "id": "", "nodes": [], "textData": { "text": "privacy policy", "decorations": [
  { "type": "LINK", "linkData": { "link": { "url": "https://www.example.com/privacy", "target": "BLANK" } } } ] } }
```

Without a URL from the user, send the text alone.

### Contact fields

A `CONTACTS_*` field writes its value to the contact the submission creates or updates. It sets `"pii": true` and `inputOptions.contactMapping`:

| `identifier` | `contactMapping` |
|---|---|
| `CONTACTS_FIRST_NAME` / `_LAST_NAME` / `_COMPANY` / `_POSITION` / `_BIRTHDATE` / `_TAX_ID` | `{ "contactField": "FIRST_NAME" }`, `LAST_NAME`, `COMPANY`, `POSITION`, `BIRTHDATE`, `VAT_ID` |
| `CONTACTS_EMAIL` / `_PHONE` / `_ADDRESS` | `{ "contactField": "EMAIL", "emailInfo": { "tag": "UNTAGGED" } }`; `PHONE` with `phoneInfo`, `ADDRESS` with `addressInfo`, same `tag` |
| `CONTACTS_SUBSCRIBE` | `{ "contactField": "SUBSCRIPTION", "subscriptionInfo": { "subscriptionChannels": ["EMAIL"] } }` |

> **⚠️ Never use `postSubmissionTriggers.upsertContact` to map contacts** Older recipes and samples used it, but it is a noop / response-only. Use per-field `contactMapping` instead.

### Sections and pages

Each `steps` entry is one page with its own `layout`; `row` restarts at 0 in each. For "add a second section" or "put the consent on page 2", add a step and place its fields there. Place `SUBMIT_BUTTON` once, in the last step; on a multi-page form also set `nextPageText` and `previousPageText` in its `pageNavigationOptions`. `stepsLimit` (STEP 0 · 2) caps the pages.

For a heading or note between fields, add `{ "id": "<GUID>", "identifier": "RICH_TEXT", "fieldType": "DISPLAY", "displayOptions": { "displayFieldType": "RICH_CONTENT", "richContentOptions": { "richContent": { "nodes": [ <PARAGRAPH node, as in the checkbox label> ] } } } }`. Display fields do not count against the field cap, but they need a layout item.

---

## STEP 2: Create the form — one POST, all fields

The request below is a complete contact form. Start from it and add the fields from STEP 1; it needs no other page.

```bash
curl -X POST \
  'https://www.wixapis.com/form-schema-service/v4/forms' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{ "form": {
    "name": "Contact form", "namespace": "wix.form_app.form",
    "formFields": [
      {"id": "d7665e98-a7c4-4829-c104-fb856883e043", "identifier": "CONTACTS_FIRST_NAME", "fieldType": "INPUT", "inputOptions": {"target": "first_name_f409", "pii": true, "contactMapping": {"contactField": "FIRST_NAME"}, "inputType": "STRING", "stringOptions": {"validation": {}, "componentType": "TEXT_INPUT", "textInputOptions": {"label": "First name", "showLabel": true}}}},
      {"id": "740e294e-6ee4-4cda-c902-823002064985", "identifier": "CONTACTS_LAST_NAME", "fieldType": "INPUT", "inputOptions": {"target": "last_name_b88c", "pii": true, "contactMapping": {"contactField": "LAST_NAME"}, "inputType": "STRING", "stringOptions": {"validation": {}, "componentType": "TEXT_INPUT", "textInputOptions": {"label": "Last name", "showLabel": true}}}},
      {"id": "19768973-65be-4a6f-b3de-57cfb1da48db", "identifier": "CONTACTS_EMAIL", "fieldType": "INPUT", "inputOptions": {"target": "email_673d", "pii": true, "required": true, "contactMapping": {"contactField": "EMAIL", "emailInfo": {"tag": "UNTAGGED"}}, "inputType": "STRING", "stringOptions": {"validation": {"format": "EMAIL"}, "componentType": "TEXT_INPUT", "textInputOptions": {"label": "Email", "showLabel": true}}}},
      {"id": "95d528a8-8f3d-4692-7363-44db1f96ca18", "identifier": "CONTACTS_PHONE", "fieldType": "INPUT", "inputOptions": {"target": "phone_6a4b", "pii": true, "contactMapping": {"contactField": "PHONE", "phoneInfo": {"tag": "UNTAGGED"}}, "inputType": "STRING", "stringOptions": {"validation": {"format": "PHONE"}, "componentType": "PHONE_INPUT", "phoneInputOptions": {"label": "Phone", "showLabel": true}}}},
      {"id": "bbecbd37-ca52-4fa6-a92c-90e70aa4ec2a", "identifier": "TEXT_AREA", "fieldType": "INPUT", "inputOptions": {"target": "message_7634", "inputType": "STRING", "stringOptions": {"validation": {}, "componentType": "TEXT_INPUT", "textInputOptions": {"label": "Your message", "showLabel": true}}}},
      {"id": "2e56791e-926e-48fd-37d0-0ad60a27736d", "identifier": "SUBMIT_BUTTON", "fieldType": "DISPLAY", "displayOptions": {"displayFieldType": "PAGE_NAVIGATION", "pageNavigationOptions": {"submitText": "Send"}}}
    ],
    "steps": [ { "id": "a26d12fc-ed7a-4b7f-90e4-994f3ad56e4b", "name": "Page 1", "layout": { "large": { "items": [
      {"fieldId": "d7665e98-a7c4-4829-c104-fb856883e043", "row": 0, "column": 0, "width": 6, "height": 1},
      {"fieldId": "740e294e-6ee4-4cda-c902-823002064985", "row": 0, "column": 6, "width": 6, "height": 1},
      {"fieldId": "19768973-65be-4a6f-b3de-57cfb1da48db", "row": 1, "column": 0, "width": 12, "height": 1},
      {"fieldId": "95d528a8-8f3d-4692-7363-44db1f96ca18", "row": 2, "column": 0, "width": 12, "height": 1},
      {"fieldId": "bbecbd37-ca52-4fa6-a92c-90e70aa4ec2a", "row": 3, "column": 0, "width": 12, "height": 1},
      {"fieldId": "2e56791e-926e-48fd-37d0-0ad60a27736d", "row": 4, "column": 6, "width": 6, "height": 1}
    ] } } } ],
    "submitSettings": {"submitSuccessAction": "THANK_YOU_MESSAGE", "thankYouMessageOptions": {"durationInSeconds": 8, "richContent": {"nodes": [{"type": "PARAGRAPH", "id": "ctf1a20", "nodes": [{"type": "TEXT", "id": "", "nodes": [], "textData": {"text": "Thanks for reaching out. We will get back to you soon.", "decorations": []}}], "paragraphData": {"textStyle": {"textAlignment": "CENTER"}}}]}}}
  } }'
```

Keep `form.id` from the response. Read back `form.name` too: a colliding name is silently saved as a numbered variation.

> `spamFilterProtectionLevel` defaults to `ADVANCED`; set it only to change that. `submitSettings` is optional; if you send `submitSuccessAction: "THANK_YOU_MESSAGE"`, send `thankYouMessageOptions` with it, as above, or the create returns `400 submitSuccessAction and the corresponding thank_you_message_options field must be passed together`.

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

**Also assert every returned `formFields[].identifier` is a value from § Field types (or, for the other kinds, About Form Fields).** An invented identifier is stored and returned like any other, so no other check flags it, and the owner cannot see the field in the editor.

**2 · Verify the dashboard and Editor will actually render it:**

```bash
curl -X GET \
  'https://www.wixapis.com/form-schema-service/v4/forms/<formId>/summary' \
  -H 'Authorization: <AUTH>'
```

**Assert `formSummary.fields` has one entry per input field you sent** (every field except `DISPLAY` ones, contact-mapped or not). An empty or short list means the owner sees an **empty form**: do not report success; fix the layout placement or the GUID casing, then re-verify. This check covers placement only, not identifiers.

**3 · If the form has an ARRAY field (`CHECKBOX_GROUP` / `TAGS` / `IMAGE_CHOICE`), send one real submission.** Checks 1–2 both pass on a malformed `arrayOptions.validation.items` while every submission `400`s:

```bash
curl -X POST \
  'https://www.wixapis.com/form-submission-service/v4/submissions' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{ "submission": { "formId": "<formId>", "submissions": { "<email_target>": "test@example.com", "<array_field_target>": ["<one of its option values>"] } } }'
```

Assert `200`, not `400 SUBMISSION_VALIDATION`. Then delete the test submission, with `submission.id` from that response, so the owner's dashboard stays clean:

```bash
curl -X DELETE 'https://www.wixapis.com/form-submission-service/v4/submissions/{submissionId}' -H 'Authorization: <AUTH>'
```

A test submission proves value types and formats only (§ Field types). It is accepted with a `required` field missing, a required checkbox `false`, or a choice value that is not in the options. So prove `required` and the options from the read-back in check 1, never from a submission.

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

- **Field count** — `Field count reached its limit of N` is the plan cap (`fieldsLimit`, 10 on a free site), counting `INPUT` fields only. `FORM_FIELDS_COUNT_EXCEEDED` is the schema-service ceiling, counting all fields. For either, **do NOT split the form across several schemas**: reduce the fields, or upgrade.
- **Step count** (`Steps count reached its limit of N`, `stepsLimit`) and **condition count** (`formRules.length`, `rulesLimit`) — collapse into fewer pages or rules, or upgrade.
- **Form count** (`NAMESPACE_FORMS_COUNT_EXCEEDED`, `NAMESPACE_DELETED_FORMS_COUNT_EXCEEDED`, or `FORM_SIZE_EXCEEDED` for a single oversized schema) — the site hit its total-form (or trash-bin) cap. Independently of the plan, `formFields` has a hard ceiling of 500 items. Upgrade, or free a slot per STEP 0 · 3 — deleting only what is clearly install sample data.
- **Premium fields** — file upload, signature and all four payment fields need a **Core plan or higher**; payment fields additionally need **Wix eCommerce**. Appointment needs **Wix Meetings**; the service pickers need **Wix Services**. A create including one of these on a site without the plan or app **fails**. **Do NOT suggest inlining files as base64** — it stores no real file. Drop the field, or upgrade.

> **⚠️ A plan cap is a hard block on the run.** The form does not exist, so nothing that depends on its `formId` or `target`s can be built "in the meantime".

---

## Automations on form submission

To auto-respond to submissions, the automation's trigger belongs to the **app that owns the form** — and the two Forms apps have different trigger keys:

| App | `appId` | Trigger key for "Form submitted" |
|---|---|---|
| **Wix Forms (New)** | `225dd912-7dea-4738-8688-4b8c6955ffc2` | `wix_form_app-form_submitted` |

**The app and the key must be the same generation.** A v4 form belongs to the New app, so its automation uses `wix_form_app-form_submitted` with the New app installed. `FAILED_PRECONDITION: "Forms app is not installed on the site"` where Wix Forms visibly *is* installed means only the **Old** app is: fix it at STEP 0 · 1, not by swapping trigger keys.

To confirm the pair on the site, use [Query Triggers](https://dev.wix.com/docs/api-reference/business-management/automations/triggers/trigger-catalog/query-triggers) filtered by `appId`.

---

## Troubleshooting

| Error / symptom | Cause | Fix |
|---|---|---|
| `UNSUPPORTED_FORM_NAMESPACE`, or `Permissions for given namespace not found` | Wix Forms **(New)** not installed, or a namespace other than `wix.form_app.form` | Install `225dd912-7dea-4738-8688-4b8c6955ffc2`; use `wix.form_app.form` |
| Automation create fails `FAILED_PRECONDITION: Forms app is not installed` although Wix Forms is installed | The **Old** Forms app (`14ce1214-…`) is installed; the New app's trigger `wix_form_app-form_submitted` needs `225dd912-…` | Install `225dd912-…` — do **not** try to fix it by swapping in the Old app's key `wix_forms-form_submit`. See § Automations on form submission |
| Form appears in the Editor's form picker but renders **empty** | Fields not placed in `steps[].layout`, or an **uppercase** `id` whose stored lowercase form no longer matches `fieldId` | Place every field (incl. `SUBMIT_BUTTON`); use lowercase GUIDs on both sides; re-verify with `/summary` |
| Choice field renders as a plain text box, and reads back with `textInputOptions` | `identifier` was `TEXT_INPUT` rather than `DROPDOWN` / `RADIO_GROUP` — `componentType` alone doesn't route the renderer | Set `identifier` to the choice kind and re-send the field. Deleting and re-adding it with the same `identifier` reproduces the fallback |
| Dropdown or single choice reads back with `options: []` (verified live 2026-11-04) | The options were sent under a wrong key, such as `choices` instead of `options`. The `200` drops them without an error | Send them as `options` in the component block, each with a lowercase GUID `id`. Check `options` in the read-back |
| `options[N].id is not a valid GUID` on a create or `PATCH` | Option `id`s were readable slugs (`tech-opt-1`) or omitted — each needs its own lowercase GUID, client-generated | Generate one GUID per option (`uuidgen`); the field's own `id` being a GUID is not enough |
| Form lists and summarizes fine, but **every** submission returns `400` | ARRAY field with malformed `arrayOptions.validation.items` — missing `itemType`, or empty/omitted `items` | Set both `items.itemType` and `items.stringOptions.enum`; prove it with STEP 3 · 3 |
| `400 namespace has size 0, expected 10 or more` / `namespace must not be empty` on a read | The `namespace` **query parameter** was omitted from `GET .../v4/forms` (or from the `query` filter) — it is required on every read, and the violation naming a field makes it look like a body problem | Add `?namespace=wix.form_app.form` to the read; leave the payload alone |
| `Unrecognized value passed for enum` | Invented `componentType` (e.g. `LONG_TEXT_INPUT`) | Use the `componentType` from § Field types — a long answer is `identifier: TEXT_AREA` with `componentType: TEXT_INPUT` |
| `Field count reached its limit of N` / `FORM_FIELDS_COUNT_EXCEEDED` | `Field count reached its limit of N` is the plan cap on `INPUT` fields (`fieldsLimit` in STEP 0 · 2). `FORM_FIELDS_COUNT_EXCEEDED` is the schema-service ceiling, counting all fields | § Plan caps: reduce or upgrade. Never split across schemas |
| `Upsert contact trigger SUBSCRIPTION field with target … doesn't have correct validation set` | The `CONTACTS_SUBSCRIBE` field has no `booleanOptions.validation`, often because `validation` was put inside `checkboxOptions` | Send `"validation": {}` in `booleanOptions`, beside `componentType` (§ Checkboxes) |
| `submitSuccessAction and the corresponding thank_you_message_options field must be passed together` | `submitSettings.submitSuccessAction` sent without its options block | Send `thankYouMessageOptions` with `THANK_YOU_MESSAGE` (STEP 2), or leave `submitSettings` out |
| `DUPLICATED_FIELD_TARGETS` / `DUPLICATED_FIELD_IDS` / `MISSING_FIELD_TARGETS` | Reused `target` or `id`, or omitted `target` | Give every field a unique lowercase GUID `id` and a unique `snake_case` `target` |
| Form saved under a different name than requested | Names are unique per namespace; a collision saves a numbered variation | Read `name` from the response and report the actual name |

---

## Related Documentation

- [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) — the premium and app fields' extra blocks, and every field-level rule
- [Create Form](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form) — complete request examples for a dozen form types
- [Form object](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/form-object) · [Update Form](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/update-form) · [Get Form Summary](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form-summary) · [List Forms Providers Configs](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/list-forms-providers-configs)
- [Form Schemas API Introduction](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/introduction) — including the namespaces of apps made by Wix
- [Form Submissions API](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/introduction) · [About Submission Values](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values)
- [Forms Dashboard Navigation](./forms-dashboard-navigation.md) · [Install Wix Apps](../app-installation/install-wix-apps.md)
