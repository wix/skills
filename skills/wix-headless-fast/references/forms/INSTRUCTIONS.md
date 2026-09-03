# Forms — playbook

The machinery ships as files — the schema read flattened into render-ready fields, upload +
submit, schema-driven validation, and server violations mapped onto controls, correct
end-to-end. A form is **schema-driven**: the owner picks the fields in their dashboard, so
every form has a different field set and no "contact form" component could ship for it.
**You render the fields; you never write the reading, validating or submitting.**

## The file map (deployed into `src/`)

**Don't read the shipped files** — this table and the contracts below are everything you need.
Open a shipped file's source only on a real fallback (runtime error / uncovered field kind).

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` · `wix/media.ts` · `wix/money.ts` | shared auth seam + helpers (deploy configures; nothing to set) |
| `wix/forms/types.ts` | the DTOs (`FormDto`, `FormFieldDto`, `FormValues`, `FormErrors`) — contracts below |
| `wix/forms/forms.ts` | `getForm`, `listForms` — the raw schema flattened into `FormFieldDto[]` |
| `wix/forms/submissions.ts` | `uploadFiles`, `toSubmissionValues`, `createSubmission`, `submissionErrors`, `normalizePhone` |
| `hooks/forms/useWixForm.ts` | the whole form as state — contract below |
| `styles/global.css` | the design system: Tailwind v4 + the `@theme` token block (shared across verticals) |

There are **no shipped components and no shipped pages** — every control is yours.

## What you build — the design job

Read the seed plan first: its forms and their fields are what the page renders.

1. **A form surface per seeded form** — your layout, your labels' typography, your error
   styling, mapping `form.fields` to controls. **Never name a field in code**: the owner can
   rename, reorder, add or require one from their dashboard, and the page must follow with no
   code change. That is the entire point of this vertical.
2. **A success state** — the resolved `submit()` IS the confirmation (a visitor cannot read
   submissions back). Show a thank-you; never a "check your submissions" link.
3. **The home page and wherever the form lives** — hero, copy, the form section.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).

### The contracts your components consume

```ts
// FormDto — one form, ready to render
// { id, name, fields: FormFieldDto[], submitText }   // submitText "" ⇒ write your own

// FormFieldDto — one visible input, flattened (settings nest 2 levels deep upstream)
// { target,            // the input's name, the key in values, the root of error keys
//   label,             // never empty; rich-content labels already flattened to text
//   control,           // text|textarea|number|rating|email|phone|url|date|time|datetime
//                      // |select|radio|checkbox|checkboxGroup|tags|address|file|signature
//                      // |payment|appointment|unknown
//   required, placeholder?, description?,
//   defaultValue,      // "" | [] | {} | the owner's prefill — already the right SHAPE
//   choices: [{ value, label }],        // select/radio/checkboxGroup/tags — else []
//   addressParts: [{ sub, label, required }],  // address — else []
//   validation: { format?, minLength?, maxLength?, pattern?, minimum?, maximum?,
//                 fileLimit?, minItems?, maxItems? },
//   phoneCountry?,     // phone only
//   identifier,        // TEXT_AREA, IMAGE_CHOICE, CONTACTS_EMAIL … when control isn't enough
//   inputType, componentType }
```

```ts
// useWixForm(formId, { initialForm? })
// → { form,        // FormDto | null — null while loading; render a skeleton, not an empty form
//     values,      // target → value; arrays for multi-choice/files, objects for an address
//     setValues,   // setValues(v => ({ ...v, [target]: next }))
//     bind,        // spread onto a text-ish control: <input {...bind(f.target)} />
//     submit,      // onSubmit handler; resolves TRUE when the submission was created
//     validate,    // validate(target) | validate("addr/city") | validate() for the whole form
//     errors,      // target (or target/sub) → visitor-facing message; errors[FORM_ERROR] is form-level
//     loading }    // loading the schema, or submitting
```

`bind` covers input / textarea / select. A **checkbox or radio group** carries `checked`
instead of `value`, and a **file input cannot be controlled at all** — wire those by hand,
keeping the same `name`, `onBlur: () => validate(target)` and `aria-describedby` contract.

### Which control each field kind wants

| `control` | render |
|---|---|
| `text` `email` `url` `phone` | `<input>` with the matching `type` — spread `bind` |
| `textarea` | `<textarea>` — spread `bind` |
| `number` `rating` | `<input type="number">`, or your own star control writing a number |
| `date` `time` `datetime` | `<input type="date" / "time" / "datetime-local">` |
| `select` | `<select>` over `choices` — spread `bind` |
| `radio` | one `<input type="radio">` per choice, all sharing `name={f.target}` |
| `checkbox` | a single `<input type="checkbox">`; its value is a **boolean** |
| `checkboxGroup` `tags` | one checkbox per choice; the value is an **array** of chosen values |
| `address` | one control per `addressParts` entry; the value is an **object** keyed by `sub`, and its error keys are `target/sub` |
| `file` `signature` | `<input type="file">` (uncontrolled) — put the `File` objects in `values[target]`; the hook uploads them on submit |
| `payment` `appointment` `unknown` | out of scope for a plain form — a payment field needs the payment flow, an appointment field needs the `bookings` vertical. Render a disabled note rather than an input that submits the wrong thing |

### Wiring — Astro (default)

Fetch in frontmatter so the first paint has the schema, and hand it to the island:

```astro
---
import { getForm } from "@/wix/forms/forms";
const form = await getForm(FORM_ID);        // FORM_ID from the seed plan
---
<ContactForm client:load initialForm={form} />
```

The island calls `useWixForm(form.id, { initialForm })` — no second fetch, no loading flash.

### Wiring — React SPA (Vite etc.)

`useWixForm(FORM_ID)` with no `initialForm`; render a skeleton while `form` is null.

## Hard rules

- **Never name a field in code.** Map `form.fields`. A page with `values.email` hardcoded
  breaks the moment the owner renames or removes that field — and the owner editing fields
  without a code change is what this vertical is for.
- **Never build a form without reading the schema.** A hand-built `<form>` posting to Wix Data
  or an email service silently drops real enquiries and loses the dashboard form builder,
  spam protection, notifications and CRM contact mapping.
- **The visitor token is enough.** Both the schema read and the submission return 200 on an
  anonymous visitor, even though the spec lists them under owner scopes. Never add a backend,
  a connector token, or `auth.elevate` to make a form work.
- **Submissions are write-only from a visitor.** Reading them back genuinely 403s. If the app
  must LIST what visitors submitted, that is the `cms` vertical.
- **All three success statuses are a success** — `CONFIRMED`, `PENDING`, `PAYMENT_WAITING`
  all mean the submission exists. Showing an error instead invites a second submit, and the
  owner gets duplicates for an entry they already have.
- **Never mock, fail loudly.** A form that cannot load is a setup problem — surface it; never
  fall back to a hand-built form.

## Point the user to their dashboard

The owner edits fields, sees submissions, and sets notifications at
`https://manage.wix.com/dashboard/<siteId>/form/forms`. Say so when you hand the site over —
the whole value of this vertical is that their edits land on the site with no code change.

## Seeding

`seed/SEED.md` is the contract: a plain-data plan in, created forms out. Read it when drafting
the plan; the seed writes the form ids your pages import.

**⚠️ Build the UI only after the seed has run** — the form id comes from it, and the field set
you are rendering is the one it created.

## Verify (before declaring done)

- The rendered controls match the seeded fields — same labels, same order, same required marks.
- A submit with an empty required field shows YOUR inline message, and focus moves to it.
- A valid submit resolves and shows the thank-you; the entry appears in the owner's dashboard.
- Renaming a field in the dashboard changes the page on reload, with no code change.
