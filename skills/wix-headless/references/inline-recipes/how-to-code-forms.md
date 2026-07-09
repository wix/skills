---
name: "How to Code Forms"
description: The frontend contract for Wix Forms — the `@wix/forms` `submissions.createSubmission(submission, options)` write path, keying the `submissions` map by each field's seeded `target` (not label/id), why the anonymous visitor can submit with no captcha and no `auth.elevate`, why the frontend only WRITES (reads are owner-only), and the `_id` result field. Specifies the *how* (module + exact call + the failure modes the docs omit); which forms/fields to render come from the request.
---
**RECIPE**: How to Code a Wix Forms Frontend (`@wix/forms`, Form Submissions v4)

A concise contract for writing the **frontend code** that renders a seeded form and submits it: building the inputs, collecting the values, and creating a submission. **This recipe is the *how* (which module, which call, which fields), not the *what*** — which forms to render, how the page looks, and the framework are decided by the request you're fulfilling.

> **This recipe is for CODING the frontend, not for seeding it.** It assumes the form schema already exists (created by `setup-forms.md`) — you have each form's `formId` and its field **`target`** keys from the seed's `seeded.forms` map. It says nothing about creating forms — only how to render and submit them from frontend code.

> **⚠️ Reading rule — always append `?apiView=SDK` to every doc link below.** The Wix docs render two views of the same page. The **bare / REST view** shows the wrapped REST body (`{ submission: {…} }`) and an `id` field; the **`?apiView=SDK` view** shows the SDK call (`submissions.createSubmission(submission, options)`) and the normalized **`_id`** field. The SDK is what your frontend calls; reading the REST view leads to the wrong call signature and the `id`-vs-`_id` trap.

---

## The module and the client (read this first)

**⚠️ CRITICAL: the submission write API is the `submissions` named export of `@wix/forms`** — `import { submissions } from "@wix/forms"`, then `submissions.createSubmission(submission, options)`. (The form *schema* lives on a different service and is created by the seed — the frontend never creates or reads schemas; it only submits.)

| Need | Package | Module / export |
|---|---|---|
| Submit a form (create a submission) | `@wix/forms` | `submissions` |

**The frontend only WRITES.** `createSubmission` is the visitor-facing call. **Reading submissions back** (`querySubmissionsByNamespace`, `getSubmission`, `countSubmission`) requires the owner permission `WIX_FORMS.SUBMISSION_READ_ANY` and is **not** available to a visitor — don't try to list/confirm submissions from the frontend. The submit's resolved promise **is** your success signal (show a thank-you); the lead lands in the site owner's dashboard.

**Auth / client — framework split:**
- **Astro (Wix-managed):** authentication is ambient. Call `submissions.createSubmission(...)` directly from a server route (`src/pages/api/*.ts`) or a server action — **no `createClient`, no `OAuthStrategy`, no `clientId`.**
- **Non-Astro (Vite/React/Vue/static):** build one manual visitor client and reuse it:
  ```js
  import { createClient, OAuthStrategy } from '@wix/sdk';
  import { submissions } from '@wix/forms';

  const client = createClient({
    modules: { submissions },
    auth: OAuthStrategy({ clientId: /* the project's PUBLIC OAuth client id */ }),
  });
  // then: client.submissions.createSubmission(submission)
  ```
  The `clientId` is public, not a secret.

**⚠️ CRITICAL: do NOT call `auth.elevate` to submit.** An anonymous visitor **can** create a submission on the plain visitor token (it stamps `submitter.visitorId`). A pure SPA/static frontend has **no server and cannot elevate** anyway. (The Velo docs example wraps `createSubmission` in `auth.elevate` inside a backend `web.js` — that's the Velo hosted pattern, **not** the headless visitor path; ignore it here.)

---

## The features (build the ones the site needs)

A forms frontend is essentially one feature — **render the fields, then submit** — plus the render/validation details around it. Implement it once per form the site shows.

### Rendering the inputs (bind `name` = `target`)

For each field the seed kept in `seeded.forms[].targets`, render an input whose **`name` attribute is the field's `target`** (the immutable snake_case key from the seed — `first_name`, `email`, `message`), with the field's label as the visible `<label>`. The `target` is the contract between seed and frontend: it's the key the submission must use.

```html
<form id="contact">
  <label>First name <input name="first_name" required></label>
  <label>Email <input name="email" type="email" required></label>
  <label>Message <textarea name="message"></textarea></label>
  <button type="submit">Send</button>
</form>
```

There is **no** need to fetch the schema to render — the seed already handed you the `target`s and labels. (The seed also stores a `steps` layout, but that's only so the Wix **dashboard** can display incoming submissions — the frontend ignores it and owns its own visual layout.)

### Submitting (create a submission)

Collect the input values into a **`submissions` object keyed by `target`**, and call `createSubmission`. Doc: <https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/create-submission?apiView=SDK>

```js
import { submissions } from '@wix/forms';   // Astro: call directly. Non-Astro: client.submissions

async function submitContact(formEl) {
  const data = Object.fromEntries(new FormData(formEl)); // { first_name, email, message } — keys already = targets
  const { _id } = await submissions.createSubmission({
    formId: SEEDED_FORM_ID,          // from seeded.forms[].formId
    submissions: data,               // map of target -> value
  });
  return _id;                        // success signal; then render a thank-you
}
```

**⚠️ CRITICAL: `createSubmission` takes POSITIONAL args — `createSubmission(submission, options)`, NOT `createSubmission({ submission })`.** The first argument **is** the submission object (`{ formId, submissions }`) directly; the optional second argument is `options` (e.g. `captchaToken`). Wrapping it as `{ submission: {…} }` is the REST body shape and does not type-check against the SDK.

**⚠️ CRITICAL: the `submissions` map is keyed by each field's `target` — never by the label or the field id.** `{ submissions: { first_name: "Jane", email: "j@x.com" } }` — the keys must be the exact `target`s the seed kept. A key that isn't a seeded target (a label like `"First name"`, a guessed key, a field GUID) is rejected with **`400 "must NOT have additional properties"`** (the whole submission fails, not just that field). This is why STEP is "bind `name` = `target`" — a plain `FormData → Object.fromEntries` then yields the right keys for free.

**⚠️ CRITICAL: a submission of a field the seed did NOT give a validation block also 400s "additional properties" — that's a SEED bug, not a frontend bug.** Wix Forms only accepts submission keys for fields that were seeded **with a `stringOptions.validation` block** (`setup-forms.md` STEP 2). If a submit rejects a target you're sure you're spelling right (`{ additionalProperty: "message" }`), the field was seeded without a validation block — fix the **seed** (add the block), don't mangle the frontend key. Symmetrically, **omitting a `required` field** 400s with a validation error — send every required target.

**⚠️ The result id is `_id`, not `id`.** The SDK normalizes the created submission to `_id` (the REST view shows `id`). Read `result._id` if you need it; for lead capture you usually just need the promise to resolve, then show a thank-you. Do **not** call `confirmSubmission` — it's an owner-only management call and unnecessary for lead capture (the submission is recorded on create).

### Spam protection (only if the site raised it)

The seed leaves `spamFilterProtectionLevel` at its default (`ADVANCED`), and an anonymous visitor submit **still succeeds without a captcha token** on the headless SDK path. So you normally pass **no** `options`. Only if a site is configured to *require* a CAPTCHA do you need to solve one and pass it as the second arg: `createSubmission(submission, { captchaToken })`. Don't add captcha plumbing speculatively — the default path needs none.

---

## Conclusion
A correct Wix Forms frontend:
- imports the **`submissions`** export of **`@wix/forms`** and calls **`submissions.createSubmission(submission, options)`** — **positional args**, the submission object first (never `{ submission }`-wrapped);
- renders each input with **`name` = the seeded `target`** and builds the **`submissions` map keyed by `target`** (not label, not field id) — a wrong/unseeded key 400s the whole submission as "additional properties";
- **only writes** — reading submissions back is owner-only, so the resolved promise is the success signal (show a thank-you); never `confirmSubmission` (owner-only, unneeded);
- submits on the **plain visitor token with NO `auth.elevate`** (anonymous submit works; a pure SPA can't elevate anyway) and, at the default `ADVANCED` protection, **no captcha**;
- reads the created id as **`result._id`**, never `result.id`;
- treats a `400 "additional properties"` on a correctly-spelled target as a **seed** gap (the field lacks a `stringOptions.validation` block — fix `setup-forms.md`), not a frontend bug.
