# Collection Toolkit — what to reach for, per user need

[UX_SUCCESS_MODEL.md](UX_SUCCESS_MODEL.md) says what a dashboard must do for the person using it. This file says which component does it, so the stage list resolves to real names instead of a hand-rolled approximation.

Everything below is a real name in the installed `@wix/patterns`. Confirm the props before writing JSX by reading its doc from `dist/docs/index.json`. **A name missing from `dist/dts-bundle/index.json` is not a name that doesn't exist** — that index is a curated subset of the package's real exports, so check `dist/types/index.d.ts` before you conclude a component listed here is unavailable and reach for a substitute. `CollectionErrorState` is exactly this case: exported, usable, absent from the index.

> **A page that renders a filtered table and nothing else is the most common failure of a generated dashboard** — it answers "what are all the records" and nothing about which one needs attention or why. Measured runs produce exactly that page unless the requirement is stated. So:
>
> 1. **A dashboard whose rows are real business records lets the user open one** — required, unless the prompt is explicitly a report or an export.
> 2. **A dashboard that reports on records usually shows aggregate numbers too** — a judgment call, not a rule. Add a `SummaryBar` when the page answers a "how many / how much" question its rows don't answer at a glance; leave it out of a short CRUD list or a rota, where the rows are the answer and a row of totals is just clutter. Be able to say which call you made.

## Understand — the aggregate

| Need | Component |
| --- | --- |
| Totals, counts, status breakdown above the table | `SummaryBar` |
| Which subset the numbers describe | wire each metric to the collection's filter state so the count follows the filters |

`SummaryBar` sits inside the page shell, above the collection. Compute the values from the same query the table uses, or a count query alongside it — a metric that disagrees with the visible rows is worse than no metric, and so is a metric nobody asked for: three tiles that restate what the table already shows cost a reader more than they give.

## Focus — narrowing

| Need | Component |
| --- | --- |
| Free-text search | `CollectionSearch` |
| The filter bar itself | `CollectionToolbarFilters` |
| Pick several values from a known list | `MultiSelectCheckboxFilter`, `MultiInlineCheckboxFilter`, `MultiAutoInlineCheckboxFilter` |
| Pick one value | `SingleSelectFilter`, `RadioGroupFilter`, `TabsFilter` |
| Values fetched from an API, not a fixed list | `MultiSelectCollectionFilter` + `useFilterCollection` |
| Type-ahead over many values | `AutoCompleteFilter` |
| Date or number ranges | `DateRangeFilter`, `NumberRangeFilter` |
| Comparison operators (greater than, contains) | `OperatorFilterPicker` + `operatorFilter` |
| The filter's state object | `idNameArrayFilter`, `stringFilter`, `stringsArrayFilter`, `arrayFilter`, `dateRangeFilter`, `customFilter` |
| A fixed in-memory option list for a filter | `useStaticListFilterCollection` |
| Sorting | `Sortable Columns`, `MultiLevelSorting` |

**Read the index once, then go straight to files.** `dist/dts-bundle/index.json` answers every name in this table in a single read — resolve it once per session and keep it, rather than re-reading it per lookup. Each entry names the exact file to open next.

**A factory or hook's doc is often empty where its signature should be** — the props table is generated for components, so `idNameArrayFilter`'s doc shows an `## API` heading with nothing under it. Its bundle has the signature: `<T extends { id: string; name: string }>(params?) => ArrayFilterState<T>`. That holds for every `use…` hook and every `…Filter` factory in the table above, and it is the difference between knowing a name and being able to call it — so for these, read the bundle the index names, not the doc.

**The search box renders whether or not you wire one.** `search` defaults to ON, so a page that
never mentions it still ships a search input that reaches no query and silently does nothing. Wire
it (`search={<CollectionSearch />}`) *and* read `query.search` inside `fetchData`.

**When the API has no free-text filter, resolve the term into every identity field it does have.**
Deleting the box is the wrong fix — the user asked for search — and picking one field is barely
better: an exact `contactDetails.email` match finds nothing unless someone pastes a whole address.
Read the *Supported Filters* page and enumerate. Query Extended Bookings accepts service ids and the
staff `resource.id` on both `bookedEntity` branches, plus `contactDetails.contactId` and `.email`, so
a term becomes an `$or` over all of them, matched against the lists you already fetched for the
filters. Give the no-match case an id nothing can reference, so "nothing found" means no rows.

**A term only another vertical can resolve is optional, not required.** Client *name* isn't
filterable on a booking, so matching it means asking Contacts for ids — a second vertical, a second
scope, a second thing that can 403. Wrap it so failure costs one branch, not the page:
[DATA_SOURCES.md](DATA_SOURCES.md#a-second-vertical-is-a-second-scope).

**Confirm the filter's field path before wiring it.** A path that reads correctly in the endpoint's
prose can still be rejected, and the endpoint's *Supported Filters* page settles it — see
[QUERY_AND_PAGING.md](QUERY_AND_PAGING.md#the-filterable-fields-are-a-closed-list-published-per-endpoint).

**A filter must narrow the result.** Declare it in the collection hook's `filters` map and read it inside `fetchData`, so the value reaches the query. Filter UI that renders but never changes the rows is a defect that looks like a feature — and it is the failure mode these components exist to prevent.

**A column must show what its header promises.** When mapping an API item to a row, treat a generic-sounding field (`.title`, `.name`, `.label`, `.summary`) as unverified until you've read its type declaration — `dist/dts-bundle/index.json` for a patterns type, the SDK's own bundled `.d.ts` for a Wix SDK response. An `Extended*`/`*WithDetails` response shape usually exists specifically to attach the real related entity (the service, the product, the contact) alongside the base record; a generic summary field on the base item is not a substitute for it, and the mistake reads as correct until someone opens a record where the two disagree. Do this for every column, not just the ones that look uncertain — the wrong-but-plausible field is the one nobody double-checks.

**A field the SDK marks `@deprecated` is a wrong-column defect waiting to happen** — both it and its replacement compile and render, and the deprecated one is usually the rawer value. Grep the declaration for `@deprecated` around every field you map: [DATA_SOURCES.md](DATA_SOURCES.md#confirming-a-field--the-part-that-ships-bugs).

**Row-mapping must cover every shape the API returns, not just the one your test data has.** A Wix SDK response often carries a oneof for entities that take more than one form — Bookings' `bookedEntity` is `slot` for an appointment, `schedule` for a class or course. A mapper reading one variant renders blank cells for every row of the other, passes `tsc`, and looks right against whatever sample data was on hand. Find the oneof in the declaration before writing the mapper, and handle each branch.

## Investigate — opening one record

| Surface | Use when | Built from |
| --- | --- | --- |
| **Side panel** | Inspect or lightly edit one record while keeping the filtered list on screen. The V1 default for review dashboards. | WDS `SidePanel` — patterns has no side panel |
| **Entity page** | Multi-section detail, editing, history, or a link someone can share. | `EntityPage` + `useEntityPage`, reached with `usePatternsNavigate().navigateToEntityPage`, form state from `@wix/patterns/form`. The call itself: [ENTITY_PAGE_TOOLKIT.md](ENTITY_PAGE_TOOLKIT.md) |
| **Expanded row** | A couple of extra fields, no separate workspace needed. | The collection's own row expansion |
| **Picker / bulk confirm** | Choosing records, or confirming an action on many. | `PickerModal` + `usePickerModal`, `bulkActionModal` |

A dialog that creates, updates or displays one listed record is **not** a dashboard modal — a create / "add new" form included, since it writes the record. See [DASHBOARD_MODAL.md](../DASHBOARD_MODAL.md); for the create route itself — registering it, and the four params that differ from the edit call — [ENTITY_PAGE_TOOLKIT.md § Create route](ENTITY_PAGE_TOOLKIT.md#create-route). A row the user cannot open is the second most common failure after the missing aggregate.

**Form state on an entity page** comes from `@wix/patterns/form` — `useForm` for the form, `useController` for a single field. That subpath re-exports `@wix/bex-core/form`, which wraps `react-hook-form`, so its API is react-hook-form's and only a handful of its names appear in the patterns docs: `FieldValues`, `ControllerProps` and most of the rest are documented by react-hook-form, not here. `Read <pkgRoot>/dist/dts-bundle/exports/form.d.ts` to see what the subpath actually gives you.

## Act and confirm

| Need | Component |
| --- | --- |
| Page header actions | `PrimaryActions`, `SecondaryActions`, `More Actions` — passed to the page header's `primaryAction`, `secondaryActions` and `moreActions` slots |
| Table toolbar button | `PrimaryActionButton` — the table's own `primaryActionButton` prop |
| Row actions | `deleteSecondaryAction`, in the row's `actionCell` |
| Acting on a multi-row selection | `MultiBulkActionToolbar`, `bulkActionModal` |
| Immediate feedback, then reconcile | `useOptimisticActions(state.collection)` ✅ — not `useOptimisticActions(state)` ❌: `useTableCollection()` returns `TableState<T, F>`, and the hook takes the `CollectionState<T, F>` that state exposes as `state.collection`. Returns `CollectionOptimisticActions` |
| A banner above the table | `TableTopNotification` |

## The states that are not the happy path

| State | Component |
| --- | --- |
| Collection is genuinely empty | `CollectionEmptyState` |
| Filters or search matched nothing | `CollectionNoResultsState` |
| Feature needs a paid plan | `CollectionPremiumEmptyState` |
| Load failed | `CollectionErrorState`, passed to the table's `errorState` |

**`errorState` is a render function, not a node** — `(err, { retry }) => ReactElement`, so `errorState={<CollectionErrorState />}` does not type-check. Wire it on every collection: a table with no `errorState` renders a failed query and a slow one identically, as skeleton rows that never resolve, and that is indistinguishable from an empty result.

**`CollectionErrorState` takes the retry as `action`, not `onRetry`.** It extends `ErrorCardProps`, so the shape is `action?: { text: string; onClick: () => void }` — guessing `onRetry` is a compile error that has actually happened in a measured run:

```tsx
errorState={(err, { retry }) => (
  <CollectionErrorState
    title="Couldn't load shifts"
    subtitle={err instanceof Error ? err.message : String(err)}
    action={{ text: 'Retry', onClick: retry }}
  />
)}
```

Both `title` and `subtitle` are optional; `action` is optional but omitting it leaves the user with no way out. Read `dist/types/components/ErrorCard/ErrorCard.d.ts` for the rest.

Empty and no-results are different messages: one means "add your first record", the other means "loosen the filters". Shipping only the first makes a working filter look broken.

## Export

`ExportButton` (its doc is `ExportTo`) for CSV and similar. Reach for it when the prompt mentions exporting, downloading, or sending records elsewhere.
