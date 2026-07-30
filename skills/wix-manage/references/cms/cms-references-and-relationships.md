---
name: "CMS References And Relationships"
description: "Link CMS collections together. Defines REFERENCE and MULTI_REFERENCE fields on an existing collection with create-field: the target collection goes in typeMetadata.reference.referencedCollectionId (or typeMetadata.multiReference.referencedCollectionId), never on the field object itself, or the call fails with WDE0075. Then add, replace, or remove items from MULTI_REFERENCE fields using insert-references, replace-references, remove-references endpoints - these CANNOT be set via regular insert/update/patch operations. Also covers querying with expanded references."
---
# CMS References & Relationships

> **Standard call shape (every curl below).** The `<AUTH>` placeholder is shorthand for `Authorization: Bearer <TOKEN>` only. Body-bearing requests also need `Content-Type: application/json`.

This recipe covers linking CMS collections together using reference fields.

## Prerequisites

1. Wix CMS enabled on the site
2. At least two collections to link together
3. API access with CMS permissions

## Required APIs

- **Collections API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/introduction)
- **Data Items API**: [REST](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/introduction)

## Reference Types

| Type | Field Type | Relationship | Example |
|------|------------|--------------|---------|
| Single Reference | `REFERENCE` | One-to-one, Many-to-one | Product → Category |
| Multi-Reference | `MULTI_REFERENCE` | One-to-many, Many-to-many | Product → Tags |

## Defining a Reference Field: `typeMetadata` Is Required

Use this recipe whenever a request is to link one collection to another — "add a reference field",
"make each book point at an author", "let a product have many tags". Defining the field comes
first; the item-level reference operations further down only work once the field exists.

Both reference types are declared with `POST /wix-data/v2/collections/create-field`, and both carry
the target collection **inside `field.typeMetadata`**. There is no top-level
`field.referencedCollection` or `field.referencedCollectionId`; a request that puts the target
collection on `field` directly is rejected with
`WDE0075: Metadata for Reference type field not provided.`

`referencedCollectionId` is the referenced *collection's* id (for example `Categories`), not an
item id. The same `field` object shape applies to `update-field` and to entries in the
`collection.fields` array of a create-collection call.

## Add a Single Reference Field

**Endpoint**: `POST /wix-data/v2/collections/create-field`

```bash
curl -X POST \
'https://www.wixapis.com/wix-data/v2/collections/create-field' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "dataCollectionId": "Products",
  "field": {
    "key": "category",
    "displayName": "Category",
    "type": "REFERENCE",
    "typeMetadata": {
      "reference": {
        "referencedCollectionId": "Categories"
      }
    }
  }
}'
```

## Add a Multi-Reference Field

**Endpoint**: `POST /wix-data/v2/collections/create-field`

```bash
curl -X POST \
'https://www.wixapis.com/wix-data/v2/collections/create-field' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "dataCollectionId": "Products",
  "field": {
    "key": "tags",
    "displayName": "Tags",
    "type": "MULTI_REFERENCE",
    "typeMetadata": {
      "multiReference": {
        "referencedCollectionId": "Tags",
        "referencingFieldKey": "products",
        "referencingDisplayName": "Products"
      }
    }
  }
}'
```

## Insert Multi-Reference Links

**Endpoint**: `POST /wix-data/v2/bulk/items/insert-references`

```json
{
  "dataCollectionId": "Products",
  "dataItemReferences": [
    {
      "referringItemId": "product-item-id",
      "referringItemFieldName": "tags",
      "referencedItemId": "tag-1-item-id"
    },
    {
      "referringItemId": "product-item-id",
      "referringItemFieldName": "tags",
      "referencedItemId": "tag-2-item-id"
    }
  ],
  "returnEntity": true
}
```

## Replace All References

**Endpoint**: `POST /wix-data/v2/items/replace-references`

```json
{
  "dataCollectionId": "Products",
  "referringItemId": "product-item-id",
  "referringItemFieldName": "tags",
  "newReferencedItemIds": ["new-tag-1-id", "new-tag-2-id", "new-tag-3-id"]
}
```

> **Note**: To remove all references, pass an empty array for `newReferencedItemIds`.

## Remove References (Bulk)

**Endpoint**: `POST /wix-data/v2/bulk/items/remove-references`

```json
{
  "dataCollectionId": "Products",
  "dataItemReferences": [
    {
      "referringItemId": "product-id-1",
      "referringItemFieldName": "tags",
      "referencedItemId": "tag-to-remove-id"
    }
  ]
}
```

## Query with Referenced Items Expanded

**Endpoint**: `POST /wix-data/v2/items/query`

```json
{
  "dataCollectionId": "Products",
  "query": {
    "filter": {
      "inStock": true
    }
  },
  "includeReferencedItems": ["category", "tags"]
}
```

## Reference Query Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `$eq` | Exact match (single reference) | `{ "category": "id" }` |
| `$hasSome` | Has at least one of | `{ "tags": { "$hasSome": ["id1", "id2"] } }` |
| `$hasAll` | Has all of | `{ "tags": { "$hasAll": ["id1", "id2"] } }` |

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `WDE0075: Metadata for Reference type field not provided.` | A `REFERENCE` or `MULTI_REFERENCE` field was sent without `typeMetadata`, or with the target collection on `field` instead of inside `typeMetadata` | Move the target collection to `field.typeMetadata.reference.referencedCollectionId` (or `field.typeMetadata.multiReference.referencedCollectionId`) and resend. |
| `WDE0110` | Wix CMS (Wix Data) app is not installed on the site | Install it, then retry — see the [CMS Schema Management recipe](cms-schema-management.md). |

## Related Documentation

- [Data Items API Reference](https://dev.wix.com/docs/api-reference/business-solutions/cms/data-items/introduction)
- [Collections API Reference](https://dev.wix.com/docs/api-reference/business-solutions/cms/collection-management/data-collections/introduction)
- [CMS Schema Management Recipe](cms-schema-management.md)
