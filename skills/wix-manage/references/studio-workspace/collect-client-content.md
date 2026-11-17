---
name: "Collect Client Content with the Content Collector"
description: Collects a client's project content with Studio workspace Content Collector intake forms (the client content form or questionnaire) — creates an intake form for a client project, shares it with the client, finds a client's forms, checks whether the client has submitted, and reads the client's answers, uploaded files and notes. Use when an agency or partner signs a new client or starts a client project and needs a content form to get the client's content, asks whether a client has filled in their form, or wants to see what a client answered. Not for Wix Forms on a site.
---
# Collect Client Content with the Content Collector

## Description
An intake form is a questionnaire a partner or agency (the user) sends to their client to collect the content for a project: business details, services, contact information, files. The user creates it, shares it with the client's email, and reads the answers.

## API Endpoints
Every call here is account-level: make it with account scope. Intake forms belong to the user's Studio workspace, not to a site, so no site ID is needed or accepted. A form ID from another account reads as not found.

| Call | Purpose |
|---|---|
| `POST https://www.wixapis.com/partners/content-collector/v1/intake-forms` | create a form |
| `PATCH https://www.wixapis.com/partners/content-collector/v1/intake-forms/{intakeFormId}` | share a form (add client emails) |
| `POST https://www.wixapis.com/partners/content-collector/v1/intake-forms/search` | find forms by client or project name |
| `GET https://www.wixapis.com/partners/content-collector/v1/intake-forms/{intakeFormId}` | get one form, including its submission state |
| `GET https://www.wixapis.com/partners/content-collector/v1/intake-forms/{intakeFormId}/submission` | read the client's answers, files and notes |
| `DELETE https://www.wixapis.com/partners/content-collector/v1/intake-forms/{intakeFormId}` | delete a form (only when asked) |

Docs: [Intake Forms](https://dev.wix.com/docs/api-reference/account-level/studio-workspace/content-collector/intake-form-v1/introduction)

Links to give the user, built from the form ID:
- **Partner view** (view and manage the form): `https://manage.wix.com/content-collector/partner/{intakeFormId}`
- **Client link** (where the client fills it in): `https://www.yoursitebrief.com/content-collector/{intakeFormId}`

## Rules

- **Don't create a form until the user gives the client's name and the project.** If either is missing, ask. Never use placeholders. Search first (Step 1): if the client has a form, offer it.
- **Only `clientFormInteraction.submissionDate` means the client submitted.** `lastEditDate` changes whenever the client saves, including before they submit, and the submission read returns saved answers either way.
- **The client must sign in with an email listed in `clientEmails`.** Wix doesn't email the client a link: give the user the client link to send, and say the client has to sign in with that address.
- **Never set `context`.** It holds the questionnaire material Content Collector generates. Put the user's description of the project in `sourceMaterials.projectMaterials`.
- **The questionnaire is generated the first time the form is opened,** by Content Collector, not by the API.

## Steps

### 1. Find a client's forms

Before creating a form, and whenever the user names a client, search for it:

```
POST https://www.wixapis.com/partners/content-collector/v1/intake-forms/search
```
```json
{ "search": { "search": { "expression": "acme florist" }, "cursorPaging": { "limit": 50 } } }
```

The expression matches the client name and the project name. The response has `intakeForms[]`, each with `id`, `revision`, `createdDate`, `clientName`, `project.name`, `clientEmails`, `publishDate` and `clientFormInteraction`. If several forms match, list them (client, project, created date) and ask which one the user means.

To list forms by state instead of by name, use a filter (no expression) — for example, shared forms the client hasn't submitted:

```json
{ "search": { "filter": { "$and": [ { "publishDate": { "$exists": true } }, { "clientFormInteraction.submissionDate": { "$exists": false } } ] }, "cursorPaging": { "limit": 50 } } }
```

Search filters accept `id`, `accountId`, `userId`, `createdDate`, `publishDate`, `clientFormInteraction.submissionDate`, `project.name`, `project.industry` and `teamMemberIds`; it can also sort by `clientFormInteraction.submissionDate`. Page with `cursorPaging.cursor` from `pagingMetadata.cursors.next`.

### 2. Check whether the client submitted

Read `clientFormInteraction` on the form from Step 1, or get it fresh:

```
GET https://www.wixapis.com/partners/content-collector/v1/intake-forms/{intakeFormId}
```

| Form state | Meaning |
|---|---|
| no `publishDate` | not shared with a client yet |
| `publishDate`, no `clientFormInteraction.submissionDate` | shared, not submitted (`lastEditDate` means the client started) |
| `clientFormInteraction.submissionDate` | submitted on that date |

Submission state is updated shortly after the client acts, not instantly. If the user says the client has just submitted but there's no `submissionDate`, say so and suggest checking again in a minute.

### 3. Read the client's answers

```
GET https://www.wixapis.com/partners/content-collector/v1/intake-forms/{intakeFormId}/submission
```

Response (shortened):

```json
{
  "submission": {
    "questions": [
      { "target": "businessName", "label": "Business name", "answer": ["Acme Florist"], "assets": [], "nestedQuestions": [] },
      { "target": "logo", "label": "Upload your logo", "answer": [], "assets": [ { "displayName": "logo.png", "url": "https://static.wixstatic.com/media/<file>.png" } ], "nestedQuestions": [] },
      { "target": "services", "label": "Services", "answer": [], "assets": [], "nestedQuestions": [
        { "target": "services", "label": "Services #1", "answer": [], "assets": [], "nestedQuestions": [
          { "target": "name", "label": "Service name", "answer": ["Wedding bouquets"], "assets": [], "nestedQuestions": [] }
        ] }
      ] }
    ],
    "notes": [ { "content": "Photos coming next week", "files": [] } ]
  }
}
```

- `answer` is always an array of text, even for one value. Choice fields return one entry per selected option label.
- Composite and repeater fields (services, FAQs, team members, contact details) have an empty `answer` and nest their questions in `nestedQuestions`, one group per item (`Services #1`, `Services #2`). Walk the tree to report them.
- Some `target` keys are generated (`ai_6fb8…`); identify questions by `label`.
- File uploads have their files in `assets`; each `url` is a permanent download link.
- `notes` are the client's free-form notes, each with its own `files`.

If the form isn't submitted (Step 2), say so before showing any saved answers, and call them a draft.

### 4. Create a form

Only with the client's name and the project from the user (see Rules):

```
POST https://www.wixapis.com/partners/content-collector/v1/intake-forms
```
```json
{
  "intakeForm": {
    "clientName": "Acme Florist",
    "project": { "name": "Acme Florist website", "industry": "OTHER" },
    "sourceMaterials": { "projectMaterials": "Flower shop. Needs a catalog, delivery areas and online orders." },
    "language": "en"
  }
}
```

- `clientName` is at most 42 characters.
- `project.industry` is optional, for example `FOOD_AND_BEVERAGE`, `CREATIVE`, `LEGAL_AND_FINANCE`, `FITNESS`, `REAL_ESTATE` or `OTHER`; see [Create Intake Form](https://dev.wix.com/docs/api-reference/account-level/studio-workspace/content-collector/intake-form-v1/create-intake-form) for the full list. Omit it unless one clearly fits.
- `sourceMaterials.projectMaterials` is what the user told you about the project; the questionnaire is tailored from it.
- `language` can be set only at creation (default English).

The response is `{ "intakeForm": { "id": "<form id>", "revision": "1", ... } }`. Give the user the partner view link and tell them the questionnaire is generated when the form is first opened, so they can review it there before sharing.

### 5. Share the form with the client

Sharing sends nothing by itself; it lets the listed emails open the form. Share when the user asks you to share or send the form to an email; if they only mention the client's email, ask before sharing:

```
PATCH https://www.wixapis.com/partners/content-collector/v1/intake-forms/{intakeFormId}
```
```json
{ "intakeForm": { "id": "<form id>", "revision": "<current revision>", "clientEmails": ["client@example.com"] } }
```

`clientEmails` replaces the whole list (up to 20): include the emails already on the form, read just before, and confirm before dropping any, since a dropped email loses access. `revision` is the form's current revision from the latest Get, Search or Create response. `publishDate` is set shortly after the first email is added; don't expect it in this response. Then give the user the client link to send, with the sign-in note from Rules.


Other changes use the same PATCH: remove all emails to unshare, which clears `publishDate` and locks the client out, so confirm first. Delete a form only when asked, and confirm first: it permanently deletes the form and its questionnaire ([Delete Intake Form](https://dev.wix.com/docs/api-reference/account-level/studio-workspace/content-collector/intake-form-v1/delete-intake-form)).

## Reporting back

Name the client and project, the form's state (not shared, shared and waiting, submitted on a date), and the links the user needs. When reporting answers, use the question labels and group repeater items under their field. Don't show IDs, revisions or field names unless the user asks. If a call fails, say which action failed; don't guess a cause.
