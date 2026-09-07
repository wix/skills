# Wix Data SDK Reference

Reference for the Wix Data methods a dashboard app needs. `items` exposes roughly 34
methods; the ones below are the ones you will use. **A method's absence from this file
is not evidence it does not exist** — notably `aggregate`, `count`, `distinct`, `search`,
`patch`, `bulkPatch`, `truncate`, the reference APIs and the `onDataItem*` events are all
real. For one of those, `Read` the single file that declares the whole `items` surface:
`@wix/wix-data-items-sdk/build/es/src/data-v2-data-item-items.public.d.ts`.

## Installation

**IMPORTANT**: The `@wix/data` package must be installed as a dependency before use.

```bash
npm install @wix/data
```

### Troubleshooting

**If you encounter: `Cannot find module '@wix/data'`**

❌ **WRONG**: Do not create mock implementations or workarounds
✅ **CORRECT**: Install the package using `npm install @wix/data`

The `@wix/data` package is a real npm package that provides access to Wix Data collections.
It must be installed before TypeScript compilation will succeed.

## SDK Methods & Interfaces

**Every row below is generic.** The `Item` type parameter is what makes a result narrow to
your own interface instead of collapsing to `WixDataItem`, whose `[key: string]: any` index
signature means a wrong field name is silently `any` rather than a compile error. Pass it.
A plain `interface` satisfies the `Record<string, any>` constraint — no index signature needed
on your own type.

| Method Call | Import | TypeScript Signature | Description |
| --- | --- | --- | --- |
| `items.get()` | `import { items } from '@wix/data'` | `<Item extends Record<string, any> = WixDataItem>(collectionId: string, itemId: string, options?: WixDataGetOptions) => Promise<(Item & WixDataItem) \| null>` | Get a single item by ID |
| `items.query()` — chainable | `import { items } from '@wix/data'` | `(collectionId: string) => WixDataQuery` | Build a chainable query (call `.find()` to execute). **Not generic** — see below |
| `items.query()` — object form | `import { items } from '@wix/data'` | `<Item extends Record<string, any> = WixDataItem>(collectionId: string, queryRequest: WixDataQueryRequest, options?: WixDataQueryOptions) => Promise<WixDataQueryResponse<Item & WixDataItem>>` | **The only typed list path.** Returns `{ items, pagingMetadata }` |
| `items.insert()` | `import { items } from '@wix/data'` | `<Item extends Record<string, any>>(collectionId: string, item: Item, options?: WixDataInsertOptions) => Promise<Item & WixDataItem>` | Add a new item to a collection |
| `items.update()` | `import { items } from '@wix/data'` | `<Item extends WithId>(collectionId: string, item: Item, options?: WixDataUpdateOptions) => Promise<Item & WixDataItem>` | Replace an existing item (item MUST include `_id`) |
| `items.save()` | `import { items } from '@wix/data'` | `<Item extends Record<string, any>>(collectionId: string, item: Item, options?: WixDataSaveOptions) => Promise<Item & WixDataItem>` | Insert or update (upsert) based on `_id` |
| `items.remove()` | `import { items } from '@wix/data'` | `<Item extends Record<string, any> = WixDataItem>(collectionId: string, itemId: string, options?: WixDataRemoveOptions) => Promise<(Item & WixDataItem) \| null>` | Remove an item by ID |
| `items.bulkInsert()` | `import { items } from '@wix/data'` | `<Item extends Record<string, any>>(collectionId: string, items: Item[], options?: WixDataBulkInsertOptions) => Promise<WixDataBulkResult>` | Insert multiple items (max 1000) |
| `items.bulkUpdate()` | `import { items } from '@wix/data'` | `<Item extends WithId>(collectionId: string, items: Item[], options?: WixDataBulkUpdateOptions) => Promise<WixDataBulkResult>` | Update multiple items (max 1000) |
| `items.bulkSave()` | `import { items } from '@wix/data'` | `<Item extends Record<string, any>>(collectionId: string, items: Item[], options?: WixDataBulkSaveOptions) => Promise<WixDataBulkResult>` | Upsert multiple items (max 1000) |
| `items.bulkRemove()` | `import { items } from '@wix/data'` | `(collectionId: string, itemIds: string[], options?: WixDataBulkRemoveOptions) => Promise<WixDataBulkResult>` | Remove multiple items (max 1000). Not generic — takes IDs |
| `items.filter()` | `import { items } from '@wix/data'` | `() => WixDataFilter` | Create a standalone filter (for use with `.or()`, `.and()`, `.not()`) |

`search`, `patch` and `bulkPatch` follow the same two-form shape as `query`: a chainable
builder from the one-argument call, and a generic `<Item>` promise from the object form.

### Typing a list: which `query` to call

```ts
interface Shift {
  employeeName: string;
  date: Date;
  hours: number;
  status: string;
}

// ✅ Object form — typed end to end, no cast.
const res = await items.query<Shift>('employee-shifts', {
  filter: { status: 'approved' },
  sort: [{ fieldName: 'date', order: 'DESC' }],
  paging: { limit: 50, offset: 0 },
});
res.items;                   // (Shift & WixDataItem)[]
res.pagingMetadata.total;    // number | undefined
```

**The chainable branch is untyped by design.** `WixDataQuery.find()` returns
`Promise<WixDataResult>` with no type parameter anywhere on the builder, so there is no
generic to pass and no way to make it narrow. Reach for it when you need the fluent filter
operators (`.contains()`, `.hasSome()`, `.between()`, `.or()`), and cast once at the
boundary — that cast is correct, not a workaround:

```ts
const result = await items
  .query('employee-shifts')
  .eq('status', 'approved')
  .descending('date')
  .limit(50)
  .find({ returnTotalCount: true });

const rows = result.items as (Shift & WixDataItem)[];   // the one sanctioned cast
const total = result.totalCount;                        // undefined unless returnTotalCount
const more = result.hasNext();                          // a method, not a property
```

Do not cast in the object form — there is nothing to cast, and a cast there hides a real
mismatch.

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

**`WixDataItem` is not importable from `@wix/data`'s root** — it lives on the `items`
namespace. Reference it as `items.WixDataItem`, e.g.
`type ShiftRecord = Shift & items.WixDataItem;`.

That `[key: string]: any` is why the `Item` generic matters: on a bare `WixDataItem`, a
misspelled field resolves to `any` with no error and no signal. Intersecting your own
`interface` in — which every generic method above does for you — restores the check.

### WixDataResult (returned by `query().find()`)

```ts
interface WixDataResult {
  readonly items: WixDataItem[];
  readonly totalCount: number | undefined;  // only when returnTotalCount: true
  readonly totalPages: number | undefined;  // only when returnTotalCount: true
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

Chainable query builder. Build filters, then call `.find()`, `.count()`, or `.distinct()`.

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

interface WixDataInsertOptions extends WixDataOptions {}

interface WixDataUpdateOptions extends WixDataOptions {
  condition?: WixDataFilter; // only update if condition is met
}

interface WixDataSaveOptions extends WixDataOptions {}

interface WixDataRemoveOptions extends WixDataOptions {
  condition?: WixDataFilter; // only remove if condition is met
}

interface WixDataBulkUpdateOptions extends WixDataOptions {
  condition?: WixDataFilter;
}

interface WixDataBulkRemoveOptions extends WixDataOptions {
  condition?: WixDataFilter;
}
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

interface WixDataBulkError extends Error {
  message: string;
  code: string;
  originalIndex: number;      // index in the request array
  item: WixDataItem | string; // the failed item or ID
}
```

## Usage Examples

```typescript
import { items } from "@wix/data";

interface Shift {
  employeeName: string;
  date: Date;
  hours: number;
  status: string;
}

// --- Get by ID ---
const shift = await items.get<Shift>("employee-shifts", "item-id-123");
// shift: (Shift & WixDataItem) | null  — shift.hours is number, not any

// --- Typed list (object form) ---
const page = await items.query<Shift>("employee-shifts", {
  filter: { status: "active" },
  sort: [{ fieldName: "date", order: "DESC" }],
  paging: { limit: 20, offset: 0 },
});
// page.items: (Shift & WixDataItem)[]; page.pagingMetadata.total: number | undefined

// --- Chainable query, for the fluent filter operators ---
const result = await items.query("employee-shifts")
  .eq("status", "active")
  .gt("hours", 4)
  .ascending("employeeName")
  .limit(20)
  .find();
const rows = result.items as (Shift & WixDataItem)[];   // no generic exists here — cast once

// --- Compound query with or/and ---
const filter1 = items.filter().eq("status", "pending");
const filter2 = items.filter().eq("status", "active");
const pending = await items.query("employee-shifts")
  .or(filter1)
  .or(filter2)
  .find();

// --- Insert (Item is inferred from the argument; annotate to enforce the schema) ---
const created = await items.insert<Shift>("employee-shifts", {
  employeeName: "Ada",
  date: new Date(),
  hours: 8,
  status: "active",
});
// created: Shift & WixDataItem  — created._id is string

// --- Update (MUST include _id) ---
await items.update<Shift & { _id: string }>("employee-shifts", {
  _id: "item-id-123",
  employeeName: "Ada",
  date: new Date(),
  hours: 9,
  status: "active",
});

// ❌ WRONG — three args
await items.update("employee-shifts", "item-id", { hours: 9 });
// ✅ CORRECT — _id inside data object
await items.update("employee-shifts", { _id: "item-id", hours: 9 });

// --- Remove ---
await items.remove<Shift>("employee-shifts", "item-id-123");

// --- Bulk Insert ---
const bulkResult = await items.bulkInsert<Shift>("employee-shifts", [
  { employeeName: "Ada", date: new Date(), hours: 8, status: "active" },
  { employeeName: "Grace", date: new Date(), hours: 6, status: "active" },
]);
// bulkResult.inserted: 2, bulkResult.insertedItemIds: [...]
```

## Collection Schema Rules

- Always use the exact field keys defined in your collection schema
- Use the collection ID exactly as defined in the schema
- Use the schema's exact field types for all operations
- Custom fields are stored in the `[key: string]: any` part of `WixDataItem`

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
