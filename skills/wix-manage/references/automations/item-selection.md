---
name: "Automations Item Selection"
description: "Resolve selectable entities by provider or tag with parent constraints, pagination, ambiguity handling and vertical API alternatives."
---

# Item Selection API

Item Selection is a **PUBLIC, BETA** service. These are its verified **service-relative** paths:

| Method | Path | Required permission |
| --- | --- | --- |
| List Installed Providers | `GET /v1/items-selection/installed-providers` | `ITEMS_SELECTION.LIST_INSTALLED_PROVIDERS` |
| Query Items | `POST /v1/items-selection/{providerKey}/items` | `ITEMS_SELECTION.LIST_ITEMS` |

Use the available public API client/MCP binding in the target site's context. The external
`wixapis.com` base/prefix and access with an external token have not been verified for these
paths; do not guess a gateway URL or substitute a dashboard session endpoint. If your tools
cannot resolve a supported binding or permissions are missing, use a vertical API from
[Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration) §2 or ask.
This delivery limitation does **not** make the service private.

1. Read the selector metadata ([Automations Entity and Provider Configuration](https://dev.wix.com/docs/api-reference/business-management/automations/skills/automations-entity-and-provider-configuration) §1). A `providerKey` / `selectorId` / trigger selector `id`
   identifies a concrete provider; keep the full key unchanged. A `tag` identifies a family,
   **not** a provider key. Call List Installed Providers with that optional `tag`, then match
   `providers[].key`, `appId`, `contentData` and `supportedTags` to the requested entity. For a
   tag-based field, consider the matching installed providers; do not arbitrarily use the first.
2. Inspect the provider's `searchParams.fields`, `searchParams.filters` and `paginationMode`.
   Query Items takes `{providerKey, query, tag?}` and returns `{items, pagingMetadata}`. Pass
   the selector's tag to both discovery and querying when present; tags can affect results.
   `query.search` is an exact-match text search (maximum 100 characters) over the provider's
   supported search fields, not a universal substring/name/id search. An empty search result
   does not prove an item is absent: page through the filtered items when necessary.
3. Apply fixed constraints and parent selections in **`query.filter`**. Copy the selector's
   filter keys and value shapes; do not rename them or invent generic operators. Builder picker
   filters commonly contain arrays such as `{"<parent-filter-key>": ["<selected-parent-id>"]}`.
   For `dynamicFiltersMapping` or trigger `queryFieldToFilterIdMapping`, resolve the parent first,
   then query children under it. Changing the parent requires re-resolving the child. A child
   with the right name under a different parent is not a match.
4. For offset providers, use `query.paging: {limit: 25, offset: 0}` and advance the offset. For
   cursor providers, use `query.cursorPaging: {limit: 25}`, then its `cursor` from
   `pagingMetadata.cursors.next`; continuation requests omit `filter` per the query contract.
   Choose one paging mode. Stop at exhausted metadata, an empty page, or repeated pages/cursors;
   report incomplete lookup rather than looping or claiming no matches. `query.filters`,
   top-level `query.limit` and `query.offset` are picker conveniences, **not** API request fields.
5. Match `items[].name` and available description/context to the user's intent, then persist
   **`items[].id` unchanged**, including non-UUID keys. Several matches → ask; none after a
   successful complete lookup → explain what was searched. Re-check saved ids by exact
   `item.id` equality, using search only if supported and paging as a fallback. Never replace an
   id with a name or treat 401/403/404, `PROVIDER_NOT_FOUND`, or another lookup failure as no items.

Example request object (use actual discovered keys and the provider's supported filter shape):

```json
{
  "providerKey": "<installed-provider-key>",
  "query": {
    "filter": { "<parent-filter-key>": ["<selected-parent-id>"] },
    "paging": { "limit": 25, "offset": 0 }
  }
}
```

Record `{providerKey, id, name, source}` so the user can review the selection. Do not depend on
internal provider fields such as `tagsOverrides`. Discovery describes available providers;
it does not create an entity or grant permission to access its items.

For a tag-based selector, List Installed Providers takes `{"tag": "<selector-tag>"}` (a query
parameter for REST GET); Query Items still needs one concrete returned `providerKey`. Query each
relevant provider with that same tag. Never substitute the tag into the `{providerKey}` path.

Cursor continuation request, after a filtered initial query returned a next cursor:

```json
{
  "providerKey": "<installed-provider-key>",
  "query": { "cursorPaging": { "limit": 25, "cursor": "<pagingMetadata.cursors.next>" } }
}
```

Keep the original selector `tag` if one was supplied. Do not mix offset and cursor pagination
or reuse a cursor across providers, sites or a changed parent selection.
