# Reading the state object `useTableCollection` hands you

> **Scope.** The [Component Docs Gate](../../SKILL.md) covers component *names and props*. This file
> covers the *state object you receive* — the thing the docs deliberately don't expand. Every member
> below was read from `dist/dts-bundle/types/TableState.d.ts` in the installed package.

## Why guessing here always fails

`useTableCollection()` returns a `TableState`. Its members are real and typed — the reason to read
this file rather than infer them is that the names are unobvious and several plausible ones don't
exist at all (see [Three that bite in practice](#three-that-bite-in-practice)).

**One thing not to conclude from the docs bundle.** `dist/dts-bundle/` publishes `CollectionState`
as a stub:

```ts
declare class CollectionState<T = any, F = any> { [key: string]: unknown }
```

That is a documentation abridgement, not the declaration your code compiles against. `tsc` resolves
`dist/types/index.d.ts`, which re-exports the **fully typed** `CollectionState` from
`@wix/bex-core` — no index signature. So `state.collection.…` is properly typed, a wrong member is a
compile error at the access, and reading `state.collection.status.status` to debug a stuck table is
sound. See [the bundle is a documentation projection](PATTERNS_BUNDLE_READING.md#what-the-bundle-leaves-out).

Prefer a typed member on `TableState` itself anyway — it is the object the hook hands you, and the
table's own view of the collection.

## The members you actually need

| You want | Use | Notes |
| --- | --- | --- |
| The loaded rows | `state.keyedItems` | `KeyedItem<T>[]` — `.map((k) => k.item)` for the items |
| Rows paged in so far | `state.keyedItems.length` | What the table currently renders — **not** the result size |
| Rows matching the filters | `state.collection.total` | Getter; in cursor mode it is what `fetchTotal` returned |
| Is the query failing | `state.showErrorState` | Boolean; pairs with `state.errorStatus` |
| Retry after a failure | `state.retryErrorState()` | Method, not a property |
| Nothing matched / nothing exists | `state.showEmptyState`, `state.hasAvailableItems` | Drives which placeholder to show |
| Sort a column | `state.sort(columnId, { forceDirection })` | |
| The visible columns | `state.visibleColumns` | |
| The toolbar (filters live here) | `state.toolbar` | **Not** `state.filters` — that does not exist |

## Three that bite in practice

**`state.filters` does not exist.** Filter state lives on the filter objects you created with
`stringsArrayFilter()` / `dateRangeFilter()` and passed into `filters`. Keep those in module-level
consts and reference the const in both the hook config and the JSX — that is also what
`MultiSelectCheckboxFilter`'s `filter` prop wants.

**`showLoadingState` is not "the query is running".** It stays `true` when the query resolves with
zero rows, so binding `SummaryBar`'s `status` to it leaves the bar on skeleton pills permanently on
an empty collection — which reads as a hung network rather than an empty result. Use
`state.showErrorState ? 'error' : 'success'`.

**`collection.isLoading` and `collection.refresh()` are not members.** They look plausible, they
compile against the index signature, and neither exists at runtime.

## Reading state outside the table: it is MobX

`@wix/patterns` depends on `mobx` and `mobx-react-lite`, so the state object is observable and a
plain React component does not track it. Anything you derive from `state` in your own component —
a `SummaryBar` count, a badge total, a header figure — is computed once on first render, when the
collection is still empty, and never recomputed. The table itself updates because it observes
internally; your derived numbers sit at zero next to a table full of rows, which reads as a bug in
the query rather than in the wiring.

`useSelector` from `@wix/patterns` subscribes:

```tsx
const loadedCount = useSelector(() => state.keyedItems.length);
const rows = useMemo(() => state.keyedItems.map((k) => k.item), [loadedCount]);
```

**Select a primitive.** Returning a fresh array or object from the selector gives it a new identity
on every evaluation. Select a length, a total or an id, then derive the rest once it fires.

## Query and result shapes

`fetchData(query)` receives a `ComputedQuery<F>`: `limit`, `offset`, `page`, `search`, `rawSearch`,
`cursor`, `filters`, `rawFilters`, `sort`.

**Read the return type from `@wix/bex-core`, not from `@wix/patterns`.** The name
`CursorQueryResult` exists in both packages and they are different types. The one your `fetchData`
must satisfy is the generic in `node_modules/@wix/bex-core/dist/types/hooks/paginationModeConfig.d.ts`:

```ts
interface DataResultRaw<T> {
  items: T[];
  total?: number | null;
  available?: number;                          // total BEFORE filters
  cursor?: string | undefined | null;
  hasNext?: boolean | null;
}
type OffsetQueryResult<T> = Omit<DataResultRaw<T>, 'cursor'>;
type CursorQueryResult<T> = Omit<DataResultRaw<T>, 'cursor'> & { cursor: string | undefined | null };
```

Three consequences, each of which has shipped as a bug:

**In cursor mode the `cursor` key is required; its value may be `undefined`.** The intersection
re-declares `cursor` without `?`, so `return { items }` does not compile — but
`{ items, cursor: undefined }` does. "Required" is about the key, not the value.

**On the last page return `undefined`, never `''`.** An empty string is still a cursor to the
collection: it requests the next page forever and appends the same rows each pass, a table that
grows without end while the API is perfectly happy, rendering as a spinner under the last row that
reads as "still loading". Derive it so the empty case collapses:

```ts
cursor: response.pagingMetadata?.cursors?.next || undefined,
```

**`hasNext` and `total` exist in both modes** — they are on `DataResultRaw`, which both aliases
extend. Cursor mode also accepts a separate `fetchTotal`, since a cursor-paged response carries no
total; build its filter exactly as the page's or the count disagrees with the rows it counts.

Look any of these up yourself with `Read <pkgRoot>/dist/dts-bundle/index.json` and the `file` path it
gives; the index is the single source of truth, and it moves between versions.
