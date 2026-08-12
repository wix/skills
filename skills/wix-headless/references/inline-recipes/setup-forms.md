---
name: "Setup Forms"
description: Initializes a Wix Forms backend with Form Schemas v4 for any visitor-fillable form — contact, survey, application, waitlist or custom data capture — by cleaning the install's sample forms, creating one form schema per requested form, then verifying each renders via the form summary; revises an existing form with `PATCH` + its `revision`. Specifies the *how* (calls + format); which forms and what they collect come from the request.
---
**RECIPE**: Business Recipe – Initial Setup for Wix Forms (Form Schemas v4)

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for
> `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need
> `Content-Type: application/json`. Send `wix-site-id: <SITE_ID>` on every call.

A concise checklist for preparing any new Wix site that uses the **Wix Forms** app. Wix Forms backs
**any form a visitor fills in** — a contact or enquiry form, a signup or waitlist, an application, a
feedback form or survey, a quote request, an intake or registration questionnaire, or any custom data
capture. Lead capture is the most common case, not the only one: the schema is a generic
field-definition store, and whether a submission becomes a CRM contact is just the optional per-field
`contactMapping` (STEP 2). This recipe is for **initial backend setup ONLY**, not for coding the
frontend.

> **Two boundaries.** Forms does **not** own **RSVP to an event or occasion** (that is the `events`
> vertical, which ships its own registration form) or the **per-service booking form** (`bookings`).
> Route there when an event or a bookable service is involved; use `forms` for everything else.

> **This recipe is the *how*, not the *what*.** How many forms, and what each one collects, come
> from the request you're fulfilling. This recipe only specifies the calls and the request format;
> it does not decide which forms to create.

> **API surfaces:** Wix Forms is a **standalone CRM API**. A form **schema** (the field definitions)
> lives on **Form Schemas v4** at `https://www.wixapis.com/form-schema-service/v4/forms` — docs
> portal **CRM ▸ Forms ▸ Form Schemas**, *not* Business Solutions. This is **NOT** the
> events/bookings per-event registration form (a different thing). The Forms app's `appDefId` is
> `225dd912-7dea-4738-8688-4b8c6955ffc2`; an `UNSUPPORTED_FORM_NAMESPACE` error means the app isn't
> installed. Call the **public** host shown above (no `/_api/` prefix).
>
> **API reference:**
> - Create Form: <https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/create-form> — its
>   examples are complete requests for common form types (contact, survey, order, booking, …). Copy
>   the one closest to what you need.
> - About Form Fields:
>   <https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields>
> - Form object: <https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/form-object>

---

## Article: Steps for Setting Up Wix Forms

**⚠️ CRITICAL ORDER REQUIREMENT: clean the install's default sample form FIRST (STEP 1), before
creating any form.** Listing-then-deleting before you create guarantees every id you delete is a
pre-existing form, never one you just created — and it keeps you clear of the site's low form cap.
**But only delete forms that are obviously the install's own default sample form:** the site may
already hold the owner's **real forms** (a connect/iterate run, or an owner-populated site). If
what's there isn't obviously install sample data, or you're unsure, **do not delete it — ask the
user first** (`SEED.md`: seeding is additive; deleting real content needs the owner's approval).

### STEP 1: Clean — remove any pre-existing (install-default) forms

A freshly installed Wix Forms app **may ship a default "Get in touch" form** (a contact form with
`first_name` / `email` / `message` fields). Its presence is **not deterministic** — some fresh
installs ship it and others don't, so it appears provisioning/timing-dependent. Rather than assume,
**list what's actually there and delete whatever comes back** — this is a safe no-op when the list
is empty.

1. **List the existing forms** —
   `GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&fieldsets=METADATA`.
   Collect every `form.id` from the response (`forms[].id`).
   **⚠️ Then list a second time with `&enabled=false` and clean both results** — a disabled form is
   invisible in the default listing while still counting toward the form cap.
2. **Delete each** — `DELETE https://www.wixapis.com/form-schema-service/v4/forms/{formId}` (one
   call per id; returns `200 {}`). Because the list ran **before** any create, every id returned is
   a pre-existing form — safe to delete. If the list was empty, issue no DELETE (a correct no-op).

**⚠️ Why clean even though it's often a no-op — two reasons.** **(1) The form cap.** Leftovers plus
your new forms can exhaust the site's form allowance (read it from
[List Forms Providers Configs](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/list-forms-providers-configs)),
which is also why you must **never create throwaway forms to probe the shape.** **(2) Name
collision.** A taken name is silently auto-suffixed rather than rejected, so your form quietly
diverges from the name the handoff reports.

### STEP 2: Create each form schema

**One POST per form** to `https://www.wixapis.com/form-schema-service/v4/forms`. How many forms, and
each form's fields and labels, come from the request you're fulfilling; this step gives the call and
the required format. Forms are independent (no shared revision), so concurrent creates are safe.

**⚠️ Generate every field `id` in the shell as a LOWERCASE GUID — never type one from memory.** One
per INPUT field, plus one for the submit button and one for the layout step:

```bash
lc() { uuidgen 2>/dev/null | tr 'A-Z' 'a-z' || python3 -c 'import uuid;print(uuid.uuid4())' || node -e 'console.log(crypto.randomUUID())'; }
F1=$(lc); F2=$(lc); F3=$(lc); F4=$(lc)   # one per INPUT field
SUBMIT=$(lc)                             # the submit-button (DISPLAY) field
STEP=$(lc)                               # the layout step (page)
```

**Assemble the request** from the closest Create Form example, building each `formFields[]` entry —
including the `SUBMIT_BUTTON` — per
**[About Form Fields](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/about-form-fields)**,
which owns every field-level rule. **Place every field in the layout**: one
`steps[].layout.large.items[]` entry per `formFields[].id`, INPUTs and the `SUBMIT_BUTTON` alike.
**Geometry (`row`/`column`/`width`) does not matter on headless** — the frontend renders its own
layout from `formFields[]` and never reads `steps[].layout` (`how-to-code-forms.md`) — so the layout
is a *correctness* requirement, not a design one: assert presence and coverage only. Use a single
step unless the request needs multiple pages.

**⚠️ A `200` proves nothing: always run STEP 3.** Most mistakes here are accepted at create and only
surface in the dashboard or on the first real submission.

#### Plan gates — surface the choice, never engineer around it

Three plan-tier limits return a real `400` on create. **Do not work around any of them; tell the user
to reduce or upgrade.**

- **`FIELDS_COUNT_RESTRICTIONS_ERROR`** — the form exceeds the plan's per-form field cap. **Do NOT
  split the form into multiple schemas** to dodge it. Reduce the field count, or upgrade.
- **`FILE_UPLOAD_RESTRICTIONS_ERROR`** — a file upload, signature, or payment field on a plan below
  Core. **Do NOT suggest inlining files as base64** — it stores no real file, gives the owner nothing
  usable, and blows past submission size limits. Drop the field, or upgrade.
- **`FORMS_COUNT_RESTRICTIONS_ERROR`** — the site hit its plan's total-form cap. Upgrade, or free a
  slot (STEP 1's list-then-delete — but only delete forms that are clearly install sample data; ask
  before deleting anything that could be the owner's real form).

**⚠️ A plan gate is a HARD BLOCK on the run — not a soft "record it and continue" precondition like
paid tickets or online reservations.** Those leave a working schema and fail only at runtime; here the
schema doesn't exist, so its `formId`/field `target`s don't either. **Put the choice to the user
(reduce, or upgrade — with the MSID + dashboard link), wait for their confirmation, then create and
verify the schema (STEP 2 → STEP 3) BEFORE any frontend work.** Do **not** build the frontend "in the
meantime": its inputs bind to those targets, so every binding would be a guess to rewrite.

Read `form.id` from the response as the `formId` to keep.

If a create fails transiently on a fresh site (`5xx`, or an identity/propagation error right after
install — the install returns `appInstance.status: "UNKNOWN"` until it propagates), retry the same
call **once**; do not loop.

### STEP 3: Verify each form persisted (mandatory)

A `200` on create is not proof the form is queryable or that the dashboard will render it.

1. **List once** —
   `GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&formIds=<id1>&formIds=<id2>`
   — **`formIds` narrows the list to exactly the forms you just created**, so you assert against them
   directly instead of filtering a whole-namespace listing. For each form, confirm its `id` appears,
   its **`formFields[]`** covers every field you sent, and its **`steps` is non-empty and places
   every field** — a `steps: []`, or any `formFields[].id` missing from
   `steps[].layout.large.items[].fieldId`, is malformed. For a form with a dropdown, also assert its
   **`dropdownOptions.options`** is non-empty and that every option `value` is listed in
   **`stringOptions.validation.enum`**.
2. **⚠️ Then verify the dashboard will actually render —
   `GET https://www.wixapis.com/form-schema-service/v4/forms/{formId}/summary` and assert
   `formSummary.fields` is NON-EMPTY**, with a count equal to **every input field you sent** (i.e.
   `formFields[]` minus the `SUBMIT_BUTTON`). A 6-input form returns all 6 — **including non-contact
   `DROPDOWN` and `TEXT_AREA` fields** — so do *not* expect only the contact-mapped ones. This is
   the reliable dashboard-truth check: the summary returns exactly the fields the Wix dashboard
   shows. A `summary.fields: []`, or a count short of your inputs, means the form renders blank (or
   partly blank) for the owner even though the public site submits fine — **do not report success;
   fix the `identifier`s and re-create.**

3. **⚠️ If the form has a multi-choice ARRAY field (`CHECKBOX_GROUP` / `TAGS`), the two checks above
   are NOT enough — send one real `createSubmission`.** A malformed `arrayOptions.validation.items`
   (missing `itemType`, or an empty/omitted `items`) still lists fine and still counts in the
   summary, so steps 1–2 pass while **every** submission to the form `400`s form-wide (see "Choice
   fields"). The only proof is a live submission:
   `POST https://www.wixapis.com/v4/submissions` with the standard call shape (`<AUTH>`,
   `Content-Type`, `wix-site-id`) and a minimal valid body — `formId` plus a `submissions` map keyed
   by each field's `target`, the ARRAY field as an **array** of enum values:

   ```jsonc
   { "submission": { "formId": "<formId>",
       "submissions": { "email": "test@example.com", "multi_choice": ["Option 1"] } } }
   ```

   Assert it returns `200`, not `400 SUBMISSION_VALIDATION`. A `400` here means the ARRAY `items`
   shape is wrong — fix it (both `itemType` and `stringOptions.enum`) and re-create. Delete the test
   submission afterward (`DELETE https://www.wixapis.com/v4/submissions/{submissionId}`, the `_id`
   from the response) so the owner's dashboard stays clean.

If a form is missing, its layout didn't persist, or its summary is unexpectedly empty, re-create it
once and re-verify; if it still fails, surface the response verbatim rather than reporting success.

### STEP 4 (when revising): update an existing form

To change a form the request has since revised — add a field, relabel one, tighten a rule:

```
PATCH https://www.wixapis.com/form-schema-service/v4/forms/{formId}
```

The safe sequence is **GET → mutate → PATCH**: read the form (STEP 3's list, or
`GET .../forms/{formId}`), apply the change to the returned object, and send it back under `form`
with its current `revision`.

```jsonc
{ "form": { "id": "<formId>", "revision": "1", "formFields": [ /* … */ ], "steps": [ /* … */ ] } }
```

**Reuse the existing ids** for every field, step and dropdown option you are keeping; generate fresh
lowercase GUIDs only for fields you are adding (plus their layout entries).

**Prefer updating over delete-and-recreate.** An update keeps the `formId` the handoff already
carries and consumes no additional slot against the site's form cap. **Re-run STEP 3 after any update**
— it can regress the layout or the dashboard summary exactly as a create can.

---

## Keep — what crosses into the handoff

**Per form: the `formId` + each form's field `target` keys.**

The `target`s are *structural* — the frontend binds each input's `name` to a field's `target` to
submit, and they are **immutable**, so they don't go stale when an owner relabels a field (the same
carve-out shape as cms's `collectionId` + field keys). Everything else — the field set, order,
labels, `required` flags, validation formats and dropdown options — is **read live from the schema
at render time** (visitor token, no `auth.elevate` — `how-to-code-forms.md`), so a field the owner
adds, removes or relabels reflects on the site with no code change. See `SDK_HANDOFF.md` §4.

---

## Conclusion

Following these steps **in order** sets up a Wix Forms backend:

- Starts from a **clean form list** — pre-existing forms are listed-then-deleted first (a safe no-op
  when none exist), across **both** the default listing and `&enabled=false`, keeping clear of the
  site's form cap and the silent name-collision auto-suffix.
- Contains exactly the forms the request calls for, created on **Form Schemas v4** in the
  **`wix.form_app.form`** namespace, each field built per **About Form Fields**, with lowercase GUID
  ids and a `steps` layout placing every field plus a `SUBMIT_BUTTON`.
- Is **verified via `GET .../forms/{formId}/summary`** (non-empty, count equal to every input field
  — contact-mapped or not) — not merely by a `200` on create, and not merely by `steps` being
  present.
- Revises forms with **`PATCH` + the current `revision`** rather than delete-and-recreate, keeping
  the `formId` and the form slot.
- **Keeps** per form the **`formId` + field `target`s** (the immutable submission keys) — the
  frontend reads everything else (labels, options, order) live from the schema.
