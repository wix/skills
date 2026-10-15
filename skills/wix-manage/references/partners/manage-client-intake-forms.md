---
name: "Manage Client Intake Forms"
description: Creates and manages Content Collector client intake forms for Wix Studio partners — AI-tailored questionnaires a partner sends to a client to gather project details before work starts. Covers creating a form from a project description, sharing it with a client, finding a client's forms, checking whether a client submitted, exporting submitted forms, team notifications, and deleting forms. Account-level, not tied to any site.
---
# Manage Client Intake Forms

Content Collector is the Studio workspace feature partners (agencies and freelancers) use to collect project details from their clients. An **intake form** wraps an AI-generated questionnaire with the client's name, project details, the source materials the questions are generated from, the clients it's shared with, and the client's submission state.

- **Auth**: account-level (a Wix user token, or an account-level API key). Scope `SCOPE.PARTNERS.CONTENT-COLLECTOR`.
- **No site context.** Send no `wix-site-id` header and no site ID. Every call is scoped to the caller's account. A form ID from another account returns not found, not a permission error.
- **Base URL**: `https://www.wixapis.com/partners/content-collector/v1`
- **Reference**: [Intake Forms API](https://dev.wix.com/docs/api-reference/account-level/studio-workspace/content-collector/intake-form-v1/introduction)

If any call returns 403 or another permission or entitlement error, the account doesn't have Content Collector. Tell the user it isn't available on their account and stop: don't retry, and don't fall back to Wix Forms or another forms API — a site form is not a Content Collector intake form.

## Endpoints

| Operation | Method | URL |
| --- | --- | --- |
| Create | POST | `https://www.wixapis.com/partners/content-collector/v1/intake-forms` |
| Get | GET | `https://www.wixapis.com/partners/content-collector/v1/intake-forms/{intakeFormId}` |
| Update | PATCH | `https://www.wixapis.com/partners/content-collector/v1/intake-forms/{intakeForm.id}` |
| Delete | DELETE | `https://www.wixapis.com/partners/content-collector/v1/intake-forms/{intakeFormId}` |
| Query | POST | `https://www.wixapis.com/partners/content-collector/v1/intake-forms/query` |
| Search | POST | `https://www.wixapis.com/partners/content-collector/v1/intake-forms/search` |
| Bulk create / update / delete | POST | `https://www.wixapis.com/partners/content-collector/v1/bulk/intake-forms/{create\|update\|delete}` |

## Fields that matter

- `clientName` — max 42 characters.
- `project.name` (max 255) and `project.industry` — infer the industry from the project description yourself; don't ask the user to pick. Values: `BEAUTY_AND_WELLNESS`, `CREATIVE`, `EDUCATION`, `FIELD_AND_CONSTRUCTION`, `FITNESS`, `HEALTH`, `FOOD_AND_BEVERAGE`, `NON_PROFIT_AND_COMMUNITIES`, `REAL_ESTATE`, `SCIENCE_AND_TECHNOLOGY`, `TRAVEL_AND_TOURISM`, `CONSULTING_AND_MARKETING`, `LEGAL_AND_FINANCE`, `FASHION_AND_APPAREL`, `ENTERTAINMENT`, `RESTAURANT`, `TECHNOLOGY`, `WELLNESS`, `CONSULTING`, `HEALTHCARE`, `OTHER`. Use `OTHER` only when the description gives no signal.
- `sourceMaterials` — inputs the questionnaire is generated from: `projectMaterials` (free-text project description), `filesMarkdown` (markdown of uploaded files), `existingQuestionnaire`.
- `language` — 2-letter ISO 639-1 code. Set on create; immutable afterwards. Missing on older forms means `en`.
- `clientEmails` (max 20) — sharing. Adding the first email shares the form and stamps `publishDate`. **It does not email the client.**
- `teamMemberIds` (max 50 GUIDs) — team members notified when the client submits or adds a note.
- `context` — AI-generated background used to tailor the questions. Empty until the questionnaire has been generated.
- `clientFormInteraction.submissionDate` / `lastEditDate` — read-only, filled asynchronously. **The form is submitted only when `submissionDate` is set.**
- `context`, `sourceMaterials`, and `introData` are omitted from responses unless requested in `fields` (`CONTEXT`, `SOURCE_MATERIALS`, `INTRO_DATA`; max 5).

## Create a form and share it with a client

1. Collect the client's name, the project name, and at least a short project description. Don't create a form without a description — it's what the questions are generated from.
2. Create the form. Don't include `clientEmails` yet.

   ```bash
   curl -X POST 'https://www.wixapis.com/partners/content-collector/v1/intake-forms' \
     -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
     --data-binary '{
       "intakeForm": {
         "clientName": "Jane Cohen",
         "language": "en",
         "project": { "name": "Bloom Bakery Website", "industry": "FOOD_AND_BEVERAGE" },
         "sourceMaterials": { "projectMaterials": "Neighborhood bakery wants a site with menu, online orders and a catering inquiry form." }
       }
     }'
   ```

   Read `intakeForm.id` and `intakeForm.revision` from the response.

3. Give the user their review link: `https://www.wix.com/content-collector/partner/{intakeFormId}`. Call it "your review link" — it's for the user, not the client. Explain that opening it shows the AI-generated questions, which they can edit, add to, or remove before anything reaches the client. The questions are generated the first time the form is opened in Content Collector, not by any API call. To check whether that has happened, call Get with `?fields=CONTEXT`: a non-empty `context` means the questionnaire exists.
4. Once the user confirms the form is ready, ask for the client's email and confirm it with them, then share:

   ```bash
   curl -X PATCH 'https://www.wixapis.com/partners/content-collector/v1/intake-forms/<FORM_ID>' \
     -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
     --data-binary '{
       "intakeForm": { "id": "<FORM_ID>", "revision": "<CURRENT_REVISION>", "clientEmails": ["jane@bloombakery.com"] }
     }'
   ```

   Update is a partial PATCH: send `id`, the current `revision`, and only the fields you change. A stale revision is rejected — re-fetch with Get and retry.
5. Tell the user the client now has access, and that **they send the link to the client themselves** — the API never contacts the client. The client must sign in to Wix with the shared email to open the form.

## Find a client's forms and check submission

- **By client or project name** — Search (free text matched against client name and project name):

  ```bash
  curl -X POST 'https://www.wixapis.com/partners/content-collector/v1/intake-forms/search' \
    -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
    --data-binary '{ "search": { "search": { "expression": "bloom bakery" }, "cursorPaging": { "limit": 50 } } }'
  ```

- **Structured filtering** — Query, e.g. by `createdDate`, `project.name`, `project.industry`, `teamMemberIds`, `clientFormInteraction.submissionDate`:

  ```bash
  curl -X POST 'https://www.wixapis.com/partners/content-collector/v1/intake-forms/query' \
    -H 'Authorization: <AUTH>' -H 'Content-Type: application/json' \
    --data-binary '{
      "query": {
        "filter": { "clientFormInteraction.submissionDate": { "$exists": true } },
        "sort": [{ "fieldName": "clientFormInteraction.submissionDate", "order": "ASC" }],
        "cursorPaging": { "limit": 100 }
      }
    }'
  ```

  Max `limit` is 100. Follow `pagingMetadata.cursors.next` while `hasNext` is true.

Report a form as submitted only when `clientFormInteraction.submissionDate` is set. If it isn't, report "shared, not submitted yet" when `publishDate` is set, and "not shared yet" otherwise.

**Export submitted forms**: run the Query above for the first export, save the latest `submissionDate` processed, and on later runs filter `"clientFormInteraction.submissionDate": { "$gt": "<LAST_PROCESSED>" }`.

## Update source materials, notifications, or details

Use the same Update call with the fields to change — for example `sourceMaterials.projectMaterials`, `teamMemberIds`, `clientName`, or `project`. `language` can't be changed. Removing all `clientEmails` unshares the form and clears `publishDate`; confirm with the user before doing that.

## Delete

Delete is permanent and also destroys the questionnaire behind the form. Name the form (client and project) and get explicit confirmation first.

```bash
curl -X DELETE 'https://www.wixapis.com/partners/content-collector/v1/intake-forms/<FORM_ID>' \
  -H 'Authorization: <AUTH>'
```

## Confirm before changing data

Ask the user before: adding or removing client emails, deleting a form, and any bulk update or delete. Creating a form the user asked for doesn't need a separate confirmation.
