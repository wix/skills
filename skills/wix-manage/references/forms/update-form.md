---
name: "Update Form"
description: "Changes a Wix form that already exists, with Form Schemas v4 `PATCH` — add a field to my form, add a dropdown, make a field required or optional, rename a label, reorder or retire a question. Covers the read-back for the `revision` (and the required `namespace` query parameter), the whole-form body a `PATCH` needs, the wholesale `formFields` replace that silently soft-deletes anything you omit, and the verification that proves what was stored. Use Create Form when there is no form yet."
---
# RECIPE: Update a Wix Form

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`. Send `wix-site-id: <SITE_ID>` when the token is account-scoped.

Change what an existing form collects — **add a field, relabel one, tighten a rule, reorder, retire one**. Composing the field is not here: [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) owns the `identifier` / `inputType` / `componentType` table and the options shapes, and [Create Form](./create-form.md) STEP 1 carries the rules it doesn't state — they apply to an added field exactly as to a created one.

**A `PATCH`, never a delete-and-recreate.** An update keeps the `formId` everything downstream holds — a frontend binding, an automation, a saved dashboard view — and spends no slot against the form cap.

---

## The call

```bash
# 1 · read the form back for its current revision and every field you intend to keep
curl -X GET \
  'https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&formIds={formId}' \
  -H 'Authorization: <AUTH>'

# 2 · send that form back with your change applied
curl -X PATCH \
  'https://www.wixapis.com/form-schema-service/v4/forms/{formId}' \
  -H 'Content-Type: application/json' -H 'Authorization: <AUTH>' \
  -d '{ "form": {
      "id": "{formId}",
      "revision": "<the revision you just read>",
      "name": "<the form name>",
      "namespace": "wix.form_app.form",
      "formFields": [ ...every field, with your change applied... ],
      "steps": [ ...every step, with a layout item for the new field... ]
  } }'
```

- **⚠️ `namespace` is a REQUIRED query parameter on the read**, and this is what a revise run trips over. Without it the read returns `400 namespace has size 0, expected 10 or more` — a violation naming a *field*, so it reads like a body problem. Fix the call, don't reshape the payload. (`POST .../v4/forms/query` needs it in the filter too.)
- **The read-back is the body.** Apply your change to what the `GET` returned and send that as `form`. `namespace` is immutable and travels along; **there is no `fieldMask`**, and no `revision` outside `form` — inventing either is a silent partial write.
- **⚠️ Append to `formFields`; never rebuild what you read.** `[...form.formFields, newField]` works. Mapping the array to "clean up" each field — dropping `fieldType`, reshaping an options block — fails with `fieldType cannot be provided with any these fields: input_options, display_options` on **every** field at once. The read-back's fields are already a valid write shape.
- **`formFields` is replaced wholesale.** Any field missing from the array you send moves to `deletedFormFields`, so resend every field you want to keep. Same for `steps[].layout`: miss an item and that field goes unplaced and renders empty. Drops are recoverable, but nothing announces them.
- **A stale `revision` is rejected** — re-`GET` and re-apply; never guess or increment it.
- **Plan caps apply to an added field.** `Field count reached its limit of N` on a `PATCH` is the site's premium cap: reduce or upgrade, with the choice put to the user ([Create Form](./create-form.md) § Plan caps). Never split the form across schemas to dodge it.

---

## Adding a field

**Read [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) § Field types for the kind you're adding** — the `identifier` / `inputType` / `componentType` triple, all three from one row (a dropdown or radio is `inputType: "STRING"`), plus the options shape. [Create Form](./create-form.md) STEP 2 has a dropdown body to copy. Composing a field from memory turns one `PATCH` into eight.

Four things are yours to generate:

- **`id`** — a fresh lowercase GUID (`uuidgen | tr 'A-Z' 'a-z'`), unique in the form.
- **`target`** — the immutable submission key, unique across the form: `snake_case` plus a short suffix (`job_industry_7f2b`). **A duplicate `target` is accepted and silently stores nothing** for every field but one.
- **the choices, declared twice** — every option needs its own lowercase GUID `id` (a readable slug is rejected — `options[N].id is not a valid GUID`) plus `value` and `label`, and `validation.enum` must list every one of those `value`s. **An empty `validation` is a free-text field, not a dropdown**, and getting it wrong is accepted with a `200`.
- **the layout item** — append to `steps[<n>].layout.large.items`, mirroring into `medium` / `small` if the form has them: `{ "fieldId": "<new field id>", "row": <next row>, "column": 0, "width": 12, "height": 1 }`. A field missing from the layout isn't dropped, but sorts last with no defined position in the owner's builder. To place it mid-form, insert at that `row` and bump every item at or after it — `row` restarts at 0 per step.

**A choice field's `identifier` is its kind** — `DROPDOWN`, `RADIO_GROUP`, `CHECKBOX_GROUP`, `TAGS` — never `TEXT_INPUT`, which is accepted and stored as a plain text input carrying `textInputOptions`. The identifier, not the `componentType`, routes the field to its renderer, and re-adding it with that same identifier reproduces the fallback.

---

## The other changes

| Change | How |
|---|---|
| Label, placeholder, options, validation, order | Patch them and stop |
| A field's component type, in place | Send that field with the **choice `identifier`** and only the new options block; leaving `textInputOptions` beside `dropdownOptions` reads back as the text-input fallback |
| Retire a field the form has submissions for | Set `hidden: true` — it stops rendering and the submissions already collected under it keep their meaning. Dropping it from the array soft-deletes it instead |
| Remove a field added by mistake this run | Drop it from `formFields`; it lands on `deletedFormFields` |
| Rename a `target` | **Never.** It is the storage key, so a rename orphans every submission collected under the old one. Change the *label* instead |

---

## Verify — an update regresses a form exactly as a create can

**A `200` on the `PATCH` proves the body parsed, nothing about what was stored.** Read the form back every time, and assert on that read rather than on the `PATCH` response:

```
GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&formIds={formId}
GET https://www.wixapis.com/form-schema-service/v4/forms/{formId}/summary
```

- the changed field is there, carrying the `identifier` and `componentType` you sent — **a choice field with a non-empty `options[]`**, which is where a dropdown that degraded to a text input shows up;
- every field you meant to keep is still present, and every `inputOptions.required` still reads back as sent;
- `formSummary.fields` still holds one entry per input field — that is what the owner's dashboard renders.

Then hand back the dashboard links ([Forms Dashboard Navigation](./forms-dashboard-navigation.md)): the builder at `wix-forms/form/{formId}`, and that form's submissions at `wix-forms/form/{formId}/submissions`. New submissions carry the new field; past ones don't.

---

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `400 namespace has size 0, expected 10 or more` on a read | The `namespace` query parameter was omitted; the violation names a field, so it looks like a body problem → add `?namespace=wix.form_app.form`, leave the payload alone |
| `fieldType cannot be provided with any these fields: input_options, display_options`, on every field | The read-back's `formFields` were re-mapped or "cleaned" before sending → send them exactly as read and append: `[...form.formFields, newField]` |
| `inputType enum must be in [UNKNOWN_INPUT_TYPE, STRING, NUMBER, …]` | An invented `inputType` such as `ENUM` for a choice field → a dropdown or radio is `STRING` with `stringOptions.componentType`; multi-choice is `ARRAY` |
| The `PATCH` is rejected for a `revision` mismatch | The form changed since your read → re-`GET` and re-apply; never increment the revision yourself |
| Fields that were on the form are gone after the update | `formFields` was sent partial — the omitted fields moved to `deletedFormFields` → re-send them from the read-back; always send the whole array |
| Surviving fields render empty for the owner | `steps[].layout` was sent without their items → re-send every item, including `SUBMIT_BUTTON`'s, and re-verify with `/summary` |
| The added dropdown reads back as a text input with `textInputOptions` | `identifier` was `TEXT_INPUT`, not the choice kind → fix the identifier and re-send; re-adding with the same one reproduces it |
| The update lands but the field never appears in submissions | It shares a `target` with an existing field — the server keeps one, the rest store nothing → give it a unique `target` and `PATCH` again |

---

## Related Documentation

- [Create Form](./create-form.md) — field composition, layout rules, plan caps · [Forms Dashboard Navigation](./forms-dashboard-navigation.md)
- [Update Form](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/update-form) — the `PATCH` contract · [Form object](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/form-object) — `revision`, `hidden`, `deletedFormFields`
