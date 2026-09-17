# Data Collection — declaring the schema

> Split out of [DATA_COLLECTION.md](../DATA_COLLECTION.md), which owns scaffolding, the file shape
> and the CLI constraints. This file is the `fields` and `indexes` you write inside it.

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

**Most collections need no index at all — ship `indexes: []` unless you can name the query that
needs one.** `_id` and `_createdDate` are indexed automatically, and the budget is small: **3 regular
indexes, 1 unique, 4 total** (the collection reports its own `capabilities.indexLimits`). "Index the
field the table sorts by" is not a reason — it spends a slot for a page that would page fine without
it.

When you do add one, it is `{ fields: [{ path, order? }], unique? }` — and **nothing else**. In
particular there is **no `name`**: the runtime Create Index API takes one, but the extension builder
does not and the platform derives it (a `date` DESC index arrives as `date_DESC`). Read
`DevCenterDataCollectionIndex` in the builders package if in doubt; a stray key is a compile error on
the `satisfies DataCollection` literal.

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
