# Forms — playbook

The machinery ships as files — the schema read flattened into render-ready fields, upload +
submit, schema-driven validation, and server violations mapped onto controls, correct
end-to-end. A form is **schema-driven**: the owner picks the fields in their dashboard, so
every form has a different field set and no "contact form" component could ship for it.
**You render the fields; you never write the reading, validating or submitting.**

## The file map (deployed into `src/`)

**On Astro and React the shipped files are tested and work as they are** — this table and the
contracts below are everything you need to use them, so don't spend the run reading their source;
wire them and build your surfaces. Reading them is the right move when something is off (a runtime
error, a field kind this playbook doesn't cover) or when the brief wants a behaviour they don't
offer — then read the file that owns it and change or extend it. On `lib`, `static`, and a port
the hook doesn't deploy; the store behind it does, and the wiring sections below say what to
read first. Files you edit: `SiteLayout.astro` and `styles/global.css`. Files you **create**
(skeletons below): the form page and its island, plus your home page.

| file | what it is |
|---|---|
| `wix/config.ts` · `wix/sdk.ts` · `wix/media.ts` · `wix/money.ts` | shared auth seam + helpers (deploy configures; nothing to set) |
| `wix/forms/types.ts` | the DTOs (`FormDto`, `FormFieldDto`, `FormValues`, `FormErrors`, `SubmissionDto`) — contracts below |
| `wix/forms/forms.ts` | `getForm`, `listForms` — the transport; the flattening of the raw schema into `FormFieldDto[]` is in `forms-core.ts` beside it (shared with the REST layer) |
| `wix/forms/submissions.ts` | `uploadFiles`, `createSubmission` — the transport; `toSubmissionValues`, `submissionErrors`, `normalizePhone`, `SUBMITTED_OK` and the upload PUT are in `submissions-core.ts` beside it (shared with the REST layer) |
| `wix/forms/form-store.ts` | the form state machine, framework-free (`createFormStore({ formId, initialForm? })` — `getState`/`subscribe` + `setValue`/`setValues`/`validate`/`submit`, one instance per form on the page); `validateValue`, `FORM_ERROR`; the hook below binds it to React, every other stack uses it directly |
| `hooks/forms/useWixForm.ts` | React binding of `form-store.ts` — the whole form as state plus `bind` — contract below |
| `rest/forms.ts` · `rest/submissions.ts` (skill-side) | the REST twin of the two data files: same exports, same DTOs, over `fetch` with the visitor token — what `--stack static` deploys, and the spec a port reads |
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

### What a complete form page shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins when it asks otherwise.

- Every field's `label` visible above or beside its control; `required` marked the same way on
  every field; `description` as help text under the control; `placeholder` only where the owner
  wrote one.
- An error under its own control (`errors[target]`, `id="err-<target>"` so `aria-describedby`
  resolves), the form-level `errors[FORM_ERROR]` above the button; nothing turns red before the
  visitor touched the field or pressed submit.
- The submit button reads `submitText` when set, your wording else; disabled while `loading`.
- `form === null` renders a skeleton of the section, not an empty `<form>`; `errors[FORM_ERROR]`
  with no form renders the message and nothing else.
- The thank-you replaces the form in place (same section, same width) — the visitor stays where
  they were.
- Copy is the owner's: labels and choices from the schema, no invented privacy promises or
  response-time claims.

### The contracts your components consume (tested and work as they are; read the source when something is off or the brief wants more)

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

// createFormStore({ formId, initialForm? }) — the same machine without React (lib, static, a port):
// getState() → { form, values, errors, loading }; subscribe(fn); start() once mounted (loads the
// schema unless initialForm was given); stop() on unmount; setValue(target, value);
// setValues(next | fn); validate(target?) → boolean; submit(event?) → Promise<boolean>.
// submit(event) reads event.currentTarget to focus the first invalid control — hand it the
// native submit event. FORM_ERROR and validateValue are exported next to it.
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
| `file` `signature` | `<input type="file">` (uncontrolled) — put the `File` objects in `values[target]`; the store uploads them on submit |
| `payment` `appointment` `unknown` | out of scope for a plain form — a payment field needs the payment flow, an appointment field needs the `bookings` vertical. Render a disabled note rather than an input that submits the wrong thing |

### The page and island you create — skeletons

The class names here are the Astro/React spelling of rules that hold on every stack; on a
stack where the hook doesn't deploy, keep the rule and write it in your own CSS. Hooks first,
branches after (an early return above a hook changes hook order between renders and React
throws). The island renders on the server too (`client:load` SSRs) — render every state
totally; nothing in a render path may throw.

```astro
---
// src/pages/contact.astro — YOU create it. The schema is fetched SERVER-SIDE so the first paint
// has the fields, and handed to the island as a serialized DTO prop.
import SiteLayout from "../layouts/SiteLayout.astro";
import ContactForm from "../components/forms/ContactForm";
import { getForm } from "../wix/forms/forms";
import type { FormDto } from "../wix/forms/types";

const FORM_ID = "…"; // from the seed result (seed-result.json → forms[].formId)
let form: FormDto | null = null;
try {
  form = await getForm(FORM_ID);
} catch {
  // Guarded: an unhandled SSR throw truncates the response mid-stream; the island loads the
  // schema itself and shows the real error if it fails again.
}
---
<SiteLayout title="Contact">
  <!-- your heading / intro, then: -->
  <ContactForm client:load formId={FORM_ID} initialForm={form ?? undefined} />
</SiteLayout>
```

```tsx
// src/components/forms/ContactForm.tsx — YOU build it; contact.astro mounts it.
import { useState } from "react";
import { useWixForm, FORM_ERROR } from "../../hooks/forms/useWixForm";
import type { FormDto } from "../../wix/forms/types";

export default function ContactForm({ formId, initialForm }: { formId: string; initialForm?: FormDto }) {
  const f = useWixForm(formId, { initialForm });   // no second fetch when initialForm is passed
  const [sent, setSent] = useState(false);
  // …you implement the render:
  //   • sent → your thank-you, in place of the form (the resolved submit() IS the confirmation)
  //   • f.errors[FORM_ERROR] && !f.form → the message alone (a form that can't load is a setup problem)
  //   • !f.form → a skeleton of the section
  //   • else <form noValidate onSubmit={async (e) => { if (await f.submit(e)) setSent(true); }}>
  //       mapping f.form.fields to controls per the table above — text-ish: <input type=… {...f.bind(field.target)} />;
  //       groups/checkbox/file by hand with the same name / onBlur / aria contract; the error for a
  //       control in <p id={`err-${field.target}`}>{f.errors[field.target]}</p>; address subfield
  //       errors under f.errors[`${field.target}/${sub}`]; f.errors[FORM_ERROR] above the button;
  //       the button labelled f.form.submitText || your wording, disabled while f.loading.
  //     noValidate: the store validates in your wording and focuses the first invalid control —
  //     the browser's bubbles would race it.
}
```

### The reference files for stacks where the components don't deploy

On `lib`, `static`, and a port, nothing under `hooks/` arrives — and this vertical ships nothing
under `components/` on any stack. The state machine behind the hook does arrive —
`wix/forms/form-store.ts` — so you never rewrite it: `createFormStore` per form, `subscribe`,
render from `getState()`, call its actions. Its `FormState` interface is the render contract;
read that. What you write is the rendering, and one shipped file is worth reading first:

1. `hooks/forms/useWixForm.ts` — `bind`: the exact props a text-ish control gets (`name`,
   `value`, change → `setValue`, blur → `validate(target)`, `aria-describedby="err-<target>"`,
   `aria-invalid`), and how a change of `formId` gets a fresh store. Your framework's controls
   follow the same contract.

The control table above is the spec for everything else. Under `references/forms/app/`.

### Wiring — Astro (default)

1. Set the `@theme` tokens (one edit); brand `SiteLayout.astro` (one pass).
2. Create the form page and its island per the skeletons above — frontmatter machinery exact,
   presentation yours. Fetch in frontmatter so the first paint has the schema; the island calls
   `useWixForm(formId, { initialForm })` — no second fetch, no loading flash.
3. Write `pages/index.astro` (home) on `SiteLayout`.

### Wiring — another JS framework (`--stack lib`: Vue, Svelte, Solid, plain Vite)

Read the reference file listed above before writing the surface.

`deploy.mjs forms --stack lib` put the data layer in `src/wix/` and nothing else: `sdk.ts` (the
visitor client, configured with the public client id), `media.ts`, `money.ts`, and `wix/forms/` —
`forms.ts`, `submissions.ts`, `types.ts`, the two `*-core.ts` rule files, and `form-store.ts`.
None of it is React. The hook doesn't ship on this stack; the store replaces it, and you write
the controls in your framework to the contracts on this page:

- bind the store with your framework's external-store primitive (Vue: `shallowRef` updated in
  `subscribe`; Svelte: `readable(store.getState(), (set) => store.subscribe(() => set(store.getState())))`;
  Solid: a signal set in `subscribe`). `createFormStore({ formId })` per form (`start()` when
  mounted, `stop()` when unmounted). State in, actions out — exactly the hook's contract above;
- a control's change handler calls `setValue(target, value)` (a checkbox group: the array of
  checked values; a file input: `[...input.files]`), blur calls `validate(target)`, the
  `<form>`'s submit handler calls `submit(event)` and shows the thank-you on `true`.

Route `/contact` (or wherever the form lives); dev server on 4321; a static build goes through
`npx @wix/cli@latest release` with `site.outputDirectory` pointing at the build folder, an SSR
build is hosted by you.

### Wiring — static site (`--stack static`, no bundler)

Read the reference file listed above before writing the surface.

`deploy.mjs forms --stack static --out site` put the REST layer in `site/js/wix/` (browser ESM,
the `.ts` beside each `.js` for reading). Everything the visitor loads lives under `site/` —
pages, styles, `js/` — and `wix.config.json`'s `site.outputDirectory` is `"./site"`; the project
root (config, plan, seed output) is never the upload. Same function names and DTOs as the table
above, so the contracts on this page hold unchanged: `getForm`, `listForms` from
`./js/wix/forms.js`; `uploadFiles`, `createSubmission`, `toSubmissionValues`, `submissionErrors`
from `./js/wix/submissions.js`. The state machine ships too: `createFormStore` from
`./js/wix/form-store.js` (`start()` once the page is up; `setValue`, `validate`, `submit`;
`FORM_ERROR` beside it). No hook, no components — you write the rendering in plain JS: build the
controls ONCE when `getState().form` arrives (one element per `form.fields` entry, `name` =
`target`, `input` → `setValue`, `blur` → `validate(target)`), and on later notifications update
only the error text, `aria-invalid`, and the button's disabled state — rebuilding the inputs on
every keystroke drops focus. `<form novalidate>` with `onsubmit = (e) => store.submit(e).then(ok
=> ok && showThankYou())`; `submit` reads the native event's `currentTarget` to focus the first
invalid control. Wix static hosting serves files, not directories: the page is `contact.html`,
linked as such. The visitor token persists in `localStorage` on its own; never mint per page.
The page's title and meta description are yours (a form is not an entity page; there is no
`seoData`). `npx @wix/cli@latest release` uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference file listed above before writing the surface.

Run `deploy.mjs forms --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Then split by where the call runs. **The schema on the
server:** port `js/wix/forms.ts` and `forms-core.ts` to your language — `getForm` is one GET with
the visitor token, `toForm` is the flattening — and render the fields in your template (labels,
required marks, choices, the same `name` = `target`), so the form is in the HTML; one anonymous
visitor token per process for this public read (mint and refresh per `client.ts`). **Values,
validation and the submit in the browser:** load `./js/wix/form-store.js` in the template and
drive the rendered controls through `createFormStore({ formId })` exactly as the static wiring
above — the browser owns the visitor's token, so the server never handles per-visitor tokens or
submissions. If the submit must run server-side anyway (no JS), port `submissions.ts` +
`submissions-core.ts` and `client.ts`'s header applies: one token set per visitor in the visitor's
session, never one process-wide token. Add your public https origin to the OAuth app's allowed
domains.

**Pre-rendered (Frozen-Flask, Pelican, any static-site generator) → Wix-hosted.** Same port for
the schema read, run at build time with one anonymous token; the generator emits the form page
with the fields in the HTML. Run `deploy.mjs forms --stack static --out <build dir>` so `js/wix/`
is inside the output the page imports from, point `site.outputDirectory` at that folder, `wix
release`. Pages sit at different depths: give the templates one base path to `js/wix/` (a
template variable, or root-relative `/js/wix/…`), never a relative `./js/wix/` — it breaks one
level down. The rendered fields are the first paint; values, validation and the submit still run
client-side through `createFormStore()` from `./js/wix/form-store.js`, exactly as on a static
site. Close with the rebuild + release command and one line for the owner: a field renamed or
added in the dashboard reaches the rendered HTML when that command runs; the submit is live
regardless.

### Wiring — React SPA (Vite etc.)

Import `./styles/global.css` once at the app entry (needs `@tailwindcss/vite` in the vite config
plugins — deploy already added the dep). `useWixForm(FORM_ID)` with no `initialForm`; render a
skeleton while `form` is null. Deploy wrote the public client id into `wix/config.ts`; nothing
else to configure.

## Hard rules

- **Never name a field in code.** Map `form.fields`. A page with `values.email` hardcoded
  breaks the moment the owner renames or removes that field — and the owner editing fields
  without a code change is what this vertical is for.
- **Never build a form without reading the schema.** A hand-built `<form>` posting to Wix Data
  or an email service silently drops real enquiries and loses the dashboard form builder,
  spam protection, notifications and CRM contact mapping.
- **Values, validation and the submit go through `useWixForm` / the store** — never call the
  submission API by hand, never re-derive a request shape, never validate by a field's name.
  Extend by adding a function in `wix/forms/` for what they don't cover (API contracts: the
  `wix-docs` skill).
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
- Don't wrap shipped calls in your own API routes — they run client-side by design.
- Where the shipped code deploys (Astro, React): theme via the `@theme` tokens, and your markup
  uses Tailwind utilities on the same tokens — one design system. Where it doesn't (`lib`,
  `static`, a port): style with whatever your stack does well, on one token set of your own.
- **Call every hook before any conditional return.** An island that returns early for the
  skeleton or the thank-you above `useWixForm`/`useState` changes hook order between renders and
  React throws. Hooks first, branches after.

## Point the user to their dashboard

The owner edits fields, sees submissions, and sets notifications at
`https://manage.wix.com/dashboard/<siteId>/form/forms`. Say so when you hand the site over —
the whole value of this vertical is that their edits land on the site with no code change.

## Seeding

`seed/SEED.md` is the contract: a plain-data plan in, created forms out. Read it when drafting
the plan; the seed writes the form ids your pages import.

**Build the UI only after the seed has run** — the form id comes from it, and the field set
you are rendering is the one it created.
