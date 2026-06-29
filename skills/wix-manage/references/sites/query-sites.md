| name        | Query Sites                                                                                                                |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| description | Lists and queries all sites associated with a Wix account using Sites API. Covers pagination with cursor-based navigation. |


# Query Sites

This recipe demonstrates how to list and query all sites associated with a Wix account.

## Prerequisites

- Account-level API access
- - Authorization for site listing permissions
 
- ## Required APIs

- - **Query Sites API**: [REST](https://dev.wix.com/docs/api-reference/account-level/sites/sites/query-sites)
 
  - ---


  ## Query All Sites

  **Endpoint**: `POST https://www.wixapis.com/site-list/v2/sites/query`

  **Request Body**:

  ```json
  {
    "query": {
      "cursorPaging": {
        "limit": 50
      }
    }
  }
  ```

  ### Filter for Premium Sites Only

  Pass a `filter` to let the server do the work — do not filter client-side:

  ```json
  {
    "query": {
      "cursorPaging": { "limit": 50 },
      "filter": { "premium": true }
    }
  }
  ```

  ---


  ## Response Structure

  > ⚠️ Pagination metadata is under `metadata`, **not** `pagingMetadata`.
  > > The cursor lives at `metadata.cursors.next` (also available at `cursorPaging.cursor`).
  > >
  > > ```json
  > > {
  > >   "sites": [
  > >     {
  > >       "id": "site-id-123",
  > >       "name": "My Website",
  > >       "displayName": "My Website",
  > >       "siteUrl": "https://username.wixsite.com/mywebsite",
  > >       "published": true,
  > >       "createdDate": "2024-01-15T10:30:00Z",
  > >       "updatedDate": "2024-06-20T14:45:00Z"
  > >     }
  > >   ],
  > >   "metadata": {
  > >     "count": 50,
  > >     "cursors": {
  > >       "next": "cursor-for-next-page"
  > >     },
  > >     "hasNext": true
  > >   },
  > >   "cursorPaging": {
  > >     "cursor": "cursor-for-next-page"
  > >   }
  > > }
  > > ```
  > >
  > > ---
  > 
  > ## Pagination
  >
  > For accounts with many sites, use cursor-based pagination.
  > Always read `metadata.hasNext` and `metadata.cursors.next` — **not** `pagingMetadata`.
  >
  > **First Request**:
  >
  > ```json
  > {
  >   "query": {
  >     "cursorPaging": { "limit": 50 }
  >   }
  > }
  > ```
  >
  > **Next Page** (using cursor from response):
  >
  > ```json
  > {
  >   "query": {
  >     "cursorPaging": {
  >       "limit": 50,
  >       "cursor": "<metadata.cursors.next from previous response>"
  >     }
  >   }
  > }
  > ```
  >
  > Continue until `metadata.hasNext` is `false`.
  >
  > **Pseudocode**:
  >
  > ```js
  > let cursor = null;
  > do {
  >   const res = await querySites({ cursor, limit: 50, filter: { premium: true } });
  >   // process res.sites ...
  >   cursor = res.metadata?.cursors?.next ?? null;
  > } while (res.metadata?.hasNext);
  > ```
  >
  > ---
  
  ## Common Use Cases

  ### List All Sites

  Retrieve all sites without filtering — useful for account dashboards or site selection interfaces.
  Paginate until `metadata.hasNext` is `false`.

  ### List Premium Sites

  Use the server-side `filter: { "premium": true }` in the request body.
  Do **not** fetch all pages and filter client-side — the filter is supported server-side and is more efficient.

  ### Find a Specific Site

  After querying, match by `name` or `id` from the returned `sites` array.

  ---


  ## Next Steps

  After finding a site:

  - Use the site ID for site-level API calls
  - - Create new sites using [Create Site from Template](https://github.com/wix/skills/blob/main/skills/wix-manage/references/sites/create-site-from-template.md)
    - - Manage site settings and content
      - 
