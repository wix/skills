# Forms — seed contract

`seed-forms.mjs` takes a plain-data plan and creates the site's forms. You write labels and
kinds; the seed derives everything the API demands — per-field UUIDs, the two-level options
nesting, the validation block that must exist even when empty, the choice enum that has to
agree with the component's options, the immutable `target`, and a layout referencing every
field. Those are the rules a hand-built payload gets wrong while still returning `200`.

**⚠️ Seed BEFORE building the form UI.** This is the one vertical that does not run in parallel
with the client: the page renders the fields this creates, and imports the id it returns.

**Additive only** — an existing form with the same name is left exactly as it is and reported
with `created: false`. Re-running never makes a second copy and never edits one.

## Run

```bash
node <SKILL_ROOT>/references/forms/seed/seed-forms.mjs plan.json    # from the project root
```

## Plan

```json
{
  "forms": [
    {
      "name": "Contact",
      "submitText": "Send enquiry",
      "fields": [
        { "label": "Your name",  "kind": "text",     "required": true },
        { "label": "Email",      "kind": "email",    "required": true },
        { "label": "Phone",      "kind": "phone" },
        { "label": "Project type", "kind": "select", "choices": ["Brand identity", "Website redesign"] },
        { "label": "Services",   "kind": "multi",    "choices": ["SEO", "Copywriting"] },
        { "label": "Budget",     "kind": "number",   "min": 500, "max": 50000 },
        { "label": "Message",    "kind": "textarea", "placeholder": "Tell us about the project" },
        { "label": "I accept the terms", "kind": "checkbox", "required": true }
      ]
    }
  ]
}
```

| key | meaning |
|---|---|
| `name` | the form's name in the owner's dashboard, and the idempotency key |
| `submitText` | the submit button's wording (default `"Submit"`) |
| `fields[].label` | what the visitor reads — also the basis of the storage key |
| `fields[].kind` | one of the kinds below |
| `fields[].required` | default `false` |
| `fields[].placeholder` · `default` | optional; passed to the control |
| `fields[].choices` | `select` · `radio` · `multi` — strings, or `{ value, label }` |
| `fields[].min` · `max` | `number` · `rating` bounds |
| `fields[].maxLength` | text length cap |
| `fields[].fileLimit` | `file` — how many files (default 1) |
| `fields[].lines` | `textarea` — rows (default 4) |

### Kinds

`text` · `textarea` · `email` · `phone` · `url` · `firstName` · `lastName` · `company` ·
`date` · `number` · `rating` · `select` · `radio` · `multi` · `checkbox` · `file` · `address`

`email`, `phone`, `firstName`, `lastName`, `company` are the CONTACTS kinds — Wix maps them
onto the owner's CRM contact, so prefer them over a plain `text` field for those.

## Result

```json
{ "forms": [ { "name": "Contact",
               "formId": "0e0…",
               "created": true,
               "fields": [ { "target": "your_name_k3f9x2", "label": "Your name" }, … ],
               "fieldsLive": 8,
               "degraded": [] } ] }
```

**`formId` is what the page imports.** `fields[].target` is each input's `name` — the page
does not need them (it renders `form.fields` from the live schema), but they are the keys the
owner's submissions are stored under.

**`degraded` must be empty.** It is the read-back check: the seed re-reads the created form and
compares each field's `componentType` against what it sent. A non-empty list means a field was
accepted and then stored as something else — almost always a choice field that lost its options
and became a plain text box. Fix the plan, delete nothing, and create the form again under a
new name; a `200` on create does not mean the field survived.

## What the seed does

1. Installs the Wix Forms app (idempotent).
2. Lists existing forms in the `wix.form_app.form` namespace — a name match is skipped.
3. Expands each field, creates the form, reads it back and checks every `componentType`.

## Traps this seed already handles

Listed because a hand-rolled payload hits all of them, and each returns `200` first:

- **A choice field declares its options twice** — the component's `options[]` and the
  validation `enum` (or `items.stringOptions.enum` + `itemType` for a multi). Disagree and the
  field is created as a plain text box.
- **`validation` must be present even when empty**, nested under the *input-type* block, not
  the component one. Absent, the target is not registered as an accepted value and every
  submission is rejected with `UNKNOWN_VALUE_ERROR` on a key that IS in the schema.
- **`required` lives at `inputOptions.required`**, never inside a validation block.
- **`steps` must reference every field, the submit button included.** A field missing from the
  layout never appears in the owner's dashboard — they cannot edit what the site renders.
- **`target` is immutable** and must be unique within the form: letters, digits and single
  underscores, starting with a letter.
- **Use `formFields`, never `fields`** — the latter is the legacy API.
