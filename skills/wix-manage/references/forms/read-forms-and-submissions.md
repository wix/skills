---
name: "Read Forms and Submissions"
description: "Reads a site's Wix forms and the submissions visitors sent to them — what forms do I have, find a form by name, show the latest submissions, who filled in my contact form, how many submissions did I get last week, submissions from one contact, unread submissions. Covers finding the form's namespace instead of guessing it, where that namespace goes on each read, the Form Schemas and Form Submissions endpoints (and the look-alike URLs that 404), forms hidden from a default listing, the closed list of submission fields you can filter and sort by, date ranges, cursor paging, totals per form, and reading answers by field. Read-only; changing a form is Update Form, building one is Create Form."
---
# RECIPE: Read Wix Forms and Their Submissions

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`. Send `wix-site-id: <SITE_ID>` when the token is account-scoped.

> These calls need the Wix Forms app on the site (`appDefId` `225dd912-7dea-4738-8688-4b8c6955ffc2`); a `428`, a `400` naming the app, or an empty result on a site that should have content means it is not there. [List Installed Apps](../app-installation/list-installed-apps.md) shows what the site has; [Install Wix Apps](../app-installation/install-wix-apps.md) adds it by that id.

List a site's forms, find one, and read the submissions sent to it. The usual order is **find the form first, then query its submissions by `formId`**. Every call here is a read — nothing on the site changes, so no confirmation is needed.

---

## STEP 1 · Know the namespace — never guess it

Every form and every submission belongs to one **namespace**: the app that owns the form. Every read except Get Form and Get Submission needs it.

| App that owns the form | Namespace |
|---|---|
| Wix Forms (the forms on the site's **Forms** dashboard) | `wix.form_app.form` |
| Wix Bookings | `wix.bookings.v2.bookings` |
| Wix Pricing Plans | `wix.pricing_plans.v1.custom_form` |
| Wix eCom checkout | `wix.ecom.v1.checkout` |
| Wix Quizzes | `wix.achievements.quizzes.v1.quiz` |
| Wix Contacts | `wix.contacts.v4.contact` |

The source is [Namespaces of apps made by Wix](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/introduction#namespaces-of-apps-made-by-wix).

- **"My forms", "my contact form", "form submissions"** with no app named → `wix.form_app.form`.
- **You already hold a form** → use its `namespace` field.
- **`Permissions for given namespace not found: <namespace>`** → that app is not installed on the site. **Stop.** Check the site's apps with [List Installed Apps](../app-installation/list-installed-apps.md) and tell the user the app is missing. Do not try other namespaces (`wix.old_form_app.form`, `wix.forms`, …): none of them exist, and each one only costs another failed call.
- **List Forms returns `"forms": []`** for a namespace → it means *no forms there*, or *the wrong namespace*. It does not error on a namespace the site lacks.

---

## STEP 2 · Pick the call

| Task | Request | Where the namespace goes |
|---|---|---|
| List forms | `GET https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form` | query parameter `namespace` (required) |
| Query forms (by name, date) | `POST https://www.wixapis.com/form-schema-service/v4/forms/query` | inside the filter: `"namespace": {"$eq": "wix.form_app.form"}` |
| Get one form | `GET https://www.wixapis.com/form-schema-service/v4/forms/{formId}` | not needed |
| Query submissions | `POST https://www.wixapis.com/form-submission-service/v4/submissions/namespace/query` | inside the filter: `"namespace": "wix.form_app.form"` |
| Get one submission | `GET https://www.wixapis.com/form-submission-service/v4/submissions/{submissionId}` | not needed |
| Count submissions per form | `POST https://www.wixapis.com/form-submission-service/v4/submissions/count` | body field `namespace` |

**⚠️ These look-alike URLs do not exist and return a bare `404`:**

- `/forms/v4/forms`, `/forms/v4/forms/query`, `/forms/v4/forms/{formId}` — forms live under **`/form-schema-service/v4/`**.
- `/form-schema-service/v4/submissions/...` and `/form-submission-service/v4/forms` — submissions live under **`/form-submission-service/v4/submissions/`**, forms don't.

**Use `.../submissions/namespace/query` for every submissions query.** It is the only submissions query the docs list. Don't drop `namespace` from the path.

`https://www.wixapis.com/forms/v4/submissions/...` (the `publicUrl` the API spec gives for the submission methods) is the same API under another path, and works too. The `/forms/v4/` alias exists for submissions only: `/forms/v4/forms` still 404s.

---

## STEP 3 · List or find the forms

### List every form

```bash
# enabled forms (the default)
curl -X GET \
  'https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&fieldsets=METADATA&paging.limit=100' \
  -H 'Authorization: <AUTH>'

# disabled forms — a second call, always
curl -X GET \
  'https://www.wixapis.com/form-schema-service/v4/forms?namespace=wix.form_app.form&enabled=false&fieldsets=METADATA&paging.limit=100' \
  -H 'Authorization: <AUTH>'
```

- **⚠️ `enabled` defaults to `true`, and no value returns both.** One call hides every disabled form. With List Forms, make both calls and report both lists, marking the disabled ones. Or use Query Forms with only the namespace filter (below): it returns enabled and disabled forms in one call.
- **`fieldsets=METADATA`** returns only the top-level properties (`id`, `name`, `enabled`, dates, `namespace`) and leaves out fields, steps and rules. Use it whenever you only need names and IDs. Omit it when you need the fields (to read submission answers, see STEP 5).
- Response: `forms[]` and **`pagingMetadata`**. When `pagingMetadata.hasNext` is `true`, call again with `paging.cursor=<pagingMetadata.cursors.next>`.
- To read specific forms, add `formIds=<id>` (repeat the parameter for each ID).

### Find a form by name or date

```bash
curl -X POST \
  'https://www.wixapis.com/form-schema-service/v4/forms/query' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{
    "query": {
      "filter": {
        "namespace": { "$eq": "wix.form_app.form" },
        "name": { "$startsWith": "Contact" }
      },
      "sort": [{ "fieldName": "createdDate", "order": "DESC" }],
      "cursorPaging": { "limit": 50 }
    }
  }'
```

- Filter and sort fields: `id`, `namespace` (`$eq` only), `name` (`$eq`, `$ne`, `$in`, `$nin`, `$startsWith`), `enabled` (`$eq`, `$ne`), `createdDate` and `updatedDate` (`$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`). Date operators are `$gte` / `$lte`. **`$ge` / `$le` are rejected.** A range needs one condition per operator under `$and`, exactly as for submissions in STEP 4.
- Query Forms returns enabled and disabled forms together, unless you filter on `enabled`.
- Response: `forms[]` and **`metadata`** (not `pagingMetadata`). For the next page, see [Paging](#paging).

### Read one form

```bash
curl -X GET \
  'https://www.wixapis.com/form-schema-service/v4/forms/{formId}' \
  -H 'Authorization: <AUTH>'
```

Returns `form`, with `formFields` (each input field's `inputOptions.target` is the key its answers are stored under) and `namespace`.

---

## STEP 4 · Query the submissions

### The latest submissions to one form

```bash
curl -X POST \
  'https://www.wixapis.com/form-submission-service/v4/submissions/namespace/query' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{
    "query": {
      "filter": {
        "namespace": "wix.form_app.form",
        "formId": "<formId>"
      },
      "sort": [{ "fieldName": "createdDate", "order": "DESC" }],
      "cursorPaging": { "limit": 20 }
    }
  }'
```

- **⚠️ `namespace` goes inside `query.filter`.** A top-level `"namespace"` beside `query` doesn't count: the call fails with `namespace filter is required`.
- Leave out `formId` to read submissions across every form in the namespace.
- Response: `submissions[]` and **`metadata`** (`count`, `hasNext`, `cursors.next`). Each submission has `id`, `formId`, `status`, `seen`, `contactId` (when linked to a contact), `submitter`, `createdDate`, and `submissions` (the answers, see STEP 5).

### Read one submission

When you already hold a submission ID, read it directly. No namespace is needed:

```bash
curl -X GET \
  'https://www.wixapis.com/form-submission-service/v4/submissions/{submissionId}' \
  -H 'Authorization: <AUTH>'
```

Returns `submission`, with the same fields as a query result, including `formId` (the form it belongs to) and the answers in `submissions`.

### When it was submitted = `createdDate`

**The submission time is `createdDate`.** Filter and sort on it. These fields **do not exist**, and each one fails with `Filter contains unsupported condition` or `Sort contains unsupported condition`: `submittedDate`, `submittedAt`, `submissionTime`, `submissionDate`, `dateCreated`, `_createdDate`.

### A date range — one condition per operator, joined with `$and`

A field takes **one** operator. Two operators in one object, such as `"createdDate": {"$gte": …, "$lt": …}`, fail with `Field '$lt' is not supported for filter with operator '$eq'`. Put each bound in its own condition under `$and`:

```bash
curl -X POST \
  'https://www.wixapis.com/form-submission-service/v4/submissions/namespace/query' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{
    "query": {
      "filter": {
        "$and": [
          { "namespace": "wix.form_app.form" },
          { "createdDate": { "$gte": "2026-10-05T00:00:00Z" } },
          { "createdDate": { "$lt": "2026-10-12T00:00:00Z" } }
        ]
      },
      "sort": [{ "fieldName": "createdDate", "order": "DESC" }],
      "cursorPaging": { "limit": 100 }
    }
  }'
```

- Write dates as ISO 8601 UTC. For "last week", work out the week's start and end from today's date, and say which dates you used.
- **"How many…" in a date range**: follow every page and add up `metadata.count`. There is no total in the response, and Count Submissions takes no date filter.
- **"How many…" in total, per form**: Count Submissions.

```bash
curl -X POST \
  'https://www.wixapis.com/form-submission-service/v4/submissions/count' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{ "formIds": ["<formId>"], "namespace": "wix.form_app.form" }'
```

Returns `formsSubmissionsCount[]`, with `formId`, `totalCount` and `unseenCount` for each form.

### The fields you can filter and sort by — a closed list

| Field | Filter operators | Sortable |
|---|---|---|
| `namespace` | `$eq` — **required in every filter** | no |
| `id`, `formId`, `contactId`, `status` | `$eq`, `$ne`, `$in`, `$nin` | yes |
| `seen` | `$eq`, `$ne` | yes |
| `createdDate`, `updatedDate` | `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin` | yes |
| `submitter.memberId`, `submitter.visitorId`, `submitter.applicationId`, `submitter.userId` | `$eq`, `$ne`, `$in`, `$nin` | yes |
| `orderDetails.checkoutId` | `$eq`, `$ne`, `$in`, `$nin` | yes |

Any other field is rejected. The common wrong ones:

| You want | Use | Not |
|---|---|---|
| Submissions from one contact | `"contactId": "<contactId>"` (top level) | `submitter.contactId`, `submitterContactId` |
| Submissions to one form | `"formId": "<formId>"` | `submission.formId` |
| Unread submissions | `"seen": false` | — |
| Recorded submissions only | `"status": "CONFIRMED"` | — |
| Submissions with a given answer (an email typed in, a choice picked) | Not filterable. Filter by `formId`, then match the answer in code (STEP 5). | `submissions.email`, `submissions.<target>`, `contact.email` |

To find a person's submissions by their email, look up the contact first, then filter submissions by `"contactId": "<contacts[0].id>"`:

```bash
curl -X POST \
  'https://www.wixapis.com/contacts/v4/contacts/query' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: <AUTH>' \
  -d '{ "query": { "filter": { "info.emails.email": "jane@example.com" }, "fieldsets": ["BASIC"] } }'
```

No contact found means no submissions linked to that email. See [Query Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/query-contacts).

### Paging

Each page holds at most **100** submissions or forms. When `metadata.hasNext` is `true`, send the same URL with **only** the cursor. The cursor carries the filter and sort, including the namespace:

```json
{ "query": { "cursorPaging": { "limit": 100, "cursor": "<metadata.cursors.next>" } } }
```

---

## STEP 5 · Read the answers

A submission's answers are in its `submissions` object, keyed by each field's **`target`**:

```json
"submissions": { "email_1923": "jane@example.com", "short_answer_7b5c": "Hello" }
```

The targets are not labels. To show the user readable answers, read the form once (Get Form) and match each `formFields[].inputOptions.target` to the label inside that field's `inputOptions`, for example `stringOptions.textInputOptions.label`.

**Return only what the user asked for.** A submission page can be large. Before you answer or pass results on, keep only the fields you need, such as `id`, `createdDate`, `contactId` and the few answers that matter. Use `fieldsets=METADATA` on List Forms for the same reason.

To give the user a link to a form's submissions table, see [Forms Dashboard Navigation](./forms-dashboard-navigation.md).

---

## Troubleshooting

| Error / symptom | Cause | Fix |
|---|---|---|
| `namespace must not be empty` / `namespace has size 0, expected 10 or more` on List Forms | The `namespace` query parameter is missing | Add `?namespace=wix.form_app.form` |
| `namespace filter is required` on a submissions query | `namespace` is missing from `query.filter`, or sent at the top level | Put `"namespace": "wix.form_app.form"` inside `query.filter` |
| `Permissions for given namespace not found: …` | The site doesn't have that app | Stop. Check [installed apps](../app-installation/list-installed-apps.md) and tell the user. Don't try other namespaces |
| A bare `404` with no message | An invented URL such as `/forms/v4/forms` or `/form-schema-service/v4/submissions/...` | Use the URLs in STEP 2 exactly |
| `Sort contains unsupported condition` / `Filter contains unsupported condition` | A field outside the closed list, such as `submittedDate`, `_createdDate`, `submitter.contactId` or an answer key | Use `createdDate`, `contactId`, or the table in STEP 4 |
| `Field '$lt' is not supported for filter with operator '$eq'` | Two operators in one field object | One condition per operator under `$and` |
| `Filter contains unsupported operator` on Query Forms | Two operators in one field object | One condition per operator under `$and` |
| `Field 'createdDate' is using non allowed operator '$ge'` | `$ge` / `$le` | Use `$gte` / `$lte` |
| The user says a form is missing from the list | List Forms defaults to `enabled=true` | Call again with `enabled=false` |
| `"forms": []` | Wrong namespace, no forms there, or (on List Forms) every form is disabled | Check the namespace (STEP 1) and call again with `enabled=false` before reporting "no forms" |

---

## Related Documentation

- [Update Form](./update-form.md) and [Create Form](./create-form.md) — changing or building a form
- [Forms Dashboard Navigation](./forms-dashboard-navigation.md) — links to a form and its submissions table
- [List Forms](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/list-forms) · [Query Forms](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/query-forms) · [Get Form](https://dev.wix.com/docs/api-reference/crm/forms/form-schemas/get-form)
- [Query Submissions By Namespace](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/query-submissions-by-namespace) · [Count Submissions](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/count-submissions)
- [About Submission Values](https://dev.wix.com/docs/api-reference/crm/forms/form-submissions/about-submission-values) — what each field type stores
- [About the Wix API Query Language](https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/data-retrieval/about-the-wix-api-query-language) — `$and`, `$or`, paging
