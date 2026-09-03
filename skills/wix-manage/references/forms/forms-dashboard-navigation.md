---
name: "Forms Dashboard Navigation"
description: "Builds direct links to Wix Forms dashboard pages on manage.wix.com. The paths are not guessable and appear in no API reference, so take them from here: under `https://manage.wix.com/dashboard/{metaSiteId}/`, the forms list is `wix-forms`, a form's builder is `wix-forms/form/{formId}`, and that form's submissions are `wix-forms/form/{formId}/submissions` — there is no site-wide submissions page, and nothing lives under `forms`, `form-builder` or `wix-forms-and-payments` (the legacy app). Also standalone forms, and each Forms entity paired with its read API so you can fetch one and hand back a 'view it in your dashboard' link."
---

# Forms Dashboard Navigation

Build direct links into the Wix Forms pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Forms list | `wix-forms` | All forms on the site |
| Form builder | `wix-forms/form/{formId}` | Edit a specific form (fields, rules, submit settings) |
| Submissions | `wix-forms/form/{formId}/submissions` | That form's submissions table |
| Standalone form | `wix-forms/standalone-form` | Create a standalone form (has its own shareable page, not embedded in a site page) |

**Every Forms page is under `wix-forms`** — the namespace **Wix Forms (New)** `225dd912-7dea-4738-8688-4b8c6955ffc2` registers, the app that owns the Form Schemas v4 API. A `wix-forms-and-payments/...` path belongs to the legacy **Wix Forms (Old)** app `14ce1214-b278-a7e4-1373-00cebd1bef7c`: don't build one, and never install or target that app (see [Create Form](./create-form.md) § Silent breakers).

**Submissions are per form**, hanging off that form's builder path — there is no site-wide submissions page to link to. With no `{formId}` in hand, link the forms list and let the owner pick.

Entity-specific links (`{formId}`) take the entity's ID as a path segment, and query params can follow. The dashboard appends its own view state to the submissions URL — `folder` (a JSON-encoded breadcrumb), `sort` (e.g. `createdDate+desc`) and `selectedColumns` (a comma-separated list of field **`target`**s) — none of which you need to construct: the bare path opens the table with the owner's defaults.

## Pairing Entities with Their Read APIs

Fetch the entity via REST, then link the matching dashboard page. All calls use `https://www.wixapis.com` with an `Authorization` header. Dashboard forms live in the **`wix.form_app.form`** namespace — every Forms call that takes a namespace, as a query parameter or inside a filter, takes that exact value.

| Entity | Read API | Dashboard link |
|---|---|---|
| Form | `GET /form-schema-service/v4/forms` · `POST /form-schema-service/v4/forms/query` · `GET /form-schema-service/v4/forms/{formId}` | `wix-forms/form/{formId}` (edit) or `wix-forms` (list) |
| Submission | `POST /form-submission-service/v4/submissions/namespace/query` (the filter must carry `"namespace": "wix.form_app.form"`) · `GET /form-submission-service/v4/submissions/{submissionId}` | `wix-forms/form/{formId}/submissions` — the `formId` comes off the submission |

Example — after creating a form, hand back its links:

```
Created "Contact Form".
Edit it here: https://manage.wix.com/dashboard/{metaSiteId}/wix-forms/form/{formId}
See submissions: https://manage.wix.com/dashboard/{metaSiteId}/wix-forms/form/{formId}/submissions
```

## Notes

- Creating forms via the [Create Form](./create-form.md) recipe (Form Schemas API) makes them appear in the forms list above — **but only when the form was created under the `wix.form_app.form` namespace with Wix Forms (New) installed.** A form created under any other namespace is reachable over the API and completely absent from these pages.
- **Before handing back a `wix-forms/form/{formId}` link, confirm the form actually renders**: `GET https://www.wixapis.com/form-schema-service/v4/forms/{formId}/summary` must return a non-empty `formSummary.fields` whose count matches every input field. An empty summary means the owner will open this link to a blank form (Create Form, STEP 3).
