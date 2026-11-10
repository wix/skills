---
name: "Bulk Delete Contacts"
description: "Deletes one or more of a site's contacts: contacts the user names, or every contact that matches a name, email, location, label or other criteria. Covers confirming with the user before an irreversible delete, the bulk job's result, and contacts that cannot be deleted, such as site members."
---

# Bulk Delete Contacts

Deleting a contact cannot be undone, and contacts hold personal data. So the flow is fixed:
find the exact contacts, show them to the user, wait for the user to confirm, then delete
**by ID** only the contacts the user confirmed. One contact goes through the same flow, with one
ID.

1. Find the contacts and collect their IDs (Step 1).
2. Show the user the count and the list, and ask them to confirm (Step 2). Stop here until they do.
3. Delete by ID (Step 3).
4. Read the bulk job and report the result (Step 4).

**Every request below is complete and was run on a live site: send it as written, with your own
values, and do not search the docs or look up the method schema first.**

Never call Bulk Delete Contacts without first showing the user the contacts and getting their
confirmation, even when the request itself says "delete". Send it only a filter on `id`: never a
filter on another field, never an empty filter, and never a `search` value. The call deletes every
contact that matches, and a name or free-text match can include contacts the user did not see.

## Step 1: Find the contacts

For a name, search with free text:

```bash
curl -X POST 'https://www.wixapis.com/contacts/v5/contacts/search' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "search": {
    "search": { "expression": "Hartley", "mode": "AND" },
    "cursorPaging": { "limit": 100 }
  }
}'
```

While `pagingMetadata.hasNext` is `true`, send the next request with only the cursor:
`{"search": {"cursorPaging": {"limit": 100, "cursor": "<pagingMetadata.cursors.next>"}}}`.

The expression matches the start of any word in the name, email, phone or company, so keep only
the exact matches in code: a search for `Hartley` also returns `Hartleyson`. When the user names a
last name ("contacts with the last name Hartley"), keep only the contacts whose `name.last` equals
it, ignoring case, not the ones whose first name is Hartley.

For an email, phone, city, state, country, date range, label or other criteria, take the request
from [Find Contacts](find-contacts.md).

From each contact in `contacts[]` keep `id`, `name.first`, `name.last`, `email.email`, and
`memberInfo.memberId` when present.

## Step 2: Show the contacts and confirm

Contacts with `memberInfo.memberId` are site members. Bulk Delete Contacts does not delete a site
member's contact, and this recipe does not delete members. Leave them out of the count and out of
the IDs you send, and list them separately as site members whose contacts cannot be deleted here.

Tell the user how many contacts will be deleted and list them: the name and email of each. When
there are more than 20, list the first 20 and give the total. Say that the deletion cannot be
undone, and ask the user to confirm.

Delete only after the user confirms this list in a later message. If they remove contacts from it,
delete only the rest. When nothing matches, say so and delete nothing.

## Step 3: Delete by ID

```bash
curl -X POST 'https://www.wixapis.com/contacts/v4/bulk/contacts/delete' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "filter": {
    "id": { "$in": ["<contactId1>", "<contactId2>"] }
  }
}'
```

Put the IDs of the confirmed contacts in `$in`. The response holds only the job ID:

```json
{ "jobId": "00000000-0000-0000-0000-000000000001" }
```

## Step 4: Read the job

The job runs in the background. Read it with
[Get Bulk Job](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/bulk-job/get-bulk-job):

```bash
curl -X GET 'https://www.wixapis.com/contacts/v4/bulk/jobs/<jobId>' \
-H 'Authorization: <AUTH>'
```

```json
{
  "job": {
    "id": "00000000-0000-0000-0000-000000000001",
    "type": "DELETE",
    "status": "COMPLETED",
    "finishedDate": "2026-01-01T12:00:01.000Z",
    "totalItems": 2,
    "successTotal": 2,
    "failedTotal": 0,
    "errors": []
  }
}
```

`status` starts as `NEW`. Read it again every one or two seconds until `finishedDate` is set; a
small job finishes within a second or two. Then tell the user how many contacts were deleted
(`successTotal`) and, for `failedTotal`, which ones and why, from `errors`:

- `CANNOT_DELETE_SITE_MEMBERS`: the contact is a site member, and the member has to be deleted first. This recipe does not delete members; tell the user.
- `CANNOT_DELETE_CONTACT_WITH_BILLING_SUBSCRIPTION`: the contact has an active billing subscription.
- `FAILED_DELETE_CONTACT`: the contact could not be deleted.

**`totalItems` lower than the number of IDs you sent.** The call matches contacts through the
search index, so a contact created in the last few seconds is not matched yet: the job finishes as
`COMPLETED` with `totalItems: 0` and that contact stays. Wait a few seconds and send the same
request again with the IDs that were not deleted. Check with
`GET https://www.wixapis.com/contacts/v4/contacts/<contactId>`: a deleted contact returns `404`
`CONTACT_NOT_FOUND`.

## Permissions

- `CONTACTS.MODIFY`

## Related Documentation

- [Bulk Delete Contacts API Reference](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/bulk-delete-contacts)
- [Get Bulk Job](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/bulk-job/get-bulk-job)
- [Find Contacts](find-contacts.md)
