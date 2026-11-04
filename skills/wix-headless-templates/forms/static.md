# Forms on a static site

The pages are HTML files at the root of the site. They import the forms modules from `/js/wix/`
and render what the modules return. This file is the whole playbook for that path: the modules,
the shipped form renderer, the page around it, the rules and the seed.

A form is schema-driven: the owner picks the fields in the dashboard, so every form has a
different field set. The page renders the fields the schema has, and never writes the reading,
the validation or the submit.

## The modules

`/js/wix/forms.js`: `getForm(formId)` (the schema, flattened into render-ready fields, with the
owner's steps, rules and submit settings) and `listForms()`. `/js/wix/submissions.js` holds the
upload and the submit; the pages reach it through the store, never directly. The store,
`createFormStore({ formId })` in `/js/wix/form-store.js`, holds the form's state: `form` (null
while loading), `values`, `errors`, `loading`, `step`, `closed`, `outcome`; its actions are
`start()`, `stop()`, `setValue(target, value)`, `setValues`, `validate(target?)`, `next()`,
`previous()`, `goToStep(index)`, `setCaptchaToken(token)`, `reset()`, `submit()`. `FORM_ERROR`
beside it is the key of the form-level error in `errors`. Each `.js` opens with its declarations.
A store calls a listener on every change and not when it subscribes. The visitor token persists
in `localStorage` on its own, and it is enough: the schema read and the submission both answer an
anonymous visitor.

## The shipped renderer

`renderForm(root, { formId, onOutcome })` from `/js/wix/form-renderer.js` renders the whole form
into `root`, driven by the store, and returns `{ store, destroy }`. The page renders it as it is.
It builds one control per field in `form.fields`, applies the owner's required indicator, shows
help text and errors under each control only after a blur or a submit, renders one step at a time
with the owner's back, next and submit wording, follows the owner's rules (a field a rule hides
leaves the page; the address parts follow the chosen country), handles the "Other" choice, keeps
`File` objects for the store to upload, shows the owner's closed message, and after a successful
submit replaces the form with the thank-you text or navigates the document to the checkout or
the redirect URL. `onOutcome(outcome)` runs once after that, for a page that wants to scroll or do
more. `initialForm` in place of `formId` takes a schema already fetched.

The renderer sets no styles. Its classes use the prefix `form`: `form`, `form-loading`,
`form-closed`, `form-step`, `form-step-title`, `form-step-count`, `form-fields`, `form-field`,
`form-field--<control>`, `form-label`, `form-required`, `form-control`, `form-choices`,
`form-choice`, `form-choice--selected`, `form-choice-label`, `form-choice-image`,
`form-other-input`, `form-address`, `form-address-part`, `form-help`, `form-error`,
`form-file-note`, `form-unsupported`, `form-actions`, `form-back`, `form-next`, `form-submit`,
`form-form-error`, `form-success`, `form-success-text`. The `<form>` carries `data-state`
("loading", "open", "submitting", "closed", "done").

To style, in the page's stylesheet on the same tokens as the rest of the page:
`form-field--<control>` names the kind of field (text, textarea, number, rating, email, phone,
url, date, time, select, radio, checkbox, checkboxGroup, tags, address, file, signature), so one
rule reaches a kind. The step's progression button, `form-next` or `form-submit`, is the primary
button, and only one of them shows per step; `form-back` is secondary. `form-choice--selected` is
a chosen radio or checkbox choice; `form-choice-image` has no size. A control with an error has
`aria-invalid="true"` with the text in `form-error` under it, both hidden until they apply.
`form-required` is the required mark. `form-submit[disabled]` with `aria-busy="true"` is the
button while submitting. `form-success` replaces the fields after a submit. Scope the rules to
these classes.

## The form page

`contact.html` (or the page the brief names) holds the heading, the intro and the form. The form
id comes from the seed result. The page's title and meta description are the page's own: a form
is not an entity and has no `seoData`.

```html
<section class="enquiry">
  <h1>Get in touch</h1>
  <p class="enquiry-intro">Tell us about your project and we reply within two working days.</p>
  <div id="contact"></div>
</section>
```

```js
import { renderForm } from "/js/wix/form-renderer.js";

const FORM_ID = "the id the seed returned";
const section = document.querySelector(".enquiry");
renderForm(document.querySelector("#contact"), {
  formId: FORM_ID,
  onOutcome: () => section.scrollIntoView({ block: "start" }),
});
```

A page that shows more of the state reads the renderer's `store`: `form.name` for a heading when
the brief wants the owner's name, `form.steps.length` for a progress cue of its own, `outcome` to
show something beside the thank-you.

```js
import { renderForm } from "/js/wix/form-renderer.js";

const { store } = renderForm(document.querySelector("#contact"), { formId: "the id the seed returned" });
const count = document.querySelector("#step-count");
function renderMeta(s) {
  if (!s.form) return;
  count.textContent = s.form.steps.length > 1 ? `Step ${s.step + 1} of ${s.form.steps.length}` : "";
}
store.subscribe(renderMeta);
renderMeta(store.getState());
```

## What the schema carries

`form.fields` are in the owner's layout order; each has `target`, `label`, `showLabel`,
`control`, `required`, `readOnly`, `hidden`, `stepId`, `placeholder`, `description`,
`defaultValue`, `choices`, `otherOption`, `addressParts`, `validation`. The form has `steps` (one
for a plain form), `rules`, `submitText`, `nextText`, `previousText`, `enabled`,
`disabledMessage`, `limits`, `requiredIndicator` ("ASTERISK", "TEXT", "NONE") with
`requiredIndicatorBefore`, and `success` (the owner's thank-you message, redirect or nothing).
The renderer reads all of it; the list is here so the page knows what the owner controls from the
dashboard and leaves to them: labels, choices, the thank-you, the closing date.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/contact.html`. A link to a folder gives the visitor a 404 page. When the submit leads to a
checkout, the renderer navigates the whole document there and the visitor comes back to `/`.

## Rules

- Map `form.fields`; a field is never named in code. The owner renames and removes fields
  without a code change, and that is the point of this solution.
- Every form on the site comes from its schema through the renderer. A hand-built form posting
  elsewhere loses the dashboard builder, the spam protection, the notifications and the contact
  mapping.
- Values, rules, validation, uploads and the submit go through the store. Extend by adding a
  function beside the modules for what they do not cover.
- The visitor token is enough for the read and the submit. Submissions are write-only from a
  visitor; a site that must list them is the cms solution's job.
- A submission with status CONFIRMED, PENDING or PAYMENT_WAITING exists; the renderer treats all
  three as success and follows the owner's submit settings: their message, their redirect, or the
  checkout for a paid form.
- Spam protection is a dashboard setting. When the server asks for a captcha, the store shows it
  as a form-level error; a site that needs one mounts a captcha widget and passes its token
  through `setCaptchaToken`.
- A form that cannot load is a setup problem to surface, never a reason for a hand-built form. A
  closed form shows the owner's message.

## The owner's links

`https://manage.wix.com/dashboard/{siteId}/` followed by `wix-forms` (the forms list),
`wix-forms/form/{formId}` (fields, steps, rules, submit settings, limits, notifications) and
`wix-forms/form/{formId}/submissions` (its submissions). Say in the close that their edits land on
the site with no code change: a renamed field, a new step, a rule, a changed thank-you, a closing
date. Submissions are per form.

## Seeding

Per `seed/SEED.md` and `seed/seed-forms.mjs`: a plain-data plan in, created forms out, run in the
script's order with its waits. Seed before building the page: the form id comes from the seed
result, and the field set the page renders is the one it created. The seed is additive; an
existing form with the same name is left as it is and reported with `created: false`. A `file`
field is created only on a paid site plan: on a free site the seed stops with
`FILE_UPLOAD_RESTRICTIONS_ERROR` and names the field, and the owner chooses between upgrading the
site and re-running the same plan, or a `url` field in its place. The close says which one
shipped.
