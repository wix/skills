# Wix Forms — client utils (you build the UI)

**Intent:** contact / enquiry / lead / signup / waitlist / application / feedback / survey / quote
request / intake or registration — any form a visitor fills in and submits. Whether the submission
also becomes a CRM contact is a per-field mapping, not a different vertical.

This vertical ships **no UI**: the owner picks the fields in their dashboard, so every form has a
different field set and no "contact form" component could ship for it. You write one control per
field — the shipped utils supply the schema behind it, the state, the validation and the submit. Everything runs on the public `WIX_CLIENT_ID`
(anonymous visitor token) — no SDK, no backend, no elevated credential.

> **⚠️ A visitor-fillable form is FORMS, not CMS.** Wiring one to `insertDataItem` works, and is the
> wrong call: it gives up the dashboard form builder, spam protection, notifications and contact
> mapping, and needs the owner to set collection permissions before a visitor can submit at all.
> Use **`cms`** only when the app must **read the entries back** (a gallery, a listing, "my
> submissions") — a visitor cannot read Forms submissions. Submit-only → forms.

## What ships (utils only)

| file | what it is |
|---|---|
| `lib/wix-form-schema-utils.js` | **Reading the raw schema** — `orderedInputs`, `submitTextOf`, and per field `targetOf`, `labelOf`, `isRequired`, `validationOf`, `componentOf`, `optionsOf`, `inputTypeOf`, `componentTypeOf`, `choicesOf`, `addressPartsOf`, `phoneCountryOf`, `isMulti`/`isFile`/`isNumber`/`isAddress`. No React, no REST; the hook hands them back as `read`. |
| `rest/wix-forms.js` | Schema transport: `getForm`, `listForms`, plus `phoneExample` (what a visitor is shown), `normalizePhone` (what goes on the wire), `setSiteCountry`. |
| `rest/wix-forms-submissions.js` | Write transport: `toSubmissionValues`, `createSubmission`, `SUBMITTED_OK`, the file flow (`getMediaUploadUrl`, `uploadSubmissionFile`, `uploadFormFiles`), `submissionViolations`. |
| `hooks/useWixForm.js` | The form's non-visual half: `useWixForm(formId)` → `{ form, values, setValues, bind, submit, validate, errors, loading, read }`. Also exports `validateField`, `mapSubmissionErrors`, `FORM_ERROR`. Not on React? Those plus `lib/` are the load-bearing part; port the state around them. |
| `wix-config.js` *(shared)* | the two ids, written by the install step. |
| `wix-forms.config.js` *(generated)* | **the gate** — `WIX_FORMS`: each form's `formId` + read-back `targets`, written by the seed after verification. |
| `WixManageBanner` *(shared)* | Dev-only manage banner — mount it in your Layout. |

## Prerequisites — a HARD GATE

- **`src/rest/wix-forms.config.js` must exist.** No file → the seed hasn't succeeded → **stop and
  run the seed**. It's the one vertical whose client can't be built in parallel with its seed.
- **Never invent a `formId`, and never write that file early.** Its only value is as proof that a
  verified schema exists; the seed writes it after creating *and* verifying each schema.
- **The Wix Forms app installed, with at least one form.** This vertical doesn't provision forms.
- **No permission setup** — unlike CMS, a visitor can read a published form's schema and submit to it
  out of the box.

## Build the UI

**The schema is the source of truth, whatever the markup looks like.** Every `target`, label,
`required` flag, constraint and choice option comes from it, and so does the submission map — nothing
about a field is yours to invent.

**The markup is yours to author.** Write a JSX element per field (step 5) when the layout matters,
which on a designed page it usually does. Loop over `read.orderedInputs(form)` with a branch per
control type instead when the owner will keep editing the form, and a dashboard change should reach
the site with no code touch. The per-field wiring is identical either way.

The JSDoc in `hooks/useWixForm.js` and `lib/wix-form-schema-utils.js` covers what each util does;
this covers which control a field wants and where the obvious implementation is wrong. Markup and
styling are yours (on base44: shadcn + `src/index.css`).

### 1 · Load the form

```jsx
import { useWixForm, FORM_ERROR } from "@/hooks/useWixForm";
import { WIX_FORMS } from "@/rest/wix-forms.config";   // written by the seed — never by hand

const { form, values, setValues, submit, validate, errors, loading, read } =
  useWixForm(WIX_FORMS.contact.formId);

const fields = read.orderedInputs(form);   // what the form contains, in the owner's layout order
```

| | |
|---|---|
| `form` | the Form exactly as Wix returned it (`null` until loaded). Nothing stripped or renamed. |
| `values` | state, keyed by `target`: string for text/choice/date, **array** for multi-choice and files, **object** for an address. Seeded from the schema's defaults. |
| `setValues` | plain React setter — `setValues((v) => ({ ...v, [name]: value }))`. |
| `bind(target)` | the props a text-ish control needs, ready to spread: `name`, `value`, `onChange`, `onBlur`, `aria-describedby`, `aria-invalid`. |
| `submit(event)` | use as `onSubmit`; resolves **`true`** only when the submission was created. |
| `validate(target?)` | one field, one address subfield, or the whole form. Returns whether it passed. |
| `errors` | control name → visitor-facing message; `errors[FORM_ERROR]` is form-level. |
| `loading` | loading the schema (`form` still `null`) **or** submitting (`form` set). |
| `read` | the schema accessors, so the UI needs one import. |

Fields are the raw objects Wix sent, so anything the accessors don't cover is still on them —
`pii`, `showLabel`, `buttonText`, `explanationText`, `options[].image`, the `steps[]` a multi-page
form would need.

**`contact` is this example's key.** The seed names each form — `waitlist`, `quote`, `application` —
so use the keys `wix-forms.config.js` actually contains.

**Several forms on one page?** The hook loads one schema each. Past two, call
`listForms({ formIds: [...] })` once (up to 100 ids) and run `orderedInputs` over each result.

**Set the site's country once at app start**, so locale-derived examples match the business, not the
visitor's browser:

```js
import { setSiteCountry } from "@/rest/wix-forms";
setSiteCountry("GB");
```

### 2 · Render one control per field

Author them or loop over them — every control carries the same four things, and `bind(target)` from
the hook supplies the first three:

1. **`name` = the field's `target`** — the immutable storage key, and also the state key, the error
   key and the submission key. Keying everything by it makes the submission right by construction;
   it's how a blocked submit finds the control to focus, and it drives autofill.
2. **`value` from `values[target]`, written back through `setValues`.** (A choice group carries
   `checked` instead; a file input can't be controlled at all and takes only `onChange`.)
3. **`onBlur` → `validate(target)`** — not on the first keystroke of an untouched field, which
   reddens a required field before the visitor types. Once flagged, re-check as they type from an
   **effect on the value**: React hasn't committed the new value when `onChange` runs, so a check
   there judges the value they just replaced.
4. **A real `<label>`, and an error node** — see step 6 for the wiring both need. `bind` sets the
   error node's `aria-describedby`/`id` pair (`err-${target}`); you render the node itself.

**Stamp the schema's constraints as native attributes.** They reinforce the JS checks and drive
mobile keyboards:

| from the schema | onto the control |
|---|---|
| `isRequired(field)` | `required` |
| `validationOf(field).minLength` / `.maxLength` | `minLength` / `maxLength` |
| `validationOf(field).pattern` | `pattern` |
| `validationOf(field).minimum` / `.maximum` | `min` / `max` (number and rating) |
| `validationOf(field).format` | input `type` — `EMAIL`→`email`, `PHONE`→`tel`, `URL`→`url`, `DATE`→`date`, `TIME`→`time`, `DATE_TIME`→`datetime-local`, else `text`; `isNumber(field)`→`number` |
| the resolved `type` | `inputMode` — `number`→`decimal`, `tel`/`email`/`url` as themselves; omit for date/time (native picker) |
| `componentOf(field).placeholder` | `placeholder` |
| `validationOf(field).fileLimit` | `multiple`, when above 1 |
| `validationOf(field).uploadFileFormats` | `accept` — map the media kinds a browser knows (`IMAGE`→`image/*`, `VIDEO`, `AUDIO`, `DOCUMENT`); omit `accept` when the owner allows anything |
| `field.identifier` for `CONTACTS_*` kinds | `autoComplete` — `email`, `tel`, `given-name`, `family-name`, `organization`, `bday`; address subfields take `address-line1`, `address-level2`, `postal-code`, `country` |

**A constrained field with no placeholder gets a synthesized one:** PHONE →
`phoneExample(read.phoneCountryOf(field))` (that country's regulator-reserved fictional number,
falling back to the site's), URL → `https://…`. It prevents the `must match format "phone"` rejection
without a hint line under every field.

#### Which control

`identifier` and `componentType` are **independent axes** — several fields share one component — so
branch on whichever distinguishes the control, and **never on the `target` name**, which an owner's
rename silently breaks.

| control | branch on | `values[target]` |
|---|---|---|
| `<textarea>` | `field.identifier === "TEXT_AREA"` | string |
| `<select>` | `read.componentTypeOf(field) === "DROPDOWN"` | string |
| radios | `read.componentTypeOf(field) === "RADIO_GROUP"` | string |
| checkbox group | `read.isMulti(field)` | **array** of checked values |
| address group | `read.isAddress(field)` | **object** keyed by subfield |
| file / signature | `read.isFile(field)` | **`File` objects** until submit |
| text / email / tel / url / date / time / number | `validationOf(field).format`, `isNumber` | string |

Two that bite: `componentType` is `TEXT_INPUT` for short **and** long answer, so keying a textarea
off it renders every long field single-line; and `IMAGE_CHOICE` is indistinguishable from multi
choice except by `identifier` — it falls out as plain checkboxes, and its pictures are on
`componentOf(field).options[].image`.

**Coverage check — every field kind an owner can add:**

| dashboard field | `identifier` | renders as | `values[target]` |
|---|---|---|---|
| Short answer, Link, Company, Position, Tax ID, First/Last name, Email, single-line Address | `TEXT_INPUT`, `URL_INPUT`, `CONTACTS_*` | text input, `type` from `format` | string |
| Long answer | `TEXT_AREA` | `<textarea>` | string |
| Phone | `CONTACTS_PHONE` | `type="tel"` + reserved example | string (E.164 on submit) |
| Number, Rating | `NUMBER_INPUT`, `RATING_INPUT` | `type="number"` (or your stars) | string in state, number on the wire |
| Dropdown | `DROPDOWN` | `<select>` | string |
| Single choice | `RADIO_GROUP` | radios | string |
| Multi choice, Tag picker, Image choice | `CHECKBOX_GROUP`, `TAGS`, `IMAGE_CHOICE` | checkboxes (or a chip / image control) | **array** |
| Date, Date picker, Date and time, Time, Birthdate | `DATE_INPUT`, `DATE_PICKER`, `DATE_TIME_INPUT`, `TIME_INPUT`, `CONTACTS_BIRTHDATE` | native date/time input | string |
| Multi-line address | `MULTILINE_ADDRESS` | fieldset of subfields | **object** |
| File upload, Signature | `FILE_UPLOAD`, `SIGNATURE` | file input (a signature deserves a canvas) | **`File` objects** |
| Checkbox, Subscribe checkbox | `CHECKBOX`, `CONTACTS_SUBSCRIBE` | not covered here — `BOOLEAN`, and its label is Ricos rich content, not a string | boolean |
| Product, Fixed price, Custom price, Donation | `PRODUCT_LIST`, `FIXED_PAYMENT`, `PAYMENT_INPUT`, `DONATION` | not covered here — `PAYMENT` | array of product objects |
| Appointment | `APPOINTMENT` | not covered here — `SCHEDULING` | appointment object |
| Service picker, Multi-service picker | `SERVICES_DROPDOWN`, `SERVICES_MULTI_CHOICE` | `<select>` / checkboxes, options from the connected app | string / **array** |

`orderedInputs` returns the uncovered types too — nothing is filtered for you. Write the control, or
have the owner drop the field; a **required** field you don't render makes the form unsubmittable.

**Display fields never reach this loop.** `RICH_TEXT` blocks and the submit button are
`fieldType: "DISPLAY"`, so `orderedInputs` drops them. If a form uses rich-content blocks as section
copy between fields, read them off `form.formFields` yourself — their content is Ricos, not a string.

Wix's [About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields.md)
is the spec behind this table. `seed/SEED.md` carries the same identifiers from the authoring side
(which JSON creates each field); this one is the rendering side (which control, which value shape) —
they join on `identifier`.

#### Controls that need more than an input

**Choice groups** go in a `<fieldset>` with a `<legend>`; the group's `aria-describedby`,
`aria-invalid` and `aria-required` go on the fieldset, since no single radio can carry them. Options
come from `read.choicesOf(field)` (`{ value, label }`, label falling back to value). A checkbox
group's value is an array — toggle values in and out of it.

**A dropdown** needs a disabled `<option value="">` first (state starts empty, so otherwise the first
real option looks pre-selected); use `componentOf(field).placeholder` for its text.

**An address** is a group whose value is a nested object. Subfields come from
`read.addressPartsOf(field)` (`{ sub, required }`, hidden `addressLine2` already dropped); name each
control **`${target}/${sub}`**, which is exactly the server's error path for a nested field, so
rejections land on the right control with no mapping of your own. Subfield keys are storage keys —
humanize them (`postalCode` → "Postal code"). **`country` and `subdivision` are country-dependent
enums the schema doesn't enumerate**: render `country` as a select over ISO-3166 alpha-2 codes,
narrowed to `validationOf(field).allowedCountries` when set. Keeping `subdivision` free text means
leaving it optional and relying on the mapped error.

#### File uploads — the value is the upload URL

The hook's `submit` runs this before it sends anything:

1. **`getMediaUploadUrl(formId, filename, mimeType)`** → a signed `uploadUrl`. This Forms-scoped
   wrapper is what makes a visitor upload possible at all: `site-media` directly needs a Manage-Media
   credential and 403s for a visitor.
2. **`PUT` the bytes to it** with the file's `Content-Type`, via plain `fetch` — the URL is
   pre-signed, and adding the visitor's `Authorization` header turns a working upload into a 400.
3. **Submit that same `uploadUrl` as the value** — not the CDN URL the upload returns, not a file id.
   One file submits the string; several submit an array.

So `values[target]` holds `File` objects until submit, and validation checks the count (`required`,
`fileLimit`) since no string rule applies. Three render consequences: the input can't be controlled
(wire `onChange`, list the picked filenames yourself); clearing it after success needs a `key` you
bump in `handleSubmit`, because resetting state leaves the browser's own "1 file selected" text; and uploads run inside
`loading`, so the button's progress state matters more here.

**A signature** shares `WIX_FILE`, so a file input accepts one — but the honest control is a canvas:
`canvas.toBlob(...)` → a `File` named `signature.png` in `values[target]`, same upload path.

**Never base64 a file into a value.** It stores no real file and blows past the submission size
limit. A form with no file field at all is a plan gate — file, signature and payment fields need a
Core-or-above plan — fixed by the owner's plan, never an inlined blob.

### 3 · Validation — schema-driven on the client, authoritative on the server

`validate(target?)` applies only rules the schema states:

| rule | from |
|---|---|
| required | `isRequired(field)` — including a multi-choice or file field with nothing picked, and each required address subfield |
| length | `validationOf(field).minLength` / `.maxLength` |
| shape | `.pattern`, and `.format` — EMAIL, PHONE (E.164 after stripping spaces/dashes/parens), URL |
| range | `.minimum` / `.maximum` on number and rating, parsed before comparing |

Call it as `validate("email")` (the `onBlur` wiring), `validate("address/city")` for one subfield, or
`validate()` for everything — `submit` already does the last, so reach for it only to gate something
else. It reads `values`, and it clears what now passes as well as flagging what doesn't. An address
subfield gets the `required` check only; `country`/`subdivision` content is the server's call.

**Show invalid state on the control**, keyed off the same `aria-invalid` the render sets, so visual
and assistive-tech state can't drift — no parallel `.has-error` class:

```css
input[aria-invalid="true"], select[aria-invalid="true"], textarea[aria-invalid="true"],
fieldset[aria-invalid="true"] { border-color: var(--destructive); outline-color: var(--destructive); }
.error:empty { display: none; }
```

**Never key a check on a field's name** (the classic slip: keying the email check on
`target === "email"`) — derive it from `format` and the schema's constraints, as `validateField`
does. And a client rule **laxer** than the server's is worse than none: the visitor
then learns about the problem after a round trip, in Wix's wording instead of yours.

### 4 · Submit

`submit(event)` client-validates → uploads picked files → builds the submission map (empty optionals
dropped, PHONE normalized to E.164, NUMBER coerced; it walks the *schema*, so a stray key in `values`
can't reach the API) → creates the submission → maps server violations onto controls and focuses the
first invalid one. On success it resets `values` to the schema's defaults.

**The resolved `true` is the only success signal there is.** Submissions are write-only from the
browser — reading them back needs an owner scope and 403s for a visitor. The submission lands in the
owner's dashboard.

`CONFIRMED`, `PENDING` and `PAYMENT_WAITING` all mean created. A `PAYMENT_WAITING` form leaves the
visitor a payment step: surface it **inside** the success state, never as a failed submit.

**No captcha** at the default protection level — don't add captcha plumbing speculatively.

### 5 · The whole component

Author one JSX element per field, using the `target`s the seed wrote and the constraints the schema
states. `bind(target)` supplies the wiring every control shares — `name`, `value`, `onChange`,
`onBlur`, `aria-describedby`, `aria-invalid` — so a field is a label, a control and its error node:

```jsx
export default function ContactForm() {
  const { form, values, bind, setValues, submit, validate, errors, loading, read } =
    useWixForm(WIX_FORMS.contact.formId);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event) {
    setSent(await submit(event));   // true only when the submission was created
  }

  if (loading && !form) return <p>Loading…</p>;
  // A form that can't load is a setup problem — say so; never fall through to a hand-built form,
  // which silently drops real enquiries.
  if (!form) return <p role="alert">This form isn't available right now. {errors[FORM_ERROR]}</p>;
  // Swapping the form out is a silent DOM change, so the success state announces itself.
  if (sent) {
    return (
      <div role="status">
        <h3 tabIndex={-1}>Thank you</h3>
        <p>We'll be in touch shortly.</p>
        <button type="button" onClick={() => setSent(false)}>Send another</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label>
        <span>Your email<span aria-hidden="true"> *</span></span>
        <input {...bind("email_a1b2")} type="email" required autoComplete="email" />
        <p className="error" id="err-email_a1b2" role="alert">{errors.email_a1b2}</p>
      </label>

      <label>
        <span>How can we help?</span>
        <textarea {...bind("message_c3d4")} rows={5} maxLength={500} />
        <p className="error" id="err-message_c3d4" role="alert">{errors.message_c3d4}</p>
      </label>

      {/* A choice group carries `checked` rather than `value`, so wire it by hand — same name,
          same onBlur, and the aria-* on the fieldset because no single radio can hold them. */}
      <fieldset aria-describedby="err-budget_e5f6" aria-invalid={Boolean(errors.budget_e5f6) || undefined}>
        <legend>Budget</legend>
        {["Under £5k", "£5k–£20k", "Over £20k"].map((option) => (
          <label key={option}>
            <input type="radio" name="budget_e5f6" value={option}
                   checked={values.budget_e5f6 === option}
                   onChange={() => setValues((v) => ({ ...v, budget_e5f6: option }))}
                   onBlur={() => validate("budget_e5f6")} />
            {option}
          </label>
        ))}
        <p className="error" id="err-budget_e5f6" role="alert">{errors.budget_e5f6}</p>
      </fieldset>

      <p role="alert">{errors[FORM_ERROR]}</p>
      <button type="submit" disabled={loading}>
        {loading ? "Sending…" : (read.submitTextOf(form) || "Submit")}
      </button>
    </form>
  );
}
```

The `target`s (`email_a1b2`, …) come from `WIX_FORMS.<key>.targets` — **never invent or shorten one**,
since a key that isn't an exact schema `target` 400s the whole submission. Everything else on each
control comes from that field's schema entry (step 2): its label, its `required`, its length/pattern
bounds, its choice options. `noValidate` keeps your messages instead of the browser's bubbles; the
native constraints still drive keyboards and assistive tech.

**Authoring beats looping here**, because the layout is the point: a two-column name row, a budget
group styled as cards, copy between sections. **Loop instead when the owner will keep editing the
form** — `read.orderedInputs(form).map(...)` with a branch per control type keeps a dashboard change
reaching the site with no code touch. Either way the wiring per field is what's above.

Two things the shell doesn't show:

- **Server violations land on controls**, keyed exactly like the client's (`target`, or `target/sub`
  for an address subfield). The copy comes from the violation's `errorType` plus the field's schema;
  an unmapped type degrades to safe copy, and Wix's internal `errorMessage` goes to `console.debug`.
  Only a failure with no per-field violations sets `errors[FORM_ERROR]`.
- **A required field you didn't render** blocks submit with a message that has no control to display
  it. Check `read.orderedInputs(form)` against your branches before shipping.

### 6 · Accessibility — the controls are generated, so one slip hits every field

- **The error node renders always**, empty or filled, with `role="alert"` and a deterministic id
  (`err-${target}`) the control points at via `aria-describedby`. `aria-describedby` alone only reads
  on focus; conditional rendering (`{error && …}`) destroys the live region entirely. Hide the empty
  state with CSS.
- **`aria-invalid` only when invalid** — `undefined`, never `"false"`.
- **A group's error and `aria-*` go on the `<fieldset>`** — choice groups and addresses have no
  single control to describe.
- **Required is programmatic**: the `required` attribute (or `aria-required` on a group) carries the
  meaning, the `*` is `aria-hidden` decoration. Both, never the glyph alone.
- **Every control has a real `<label>`** — a placeholder disappears on input and fails contrast.
- **The success state is announced** (`role="status"`, or focus its heading).

Don't reach for `role="form"`, an `aria-label` on an input that already has a `<label>`, or a custom
`role="radio"` — native radios in a `<fieldset>` are already a radiogroup.

## Hard rules

- A visitor-fillable form is this vertical, not `cms`.
- Read and write only through the shipped helpers — never hand-build a Wix Forms URL.
- Never invent a `target`, label, option or constraint — every one comes from the schema (authored
  markup included). Never detect a control by its `target` name either.
- Read fields through the accessors, not by reaching into `inputOptions` — the block names are enum
  derived, and the accessors map every one of them.
- Key every control by `target`: `values[target]`, `errors[target]`, `name`. Address subfields use
  `target/sub`.
- Derive validation from the schema, and keep every client rule at least as strict as the server's.
- **Never add `auth.elevate`, a backend function or a connector token to make a form work.** The
  visitor token reads the schema and creates the submission; the API spec's owner scopes are wrong
  for the published-site path. This is the most common wrong turn on this vertical.
- Submissions are write-only from the browser — the resolved `createSubmission` **is** the success
  signal. Listing entries back needs `cms`.
- Every status the submit resolves on is a created submission: show the thank-you, and put a payment
  step inside it. Treating one as failure costs the owner duplicates.
- Order comes from `steps[]`, not `formFields[]`; take the order only, not the geometry.
- Render every field `orderedInputs` returns, or confirm what you skip isn't `required`.
- A file field submits the URL from `getMediaUploadUrl` — never base64, never a Manage-Media
  credential, never the CDN URL the upload returns.
- `UNKNOWN_VALUE_ERROR` / `NOT_ALLOWED_VALUE_ERROR` are seed bugs — fix the schema, don't mangle the
  key or value.
- Never mock a form. No `formId`, or a form that won't load, is a setup problem to surface.
- Never show a locale-wrong example, and never submit the reserved one you display.

## Fallback

Three sources answer what this file doesn't: the **JSDoc** in `hooks/useWixForm.js` and
`lib/wix-form-schema-utils.js`; the **Wix reference** below; and `seed/SEED.md` for how a field was
authored. Calling an endpoint the helpers don't wrap is fine via `wixApiRequest` — look up the exact
method and body first (or use the `wix-docs` skill), never guess.

- Form object (the shape `form` and its fields arrive in): https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/form-object.md
- Form Schemas API: https://dev.wix.com/docs/api-reference/crm/forms/form-schemas.md
- About Form Fields (every field-level rule): https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields.md
- Form Submissions API: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions.md
- About Submission Values (per-`inputType` value shapes): https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values.md
- Validation errors: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/introduction#validation-errors
- Get Media Upload URL: https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/get-media-upload-url.md
- Uploading to a generated URL: https://dev.wix.com/docs/api-reference/assets/media/media-manager/files/upload-api.md

## Not this vertical

An event **RSVP** → `events` (it ships its own registration form). A **bookable service's** form →
`bookings`. Content the app **lists back** — reviews, galleries, "my items" → `cms`. A form only
logged-in members may reach → `members` for the gate, forms for the form. `SKILL.md`'s routing table
is the deciding copy.

## Seeding

Seed per `seed/SEED.md`: it installs the Forms app, creates each schema, verifies it (reads it back,
checks the dashboard summary, sends and deletes one real submission), then writes
`src/rest/wix-forms.config.js`. Needs an elevated credential, and **does not run in parallel with the
client** — see Prerequisites.

## Point the user to their dashboard

Substitute the site's `metaSiteId`:

- **Forms list** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-forms`
- **Form builder** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-forms/form/{formId}` → add,
  relabel, reorder or require fields; every change reflects on the site with no code change.
- **Submissions** — `https://manage.wix.com/dashboard/{metaSiteId}/wix-forms-and-payments/submissions`
- **Forms settings** (incl. notifications) — `https://manage.wix.com/dashboard/{metaSiteId}/wix-forms-and-payments/settings`
- **Contacts** — `https://manage.wix.com/dashboard/{metaSiteId}/contacts` → contact-mapped fields
  create or update a contact automatically.

## Verify

- [ ] `wix-forms.config.js` exists; every `formId` comes from `WIX_FORMS`, none typed by hand.
- [ ] `WIX_CLIENT_ID` set (not the placeholder).
- [ ] Looped form: relabel a field in the dashboard, reload, the new label appears with no code
      change. Authored form: every `target` in the JSX matches `WIX_FORMS.<key>.targets` exactly.
- [ ] Every field `read.orderedInputs(form)` returns has a control — long answer is a `<textarea>`,
      choice groups render their options, an address renders its subfields — or what you skipped
      isn't `required`.
- [ ] Required fields show inline errors on blur, in your wording, before any round trip.
- [ ] A deliberately invalid email/phone is rejected inline, on the right control.
- [ ] A real submission shows the thank-you, then appears in the owner's **submissions inbox** and
      (for contact-mapped fields) as a **contact**.
- [ ] Has a file field? Attached a real file, submitted, and opened the attachment from the
      dashboard — a submission recording an unusable attachment still "succeeds".
- [ ] Keyboard pass: a blocked submit focuses the first invalid control, errors are announced, every
      control has a real label.
- [ ] No `auth.elevate`, backend function or connector token in the submit path.
