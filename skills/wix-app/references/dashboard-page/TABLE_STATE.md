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
| Row count for a metric | `state.keyedItems.length` | Derived from the same rows the table renders |
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
`cursor`, `filters`, `rawFilters`, `sort`. What you return depends on `paginationMode`:

| Mode | Return | Declared as |
| --- | --- | --- |
| `'offset'` | `{ items, total?, hasNext? }` | `OffsetQueryResult` |
| `'cursor'` | `{ items, cursor?, total? }` | `CursorQueryResult` |

```ts
// dist/types/types/SchemaConfig.d.ts — read it, don't recall it
export interface CursorQueryResult { items: any[]; cursor?: string | undefined | null; total?: number | null }
export interface OffsetQueryResult { items: any[]; total?: number | null; hasNext?: boolean }
```

**`hasNext` is offset-only.** It is not a member of `CursorQueryResult`; returning it from a
cursor-mode `fetchData` is a no-op that type-checks, because the object flows through your own
return type rather than an object literal. In cursor mode, `cursor` alone says whether there is more.

**On the last page return no cursor — `undefined`, not `''`.** An empty string is still a value the
collection treats as a cursor: it requests the next page forever and appends the same rows each
pass, a table that grows without end while the API is perfectly happy. It renders as a spinner under
the last row, which reads as "still loading". Derive it so the empty case collapses:

```ts
cursor: response.pagingMetadata?.cursors?.next || undefined,
```

Look any of these up yourself with `Read <pkgRoot>/dist/dts-bundle/index.json` and the `file` path it
gives; the index is the single source of truth, and it moves between versions.
