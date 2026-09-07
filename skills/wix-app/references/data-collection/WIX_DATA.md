# Wix Data SDK Reference

Complete reference for working with Wix Data collections.

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

| Method Call | Import | TypeScript Signature | Description |
| --- | --- | --- | --- |
| `items.get()` | `import { items } from '@wix/data'` | `(collectionId: string, itemId: string, options?: WixDataGetOptions) => Promise<WixDataItem \| null>` | Get a single item by ID |
| `items.query()` | `import { items } from '@wix/data'` | `(collectionId: string) => WixDataQuery` | Build a chainable query (call `.find()` to execute) |
| `items.insert()` | `import { items } from '@wix/data'` | `(collectionId: string, item: Partial<WixDataItem>, options?: WixDataInsertOptions) => Promise<WixDataItem>` | Add a new item to a collection |
| `items.update()` | `import { items } from '@wix/data'` | `(collectionId: string, item: WixDataItem, options?: WixDataUpdateOptions) => Promise<WixDataItem>` | Replace an existing item (item MUST include `_id`) |
| `items.save()` | `import { items } from '@wix/data'` | `(collectionId: string, item: Partial<WixDataItem>, options?: WixDataSaveOptions) => Promise<WixDataItem>` | Insert or update (upsert) based on `_id` |
| `items.remove()` | `import { items } from '@wix/data'` | `(collectionId: string, itemId: string, options?: WixDataRemoveOptions) => Promise<WixDataItem \| null>` | Remove an item by ID |
| `items.bulkInsert()` | `import { items } from '@wix/data'` | `(collectionId: string, items: Partial<WixDataItem>[], options?: WixDataOptions) => Promise<WixDataBulkResult>` | Insert multiple items (max 1000) |
| `items.bulkUpdate()` | `import { items } from '@wix/data'` | `(collectionId: string, items: WixDataItem[], options?: WixDataBulkUpdateOptions) => Promise<WixDataBulkResult>` | Update multiple items (max 1000) |
| `items.bulkRemove()` | `import { items } from '@wix/data'` | `(collectionId: string, itemIds: string[], options?: WixDataBulkRemoveOptions) => Promise<WixDataBulkResult>` | Remove multiple items (max 1000) |
| `items.filter()` | `import { items } from '@wix/data'` | `() => WixDataFilter` | Create a standalone filter (for use with `.or()`, `.and()`, `.not()`) |

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

## Aggregation

**Never compute a headline number by fetching rows and reducing them client-side.**
`items.query().limit()` caps at 1000, so a `.reduce()` over the result silently reports the
total for the first 1000 records and gives no warning that it is wrong. A `SummaryBar` fed
that way is a metric that lies as soon as the collection grows — which is worse than
showing no metric. Use `items.aggregate`; the server does the arithmetic over every
matching row.

### The chainable form — what a `SummaryBar` needs

```ts
import { items } from '@wix/data';

const totals = await items
  .aggregate('employee-shifts')
  .filter(items.filter().eq('status', 'approved'))   // same predicate as the table
  .sum('hours', 'totalHours')
  .count('shiftCount')
  .run();

// `.run()` returns WixDataResult<Record<string, any>> — one row per group,
// and a single row when there is no `.group()`.
const row = totals.items[0] as { totalHours?: number; shiftCount?: number } | undefined;

const summary = [
  { title: 'Total hours', value: String(row?.totalHours ?? 0) },
  { title: 'Shifts', value: String(row?.shiftCount ?? 0) },
];
```

**Wire the aggregate to the same filters as the table.** A metric that disagrees with the
visible rows is the defect this section exists to prevent — pass the collection's current
filter state into `.filter()` and re-run the aggregate when it changes, exactly as
`fetchData` does.

### Grouping — a breakdown per value

```ts
const perEmployee = await items
  .aggregate('employee-shifts')
  .group('employeeName')
  .sum('hours', 'totalHours')
  .descending('totalHours')
  .limit(5)
  .run();

const top = perEmployee.items as { employeeName: string; totalHours: number }[];
```

### `WixDataAggregate` — the chainable surface

```ts
interface WixDataAggregate {
  // --- Grouping ---
  group(...fields: string[]): WixDataAggregate;   // omit entirely for a whole-collection total

  // --- Accumulators. `projectedField` names the output key; default is derived from the field ---
  sum(field: string, projectedField?: string): WixDataAggregate;
  avg(field: string, projectedField?: string): WixDataAggregate;
  min(field: string, projectedField?: string): WixDataAggregate;
  max(field: string, projectedField?: string): WixDataAggregate;
  count(projectedField?: string): WixDataAggregate;

  // --- Narrowing. `filter` runs before grouping, `having` after ---
  filter(filter: WixDataFilter): WixDataAggregate;
  having(filter: WixDataFilter): WixDataAggregate;

  // --- Sorting and paging over the groups ---
  ascending(...fields: string[]): WixDataAggregate;
  descending(...fields: string[]): WixDataAggregate;
  limit(limit: number): WixDataAggregate;
  skip(skip: number): WixDataAggregate;

  // --- Execute ---
  run(options?: WixDataAggregateOptions): Promise<WixDataResult<Record<string, any>>>;
}
```

`.run()` has no type parameter, so read its rows the same way you read a chainable
`.find()`: cast once, at the boundary.

### The object form, when you want the return type declared

`items.aggregate` also takes a REST-shaped pipeline and is generic in the result:

```ts
interface ShiftTotals {
  totalHours: number;
}

const res = await items.aggregate<ShiftTotals>('employee-shifts', {
  stages: [
    {
      group: {
        groupIds: [],                                     // [] = one group, the whole collection
        accumulators: [
          { resultFieldName: 'totalHours', sum: { expression: { fieldPath: 'hours' } } },
        ],
      },
    },
  ],
});

res.results[0];   // ShiftTotals | undefined  — note `results`, not `items`
```

Two things to know before reaching for it:

- **`Result` is an assertion, not a check.** TypeScript does not verify that the pipeline
  produces the shape you named, so a mismatch between `accumulators` and `Result` compiles
  clean and fails at runtime. The chainable form's cast is no less safe.
- **There is no `count` accumulator.** The object form offers only `avg`, `min`, `max`,
  `sum`, `first`, `last` and `push`; to count, sum a constant
  (`sum: { expression: { numeric: 1 } }`). The chainable `.count()` has no equivalent.

Prefer the chainable form. Reach for the object form only when you need a pipeline stage the
builder does not expose (`projection`, `unwindArray`, `objectToArray`, `cursorPaging`).

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
const filter1 = items.filter().eq("status", "pending");
const filter2 = items.filter().eq("status", "active");
const result = await items.query("MyCollection")
  .or(filter1)
  .or(filter2)
  .find();

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

- Always use the exact field keys defined in your collection schema
- Use the collection ID exactly as defined in the schema
- Use the schema's exact field types for all operations
- Custom fields are stored in the `[key: string]: any` part of `WixDataItem`

## Permissions

| Operation | Required Scope |
| --- | --- |
| `get`, `query`, `aggregate`, `count`, `distinct` | `SCOPE.DC-DATA.READ` |
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
