# Forms — playbook

The machinery ships as files — the schema read flattened into render-ready fields, the owner's
rules and steps applied, upload + submit, schema-driven validation in Wix's own wording, server
violations mapped onto controls, and the owner's submit settings resolved into an outcome,
correct end-to-end. A form is **schema-driven**: the owner picks the fields in their dashboard, so
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
| `wix/forms/types.ts` | the DTOs (`FormDto`, `FormFieldDto`, `FormStep`, `FormRule`, `FormSuccess`, `FormValues`, `FormErrors`, `SubmissionDto`, `SubmitOutcome`) — contracts below |
| `wix/forms/forms.ts` | `getForm`, `listForms` — the transport; the flattening of the raw schema into `FormFieldDto[]`, the rule evaluation (`applyRules`) and `isClosed` are in `forms-core.ts` beside it (shared with the REST layer) |
| `wix/forms/submissions.ts` | `uploadFiles`, `createSubmission`, `checkoutUrl` — the transport; `toSubmissionValues`, `submissionErrors`, `formLevelError`, `normalizePhone`, `normalizeUrl`, `SUBMITTED_OK` and the upload PUT are in `submissions-core.ts` beside it (shared with the REST layer) |
| `wix/forms/form-store.ts` | the form state machine, framework-free (`createFormStore({ formId, initialForm? })` — `getState`/`subscribe` + `setValue`/`setValues`/`validate`/`next`/`previous`/`submit`/`reset`/`setCaptchaToken`, one instance per form on the page); `validateValue`, `FORM_ERROR`, `otherValue`/`otherText`; the hook below binds it to React, every other stack uses it directly |
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
   submissions back). It carries the owner's submit settings: their thank-you text, a redirect,
   or the checkout of a paid form. Render what it says; never a "check your submissions" link.
3. **The home page and wherever the form lives** — hero, copy, the form section.

Plus the **theme** (`@theme` block, one edit) and the **chrome** (`SiteLayout`, one pass).

### What a complete form page shows (recommended defaults)

Defaults for a brief that says nothing about them; the prompt wins when it asks otherwise.

- Every field's `label` visible above or beside its control (`showLabel: false` → `aria-label`
  only); `required` marked the way `form.requiredIndicator` says — `ASTERISK` (an `*`), `TEXT`
  ("Required"), `NONE` — before or after the label per `requiredIndicatorBefore`;
  `description` as help text under the control; `placeholder` only where the owner wrote one;
  `readOnly` fields disabled.
- An error under its own control (`errors[target]`, `id="err-<target>"` so `aria-describedby`
  resolves), the form-level `errors[FORM_ERROR]` above the button; nothing turns red before the
  visitor touched the field or pressed submit.
- A multi-step form (`form.steps.length > 1`) shows one step at a time — the step's name, a
  progress cue, the fields whose `stepId` is the current step's, a back button (`previousText`)
  from the second step on, and `nextText` instead of the submit button until the last step.
- The submit button reads `submitText` when set, your wording else; disabled while `loading`.
- `form === null` renders a skeleton of the section, not an empty `<form>`; `errors[FORM_ERROR]`
  with no form renders the message and nothing else; `closed` renders `form.disabledMessage`
  (or your own "no longer accepting responses" line) instead of the fields.
- The thank-you replaces the form in place (same section, same width) — the visitor stays where
  they were. When `outcome.message` is set it is the owner's text (render its `\n` as
  paragraphs); when `outcome.durationSeconds` is set the store hides it again by itself.
- Copy is the owner's: labels, choices, thank-you and closed messages from the schema; no
  invented privacy promises or response-time claims.

### The contracts your components consume (tested and work as they are; read the source when something is off or the brief wants more)

```ts
// FormDto — one form, ready to render. In the store's state the owner's rules are ALREADY
// applied to the current values: `fields` holds only what to render now.
// { id, name,
//   fields: FormFieldDto[],
//   steps: [{ id, name, targets }],   // one entry on a plain form; targets = visible fields on that step
//   rules,                            // the owner's rules — the store evaluates them; a page never does
//   submitText, nextText, previousText,   // "" ⇒ write your own
//   enabled, disabledMessage,         // enabled: false ⇒ show disabledMessage instead of the form
//   limits: { deadline?, maxSubmissions?, perVisitor? },   // deadline closes the form client-side too
//   requiredIndicator: "ASTERISK" | "TEXT" | "NONE", requiredIndicatorBefore,
//   success: { action, message?, durationSeconds?, redirectUrl?, newTab? } }   // the owner's submit settings

// FormFieldDto — one input, flattened (settings nest 2 levels deep upstream)
// { target,            // the input's name, the key in values, the root of error keys
//   label, showLabel,  // never empty; rich-content labels already flattened to text
//   control,           // text|textarea|password|number|rating|email|phone|url|date|time|datetime
//                      // |select|radio|checkbox|checkboxGroup|tags|address|file|signature
//                      // |payment|appointment|unknown
//   required, readOnly, hidden, stepId,
//   placeholder?, description?,
//   defaultValue,      // "" | [] | {} | false | the owner's prefill — already the right SHAPE
//   choices: [{ value, label, imageUrl? }],   // select/radio/checkboxGroup/tags — else []; after a rule: the allowed subset
//   otherOption?: { label, placeholder? },    // a free-text "Other" entry — see below
//   addressParts: [{ sub, label, required, choices? }],  // address — `country` first, with its choices
//   validation: { format?, minLength?, maxLength?, pattern?, patternMessage?, minimum?, maximum?,
//                 multipleOf?, minDate?, maxDate?, fileLimit?, fileFormats?, accept?, minItems?,
//                 maxItems?, mustBeTrue?, allowedCountryCodes? },   // resolved: minDate is a real date
//   phoneCountry?, buttonText?, explanationText?,
//   identifier,        // TEXT_AREA, IMAGE_CHOICE, CONTACTS_EMAIL, CONTACTS_BIRTHDATE, CONTACTS_SUBSCRIBE …
//   inputType, componentType }

// SubmitOutcome — what a successful submit() resolves to (and `outcome` in state)
// { submission: { id, status, checkoutId? },
//   action: "CHECKOUT" | "THANK_YOU_MESSAGE" | "REDIRECT" | "POPUP" | "NO_ACTION",
//   message?, durationSeconds?,   // THANK_YOU_MESSAGE: the owner's text
//   url?, newTab? }               // CHECKOUT / REDIRECT: navigate there
```

```ts
// useWixForm(formId, { initialForm? })
// → { form,        // FormDto | null — null while loading; render a skeleton, not an empty form
//     values,      // target → value; arrays for multi-choice/files, objects for an address
//     setValues,   // setValues(v => ({ ...v, [target]: next }))
//     bind,        // spread onto a text-ish control: <input {...bind(f.target)} />
//     submit,      // onSubmit handler; resolves the SubmitOutcome when the submission was created, false else
//     validate,    // validate(target) | validate("addr/city") | validate() for the whole form
//     errors,      // target (or target/sub) → visitor-facing message; errors[FORM_ERROR] is form-level
//     loading,     // loading the schema, or submitting
//     step, next, previous, goToStep,   // multi-step; next(event) validates the current step first
//     closed,      // the form is off or past its deadline — show form.disabledMessage
//     outcome, reset,                    // the last success (thank-you / url), and how to dismiss it
//     setCaptchaToken }                  // hand a captcha widget's token to the next submit

// createFormStore({ formId, initialForm? }) — the same machine without React (lib, static, a port):
// getState() → { form, values, errors, loading, step, closed, outcome }; subscribe(fn); start() once
// mounted (loads the schema unless initialForm was given); stop() on unmount; setValue(target, value);
// setValues(next | fn); validate(target?) → boolean; next(event?) → boolean; previous(); goToStep(i);
// setCaptchaToken(token); reset(); submit(event?) → Promise<SubmitOutcome | false>.
// submit(event) reads event.currentTarget to focus the first invalid control (switching step
// when it sits on another page) — hand it the native submit event. FORM_ERROR, validateValue,
// otherValue and otherText are exported next to it.
```

`bind` covers input / textarea / select. A **checkbox or radio group** carries `checked`
instead of `value`, and a **file input cannot be controlled at all** — wire those by hand,
keeping the same `name`, `onBlur: () => validate(target)` and `aria-describedby` contract.

### Which control each field kind wants

| `control` | render |
|---|---|
| `text` `email` `url` `phone` `password` | `<input>` with the matching `type` — spread `bind`. A `url` gets `https://` prefixed on blur when typed as a bare domain; a `phone` shows `phoneCountry` as the example and, with `validation.allowedCountryCodes`, only those countries in a selector |
| `textarea` | `<textarea>` — spread `bind` |
| `number` `rating` | `<input type="number" min max step={validation.multipleOf}>`, or your own star control writing 1–5 |
| `date` `time` `datetime` | `<input type="date" / "time" / "datetime-local" min={validation.minDate} max={validation.maxDate}>` — the store adds the seconds Wix expects |
| `select` | `<select>` over `choices` — spread `bind` |
| `radio` | one `<input type="radio">` per choice, all sharing `name={f.target}` |
| `checkbox` | a single `<input type="checkbox">`; its value is a **boolean**. `identifier === "CONTACTS_SUBSCRIBE"` is the marketing opt-in — unchecked by default, never pre-ticked |
| `checkboxGroup` `tags` | one checkbox per choice; the value is an **array** of chosen values. `identifier === "IMAGE_CHOICE"` ⇒ each choice has `imageUrl` — render a picture tile per choice |
| `address` | one control per `addressParts` entry — `country` is a `<select>` over its `choices` (ISO-2 codes, labelled) and comes first; the value is an **object** keyed by `sub`, and its error keys are `target/sub` |
| `file` `signature` | `<input type="file" accept={validation.accept} multiple={validation.fileLimit > 1}>` (uncontrolled) — put the `File` objects in `values[target]`; the store uploads them on submit. Button wording from `buttonText`; a signature is an image the visitor draws or uploads |
| `payment` `appointment` `unknown` | out of scope for a plain form — a payment field needs the payment flow, an appointment field needs the `bookings` vertical. Render a disabled note rather than an input that submits the wrong thing |

**An "Other" choice.** When `otherOption` is set, render one extra radio / checkbox labelled
`otherOption.label` with a text input beside it; write `otherValue(field, text)` into the value
(for a group: into the array) — that is the `"Other: <text>"` string Wix stores — and read it
back with `otherText(field, value)`.

**Hidden fields and rules.** A field the owner hid, or a rule hides for the current values, is
not in `form.fields` — the store re-derives the list on every `setValue`, clears the value of a
field a rule just hid, and never validates or submits it. A rule can also make a field required
or narrow its `choices`; render from the current `form.fields` on every render and it all
follows.

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
import { useWixForm, FORM_ERROR } from "../../hooks/forms/useWixForm";
import type { FormDto } from "../../wix/forms/types";

export default function ContactForm({ formId, initialForm }: { formId: string; initialForm?: FormDto }) {
  const f = useWixForm(formId, { initialForm });   // no second fetch when initialForm is passed
  // …you implement the render:
  //   • f.outcome → the success state, in place of the form: f.outcome.message (the owner's
  //     thank-you, "\n" = paragraph) or your own wording; when f.outcome.url is set navigate there —
  //     window.location.assign(url) for CHECKOUT and a same-tab REDIRECT, window.open(url) when newTab.
  //     A paid form (action CHECKOUT) MUST be sent on: the order is waiting for payment.
  //   • f.errors[FORM_ERROR] && !f.form → the message alone (a form that can't load is a setup problem)
  //   • !f.form → a skeleton of the section
  //   • f.closed → f.form.disabledMessage || your "no longer accepting responses" line, no fields
  //   • else <form noValidate onSubmit={async (e) => { await f.submit(e); }}>
  //       (the outcome lands in f.outcome; a false return means errors are set)
  //       const step = f.form.steps[f.step]; const last = f.step === f.form.steps.length - 1;
  //       const fields = f.form.fields.filter((x) => x.stepId === step.id);   // one step at a time
  //       mapping fields to controls per the table above — text-ish: <input type=… {...f.bind(field.target)} />;
  //       groups/checkbox/file by hand with the same name / onBlur / aria contract; the error for a
  //       control in <p id={`err-${field.target}`}>{f.errors[field.target]}</p>; address subfield
  //       errors under f.errors[`${field.target}/${sub}`]; f.errors[FORM_ERROR] above the buttons;
  //       f.step > 0 && <button type="button" onClick={f.previous}>{f.form.previousText || "Back"}</button>
  //       last ? <button type="submit" disabled={f.loading}>{f.form.submitText || your wording}</button>
  //            : <button type="button" onClick={(e) => f.next(e)}>{f.form.nextText || "Continue"}</button>
  //       (hand next() the event of the <form>, or call f.next() with none — it focuses the first
  //       invalid control of the current step; a single-step form has no next button at all.)
  //     noValidate: the store validates in Wix's wording and focuses the first invalid control —
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

The control table above is the spec for everything else. Under `templates/forms/app/`.

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
  `<form>`'s submit handler calls `submit(event)` and renders `getState().outcome` (navigating
  to its `url` when set); a multi-step form calls `next(event)` / `previous()` and renders the
  fields of `form.steps[step]`.

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
`./js/wix/forms.js`; `uploadFiles`, `createSubmission`, `checkoutUrl`, `toSubmissionValues`,
`submissionErrors` from `./js/wix/submissions.js`. The state machine ships too: `createFormStore`
from `./js/wix/form-store.js` (`start()` once the page is up; `setValue`, `validate`, `next`,
`previous`, `submit`; `FORM_ERROR` beside it). No hook, no components — you write the rendering
in plain JS: build the controls when `getState().form` arrives (one element per `form.fields`
entry, `name` = `target`, `input` → `setValue`, `blur` → `validate(target)`), and on later
notifications update only the error text, `aria-invalid`, the button's disabled state, and
which fields are present (a rule can add or remove one; compare targets and add/remove only
those) — rebuilding every input on each keystroke drops focus. `<form novalidate>` with
`onsubmit = (e) => store.submit(e).then(out => out && showOutcome(out))`; `submit` reads the
native event's `currentTarget` to focus the first invalid control. Wix static hosting serves
files, not directories: the page is `contact.html`, linked as such. The visitor token persists
in `localStorage` on its own; never mint per page. The page's title and meta description are
yours (a form is not an entity page; there is no `seoData`). `npx @wix/cli@latest release`
uploads `site/`.

### Wiring — server-rendered, another language (Flask, Laravel, Rails, …)

Read the reference file listed above before writing the surface.

Run `deploy.mjs forms --stack static` in the project folder anyway: `js/wix/` is both the
browser-side code and the readable spec. Then split by where the call runs. **The schema on the
server:** port `js/wix/forms.ts` and `forms-core.ts` to your language — `getForm` is one GET with
the visitor token, `toForm` is the flattening — and render the fields in your template (labels,
required marks, choices, the same `name` = `target`), so the form is in the HTML; one anonymous
visitor token per process for this public read (mint and refresh per `client.ts`). **Values,
rules, validation and the submit in the browser:** load `./js/wix/form-store.js` in the template
and drive the rendered controls through `createFormStore({ formId })` exactly as the static wiring
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

Routes on Wix hosting: the host serves files only, so a clean route answers 404 when loaded directly — hash routes, or one HTML file per route, decided before the first route is written; any URL handed to Wix as a return target must be one the host serves (SKILL.md step 1).

## Hard rules

- **Never name a field in code.** Map `form.fields`. A page with `values.email` hardcoded
  breaks the moment the owner renames or removes that field — and the owner editing fields
  without a code change is what this vertical is for.
- **Never build a form without reading the schema.** A hand-built `<form>` posting to Wix Data
  or an email service silently drops real enquiries and loses the dashboard form builder,
  spam protection, notifications and CRM contact mapping.
- **Values, rules, validation and the submit go through `useWixForm` / the store** — never call
  the submission API by hand, never re-derive a request shape, never evaluate a rule or validate
  by a field's name. Extend by adding a function in `wix/forms/` for what they don't cover (API
  contracts: the `wix-docs` skill).
- **The visitor token is enough.** Both the schema read and the submission return 200 on an
  anonymous visitor, even though the spec lists them under owner scopes. Never add a backend,
  a connector token, or `auth.elevate` to make a form work.
- **Submissions are write-only from a visitor.** Reading them back genuinely 403s. If the app
  must LIST what visitors submitted, that is the `cms` vertical.
- **All three success statuses are a success** — `CONFIRMED`, `PENDING`, `PAYMENT_WAITING`
  all mean the submission exists. Showing an error instead invites a second submit, and the
  owner gets duplicates for an entry they already have. `PAYMENT_WAITING` additionally means an
  order is waiting: the outcome is `CHECKOUT` with the Wix checkout `url` — navigate the whole
  document there (never an iframe); the visitor comes back to `/` afterwards.
- **The owner's submit settings win.** `outcome.message` is their thank-you, `outcome.url` their
  redirect — render or follow them; your own wording is the fallback for `NO_ACTION` / `POPUP`.
- **Attachments are uploaded, never inlined.** The store uploads each `File` and submits
  `[{ fileId, displayName, fileType, url }]` per file field, as Wix's own runtime does. If a
  live submit with a file ever answers a violation on that field, that is the one place to
  look: the value shape in `submissions-core.ts`, checked against `about-submission-values.md`.
- **Spam protection is a dashboard setting**, not code. When the server wants a captcha it
  rejects with `INVALID_CAPTCHA` (the store shows it form-level); a site that needs one mounts
  a captcha widget and passes its token through `setCaptchaToken` — nothing ships for it.
- **Never mock, fail loudly.** A form that cannot load is a setup problem — surface it; never
  fall back to a hand-built form. A closed form (`closed`) is not an error: it renders the
  owner's message.
- Don't wrap shipped calls in your own API routes — they run client-side by design.
- Where the shipped code deploys (Astro, React): theme via the `@theme` tokens, and your markup
  uses Tailwind utilities on the same tokens — one design system. Where it doesn't (`lib`,
  `static`, a port): style with whatever your stack does well, on one token set of your own.
- **Call every hook before any conditional return.** An island that returns early for the
  skeleton or the thank-you above `useWixForm`/`useState` changes hook order between renders and
  React throws. Hooks first, branches after.

## Point the user to their dashboard

Hand the owner these links — `{siteId}` is `siteId` in `wix.config.json` (the deploy JSON prints it as
`dashboardUrl`); `{formId}` is the id the seed result returned.

| page | `https://manage.wix.com/dashboard/{siteId}/` + |
|---|---|
| Forms list | `wix-forms` |
| Edit the form (fields, steps, rules, submit settings, limits, notifications) | `wix-forms/form/{formId}` |
| Its submissions | `wix-forms/form/{formId}/submissions` |

Say so when you hand the site over — the whole value of this vertical is that their edits land on the
site with no code change: a renamed field, a new step, a "show when" rule, a changed thank-you, a
closing date. Submissions are per form; there is no site-wide submissions page.

## Seeding

`seed/SEED.md` is the contract: a plain-data plan in, created forms out. Read it when drafting
the plan; the seed writes the form ids your pages import.

**Build the UI only after the seed has run** — the form id comes from it, and the field set
you are rendering is the one it created.

**File uploads are plan-gated.** A `file` field is created only on a paid site plan; on a free site
the seed stops with `FILE_UPLOAD_RESTRICTIONS_ERROR` and names the field. Two ways out, the owner's
choice unless the brief already decided: they upgrade the site and the same plan re-runs, or the field
becomes a `url` kind plus a `capabilities.mediaUpload` policy (Astro only) — the site uploads the file
through the shared endpoint (`wix/media-upload/client.ts`) and submits the file's URL as that field's
value. The closing message says which one shipped.
