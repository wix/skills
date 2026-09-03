---
name: "Update Form"
description: "Changes a Wix form that already exists, with Form Schemas v4 `PATCH` — add a field to my form, add a dropdown, make a field required or optional, rename a label, reorder or retire a question. Covers reading the form back for its `revision` (and the required `namespace` query parameter), the whole-form body that a `PATCH` needs, the wholesale `formFields` replace that silently soft-deletes anything you omit, changing a field's component type in place, retiring a field that already has submissions, and the read-back that proves what was stored. Use whenever the form exists and the request changes what it collects; use Create Form when there is no form yet."
---
# RECIPE: Update a Wix Form

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`. Send `wix-site-id: <SITE_ID>` when the token is account-scoped.

Change what a form collects — **add a field, relabel one, tighten a rule, reorder, retire one** — on a form that already exists. **Composing the field itself is not here**: [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) owns the `identifier` / `inputType` / `componentType` table and the options/enum shapes, and [Create Form](./create-form.md) § Silent breakers apply to an added field exactly as to a created one.

**A `PATCH`, never a delete-and-recreate.** An update keeps the `formId` everything downstream already holds — a frontend binding, an automation, a saved dashboard view — and spends no slot against the site's form cap.

---

## The call

```bash
# 1 · read the form back: you need its current revision, and every field you intend to keep
curl -X GET \
  'https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&formIds={formId}' \
  -H 'Authorization: <AUTH>'

# 2 · send that form back with your change applied
curl -X PATCH \
  'https://www.wixapis.com/form-schema-service/v4/forms/{formId}' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{ "form": {
      "id": "{formId}",
      "revision": "<the revision you just read>",
      "name": "<the form name>",
      "namespace": "wix.form_app.form",
      "formFields": [ ...every field, with your change applied... ],
      "steps": [ ...every step, with the layout item for a new field... ]
  } }'
```

- **⚠️ `namespace` is a REQUIRED query parameter on the read, and this is what a revise run trips over.** Without it the read returns `400 namespace has size 0, expected 10 or more, namespace must not be empty` — a violation naming a *field*, so it reads like a body problem. Fix the call, don't reshape the payload. (The filter on `POST .../v4/forms/query` needs it too.)
- **The read-back is the body.** Apply your change to what the `GET` returned and send that as `form`. `namespace` is **immutable** and travels along; **there is no `fieldMask`**, and no `revision` outside `form` — inventing either is a silent partial write.
- **⚠️ Append to `formFields`; never rebuild the entries you read.** `[...form.formFields, newField]` works. Mapping the array to "clean up" each field — dropping `fieldType`, re-shaping an options block — fails with `fieldType cannot be provided with any these fields: input_options, display_options` on **every** field at once. The read-back's field objects are already a valid write shape: pass them through untouched and touch only the one field you are changing.
- **`formFields` is replaced wholesale.** Wix: *"Any field that's missing from the array you send is moved to `deletedFormFields`, so resend every field you want to keep."* Same for `steps[].layout` — miss an item and that field goes unplaced, which renders empty. Drops are recoverable from `deletedFormFields`, but nothing announces them.
- **A stale `revision` is rejected** — re-`GET` and re-apply; never guess or increment it.
- **Plan caps apply to an added field.** `Field count reached its limit of N` on a `PATCH` is the site's premium cap: reduce or upgrade, with the choice put to the user ([Create Form](./create-form.md) § Plan caps). Never split the form across schemas to dodge it.

---

## Adding a field

**Start by reading [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) § Field types and § Choice fields** for the field kind you're adding: it gives the `identifier` / `inputType` / `componentType` triple — take all three from one row, and note that a dropdown or radio is `inputType: "STRING"` — plus the options/enum shape and the GUID every option needs. [Create Form](./create-form.md) § Choice fields carries a complete dropdown body to copy. Composing a field from memory is what turns one `PATCH` into eight.

Then four things are yours to generate:

- **`id`** — a fresh lowercase GUID (`uuidgen | tr 'A-Z' 'a-z'`), unique in the form.
- **`target`** — the immutable submission key, unique across the form: snake_case plus a short random suffix (`job_industry_7f2b`). **A duplicate `target` is accepted and silently stores nothing** for every field but one.
- **one GUID per choice option** — `options[]` each need their own, exactly like the field's; a readable slug is rejected ([Create Form](./create-form.md) § Choice fields). Generate them with `uuidgen`, never by hand.
- **the choices, declared twice** — every option needs `id` + `value` + `label`, and `validation.enum` must list every one of those `value`s. **An empty `validation` is a free-text field, not a dropdown**; the general "always include `validation`, even as `{}`" rule does not apply here, and getting it wrong is accepted with a `200`.
- **the layout item** — append to `steps[<n>].layout.large.items`, mirroring into `medium` / `small` if the form has them:

```json
{ "fieldId": "<the new field's id>", "row": <next row>, "column": 0, "width": 12, "height": 1 }
```

A field missing from the layout isn't dropped, but it sorts last and has no defined position in the owner's builder. To place it mid-form, insert at that `row` and bump every item at or after it — `row` restarts at 0 in each step.

**A choice field's `identifier` is its kind** — `DROPDOWN`, `RADIO_GROUP`, `CHECKBOX_GROUP`, `TAGS` — never `TEXT_INPUT`, which is accepted and stored as a plain text input ([Create Form](./create-form.md) § Choice fields).

---

## The other changes

| Change | How |
|---|---|
| Label, placeholder, options, validation, order | Patch them and stop — nothing downstream needs updating |
| A field's component type, in place | Send that field with the **choice `identifier`** and only the new options block; leaving `textInputOptions` beside `dropdownOptions` reads back as the text-input fallback |
| Retire a field the form has submissions for | Set `hidden: true` — "hidden from submitters": the field stops rendering, and the submissions already collected under it keep their meaning. Dropping it from the array soft-deletes it instead |
| Remove a field added by mistake this run | Drop it from `formFields`; it lands on `deletedFormFields` |
| Rename a `target` | **Never.** It is the storage key, so a rename orphans every submission already collected under the old one. Change the *label* instead |

---

## Verify — an update regresses a form exactly as a create can

**A `200` on the `PATCH` proves the body parsed, nothing about what was stored.** Read the form back, every time:

```
GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&formIds={formId}
GET https://www.wixapis.com/form-schema-service/v4/forms/{formId}/summary
```

Assert on that read-back, not on the `PATCH` response:

- the changed field is there, carrying the `identifier` and `componentType` you sent — **a choice field with a non-empty `options[]`**, which is where a dropdown that degraded to a text input shows up;
- every field you meant to keep is still present, and every `inputOptions.required` still reads back as sent;
- `formSummary.fields` still holds one entry per input field — that is what the owner's dashboard renders.

Then hand back the dashboard links ([Forms Dashboard Navigation](./forms-dashboard-navigation.md)): the form builder at `wix-forms/form/{formId}`, and that form's submissions at `wix-forms/form/{formId}/submissions`. New submissions carry the new field; past ones don't.

---

## Troubleshooting

| Error / symptom | Cause | Fix |
|---|---|---|
| `400 namespace has size 0, expected 10 or more` / `namespace must not be empty` on a read | The `namespace` **query parameter** was omitted — it is required on every listing read, and the violation naming a field makes it look like a body problem | Add `?namespace=wix.form_app.form` to the read; leave the payload alone |
| `fieldType cannot be provided with any these fields: input_options, display_options` — on every field | The read-back's `formFields` were re-mapped or "cleaned" before sending | Send the fields exactly as read and append the new one: `[...form.formFields, newField]` |
| `inputType enum must be in [UNKNOWN_INPUT_TYPE, STRING, NUMBER, …]` | An invented `inputType` such as `ENUM` (with an `enumOptions` block) for a choice field | A dropdown or radio is `inputType: "STRING"` with `stringOptions.componentType`; multi choice is `ARRAY` |
| The `PATCH` is rejected for a `revision` mismatch | Someone (or an earlier call) updated the form since your read | Re-`GET` and re-apply the change; never increment the revision yourself |
| Fields that were on the form are gone after the update | `formFields` was sent partial — the omitted fields moved to `deletedFormFields` | Re-send them in a further `PATCH`, from `deletedFormFields` in the read-back; always send the whole array |
| Surviving fields render empty for the owner | `steps[].layout` was sent without their items | Re-send every layout item, including `SUBMIT_BUTTON`'s; re-verify with `/summary` |
| The added dropdown/radio reads back as a text input with `textInputOptions` | `identifier` was `TEXT_INPUT` rather than the choice kind — `componentType` alone doesn't route the renderer | Set `identifier` to the choice kind and re-send. Deleting and re-adding the field with the same `identifier` reproduces it ([Create Form](./create-form.md) § Choice fields) |
| The update lands but the field never appears in submissions | The new field shares a `target` with an existing one — the server keeps one and the rest store nothing | Give it a unique `target` and `PATCH` again |
| `Field count reached its limit of N` | The site's premium field cap, counting `INPUT` fields | Reduce, or put the upgrade choice to the user ([Create Form](./create-form.md) § Plan caps) |

---

## Related Documentation

- [Create Form](./create-form.md) — composing fields, the identifier table, choice fields, the layout rules, plan caps
- [Forms Dashboard Navigation](./forms-dashboard-navigation.md) — the builder and submissions links to hand back
- [Update Form](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/update-form) — the `PATCH` contract and its replace semantics
- [Form object](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/form-object) — `revision`, `hidden`, `deletedFormFields`, `steps[].layout`
- [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields) — every field-level rule
