# Reading the state object `useTableCollection` hands you

> **Scope.** The [Component Docs Gate](../../SKILL.md) covers component *names and props*. This file
> covers the *state object you receive* — the thing the docs deliberately don't expand. Every member
> below was read from `dist/dts-bundle/types/TableState.d.ts` in the installed package.

## Why guessing here always fails

`useTableCollection()` returns a `TableState`. Inside the bundle, its companion `CollectionState` is
published as a deliberate stub:

```ts
declare class CollectionState<T = any, F = any> {
    [key: string]: unknown;
}
```

That index signature means **every property you read off `state.collection` is `unknown`** — it
type-checks as a member access and then fails the moment you use the value. `state.collection.result.total`
is not a compile error at the access, it is `unknown` arriving where a `string` was wanted. Reach for a
typed member on `TableState` itself instead.

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

## Query and result shapes

`fetchData(query)` receives a `ComputedQuery<F>`: `limit`, `offset`, `page`, `search`, `rawSearch`,
`cursor`, `filters`, `rawFilters`, `sort`. What you return depends on `paginationMode`:

| Mode | Return |
| --- | --- |
| `'offset'` | `{ items, total? }` |
| `'cursor'` | `{ items, cursor, hasNext? }` — **`cursor` is a required `string`**, so return `''` when the pages are exhausted, not `null` |

Look any of these up yourself with `Read <pkgRoot>/dist/dts-bundle/index.json` and the `file` path it
gives; the index is the single source of truth, and it moves between versions.
