# Wix Data SDK Reference

## Installation

`@wix/data` must be a dependency before use: `npm install @wix/data`.

`Cannot find module '@wix/data'` means it is not installed. Install it — never mock it.

## SDK Methods & Interfaces

All of these come from `import { items } from '@wix/data'`.

| Method Call | TypeScript Signature | Description |
| --- | --- | --- |
| `items.get()` | `(collectionId: string, itemId: string, options?: WixDataGetOptions) => Promise<WixDataItem \| null>` | Get a single item by ID |
| `items.query()` | `(collectionId: string) => WixDataQuery` | Build a chainable query (call `.find()` to execute) |
| `items.insert()` | `(collectionId: string, item: Partial<WixDataItem>, options?: WixDataInsertOptions) => Promise<WixDataItem>` | Add a new item to a collection |
| `items.update()` | `(collectionId: string, item: WixDataItem, options?: WixDataUpdateOptions) => Promise<WixDataItem>` | Replace an existing item (item MUST include `_id`) |
| `items.save()` | `(collectionId: string, item: Partial<WixDataItem>, options?: WixDataSaveOptions) => Promise<WixDataItem>` | Insert or update (upsert) based on `_id` |
| `items.remove()` | `(collectionId: string, itemId: string, options?: WixDataRemoveOptions) => Promise<WixDataItem \| null>` | Remove an item by ID |
| `items.bulkInsert()` | `(collectionId: string, items: Partial<WixDataItem>[], options?: WixDataOptions) => Promise<WixDataBulkResult>` | Insert multiple items (max 1000) |
| `items.bulkUpdate()` | `(collectionId: string, items: WixDataItem[], options?: WixDataBulkUpdateOptions) => Promise<WixDataBulkResult>` | Update multiple items (max 1000) |
| `items.bulkRemove()` | `(collectionId: string, itemIds: string[], options?: WixDataBulkRemoveOptions) => Promise<WixDataBulkResult>` | Remove multiple items (max 1000) |
| `items.filter()` | `() => WixDataFilter` | Create a standalone filter (for use with `.or()`, `.and()`, `.not()`) |

## ⚠️ Common Wrong Method Names (DO NOT USE)

| ❌ WRONG (does not exist) | ✅ CORRECT |
| --- | --- |
| `items.queryDataItems()` | `items.query("Collection").find()` |
| `items.insertDataItem()` | `items.insert("Collection", data)` |
| `items.updateDataItem()` | `items.update("Collection", data)` |
| `items.removeDataItem()` | `items.remove("Collection", id)` |
| `items.getDataItem()` | `items.get("Collection", itemId)` |
| `items.bulkInsertDataItems()` | `items.bulkInsert("Collection", items)` |

If you see any method with `DataItem` in the name, it is **wrong**.

## Full Type Definitions

### WixDataItem

```ts
interface WixDataItem {
  _id: string;
  _createdDate?: Date;   // read-only, set by Wix on insert
  _updatedDate?: Date;   // read-only, set by Wix on insert/update
  _owner?: string;       // ID of the user who created the item
  [key: string]: any;    // custom fields from your collection schema
}
```

### WixDataResult (returned by `query().find()`)

```ts
interface WixDataResult {
  readonly items: WixDataItem[];
  readonly totalCount: number | undefined;  // both only when returnTotalCount: true
  readonly totalPages: number | undefined;
  readonly pageSize: number | undefined;
  readonly currentPage: number | undefined;
  readonly length: number;
  hasNext(): boolean;
  hasPrev(): boolean;
  next(): Promise<WixDataResult>;
  prev(): Promise<WixDataResult>;
}
```

### WixDataQuery (returned by `items.query()`)

Chainable. Build filters, then `.find()`, `.count()` or `.distinct()`.

```ts
interface WixDataQuery {
  // --- Filters ---
  eq(field: string, value: any): WixDataQuery;
  ne(field: string, value: any): WixDataQuery;
  gt(field: string, value: string | number | Date): WixDataQuery;
  ge(field: string, value: string | number | Date): WixDataQuery;
  lt(field: string, value: string | number | Date): WixDataQuery;
  le(field: string, value: string | number | Date): WixDataQuery;
  between(field: string, rangeStart: string | number | Date, rangeEnd: string | number | Date): WixDataQuery;
  contains(field: string, value: string): WixDataQuery;
  startsWith(field: string, value: string): WixDataQuery;
  endsWith(field: string, value: string): WixDataQuery;
  hasSome(field: string, values: string[] | number[] | Date[]): WixDataQuery;
  hasAll(field: string, values: string[] | number[] | Date[]): WixDataQuery;
  isEmpty(field: string): WixDataQuery;
  isNotEmpty(field: string): WixDataQuery;

  // --- Logical operators ---
  or(filter: WixDataFilter): WixDataQuery;
  and(filter: WixDataFilter): WixDataQuery;
  not(filter: WixDataFilter): WixDataQuery;

  // --- Sorting ---
  ascending(...fields: string[]): WixDataQuery;
  descending(...fields: string[]): WixDataQuery;

  // --- Pagination ---
  limit(limitNumber: number): WixDataQuery;   // default 50, max 1000
  skip(skipCount: number): WixDataQuery;

  // --- Projection ---
  fields(...fields: string[]): WixDataQuery;
  include(...fields: string[]): WixDataQuery; // include referenced items

  // --- Execute ---
  find(options?: WixDataQueryOptions): Promise<WixDataResult>;
  count(options?: WixDataReadOptions): Promise<number>;
  distinct(field: string, options?: WixDataQueryOptions): Promise<WixDataResult<any>>;
}
```

### Options Types

```ts
interface WixDataOptions {
  suppressHooks?: boolean;  // skip beforeX/afterX hooks
  showDrafts?: boolean;     // include draft items
  appOptions?: Record<string, any>;
}

interface WixDataReadOptions extends WixDataOptions {
  language?: string;        // IETF BCP 47 language tag
  consistentRead?: boolean; // read from primary DB (slower but up-to-date)
}

interface WixDataQueryOptions extends WixDataReadOptions {
  returnTotalCount?: boolean; // populate totalCount/totalPages in results
}

interface WixDataGetOptions extends WixDataReadOptions {
  fields?: string[];                              // fields to return
  includeReferences?: { field: string; limit?: number }[];
  includeFieldGroups?: string[];
}

// Insert/Save options add nothing to WixDataOptions.
// Update/Remove/BulkUpdate/BulkRemove options add an optional guard:
//   condition?: WixDataFilter  — only apply when the condition is met
```

### WixDataBulkResult (returned by bulk operations)

```ts
interface WixDataBulkResult {
  inserted: number;
  updated: number;
  removed: number;
  skipped: number;
  errors: WixDataBulkError[];
  insertedItemIds: string[];
  updatedItemIds: string[];
  removedItemIds: string[];
}

// WixDataBulkError extends Error with `code`, `originalIndex` (position in the
// request array) and `item` (the failed item or its id).
```

## Usage Examples

```typescript
import { items } from "@wix/data";

// --- Get by ID ---
const item = await items.get("MyCollection", "item-id-123");
// Returns WixDataItem | null

// --- Query with filters ---
const result = await items.query("MyCollection")
  .eq("status", "active")
  .gt("price", 10)
  .ascending("name")
  .limit(20)
  .find();
// result.items: WixDataItem[]

// --- Compound query with or/and ---
// `or()` COMBINES two filters; it is not a condition. Called on a query or
// filter that holds no condition yet, it contributes an empty `{}` branch, and
// `{} OR x` matches the whole collection. Seed with the first condition, `or()`
// the rest onto it, then `and()` the result onto the query.
const pendingOrActive = items.filter().eq("status", "pending")
  .or(items.filter().eq("status", "active"));
const result = await items.query("MyCollection").and(pendingOrActive).find();

// ❌ WRONG — or() onto a query holding no condition: matches every row
items.query("MyCollection").or(filter1).or(filter2);
// ❌ WRONG — or() onto the query itself: `country` is dropped from branch two
items.query("MyCollection").eq("country", "IL").contains("name", t).or(filter2);

// --- Insert ---
const created = await items.insert("MyCollection", {
  title: "New Item",
  price: 29.99,
});

// --- Update (MUST include _id) ---
await items.update("MyCollection", {
  _id: "item-id-123",
  title: "Updated Title",
  price: 39.99,
});

// ❌ WRONG — three args
await items.update("MyCollection", "item-id", { title: "x" });
// ✅ CORRECT — _id inside data object
await items.update("MyCollection", { _id: "item-id", title: "x" });

// --- Remove ---
await items.remove("MyCollection", "item-id-123");

// --- Bulk Insert ---
const bulkResult = await items.bulkInsert("MyCollection", [
  { title: "Item 1" },
  { title: "Item 2" },
]);
// bulkResult.inserted: 2, bulkResult.insertedItemIds: [...]
```

## Collection Schema Rules

Use the collection id, field keys and field types exactly as the schema defines them. Custom fields
live in the `[key: string]: any` part of `WixDataItem`.

## Permissions

| Operation | Required Scope |
| --- | --- |
| `get`, `query`, `count`, `distinct` | `SCOPE.DC-DATA.READ` |
| `insert`, `update`, `save`, `remove`, `bulkInsert`, `bulkUpdate`, `bulkRemove` | `SCOPE.DC-DATA.WRITE` |

### Elevating permissions (backend only)

In backend code (service plugins, events, backend APIs), wrap the `items` method with `auth.elevate` from `@wix/essentials` to run with elevated permissions:

```typescript
import { auth } from '@wix/essentials';
const elevatedQuery = auth.elevate(items.query);
const configResult = await elevatedQuery('MyCollection').find();
```

## Date/Time Handling

- **Date (date-only)**: Store as a string in "YYYY-MM-DD" format (as returned by `<input type="date" />`).
- **DateTime (date + time)**: Store as a Date object. Accept the YYYY-MM-DDTHH:mm format returned by `<input type="datetime-local" />` and convert to a Date object using `new Date()`.
- **Time (time-only)**: Store as a string in HH:mm or HH:mm:ss 24-hour format (as returned by `<input type="time" />`).
- Use native JavaScript Date methods for parsing, formatting, and manipulating dates/times (e.g., `new Date()`, `toISOString()`, `toLocaleString()`, `toLocaleDateString()`).
- Always validate incoming date/time values and provide graceful fallback or explicit error handling when values are invalid.
