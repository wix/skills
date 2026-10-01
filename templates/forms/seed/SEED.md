# Forms — seed contract

`seed-forms.mjs` takes a plain-data plan and creates the site's forms. You write labels and
kinds; the seed derives everything the API demands — per-field UUIDs, the two-level options
nesting, the validation block that must exist even when empty, the choice enum that has to
agree with the component's options, the per-component prefill key, the immutable `target`, a
layout referencing every field, and rules keyed by field id. Those are the rules a hand-built
payload gets wrong while still returning `200`.

**Seed BEFORE building the form UI.** This is the one vertical that does not run in parallel
with the client: the page renders the fields this creates, and imports the id it returns.

**Additive only** — an existing form with the same name is left exactly as it is and reported
with `created: false`. Re-running never makes a second copy and never edits one.

## Run

```bash
node <SKILL_ROOT>/templates/forms/seed/seed-forms.mjs plan.json    # from the project root
```

## Plan

```json
{
  "forms": [
    {
      "name": "Contact",
      "submitText": "Send enquiry",
      "thankYou": "Thanks, we will reply within two working days.",
      "fields": [
        { "label": "Your name",  "kind": "text",     "required": true },
        { "label": "Email",      "kind": "email",    "required": true },
        { "label": "Phone",      "kind": "phone",    "country": "GB" },
        { "label": "Project type", "kind": "select", "choices": ["Brand identity", "Website redesign"], "other": true },
        { "label": "Tell us more", "kind": "textarea", "hidden": true },
        { "label": "Services",   "kind": "multi",    "choices": ["SEO", "Copywriting"] },
        { "label": "Budget",     "kind": "number",   "min": 500, "max": 50000, "step": 100 },
        { "label": "Start date", "kind": "date",     "min": "$now" },
        { "label": "I accept the terms", "kind": "checkbox", "required": true }
      ],
      "rules": [
        { "when": { "field": "Project type", "isNot": "Brand identity" }, "show": ["Tell us more"] }
      ]
    },
    {
      "name": "Application",
      "submitText": "Apply",
      "nextText": "Continue",
      "previousText": "Back",
      "steps": [
        { "name": "About you", "fields": ["First name", "Last name", "Email"] },
        { "name": "Your work", "fields": ["Portfolio", "CV"] }
      ],
      "deadline": "2026-12-31T23:59:59Z",
      "redirect": "https://example.com/thanks",
      "fields": [
        { "label": "First name", "kind": "firstName", "required": true },
        { "label": "Last name",  "kind": "lastName",  "required": true },
        { "label": "Email",      "kind": "email",     "required": true },
        { "label": "Portfolio",  "kind": "url" },
        { "label": "CV",         "kind": "file", "required": true, "formats": ["DOCUMENT"], "fileLimit": 2 }
      ]
    }
  ]
}
```

### Form keys

| key | meaning |
|---|---|
| `name` | the form's name in the owner's dashboard, and the idempotency key |
| `submitText` | the submit button's wording (default `"Submit"`) |
| `nextText` · `previousText` | multi-step: the next / back button wording |
| `steps` | `[{ name, fields: [labels] }]` — one page per entry, in order; a field named on no step lands on the last page. Omit for a single page |
| `rules` | `[{ when, show?, hide?, require? }]` — see Rules |
| `thankYou` · `thankYouSeconds` | the owner's thank-you text shown after a submit; optional auto-hide seconds |
| `redirect` | send the visitor to this URL after a submit instead (same tab) |
| `deadline` | ISO date-time after which the form stops accepting submissions |
| `maxSubmissions` · `perVisitor` | close the form after this many submissions in total / per visitor |
| `requiredIndicator` | how required fields are marked: `ASTERISK` (default) · `TEXT` · `NONE` |

### Field keys

| key | meaning |
|---|---|
| `label` | what the visitor reads — also the basis of the storage key |
| `kind` | one of the kinds below |
| `required` | default `false`; on a `checkbox` it means "must be ticked" |
| `placeholder` · `description` | optional; passed to the control (description renders as help text). A placeholder is at most 100 characters |
| `default` | the prefill: text, a number, `true` for a checkbox, a choice value (or an array of them for `multi` / `tags`), a date (`"2026-01-31"` or `"$now+2d"`) |
| `hidden` | start hidden — for a field a rule shows |
| `choices` | `select` · `radio` · `multi` · `tags` — strings, or `{ value, label }` |
| `other` · `otherPlaceholder` | a free-text "Other" entry on a choice field: `true` (labelled "Other") or the label |
| `min` · `max` | `number` · `rating` bounds; on `date` · `time` · `datetime` an ISO value or `$now`, `$now+2d`, `$now-1M` (units `y M d h m`) |
| `step` | `number`: the allowed increment (`0.01` for money, `1` for whole numbers) |
| `minLength` · `maxLength` | text length bounds |
| `pattern` · `patternMessage` | a regex the text must match, and the owner's wording when it does not |
| `minItems` · `maxItems` | `multi` · `tags` bounds |
| `fileLimit` · `formats` | `file` — how many files (default 1, max 30); allowed families out of `IMAGE` `DOCUMENT` `VIDEO` `AUDIO` `ARCHIVE` |
| `buttonText` | `file` — the upload button's wording |
| `country` · `countries` | `phone`: default country (ISO-2) and the allowed countries; `address`: `countries` restricts the country list |
| `parts` | `address`: per-subfield required flags, e.g. `{ "postalCode": false, "addressLine2": false }` (`addressLine2: false` also hides it) |

### Kinds

`text` · `textarea` · `email` · `phone` · `url` · `firstName` · `lastName` · `company` ·
`date` · `time` · `datetime` · `number` · `rating` · `select` · `radio` · `multi` · `tags` ·
`checkbox` · `file` · `address`

`email`, `phone`, `firstName`, `lastName`, `company` are the CONTACTS kinds — Wix maps them
onto the owner's CRM contact, so prefer them over a plain `text` field for those.

A required `address` requires country, address line, city and postal code; `parts` overrides
that per subfield.

### Limits

**The site's plan caps the forms.** A free site allows 4 forms, 10 fields per form, 3 steps and 3
rules; a paid plan lifts them. The seed reads the live limits (Get Restrictions) and checks the
whole plan against them before creating anything, naming each form and the cap it breaks; nothing
is created. Trim the form, or the owner upgrades the plan
(`https://www.wix.com/upgrade/website?metaSiteId=<siteId>`) and the same plan runs unchanged. Do
not split one form in two to fit: it spends a form slot and splits a visitor's answers across two
records. The example above sits at nine fields on purpose.

**`file` needs a paid site plan.** Verified live: on a free site the create fails as a whole with
`FILE_UPLOAD_RESTRICTIONS_ERROR` (the seed reports it by field label; nothing is created). No API
call lifts it — the owner upgrades the site in the dashboard, then the same plan runs unchanged.
When the brief needs the upload now and the site is free, use a `url` kind for that field and add a
`capabilities.mediaUpload` policy to the plan (Astro stack only): the site uploads the file itself
through the shared endpoint and submits the uploaded file's URL as the field's value. Say which way
you went in the closing message; a "link to your CV" text field is not a substitute for an upload.

### Rules

A rule shows, hides or requires fields while a condition on another field holds — the
dashboard's Rules tab, written as data. `when` names the deciding field by label and ONE test:

| test | holds when |
|---|---|
| `"is": value` · `"isNot": value` | the field equals / does not equal the value (a choice value, text, a number) |
| `"in": [values]` | the field's value is one of the list |
| `"includes": value` | a `multi` / `tags` selection contains the value (or text contains it) |
| `"checked": true` | a `checkbox` is ticked |
| `"isEmpty": true` · `"isNotEmpty": true` | the field is empty / filled |

Effects: `show: [labels]` (those fields are created hidden and appear while the condition
holds), `hide: [labels]`, `require: [labels]`. A field a rule hides is cleared and not submitted.

## Result

```json
{ "forms": [ { "name": "Contact",
               "formId": "0e0…",
               "created": true,
               "fields": [ { "target": "your_name_k3f9x2", "label": "Your name" }, … ],
               "fieldsLive": 9,
               "steps": 1,
               "rules": 1,
               "degraded": [] } ] }
```

**`formId` is what the page imports.** `fields[].target` is each input's `name` — the page
does not need them (it renders `form.fields` from the live schema), but they are the keys the
owner's submissions are stored under.

**`degraded` must be empty.** It is the read-back check: the seed re-reads the created form and
compares each field's `componentType` against what it sent, and the step and rule counts. A
non-empty list means something was accepted and then stored as something else — almost always a
choice field that lost its options and became a plain text box. Fix the plan, delete nothing, and
create the form again under a new name; a `200` on create does not mean the field survived.

## What the seed does

1. Installs the Wix Forms app (idempotent).
2. Lists existing forms in the `wix.form_app.form` namespace — a name match is skipped.
3. Expands each field, builds the steps and rules, creates the form, reads it back and checks
   every `componentType`, the step count and the rule count.

## Traps this seed already handles

Listed because a hand-rolled payload hits all of them, and each returns `200` first:

- **A choice field declares its options twice** — the component's `options[]` and the
  validation `enum` (or `items: { itemType, stringOptions.enum }` for a multi). Disagree and the
  field is created as a plain text box. With an `other` entry no enum is written: the free text
  is by definition outside the list. For a multi, `itemType` sits inside `items` beside the
  options block; one level up the create is a `400` whose message blames the options block.
- **A rule's expression root is an `and` / `or` group**, even for one condition. A bare
  condition at the root is a `400` (`UNGROUPED_RULE_EXPRESSION_ROOT`). Every condition carries a
  `value`, `isEmpty` / `isNotEmpty` / `checked` included (`RULE_CONDITION_VALUE_MISSING` without).
- **`validation` must be present even when empty**, nested under the *input-type* block, not
  the component one. Absent, the target is not registered as an accepted value and every
  submission is rejected with `UNKNOWN_VALUE_ERROR` on a key that IS in the schema.
- **`required` lives at `inputOptions.required`**, never inside a validation block. A checkbox
  that must be ticked additionally needs `validation.enum: [true]` — `required` alone only checks
  that a value is present, and `false` is a value.
- **The prefill key differs per component**: `options[].default` on a choice, `checked` on a
  checkbox, `defaultValue` on a rating, `default` elsewhere. The wrong key is silently ignored.
- **Date bounds live under the format's own block** (`dateOptions` / `timeOptions` /
  `dateTimeOptions`), as strings, and accept `$now±N`.
- **`steps` must reference every field, the submit button included.** A field missing from the
  layout never appears in the owner's dashboard — they cannot edit what the site renders.
- **Rules reference fields by id** (`fieldOptions.fieldId`, condition `target`), so a rule
  written by hand against labels never fires.
- **`target` is immutable** and must be unique within the form: letters, digits and single
  underscores, starting with a letter.
- **A checkbox label is rich content** (Ricos), not a string — the owner may put a link to the
  terms in it. The app flattens it to text.
- **Use `formFields`, never `fields`** — the latter is the legacy API.
- **A `file` field fails the whole create on a free site** (`FILE_UPLOAD_RESTRICTIONS_ERROR`, a
  plan restriction, not a payload bug); the seed names the field and the two ways out.

## Supplied content

The general rules are in `templates/shared/SUPPLIED-CONTENT.md`. For forms the user usually hands
over the form itself: a list of questions, or a PDF or screenshot of the form they use today. Each
question becomes a field, with the `kind` its answer implies (an email address → `email`, a fixed set
of answers → `select`, `radio` or `multi`, a long answer → `textarea`, an attachment → `file`); a
required mark becomes `required`; "if yes, …" becomes a rule; page breaks become `steps`; the
button label becomes `submitText`; the confirmation wording becomes `thankYou`. Question wording
verbatim.
