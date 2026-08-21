---
name: "Query Sites"
description: List, count, and find the sites in a Wix account. Covers the namespace filter for headless sites, counting before enumerating, cursor pagination, and resolving a site by name.
---
# Query Sites

List, count, and find the sites in a Wix account.

- **Auth**: account-level (a Wix user token, or an account-level API key). `wix token` prints one.
- **Permission**: `SITE_LIST.READ` (scope `SCOPE.ACC-DC-OS.READ-SITE`).
- **Endpoints**: list `POST https://www.wixapis.com/site-list/v2/sites/query` · count
  `POST https://www.wixapis.com/site-list/v2/sites/count`.

## Include headless sites — filter by `namespace`

Both endpoints see only `WIX`-namespace sites by default; **headless sites** (anything built on a
connected OAuth app) are silently excluded. Filter on both namespaces to see everything:

```bash
curl -X POST 'https://www.wixapis.com/site-list/v2/sites/query' \
  -H 'Authorization: <ACCOUNT_TOKEN>' -H 'Content-Type: application/json' \
  -d '{ "query": { "filter": { "namespace": { "$in": ["WIX", "HEADLESS"] } }, "cursorPaging": { "limit": 100 } } }'
```

`query` takes optional `filter`, `sort` (e.g. `[{ "fieldName": "createdDate", "order": "DESC" }]`),
and `cursorPaging` (max `limit` 100).

## Count before you enumerate

An account can hold thousands of sites. To find one by name, search (see "Find a site by name")
rather than enumerate. To walk the whole list, count first and decide whether that's worth it:

```bash
curl -X POST 'https://www.wixapis.com/site-list/v2/sites/count' \
  -H 'Authorization: <ACCOUNT_TOKEN>' -H 'Content-Type: application/json' \
  -d '{ "filter": { "namespace": { "$in": ["WIX", "HEADLESS"] } } }'   # → { "count": 1335 }
```

Enumerating costs **~0.7s per 100 sites** (100 → ~0.7s, 500 → ~3.4s, ~1,300 → ~9s). For a large
count, render the first N sites with a "…and N more" note instead of fetching all of them.

## Paginate

The next cursor is at `metadata.cursors.next` (there is **no** `pagingMetadata` field); it already
encodes the filter/sort, so follow-up pages send only the cursor:

```javascript
async function listAllSites(wixPost) {
  const sites = [];
  let cursor = null;
  do {
    const query = cursor
      ? { cursorPaging: { limit: 100, cursor } }
      : { filter: { namespace: { $in: ["WIX", "HEADLESS"] } }, cursorPaging: { limit: 100 } };
    const res = await wixPost("/site-list/v2/sites/query", { query });
    sites.push(...res.sites);
    cursor = res.metadata.hasNext ? res.metadata.cursors.next : null;
  } while (cursor);
  return sites;
}
```

## Find a site by name

Substring-search by display name with `GET manage.wix.com/account/sites/api/sites/search`. It
returns full site records (headless included) and, with `getCount=true`, the total:

```bash
curl 'https://manage.wix.com/account/sites/api/sites/search?query=kintsugi&getCount=true' \
  -H 'Authorization: <ACCOUNT_TOKEN>' -H 'accept: application/json'
# → { "sites": [ { "metaSiteId", "displayName", "namespace", "published", "editUrl", … } ], "totalCount": 5 }
```

## Response — the `Site` object

`sites` is an array of:

```typescript
interface Site {
  id: string;                 // site ID — use for site-level API calls
  htmlAppId: string;
  name: string;               // URL slug / internal name; opaque `headless-<id>` for headless sites
  displayName: string;        // human-readable name
  createdDate: string;        // ISO datetime
  updatedDate: string;        // ISO datetime
  trashedDate?: string;       // present only when the site is in the trash
  published: boolean;
  premium: boolean;           // has a Wix Premium (paid) plan
  viewUrl: string;            // public address; "" when unpublished (there is no `siteUrl` field)
  editUrl: string;            // relative; prefix with https://manage.wix.com to open
  thumbnail: string;
  ownerAccountId: string;
  contributorAccountIds: string[];
  editorType: string;         // EDITOR | ODEDITOR | STUDIO | EDITORLESS
  blocked: boolean;
  folderId?: string;          // set for sites organized in folders / parent-child setups
  namespace: string;          // WIX | HEADLESS
  domainConnected: boolean;
  parentChildRole: string;    // e.g. NONE
}
```

## Next Steps

Use a site's `id` for site-level API calls — derive a site token from the account token
(`wix token --site <id>`, or the `oauth2/token` refresh-grant in wix-auth `device-flow`), then read
its context via [Read Site Context](read-site-context.md) or create sites with
[Create Site from Template](create-site-from-template.md).
