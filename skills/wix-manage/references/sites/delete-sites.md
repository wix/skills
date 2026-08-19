---
name: "Delete Sites"
description: Deletes one or more sites from a Wix account using the Bulk Delete Site API. Use this to clean up unwanted duplicate/orphan sites (e.g. leftover from a declined, timed-out, or retried site-creation call) instead of leaving them for the user to find and delete manually.
---
# Delete Sites

This recipe deletes one or more sites owned by the account. It's the cleanup step to pair with
[Query Sites](query-sites.md) whenever a site-creation flow (e.g. `WixSiteBuilder`/Wix Harmony AI
generation) leaves behind duplicate or unwanted sites — for example when a build call was retried,
or when a user declined/the client timed out on a tool-call approval but the backend build had
already started and a real site was created anyway.

## Prerequisites

- Account-level API access (authenticated as a Wix user or using an account-level API key)
- Permission `my-account.delete-site`

## Required APIs

- **Bulk Delete Site API**: [REST](https://dev.wix.com/docs/api-reference/account-level/sites/site-actions/bulk-delete-site)

> This is **not a permanent delete** — sites are moved to the trash bin and can be restored by a
> site collaborator. Safe to use for cleaning up accidental/duplicate sites without risk of
> permanent data loss.

## When to use this

1. A site-creation tool (e.g. `WixSiteBuilder`) was called more than once for what was meant to be
   one site — each call creates a fully independent new site, with no de-duplication.
2. A site-creation tool call was declined or timed out client-side, but the site was already
   created server-side by the time of the decline/timeout.
3. The user asks to clean up test/duplicate/unwanted sites in their account.

Identify the sites to delete first — with [Query Sites](query-sites.md) or `ListWixSites`, matching
on name, `createdDate`, or `updatedDate` around the time of the duplicate calls. **Confirm with the
user which sites are unwanted before deleting** — deletion (even to trash) should not be assumed
silently for sites the user might still want.

## Delete Sites

**Endpoint**: `POST https://www.wixapis.com/site-actions/v1/bulk/sites/delete`

Up to 20 site IDs per call.

**Request Body**:
```json
{
  "ids": [
    "9f023696-c821-4e09-b1d0-55357272ff2a",
    "da0c7663-e375-48a9-b273-f0bd45c933a9"
  ]
}
```

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/site-actions/v1/bulk/sites/delete' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "ids": ["9f023696-c821-4e09-b1d0-55357272ff2a"]
  }'
```

## Response Structure

```json
{
  "results": [
    { "itemMetadata": { "id": "9f023696-c821-4e09-b1d0-55357272ff2a", "originalIndex": 0, "success": true } }
  ],
  "bulkActionMetadata": {
    "totalSuccesses": 1,
    "totalFailures": 0
  }
}
```

Check `results[].itemMetadata.success` per site — a non-zero `totalFailures` doesn't mean the whole
call failed, just that some of the requested IDs didn't delete (e.g. already trashed, or not owned
by this account).

## Next Steps

- Deleted sites go to the trash bin, not permanent deletion — see
  [Moving a site to trash](https://support.wix.com/en/article/moving-a-site-to-trash) for how a
  collaborator restores one.
- To find sites to clean up in the first place, see [Query Sites](query-sites.md).
