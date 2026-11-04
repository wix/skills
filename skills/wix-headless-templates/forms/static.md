# Forms on a static site

The pages are HTML files at the root of the site. They import the forms layer from `/js/wix/`:
the schema read, the submission calls, and one store that holds a form's state and rules. Nothing
on the screen ships; every control is yours, in the design of the site. This file shows how to
drive the layer. The skeletons show the calls and the fields and leave the markup to you.

A form is schema-driven: the owner picks the fields in the dashboard, so every form has a
different field set. The page renders the fields the schema has, by kind, and never writes the
reading, the validation or the submit.

## The layer

`/js/wix/forms.js`: `getForm(formId)` (the schema, flattened into render-ready fields, with the
owner's steps, rules and submit settings) and `listForms()`. `/js/wix/submissions.js` holds the
upload and the submit; the page reaches them through the store. The store, `createFormStore({
formId })` in `/js/wix/form-store.js`, owns the rules: the values, the owner's rules applied to
them (a field a rule hides leaves `form.fields`, its choices narrow, its required flag follows),
validation in Wix's wording, the steps, the closed state, the uploads and the submit. `FORM_ERROR`
beside it is the key of the form-level error in `errors`; `otherText(field, value)` and
`otherValue(field, text)` beside it handle a choice field's free-text "Other" entry. Each `.js`
opens with its declarations; read the store's before you write the page. The visitor token
persists in `localStorage` on its own, and it is enough: the schema read and the submission both
answer an anonymous visitor.

## The pattern

Create the store, subscribe a render function, render once, start. A store calls the listener on
every change and not on subscribe, so the first render is yours.

```js
import { createFormStore } from "/js/wix/form-store.js";

var store = createFormStore({ formId: "the id the seed returned" });
function render(s) {
  // read s, write your markup into the page
}
store.subscribe(render);
render(store.getState());
store.start();
```

Controls call the store's actions. Delegate from the form element and read the field from the
control's `name`, so a re-render keeps the listeners:

```js
formEl.addEventListener("input", function (e) { store.setValue(e.target.name, e.target.value); });
formEl.addEventListener("focusout", function (e) { if (e.target.name) store.validate(e.target.name); });
formEl.addEventListener("submit", function (e) {
  var s = store.getState();
  if (s.form && s.step < s.form.steps.length - 1) store.next(e); else store.submit(e);
});
```

`next(e)` and `submit(e)` prevent the default themselves; both validate first and move focus to
the first invalid control. `submit()` resolves the outcome when the submission was created and
`false` when it did not send.

## The form page

`contact.html`, or the page the brief names, holds the heading, the intro and the form. The form
id comes from the seed result. The page's title and meta description are the page's own: a form
is not an entity. From the state:

- `form` is null while loading: render a loading line, and `errors[FORM_ERROR]` when the load
  failed. `closed` true means the form is not taking submissions (switched off, or past its
  deadline): show `form.disabledMessage`, or your own line when it is empty, and nothing else.
- `form.fields` are the fields to render right now, in the owner's order, with the rules already
  applied: hidden ones are gone, each has its effective `required` and `choices`. Render by
  mapping them; a field is never named in code.
- `form.steps` has one entry for a plain form. `step` is the index of the page being shown;
  render the fields whose `stepId` matches `form.steps[step].id`, a progress cue when there is
  more than one step, and the actions: `previous()` on every step but the first with
  `form.previousText`, `next(e)` with `form.nextText` on every step but the last, `submit(e)`
  with `form.submitText` on the last. Empty wording means the owner left the default; write
  yours. One progression button per step is the primary action; back is secondary.
- `values[field.target]` is the control's value: a string, a number, a boolean for a consent
  checkbox, an array for a multi-choice or a file field, an object for an address.
- `errors[field.target]` is the message under the control, present only after a blur or a
  submit; set `aria-invalid` on the control while it is there. `errors[target + "/" + sub]` is an
  address part's. `errors[FORM_ERROR]` is form-level: show it above the actions.
- `loading` is true while the schema loads and while submitting: disable the progression button
  and mark it busy.
- `outcome` is set after a successful submit. With `outcome.url` (a checkout or the owner's
  redirect) navigate the document there, in a new tab when `outcome.newTab`; else replace the
  form with `outcome.message` split on newlines, or your own thank-you when it is empty.
  `outcome.durationSeconds` asks for the message to hide after that long: call `reset()` then.

Each field carries `target`, `label`, `showLabel` (false: keep the label for assistive tech
only), `control`, `required`, `readOnly` (render disabled, it submits its prefill), `placeholder`,
`description` (help text under the control), `defaultValue`, `choices`, `otherOption`,
`addressParts`, `validation`, `identifier`. The required mark follows `form.requiredIndicator`
("ASTERISK", "TEXT" for the word, "NONE") and `form.requiredIndicatorBefore`.

The kinds in `control`, and the control each takes:

- `text`, `email`, `phone`, `url`, `password`: an input of that type. `number`: a number input
  with `validation.minimum`, `maximum`, `multipleOf` as its step. `date`, `time`, `datetime`: the
  matching input type, bounds from `validation.minDate` and `maxDate`. `textarea`: a textarea
  with `validation.maxLength`. `rating`: a row of values from `minimum` to `maximum`.
- `select`: a select over `choices` (`value`, `label`); `radio`: one radio per choice;
  `checkboxGroup` and `tags`: one checkbox per choice, the value an array of the checked values;
  a choice with `imageUrl` renders its picture. `checkbox`: one consent checkbox, the value a
  boolean, its label the field's.
- A choice field with `otherOption` gets one more choice with `otherOption.label` and a text
  input shown while it is chosen. Its value goes through `otherValue(field, text)` and comes back
  through `otherText(field, value)`, null when a listed choice is chosen.
- `address`: one control per entry of `field.addressParts`, named `target/sub`, `country` first
  as a select over its `choices`, a part with `choices` (a subdivision) as a select, the rest as
  text inputs. The store recomputes `addressParts` for the chosen country, so read them from the
  state on every render. The value is an object keyed by `sub`: set it whole with
  `setValue(target, Object.assign({}, values[target], { city: text }))`.
- `file`, `signature`: a file input with `validation.accept`, `multiple` when `fileLimit` is
  above one; `setValue(target, Array.from(input.files))`. The store uploads the files on submit.
  `buttonText` and `explanationText` are the owner's words for it.
- `payment`, `appointment`, `unknown`: not fillable on a static page; render the label and a line
  saying so.

A sketch of one field, kinds in, markup yours:

```js
function field(f, s) {
  var v = s.values[f.target], err = s.errors[f.target], html = "";
  html += "<label for=\"" + f.target + "\">" + esc(f.label) + (f.required ? " *" : "") + "</label>";
  switch (f.control) {
    case "textarea":
      html += "<textarea id=\"" + f.target + "\" name=\"" + f.target + "\"" + (f.readOnly ? " disabled" : "") + ">" + esc(v || "") + "</textarea>";
      break;
    case "select":
      html += "<select id=\"" + f.target + "\" name=\"" + f.target + "\">";
      f.choices.forEach(function (c) { html += "<option value=\"" + esc(c.value) + "\"" + (v === c.value ? " selected" : "") + ">" + esc(c.label) + "</option>"; });
      html += "</select>";
      break;
    case "checkbox":
      html += "<input id=\"" + f.target + "\" name=\"" + f.target + "\" type=\"checkbox\"" + (v === true ? " checked" : "") + ">";
      break;
    default:
      html += "<input id=\"" + f.target + "\" name=\"" + f.target + "\" type=\"" + inputType(f.control) + "\" value=\"" + esc(v || "") + "\"" + (f.readOnly ? " disabled" : "") + (err ? " aria-invalid=\"true\"" : "") + ">";
  }
  if (f.description) html += "<p>" + esc(f.description) + "</p>";
  if (err) html += "<p role=\"alert\">" + esc(err) + "</p>";
  return html;
}
```

`inputType` maps `email`, `url`, `phone` (to `tel`), `password`, `number`, `date`, `time`,
`datetime` (to `datetime-local`) and anything else to `text`. `esc` escapes `&`, `<`, `>` and
`"` in anything that came from the schema. A checkbox group's `input` handler builds the array
from the checked boxes before `setValue`; a file input's `change` handler passes the files.
Re-rendering a text control on every keystroke loses the caret: update only the parts of the
markup that changed, or restore focus and selection after the render.

## Pages and routes

Wix static hosting serves files. Make every page a file in the root and link to the file:
`/contact.html`. A link to a folder gives the visitor a 404 page. Every page declares its charset in
the head; the host sends none. When the submit leads to a checkout, the page navigates the whole
document there and the visitor comes back to `/`. Write the page's script as a file of its own and
keep it small; a page's code travels as text in the upload call.

## Rules

- Map `form.fields`; a field is never named in code. The owner renames and removes fields
  without a code change, and that is the point of this solution.
- Every form on the site comes from its schema through the store. A hand-built form posting
  elsewhere loses the dashboard builder, the spam protection, the notifications and the contact
  mapping.
- Values, rules, validation, uploads and the submit go through the store. Extend by adding a
  function beside the layer for what it does not cover.
- The visitor token is enough for the read and the submit. Submissions are write-only from a
  visitor; a site that must list them is the cms solution's job.
- A submission with status CONFIRMED, PENDING or PAYMENT_WAITING exists; the store treats all
  three as success and resolves the owner's submit settings into `outcome`: their message, their
  redirect, or the checkout for a paid form.
- Spam protection is a dashboard setting. When the server asks for a captcha, the store shows it
  as the form-level error; a site that needs one mounts a captcha widget and passes its token
  through `setCaptchaToken`.
- A form that cannot load is a setup problem to surface, never a reason for a hand-built form. A
  closed form shows the owner's message.
- Render form inputs once; a render touches their values, the button and the error, not the inputs.
- Every control on the page has a rule in the stylesheet; one primary action per step, the rest
  compact or text actions.

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
