---
name: "Bulk Label and Unlabel Contacts"
description: Adds/removes labels from multiple contacts using Contacts API bulk operations. Covers label creation, contact filtering, batch processing, and rate limit handling.
---
# Bulk Label And Unlabel Contacts

## Description
Adds and removes labels from multiple contacts using the Wix Contacts REST API.

Labels are added to and removed from all contacts that meet the specified `filter` and `search` criteria.
The request should specify a `filter` value, a `search` value, or both.
To perform a dry run, call [Query Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/query-contacts) with the intended filter options.

When this method is used, a bulk job is started and the job ID is returned.
The job might not complete right away, depending on its size.
The job's status can be retrieved with [Get Bulk Job](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/bulk-job/get-bulk-job).

**IMPORTANT NOTE:** When specific contacts are to be labeled, they should be filtered by id.

## Resolve the label key before labeling

`labelKeysToAdd` and `labelKeysToRemove` take label **keys**, not display names. A user asking to
apply a label names it the way they see it in the dashboard ("VIP Customer"), so the display name
has to be resolved to a key first.

**Never derive the key from the display name.** A key is assigned when the label is created and
[can't be changed afterwards](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/introduction),
while [Update Label](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/update-label)
renames the `displayName` — so a renamed label still carries a key derived from its original name,
and the two do not have to correspond. Keys are also namespaced: user-defined labels sit under
`custom.` (`custom.my-label`), system-defined ones under other namespaces
(`contacts.contacted-me`). Always read the key out of an API response.

### Adding a label: Find Or Create Label

[Find Or Create Label](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/find-or-create-label)
takes a display name and returns the label, "or creates one if it doesn't exist". One call resolves
the key whether or not the label is already on the site, so use it for any request that adds a
label. Do not list every label to search for a match, and do not stop to ask whether to create a
missing label — apply the label the user asked for.

`POST https://www.wixapis.com/contacts/v4/labels`

```bash
curl -X POST 'https://www.wixapis.com/contacts/v4/labels' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  --data-binary '{ "displayName": "VIP Customer" }'
```

```json
{
  "label": {
    "key": "custom.vip-customer",
    "displayName": "VIP Customer",
    "labelType": "USER_DEFINED"
  },
  "newLabel": true
}
```

Pass `label.key` to `labelKeysToAdd`. `newLabel` reports whether the label already existed, so use
it to tell the user whether the label was created and applied or an existing one was applied.
Requires `CONTACTS_LABELS.MODIFY`.

### Removing a label: look it up without creating it

Find Or Create Label would create the label being removed, so for `labelKeysToRemove` resolve the
key read-only instead. `displayName` supports `$eq` on
[Query Labels](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/query-labels):

```bash
curl -X POST 'https://www.wixapis.com/contacts/v4/labels/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  --data-binary '{ "query": { "filter": { "displayName": { "$eq": "VIP Customer" } } } }'
```

An empty `labels` array means no such label exists, so there is nothing to remove — say so rather
than creating it. Requires `CONTACTS_LABELS.VIEW`.

Two other read-only options:
[Get Label](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/get-label)
(`GET /contacts/v4/labels/{key}`) when the key is already known, and
[List Labels](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/list-labels)
(`GET /contacts/v4/labels`), which accepts `?startsWith=` to return only labels whose display names
start with a string, and `?labelType=USER_DEFINED` to exclude system labels. Prefer the filtered
query over listing every label on the site.

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
      "info.name.first": "John"
    },
    "labelKeysToAdd": ["custom.name-john", "custom.name-starts-with-J"],
    "labelKeysToRemove": ["custom.last-name-smith"]
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
- `CONTACTS.MODIFY` — the bulk label/unlabel call
- `CONTACTS_LABELS.MODIFY` — Find Or Create Label
- `CONTACTS_LABELS.VIEW` — Query Labels, Get Label, List Labels

## Related Documentation
- [Bulk Label And Unlabel Contacts API Reference](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/bulk-label-and-unlabel-contacts)
- [Query Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/query-contacts)
- [Get Bulk Job](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/bulk-job/get-bulk-job)
- [Labels API Reference](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/introduction)
- [Find Or Create Label](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/find-or-create-label)
- [Query Labels](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/query-labels)
- [Contact Labels: Supported Filters and Sorting](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/labels/sort-and-filter)
