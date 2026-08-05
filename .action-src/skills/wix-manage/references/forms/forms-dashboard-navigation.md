---
name: "Forms Dashboard Navigation"
description: "Builds direct links to Wix Forms dashboard pages on manage.wix.com — the forms list, the submissions table, the form builder for a specific form, standalone forms, templates, and forms settings. Pairs each main Forms entity (form, submission) with its read API so you can fetch an entity and hand back a 'view it in your dashboard' link. Use when the user asks where something is in the Wix dashboard, wants a direct link to a dashboard page, or you need a dashboard URL to include with the result of an API operation."
---

# Forms Dashboard Navigation

Build direct links into the Wix Forms pages of a site's dashboard. For the general URL contract (metaSiteId, fallbacks, redirects), see [Dashboard Navigation](../dashboard-navigation/dashboard-navigation.md).

## Main Pages

| Page | URL after `/dashboard/{metaSiteId}/` | What it manages |
|---|---|---|
| Forms list | `wix-forms` | All forms on the site |
| Form builder | `wix-forms/form/{formId}` | Edit a specific form (fields, rules, submit settings) |
| Standalone form | `wix-forms/standalone-form` | Create a standalone form (has its own shareable page, not embedded in a site page) |
| Submissions | `wix-forms-and-payments/submissions` | Submissions table across forms |
| Templates | `wix-forms-and-payments/templates` | Create a form from a template |
| Forms settings | `wix-forms-and-payments/settings` | Forms-level settings |

Two URL namespaces appear here because the forms management pages and the form builder are registered by two apps (`14ce1214-b278-a7e4-1373-00cebd1bef7c` and `225dd912-7dea-4738-8688-4b8c6955ffc2`); `wix-forms` also redirects to the forms list, so it's the stable entry point.

Entity-specific links (`{formId}`) accept the entity's ID appended as an extra path segment. Query params can follow.

## Pairing Entities with Their Read APIs

Fetch the entity via REST, then link the matching dashboard page. All calls use `https://www.wixapis.com` with an `Authorization` header. Dashboard forms use the `wix.form_app.form` namespace.

| Entity | Read API | Dashboard link |
|---|---|---|
| Form | `GET /form-schema-service/v4/forms` · `POST /form-schema-service/v4/forms/query` · `GET /form-schema-service/v4/forms/{formId}` | `wix-forms/form/{formId}` (edit) or `wix-forms` (list) |
| Submission | `POST /form-submission/v4/submissions/namespace/query` (filter must include the `namespace`) · `GET /form-submission/v4/submissions/{submissionId}` | `wix-forms-and-payments/submissions` |

Example — after creating a form, hand back its links:

```
Created "Contact Form".
Edit it here: https://manage.wix.com/dashboard/{metaSiteId}/wix-forms/form/{formId}
See submissions: https://manage.wix.com/dashboard/{metaSiteId}/wix-forms-and-payments/submissions
```

## Notes

- Creating forms via the [Create Form](./create-form.md) recipe (Form Schemas API) makes them appear in the forms list above.
