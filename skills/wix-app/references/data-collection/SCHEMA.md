# Data Collection Schema Reference

> Split out of [DATA_COLLECTION.md](../DATA_COLLECTION.md) so each file covers one job: that one is
> the workflow, this one is the field catalogue you consult while writing a collection's schema.

## Contents

- [Field Types](#field-types) — the full type list, and the `OBJECT` gotcha
- [Field Properties](#field-properties)
- [Indexes](#indexes) — the exact shape, which has no `name`
- [Naming Conventions](#naming-conventions)
- [System Fields (Automatic)](#system-fields-automatic)
- [Relationships](#relationships)
- [Examples](#examples) — full worked collection files

## Field Types

| Type              | Description                      | Use Case               |
| ----------------- | -------------------------------- | ---------------------- |
| `TEXT`            | Single-line text                 | Names, titles          |
| `RICH_TEXT`       | Formatted HTML text              | Blog content           |
| `RICH_CONTENT`    | Rich content with embedded media | Complex blog posts     |
| `NUMBER`          | Decimal numbers                  | Prices, quantities     |
| `BOOLEAN`         | True/false                       | Toggles, flags         |
| `DATE`            | Date only                        | Birthdays              |
| `DATETIME`        | Date with time                   | Timestamps             |
| `TIME`            | Time only                        | Schedules              |
| `IMAGE`           | Single image                     | Thumbnails             |
| `DOCUMENT`        | File attachment                  | PDFs                   |
| `VIDEO`           | Video file                       | Media                  |
| `AUDIO`           | Audio file                       | Podcasts               |
| `MEDIA_GALLERY`   | Multiple media                   | Galleries              |
| `REFERENCE`       | Link to one item                 | Author → User          |
| `MULTI_REFERENCE` | Link to many items               | Post → Tags            |
| `ADDRESS`         | Structured address               | Locations              |
| `URL`             | URL validation                   | Links                  |
| `PAGE_LINK`       | Link to Wix page                 | Internal navigation    |
| `LANGUAGE`        | Language code                    | Multi-language content |
| `OBJECT`          | JSON object                      | Flexible data          |
| `ARRAY`           | Array of values                  | Generic arrays         |
| `ARRAY_STRING`    | Array of strings                 | Tags list              |
| `ARRAY_DOCUMENT`  | Array of documents               | File collections       |
| `ANY`             | Any type                         | Most flexible          |

**CRITICAL: OBJECT fields require `objectOptions` with a `fields` array.** When using `type: "OBJECT"`, you MUST include `objectOptions: { fields: [] }` — the API will reject OBJECT fields without it. Use an empty `fields` array if you don't need a fixed schema (the object will still accept arbitrary JSON):

```json
{
  "key": "settings",
  "displayName": "Settings",
  "type": "OBJECT",
  "objectOptions": { "fields": [] }
}
```

> ⚠️ `objectOptions: {}` (without the `fields` key) is **not valid** and will cause a runtime error. Always include `fields`, even as an empty array.

For structured objects with a defined schema, list the nested fields inside `objectOptions.fields`:

```json
{
  "key": "triggerRules",
  "displayName": "Trigger Rules",
  "type": "OBJECT",
  "objectOptions": {
    "fields": [
      { "key": "url", "displayName": "URL Condition", "type": "TEXT" },
      {
        "key": "scrollDepth",
        "displayName": "Scroll Depth %",
        "type": "NUMBER"
      },
      { "key": "dateStart", "displayName": "Start Date", "type": "DATE" }
    ]
  }
}
```

## Field Properties

```ts
{
  key: 'email',                         // required, lowerCamelCase ASCII
  type: 'TEXT',                         // required, see Field Types above
  displayName: 'Email Address',         // optional, CMS label
  description: "User's primary email",  // optional, help text
  encrypted: false,                     // optional, encrypt value at rest
  // arrayOptions / objectOptions / referenceOptions / multiReferenceOptions
  // only when type is ARRAY / OBJECT / REFERENCE / MULTI_REFERENCE
}
```

| Property      | Required | Description                          |
| ------------- | -------- | ------------------------------------ |
| `key`         | yes      | Field identifier (lowerCamelCase)    |
| `type`        | yes      | Field data type (see Field Types)    |
| `displayName` | no       | Label shown in CMS                   |
| `description` | no       | Help text                            |
| `encrypted`   | no       | Encrypt value at rest                |

**There is no field-level `required`, `defaultValue`, or `unique`.** The `DevCenterDataCollectionField` type does not accept them and TypeScript will reject the build. Use these alternatives instead:

- **Required values:** Validate in the dashboard form and/or service-plugin handler before inserting. Do not rely on the collection schema to enforce presence.
- **Defaults:** Set defaults in the insert path (dashboard handler, service plugin) or via the collection's `initialData` for seeded rows.
- **Uniqueness:** Declare a unique index in the collection's `indexes` array (see [Indexes](#indexes)). Uniqueness is an index-level concern, not a field-level one.

## Indexes

An index is `{ fields: [{ path, order? }], unique? }` — and **nothing else**. There is no `name`:

```ts
indexes: [{ fields: [{ path: 'date', order: 'DESC' }], unique: false }]
```

`order` is `'ASC' | 'DESC'`. Read `DevCenterDataCollectionIndex` in the builders package if in doubt;
a stray key is a compile error on the `satisfies DataCollection` literal.


The `indexes` array on the collection accepts entries shaped like:

```ts
indexes: [
  {
    fields: [{ path: 'email', order: 'ASC' }],  // order is optional: 'ASC' | 'DESC'
    unique: true,                                // optional, enforces uniqueness across items
  },
  {
    fields: [
      { path: 'category' },
      { path: '_createdDate', order: 'DESC' },
    ],
  },
],
```

| Property        | Required | Description                                            |
| --------------- | -------- | ------------------------------------------------------ |
| `fields`        | yes      | One or more `{ path, order? }` entries (composite index when more than one) |
| `fields[].path` | yes      | Field key to index                                     |
| `fields[].order`| no       | `'ASC'` (default) or `'DESC'`                          |
| `unique`        | no       | Enforce uniqueness on the indexed field(s)             |

Leave `indexes: []` when no custom indexing is needed; the `_id` index is created automatically.

## Naming Conventions

- **Field keys:** `lowerCamelCase`, ASCII only (e.g., `productName`, `isActive`, `createdAt`)
- **Collection IDs (`idSuffix`):** `lower-kebab-case` or `lower_underscore` (e.g., `product-categories`, `blog_posts`)
- **Display names:** Human-readable, can contain spaces (e.g., `"Product Name"`, `"Is Active"`)

## System Fields (Automatic)

Every collection includes: `_id`, `_createdDate`, `_updatedDate`, `_owner`

## Relationships

**One-to-One / Many-to-One (REFERENCE):**

```json
{
  "key": "category",
  "displayName": "Category",
  "type": "REFERENCE",
  "referenceOptions": {
    "referencedCollectionId": "categories"
  }
}
```

**Many-to-Many (MULTI_REFERENCE):**

```json
{
  "key": "tags",
  "displayName": "Tags",
  "type": "MULTI_REFERENCE",
  "multiReferenceOptions": {
    "referencedCollectionId": "tags"
  }
}
```

**CRITICAL Constraints:**

- REFERENCE/MULTI_REFERENCE fields can ONLY link to other custom CMS collections defined in your app
- The `referencedCollectionId` MUST be the `idSuffix` of another collection in the same plan
- **NEVER use REFERENCE fields to link to Wix business entities** (Products, Orders, Contacts, Members, etc.)
- Use Wix SDK APIs to access Wix business entities instead

## Examples

### Simple Collection with Initial Data

**Request:** "Create a collection for handling fees with example data"

Scaffold:

```bash
wix generate --params '{"extensionType":"DATA_COLLECTION","collectionName":"additional-fees"}'
```

Edit the generated `src/extensions/backend/data-collections/additional-fees.ts`:

```typescript
import type { DataCollection } from '@wix/astro/builders';

export const collectionIdSuffix = 'additional-fees';

export default {
  idSuffix: collectionIdSuffix,
  displayName: 'Additional Fees',
  displayField: 'title',
  fields: [
    { key: 'title', displayName: 'Fee Title', type: 'TEXT' },
    { key: 'amount', displayName: 'Fee Amount', type: 'NUMBER' },
  ],
  dataPermissions: {
    itemRead: 'ANYONE',
    itemInsert: 'PRIVILEGED',
    itemUpdate: 'PRIVILEGED',
    itemRemove: 'PRIVILEGED',
  },
  indexes: [],
  initialData: [
    { title: 'Handling Fee', amount: 5 },
    { title: 'Gift Wrapping', amount: 3.5 },
  ],
} satisfies DataCollection;
```

### Collection with Reference Relationship

**Request:** "Create collections for products and categories with relationships"

Run `wix generate --params` twice — once with `collectionName: "categories"` and once with `collectionName: "products"`. Then edit `src/extensions/backend/data-collections/products.ts` to add a `REFERENCE` field pointing at `categories` (`referenceOptions: { referencedCollectionId: "categories" }`). The aggregator `data-collections.extension.ts` is updated by the CLI automatically.
