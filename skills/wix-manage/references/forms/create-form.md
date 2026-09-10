---
name: "Create Form"
description: "Creates a visitor-fillable Wix form with Form Schemas v4 — a contact or enquiry form, a signup or waitlist, an application, a survey, a quote request, and forms whose submissions create a contact. Changing an existing form is Update Form."
---
# RECIPE: Create a Wix Form

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`. Send `wix-site-id: <SITE_ID>` when the token is account-scoped.

Wix forms is any form a visitor fills in — contact, signup, application, survey, etc.: visible in the **Forms & Submissions** dashboard, placeable in the Editor. Submissions become CRM contacts only via the per-field `contactMapping`.

**Routing exceptions**:
- Event RSVP forms belong to **Wix Events** vertical
- Booking forms to **Wix Bookings**

**Non-negotiable instructions**:
- Never compose form and field payloads from memory, never guess their shape
- Follow this recipe step by step and do not skip any
- Ignore any previous verification rules and perform verification calls when asked. Response status `200` does not indicate a successful form creation (see STEP 3).
- Do not create throwaway "test" forms to probe the shape — the form allowance is finite. Assemble it whole, POST once then verify.
- Changing an already existing form is a `PATCH` ([Update Form](./update-form.md)), never a delete-and-recreate

---

## STEP 0: Confirm the app

Wix Forms appDefinitionId: 225dd912-7dea-4738-8688-4b8c6955ffc2

`14ce1214-b278-a7e4-1373-00cebd1bef7c` is the **Old Forms** app: never install it, and never read its presence as satisfying this API — you get `UNSUPPORTED_FORM_NAMESPACE`, and automations fail `FAILED_PRECONDITION: "Forms app is not installed"` though *an* app named Wix Forms is there.


1. Get application instances:
```bash
curl -X GET 'https://www.wixapis.com/apps-installer-service/v1/app-instances' -H 'Authorization: <AUTH>'
```

2. If Wix Forms `225dd912-…` is absent, install it ([Install Wix Apps](../app-installation/install-wix-apps.md)); a fresh install reports `status: "UNKNOWN"` until it propagates, so retry an identity error **once**.
3. Retrieve form / form field limits using [Form Restrictions API](https://dev.wix.com/docs/api-reference/crm/forms/form-restrictions/introduction) – these are hard limits, never engineer around them, never split form, etc.:  
   a. if form limit is hit, prompt the user to upgrade the plan or cleanup the existing forms
   b. if form field limit is hit, prompt the user to upgrade the plan or reduce the field count
4. **⚠️ Never size the form using `/v4/forms/providers-config` – use the Restrictions API.
---

## STEP 1: Compose the fields

1. Find the example(-s) relevant to the user request in the table below. Do not start authoring payload from scratch.
   
   | Example name                           | Use it for                                                           |
   |----------------------------------------|----------------------------------------------------------------------|
   | `Create a contact form`                | Name, email, phone, message, opt-in — contact-mapped                 |
   | `Create a form with conditional logic` | Show, hide or require a field based on another answer (`formRules`)  |
   | `Create a customer feedback survey`    | Star rating, radio, checkbox group, rich-text intro                  |
   | `Create a client onboarding form`      | Dropdown with a custom "other", tags, image choice, number, password |
   | `Create a delivery scheduling form`    | Single-line address, date picker, time                               |
   | `Create a billing details form`        | Company, tax ID, structured multi-line address                       |
   | `Create a job application form`        | Job title, portfolio URL, birthdate, start date                      |
   | `Create a waiver form`                 | Rich-text terms, file upload, signature — Core plan                  |
   | `Create a donation form`               | Suggested and custom donation amounts — Core plan                    |
   | `Create a product order form`          | Sell products, fixed fee — Core plan + Wix eCommerce                 |
   | `Create a consultation booking form`   | Appointment slot picker — Wix Meetings                               |
   | `Create a service booking form`        | Bookable service and extras — Wix Services                           |

2. Retrieve [create-form.md](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form.md) and find chosen example's payload, e.g.:

    ```bash
    EXAMPLE='Create a contact form'   # any Example name from the table below
    curl -sS 'https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form.md' \
      | awk -v h="### $EXAMPLE" '/^### /{p=($0==h)} p'
    ```

3. Copy relevant form fields from the examples
4. Each field: keep exactly as in example: field type (combination of `identifier`, `inputType` and `componentType`).
5. Each field: keep contact mapping (`contactMapping.contactField`, `pii: true`). The create response *echoes* an `upsertContact` block derived from your `contactMapping`: that is output, not configuration — don't report it as the thing that creates contacts.
6. Generate fresh `id` (UUID v4) for each field – never use one from example or memory:  

   ```bash
   gen_uuid() { uuidgen 2>/dev/null | tr 'A-Z' 'a-z' \
     || python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null \
     || node -e 'console.log(require("crypto").randomUUID())'; }
   ```

7. Generate fresh id (UUID v4) for each field option (e.g. `dropdownOptions[].options.id`): generate fresh `id` – never use one from example or memory. Exception: reference IDs in payment/booking fields use **real entity IDs** — the service, product and appointment examples embed placeholder GUIDs: `servicesDropdownOptions.options[].id` / `value` and its `validation.enum`, `paymentOptions.validation.products[].id`, `appointmentOptions.staffIds`. Read the real IDs off the site first; a stale one renders an empty picker.
8. Generate unique `target` for each field – the immutable submission key, lowercase `snake_case` based on field label (e.g. `first_name_f409ab`)
9. Configure `required` setting: — the one setting that is **not** in the component block: it sits at `inputOptions.required`, beside `target` and `inputType`.
10. Configure field settings: presentation and behavior live together in the field's component block (`textInputOptions`, `dropdownOptions`, `appointmentOptions`, …): `label` and `showLabel`, `placeholder` and `showPlaceholder`, `defaultValue`, plus kind-specific ones the examples carry — `numberOfColumns` and `customOption` on choice fields, `submitText` on the button, `use24HourFormat` / `firstDayOfWeek` / `showDateLabels` on date and time, `autocompleteEnabled` and `fieldSettings` on addresses, `durationInMinutes` / `staffIds` / `manualApprovalRequired` on appointment, `buttonText` and `explanationText` on file upload. Set each to what the user asked; any example phone number, postcode, currency or date is visitor-visible, so it follows the site's country. 
11. Setup validation: all fields must have a `validation` block. If there are no validation rules, an empty `validation: {}` should be set. Choice fields must have a matching validation block containing values from `options`: `validation.enum` for `STRING`, or `validation.items.stringOptions.enum` + `itemType` for `ARRAY`. **An empty `validation` is a free-text field, not a dropdown** — accepted with a `200`.
12. For cases not documented see: [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields)

## STEP 2: One POST, all fields

1. Use `namespace: "wix.form_app.form"`.
2. Put generated form fields `formFields`, do not use the **deprecated** `fields`.
3. Generate a fresh `id` for each step.
4. Include every field, including `SUBMIT_BUTTON` in `steps[].layout` – fieldId referencing that field's `id`. Layout is 12-col grid.

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

---

## STEP 3: Verify (mandatory)

1. **`GET /form-schema-service/v4/forms?namespace=wix.form_app.form&formIds=<formId>`** and diff: `formFields[]` covers **every** field, `steps` **places every one**, each `inputOptions.required` survived (a misplaced one is dropped silently)
2. Test submission: `POST /form-submission-service/v4/submissions` with form values, e.g. `{ "submission": { "formId": "<formId>", "submissions": { "<target>": ["Option 1"] } } }`, assert 200, then `DELETE .../v4/submissions/{submissionId}`. [About Submission Values](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values)
3. **Hand back the links** ([Forms Dashboard Navigation](./forms-dashboard-navigation.md)): `https://manage.wix.com/dashboard/{metaSiteId}/wix-forms/form/{formId}`, and that path + `/submissions`.
