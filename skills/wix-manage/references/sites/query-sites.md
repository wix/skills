---
name: "Query Sites"
description: Lists and queries all sites associated with a Wix account using the Sites API. Covers filtering, sorting, and cursor-based pagination.
---
# Query Sites

This recipe demonstrates how to list and query the sites associated with a Wix account.

## Prerequisites

- Account-level API access (authenticated as a Wix user or using an account-level API key)
- Permission `SITE_LIST.READ` (scope `SCOPE.ACC-DC-OS.READ-SITE`)

## Required APIs

- **Query Sites API**: [REST](https://dev.wix.com/docs/api-reference/account-level/sites/sites/query-sites)

> Returns up to **100** sites per request. Use cursor paging (below) to retrieve more.

---

## Query Sites

**Endpoint**: `POST https://www.wixapis.com/site-list/v2/sites/query`

The request takes a `query` object that supports `filter`, `sort`, and `cursorPaging`.

**Request Body**:
```json
{
  "query": {
    "filter": { "editorType": "EDITOR" },
    "sort": [{ "fieldName": "createdDate", "order": "ASC" }],
    "cursorPaging": { "limit": 50 }
  }
}
```

All three fields are optional — `{ "query": { "cursorPaging": { "limit": 50 } } }` lists every site.

**Request**:
```bash
curl -X POST \
  'https://www.wixapis.com/site-list/v2/sites/query' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "filter": { "editorType": "EDITOR" },
      "sort": [{ "fieldName": "createdDate", "order": "ASC" }],
      "cursorPaging": { "limit": 50 }
    }
  }'
```

---

## Response Structure

The response has the sites array plus **two** paging objects: a top-level `cursorPaging`
(echoes the applied limit and the next cursor) and `metadata` (count, `cursors.next`, `hasNext`).

> ⚠️ There is **no** `pagingMetadata` field. Read paging info from `metadata`.

```json
{
  "sites": [
    {
      "id": "f6061c5f-6aa3-42f8-8822-36a4981dabb2",
      "htmlAppId": "70df538d-906c-44ca-9f27-c186b62f2b2b",
      "name": "my-site-47",
      "displayName": "My Site 47",
      "createdDate": "2023-02-01T14:56:09.831Z",
      "updatedDate": "2026-06-22T03:55:49.031Z",
      "published": true,
      "premium": false,
      "viewUrl": "https://username.wixsite.com/my-site-47",
      "editUrl": "/editor/f6061c5f-6aa3-42f8-8822-36a4981dabb2?editorSessionId=...",
      "thumbnail": "/site-thumbnail/f6061c5f-6aa3-42f8-8822-36a4981dabb2",
      "ownerAccountId": "e6a89eda-d100-4b2d-8a47-3040e2134497",
      "contributorAccountIds": [],
      "editorType": "EDITOR",
      "blocked": false,
      "namespace": "WIX",
      "domainConnected": false,
      "parentChildRole": "NONE"
    }
  ],
  "cursorPaging": {
    "limit": 50,
    "cursor": "<cursor-for-next-page>"
  },
  "metadata": {
    "count": 50,
    "cursors": {
      "next": "<cursor-for-next-page>"
    },
    "hasNext": true
  }
}
```

### Site object fields

Each entry in `sites` has these fields (from the `Site` schema):

| Field | Type | Notes |
|---|---|---|
| `id` | string | Site ID — use for site-level API calls |
| `htmlAppId` | string | Internal HTML app ID |
| `name` | string | URL slug / internal name |
| `displayName` | string | Human-readable site name |
| `createdDate` / `updatedDate` | datetime | |
| `trashedDate` | datetime | Present only if the site is in the trash |
| `published` | boolean | Whether the site is published |
| `premium` | boolean | Whether the site has a Wix Premium (paid) plan |
| `viewUrl` | string | Public site address; empty string when unpublished. **There is no `siteUrl` field.** |
| `editUrl` | string | Relative editor path; prefix with `https://manage.wix.com` to open |
| `thumbnail` | string | Relative thumbnail path |
| `ownerAccountId` | string | |
| `contributorAccountIds` | string[] | |
| `editorType` | string | e.g. `EDITOR`, `ODEDITOR` — also a valid `filter` field |
| `blocked` | boolean | |
| `folderId` / `parentId` | string | Set for sites organized in folders / parent-child setups |
| `namespace` | string | e.g. `WIX` |
| `domainConnected` | boolean | |
| `parentChildRole` | string | e.g. `NONE` |

---

## Pagination

Cursor-based. Read the next cursor from `metadata.cursors.next` and stop when
`metadata.hasNext` is `false`.

> The cursor does **not** carry the page limit, and it already encodes the filter/sort
> from the first request. On follow-up pages send **only** the cursor (plus `limit` if you
> want a non-default page size) — do **not** repeat `filter` or `sort`.

**First request**:
```json
{
  "query": {
    "filter": { "editorType": "EDITOR" },
    "sort": [{ "fieldName": "createdDate", "order": "ASC" }],
    "cursorPaging": { "limit": 50 }
  }
}
```

**Next page** (cursor from `metadata.cursors.next`):
```json
{
  "query": {
    "cursorPaging": {
      "limit": 50,
      "cursor": "<metadata.cursors.next from previous response>"
    }
  }
}
```

**Loop**:
```javascript
async function listAllSites() {
  const sites = [];
  let cursor = null;
  do {
    const cursorPaging = cursor ? { limit: 100, cursor } : { limit: 100 };
    const res = await wixRequest({ query: { cursorPaging } }); // POST .../site-list/v2/sites/query
    sites.push(...res.sites);
    cursor = res.metadata.hasNext ? res.metadata.cursors.next : null;
  } while (cursor);
  return sites;
}
```

---

## Common Use Cases

### List all sites
Omit `filter` and page through with `cursorPaging` until `metadata.hasNext` is `false`.

### Find a specific site
Prefer server-side `filter` (e.g. `{ "editorType": "EDITOR" }`) and `sort` over fetching
everything and filtering client-side. Filterable fields match the site object (e.g. `name`,
`displayName`, `editorType`, `published`).

---

## Next Steps

After finding a site:
- Use the site `id` for site-level API calls
- Create new sites using [Create Site from Template](create-site-from-template.md)
- Manage site settings and content
