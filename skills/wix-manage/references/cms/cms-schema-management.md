---
name: "CMS Schema Management"
description: Create and modify CMS collection structures identified by ID or display name. Covers listing collections, creating collections with fields, adding/removing fields, and updating collection settings.
---
# CMS Schema Management

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

This recipe covers managing the structure (schema) of Wix CMS collections using the REST API.

## Prerequisites

1. Wix CMS application installed on the site (appDefId: `e593b0bd-b783-45b8-97c2-873d42aacaf4`)
2. API access with CMS permissions (Manage Data Collections scope)

## Required APIs

- **Collections API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/introduction)

## Resolve an Existing Collection

For schema changes or collection deletion, resolve the target before any mutation:

1. For a supplied collection ID, use the Get Collection Schema call below. Read
   `collection.id` from the response; a different `collection.displayName` is not a mismatch.
2. For a supplied display name, or an ID lookup that specifically reports a missing collection,
   list collections. Compare the supplied text to `id` first. Only when no exact ID matches,
   accept a unique exact `displayName` match across the complete listing.
3. For zero or multiple exact matches, show candidate IDs and names and ask which collection
   the user means. Do not normalize spaces/case or fuzzy-match a target for a write or delete.
   Resolve permission, authentication, or transient failures instead of treating them as absence.
4. Carry the resolved ID into every `dataCollectionId` or collection path below. Reuse the
   returned schema when present; otherwise retrieve it by ID before modifying fields/settings.
   Show the resolved ID and display name when requesting any required mutation confirmation.

For example, `{ "id": "OrdersArchive", "displayName": "Archived Orders" }` resolves a request
for `OrdersArchive` immediately by ID. It also resolves `Archived Orders` by display name
only if no ID matches that text and exactly one collection has that display name.

## List All Collections

**Lightweight listing (for display-name lookup or browsing)**:
```bash
curl -X GET \
'https://www.wixapis.com/wix-data/v2/collections?fields=id&fields=displayName&paging.limit=100&paging.offset=0' \
-H 'Authorization: <AUTH>'
```

Read `collections[].id` and `collections[].displayName`. Advance `paging.offset` by the
number of collections returned until the listing is complete (using `pagingMetadata`);
do not infer a unique display-name match from one page. An exact ID match can resolve immediately.
See [List Data Collections](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/list-data-collections).

**Full listing (includes all field schemas)**:
```bash
curl -X GET \
'https://www.wixapis.com/wix-data/v2/collections' \
-H 'Authorization: <AUTH>'
```

**Collection Types**: `NATIVE` (user-created), `WIX_APP` (Wix app collections), `BLOCKS_APP`, `EXTERNAL`

## Get Collection Schema

**Endpoint**: `GET /wix-data/v2/collections/{collectionId}`

```bash
curl -X GET \
'https://www.wixapis.com/wix-data/v2/collections/Products' \
-H 'Authorization: <AUTH>'
```

The response's `collection` contains `id`, `displayName`, `fields`, `plugins`, and `revision`.
Keep the fields/plugins needed by the next operation. See
[Get Data Collection](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/get-data-collection).

## Create a New Collection

**Endpoint**: `POST /wix-data/v2/collections`

```json
{
  "collection": {
    "id": "Products",
    "displayName": "Products",
    "fields": [
      {"key": "title", "displayName": "Title", "type": "TEXT", "required": true},
      {"key": "price", "displayName": "Price", "type": "NUMBER"},
      {"key": "description", "displayName": "Description", "type": "TEXT"},
      {"key": "inStock", "displayName": "In Stock", "type": "BOOLEAN"}
    ],
    "permissions": {
      "insert": "ADMIN",
      "update": "ADMIN",
      "remove": "ADMIN",
      "read": "ANYONE"
    }
  }
}
```

## Add a Field to Existing Collection

**Endpoint**: `POST /wix-data/v2/collections/create-field`

```json
{
  "dataCollectionId": "Products",
  "field": {
    "key": "sku",
    "displayName": "SKU",
    "type": "TEXT",
    "description": "Product SKU code"
  }
}
```

## Delete a Field from Collection

> **Warning**: This permanently deletes all data stored in this field across all items.

**Endpoint**: `POST /wix-data/v2/collections/delete-field`

```json
{
  "dataCollectionId": "Products",
  "fieldKey": "sku"
}
```

## Update Collection Settings

**Endpoint**: `PATCH /wix-data/v2/collections/{collectionId}`

```json
{
  "dataCollection": {
    "id": "Products",
    "displayName": "Product Catalog"
  }
}
```

This works for `displayName`/`displayField`. **Permission updates currently fail with `WDE0075: Not recognized role provided in permissions.`** Use the full-replace endpoint below to update a collection's permissions.

**To change permissions on an existing collection, use the full-replace endpoint instead** (`UpdateDataCollection`, not `PatchDataCollection`) — it requires the collection's current `revision` and full `fields` array (get both from a `GET` first), but it does work:

**Endpoint**: `PUT /wix-data/v2/collections`

```json
{
  "collection": {
    "id": "Products",
    "revision": "3",
    "displayName": "Product Catalog",
    "fields": [ /* the collection's full current non-system fields, from GET */ ],
    "permissions": {
      "insert": "ADMIN",
      "update": "ADMIN",
      "remove": "ADMIN",
      "read": "SITE_MEMBER"
    }
  }
}
```

Don't delete and recreate a collection just to change its permissions — this full-replace call is the working path.

## Field Types Reference

| Type | Description | Example Value |
|------|-------------|---------------|
| `TEXT` | String | `"Hello World"` |
| `NUMBER` | Numeric | `99.99` |
| `BOOLEAN` | True/false | `true` |
| `DATE` | Date only | `"2024-01-15"` |
| `DATETIME` | Date and time | `{ "$date": "2024-01-15T10:00:00.000Z" }` |
| `IMAGE` | Image reference | `"wix:image://v1/..."` |
| `MEDIA_IMAGE` | Wix Media Image | `{ "id": "<mediaId>", "url": "http://...", "height": 640, "width": 480, "altText": "Picture" }` |
| `MEDIA_VECTOR_ART` | Wix Media Vector Art | `{ "uri": "wix:vector://v1/...", "viewBox": "0 0 100 100", "contentType": "shape", "svgContent": "<svg>...</svg>" }` |
| `URL` | Web URL | `"https://example.com"` |
| `RICH_TEXT` | HTML content | `"<p>Rich text</p>"` |
| `ARRAY_STRING` | Array of strings | `["tag1", "tag2"]` |
| `OBJECT` | JSON object | `{"key": "value"}` |
| `REFERENCE` | Single reference | Item ID string |
| `MULTI_REFERENCE` | Multiple references | Array of IDs |

## Permission Levels

| Role | Description |
|------|-------------|
| `ANYONE` | All visitors (including anonymous) |
| `SITE_MEMBER` | Logged-in site members |
| `SITE_MEMBER_AUTHOR` | Members who created the item |
| `PRIVILEGED` | Access to collection is controlled per role |
| `ADMIN` | Site admins only |

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `WDE0110` | Wix CMS (Wix Data) app is not installed on the site | Install it: `POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install` with body `{"tenant":{"tenantType":"SITE","id":"<SITE_ID>"},"appInstance":{"appDefId":"e593b0bd-b783-45b8-97c2-873d42aacaf4"}}`, then retry. See the [Install Wix Apps recipe](../app-installation/install-wix-apps.md). |

## Related Documentation

- [Data Collections API Reference](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/introduction)
- [Data Types in Wix Data](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-types-in-wix-data)
- [CMS Data Items CRUD Recipe](cms-data-items-crud.md)
