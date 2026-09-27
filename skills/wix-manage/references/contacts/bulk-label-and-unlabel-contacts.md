---
name: "Bulk Label and Unlabel Contacts"
description: Creates contact label definitions or adds/removes labels from matching contacts. Use Find or Create Label for label creation alone; use bulk labeling only when the user requests contact assignments.
---
# Bulk Label And Unlabel Contacts

## Description
Adds and removes labels from multiple contacts using the Wix Contacts REST API.

## Create labels or assign labels?

If the user asks to **create a label** (for example, "Create VIP, Wholesale, and Newsletter labels"), use [Find or Create Label](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/find-or-create-label) directly. Creating a label definition does not require finding contacts or starting a bulk labeling job.

```http
POST https://www.wixapis.com/contacts/v4/labels
Content-Type: application/json

{"displayName":"VIP"}
```

Use the returned `label` and its `key`; `newLabel` distinguishes a newly created label from an existing one. For several names, make one call per name and check each result. Stop here when the request is only to create labels: do not assign them to contacts.

If the user asks to **label or unlabel contacts**, resolve the requested label keys first, then follow the bulk assignment flow below. Create a missing label only when that is part of the authorized request. An explicit request to create labels or apply them to a specified set of contacts authorizes that operation; otherwise confirm the target and intended change before mutating.

## Bulk assignment flow

Labels are added to and removed from all contacts that meet the specified `filter` and `search` criteria.
The request should specify a `filter` value, a `search` value, or both.
To perform a dry run, call [Query Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/query-contacts) with the intended filter options.

When this method is used, a bulk job is started and the job ID is returned.
The job might not complete right away, depending on its size.
The job's status can be retrieved with [Get Bulk Job](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/bulk-job/get-bulk-job).

**IMPORTANT NOTE:** When specific contacts are to be labeled, they should be filtered by id.

### Steps

1. **Resolve label keys.** When adding, Find or Create Label (above) returns the `key`. To remove a label, or to
   use only a label that already exists, look it up by name instead of creating it:
   `POST https://www.wixapis.com/contacts/v4/labels/query` with
   `{"query":{"filter":{"displayName":{"$eq":"Newsletter"}}}}`, and take each returned label's `key`.
2. **Resolve named contacts to IDs** with Search Contacts, as in
   [Update a Contact](update-a-contact.md) — Query Contacts cannot filter on a name:
   `POST https://www.wixapis.com/contacts/v5/contacts/search` with `{"search":{"search":{"expression":"Leo Marsh"}}}`.
   Each result in `contacts` has an `id` and `name.first` / `name.last`; keep only exact name matches. If none or
   more than one contact matches, stop and ask the user.
3. **Start the job** with the endpoint below, filtering by the resolved IDs:
   `{"filter":{"id":{"$in":["<CONTACT_ID>"]}},"labelKeysToAdd":["<LABEL_KEY>"]}` (or `labelKeysToRemove`).
4. **Confirm the job finished** with `GET https://www.wixapis.com/contacts/v4/bulk/jobs/{jobId}`; repeat until
   `job.status` is `COMPLETED`, then report `job.successTotal` and `job.failedTotal`.

## API Endpoint
`POST https://www.wixapis.com/contacts/v4/bulk/contacts/add-remove-labels`

## Request Example

```bash
curl -X POST \
  'https://www.wixapis.com/contacts/v4/bulk/contacts/add-remove-labels' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "filter": {
      "id": { "$in": ["<CONTACT_ID_1>", "<CONTACT_ID_2>"] }
    },
    "labelKeysToAdd": ["custom.newsletter"],
    "labelKeysToRemove": ["custom.prospect"]
  }'
```

## Request Parameters

- `filter` (object, optional): Filter criteria to identify contacts. When specific contacts are to be labeled, filter by `id`.
- `search` (string, optional): Search query to identify contacts.
- `labelKeysToAdd` (array of strings): Array of label keys to add to matching contacts.
- `labelKeysToRemove` (array of strings): Array of label keys to remove from matching contacts.

**Note:** The request should specify a `filter` value, a `search` value, or both.

## Response

The response includes a `jobId` which can be used to track the bulk job status:

```json
{
  "jobId": "00000000-0000-0000-0000-000000000001"
}
```

Use the [Get Bulk Job](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/bulk-job/get-bulk-job) endpoint to check the job status.

## Permissions Required
- `CONTACTS.MODIFY`

## Related Documentation
- [Bulk Label And Unlabel Contacts API Reference](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/bulk-label-and-unlabel-contacts)
- [Query Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/query-contacts)
- [Get Bulk Job](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/bulk-job/get-bulk-job)
- [Labels API Reference](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/introduction)
