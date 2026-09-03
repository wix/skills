---
name: "Forms Recipes"
description: "Site forms — build forms and their fields through the Form Schemas API, wire up post-submission behaviour, and link to the forms and submissions dashboard pages. Use for anything users call forms, contact forms, surveys, sign-up forms, submissions, or fields."
---

# Forms Recipes

Use **Create Form** to define a form and its fields, layout, and what happens after a visitor submits. Use **Forms Dashboard Navigation** when the user wants the forms list, the submissions table for a form, the form builder, templates, or forms settings — including pairing a submission fetched through the API with a link to where it can be reviewed.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Recipes

### [Create Form](https://dev.wix.com/docs/api-reference/crm/forms/skills/create-form)
**Technical:** Creates a form with fields (name, email, etc.) using the Form Schemas
API. Covers field configuration, layout, and post-submission triggers.

### [Forms Dashboard Navigation](https://dev.wix.com/docs/api-reference/crm/forms/skills/forms-dashboard-navigation)
**Technical:** Builds direct links to Wix Forms dashboard pages on manage.wix.com — the
forms list, the submissions table, the form builder for a specific form, standalone
forms, templates, and forms settings. Pairs each main Forms entity (form, submission)
with its read API so you can fetch an entity and hand back a 'view it in your dashboard'
link. Use when the user asks where something is in the Wix dashboard, wants a direct
link to a dashboard page, or you need a dashboard URL to include with the result of an
API operation.
