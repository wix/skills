---
name: "CMS Schema Management"
description: Create and modify CMS collection structures. Covers listing collections, creating collections with fields, adding/removing fields — including REFERENCE and MULTI_REFERENCE fields, whose definitions require typeMetadata.reference.referencedCollectionId or typeMetadata.multiReference.referencedCollectionId — and updating collection settings.
---
# CMS Schema Management

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

This recipe covers managing the structure (schema) of Wix CMS collections using the REST API.

## Prerequisites

1. Wix CMS application installed on the site (appDefId: `e593b0bd-b783-45b8-97c2-873d42aacaf4`)
2. API access with CMS permissions (Manage Data Collections scope)

## Required APIs

- **Collections API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/introduction)

## List All Collections

**Lightweight listing (recommended for existence checks)**:
```bash
curl -X GET \
'https://www.wixapis.com/wix-data/v2/collections?fields=displayName' \
-H 'Authorization: <AUTH>'
```

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

Entries in `collection.fields` use the same `field` shape as `create-field`, so a `REFERENCE` or
`MULTI_REFERENCE` field declared here needs the `typeMetadata` block described in
[Reference Fields: `typeMetadata` Is Required](#reference-fields-typemetadata-is-required).

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

### Reference Fields: `typeMetadata` Is Required

`REFERENCE` and `MULTI_REFERENCE` fields carry the target collection in
`field.typeMetadata`, **not** on `field` itself. There is no top-level
`field.referencedCollection` or `field.referencedCollectionId`; a request that puts the target
collection there is rejected with `WDE0075: Metadata for Reference type field not provided.`
Use the shapes below verbatim — the same `field` object works in `create-field`, `update-field`,
and the `collection.fields` array of a create-collection call.

**Single reference** (`REFERENCE`) — each item links to one item in the other collection:

```json
{
  "dataCollectionId": "Books",
  "field": {
    "key": "author",
    "displayName": "Author",
    "type": "REFERENCE",
    "typeMetadata": {
      "reference": {
        "referencedCollectionId": "Authors"
      }
    }
  }
}
```

**Multi-reference** (`MULTI_REFERENCE`) — each item links to many items, and the referenced
collection gets a back-reference field described by `referencingFieldKey` /
`referencingDisplayName`:

```json
{
  "dataCollectionId": "Books",
  "field": {
    "key": "genres",
    "displayName": "Genres",
    "type": "MULTI_REFERENCE",
    "typeMetadata": {
      "multiReference": {
        "referencedCollectionId": "Genres",
        "referencingFieldKey": "books",
        "referencingDisplayName": "Books"
      }
    }
  }
}
```

`referencedCollectionId` is the referenced collection's id (for example `Authors`), not an item id.

For managing the reference *values* on items once the field exists — `insert-references`,
`replace-references`, `remove-references`, and querying with `includeReferencedItems` — see the
[CMS References & Relationships recipe](cms-references-and-relationships.md).

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

## Field Types Reference

| Type | Description | Example Value |
|------|-------------|---------------|
| `TEXT` | String | `"Hello World"` |
| `NUMBER` | Numeric | `99.99` |
| `BOOLEAN` | True/false | `true` |
| `DATE` | Date only | `"2024-01-15"` |
| `DATETIME` | Date and time | `{ "$date": "2024-01-15T10:00:00.000Z" }` |
| `IMAGE` | Image reference | `"wix:image://v1/..."` |
| `MEDIA_IMAGE` | Wix Media Image | `{ "url": "http://...", "height": 640, "width": 480, "alt": "Picture" }` |
| `MEDIA_VECTOR_ART` | Wix Media Vector Art | `{ "uri": "wix:vector://v1/...", "viewBox": "0 0 100 100", "contentType": "shape", "svgContent": "<svg>...</svg>" }` |
| `URL` | Web URL | `"https://example.com"` |
| `RICH_TEXT` | HTML content | `"<p>Rich text</p>"` |
| `ARRAY_STRING` | Array of strings | `["tag1", "tag2"]` |
| `OBJECT` | JSON object | `{"key": "value"}` |
| `REFERENCE` | Single reference — field definition requires `typeMetadata.reference.referencedCollectionId` | Item ID string |
| `MULTI_REFERENCE` | Multiple references — field definition requires `typeMetadata.multiReference.referencedCollectionId` | Array of IDs |

> The "Example Value" column is the value stored on an **item**. Defining a `REFERENCE` or
> `MULTI_REFERENCE` **field** additionally requires the `typeMetadata` block shown in
> [Reference Fields: `typeMetadata` Is Required](#reference-fields-typemetadata-is-required).

## Permission Levels

| Role | Description |
|------|-------------|
| `ANYONE` | All visitors (including anonymous) |
| `SITE_MEMBER` | Logged-in site members |
| `SITE_MEMBER_AUTHOR` | Members who created the item |
| `ADMIN` | Site admins only |

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `WDE0075: Metadata for Reference type field not provided.` | A `REFERENCE` or `MULTI_REFERENCE` field was sent without `typeMetadata`, or with the target collection on `field` instead of inside `typeMetadata` | Move the target collection to `field.typeMetadata.reference.referencedCollectionId` (or `field.typeMetadata.multiReference.referencedCollectionId`) and resend. See [Reference Fields: `typeMetadata` Is Required](#reference-fields-typemetadata-is-required). |
| `WDE0110` | Wix CMS (Wix Data) app is not installed on the site | Install it: `POST https://www.wixapis.com/apps-installer-service/v1/app-instance/install` with body `{"tenant":{"tenantType":"SITE","id":"<SITE_ID>"},"appInstance":{"appDefId":"e593b0bd-b783-45b8-97c2-873d42aacaf4"}}`, then retry. See the [Install Wix Apps recipe](../app-installation/install-wix-apps.md). |

## Related Documentation

- [Data Collections API Reference](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/introduction)
- [Data Types in Wix Data](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-types-in-wix-data)
- [CMS Data Items CRUD Recipe](cms-data-items-crud.md)
