# Collection Toolkit — what to reach for, per user need

[UX_SUCCESS_MODEL.md](UX_SUCCESS_MODEL.md) says what a dashboard must do for the person using it. This file says which component does it, so the stage list resolves to real names instead of a hand-rolled approximation.

Everything below is a real name in the installed `@wix/patterns`. Confirm the props before writing JSX by reading its doc from `dist/docs/index.json` — and if a name is missing from `dist/dts-bundle/index.json`, the installed version is older than this file; work from that inventory, not from memory.

> **The requirement below is not a suggestion.** A page that renders a filtered table and nothing else is the single most common failure of a generated dashboard: it answers "what are all the records" and nothing about which one needs attention, or why something happened. Measured runs produce exactly that page unless the requirement is stated.
>
> **A dashboard whose rows represent real business records lets the user open one**, unless the prompt is explicitly a report or an export.

## Understand — the aggregate

Numbers above the table are the other half of "understand what matters", and worth adding — but they are **not** a requirement, because a headline number that is wrong is worse than one that is missing. Add the ones you can compute correctly, and leave out the rest.

| Need | Component |
| --- | --- |
| Counts and status breakdown above the table | `SummaryBar` |
| Which subset the numbers describe | wire each metric to the collection's filter state so the count follows the filters |

`SummaryBar` sits inside the page shell, above the collection. **Only show a number the server computed over the whole set.**

- **A count is safe.** Pass `{ returnTotalCount: true }` to the same `.find()` the table runs and read `totalCount` off the result — the server counts every matching row, so it stays right past the first page. Types: [WIX_DATA.md](../data-collection/WIX_DATA.md) (`WixDataQueryOptions`, `WixDataResult`). Run the query again with a narrower filter for a per-status count.
- **A sum or an average over fetched rows is not.** `items.query()` returns at most 1000 rows, so `.reduce()`-ing the result reports the total for the first 1000 records and never says it is wrong. Don't ship that number — omit the metric, or replace it with a count that answers the same question.
- If the prompt explicitly asks for a total the query cannot compute, say so in the manual action items rather than shipping a capped figure.
- Wire whatever you do show to the collection's filter state, so the numbers describe the rows on screen. A metric that disagrees with the visible rows is worse than no metric.

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

**A filter must narrow the result.** Declare it in the collection hook's `filters` map and read it inside `fetchData`, so the value reaches the query. Filter UI that renders but never changes the rows is a defect that looks like a feature — and it is the failure mode these components exist to prevent.

## Investigate — opening one record

| Surface | Use when | Built from |
| --- | --- | --- |
| **Side panel** | Inspect or lightly edit one record while keeping the filtered list on screen. The V1 default for review dashboards. | WDS `SidePanel` — patterns has no side panel |
| **Entity page** | Multi-section detail, editing, history, or a link someone can share. | `EntityPage` + `useEntityPage`, reached with `usePatternsNavigate().navigateToEntityPage`, form state from `@wix/patterns/form`. The call itself: [ENTITY_PAGE_TOOLKIT.md](ENTITY_PAGE_TOOLKIT.md) |
| **Expanded row** | A couple of extra fields, no separate workspace needed. | The collection's own row expansion |
| **Picker / bulk confirm** | Choosing records, or confirming an action on many. | `PickerModal` + `usePickerModal`, `bulkActionModal` |

A dialog that creates, updates or displays one listed record is **not** a dashboard modal — a create / "add new" form included, since it writes the record. See [DASHBOARD_MODAL.md](../DASHBOARD_MODAL.md). A row the user cannot open is the failure the requirement at the top of this file exists to prevent.

**Form state on an entity page** comes from `@wix/patterns/form` — `useForm` for the form, `useController` for a single field. That subpath re-exports `@wix/bex-core/form`, which wraps `react-hook-form`, so its API is react-hook-form's and only a handful of its names appear in the patterns docs: `FieldValues`, `ControllerProps` and most of the rest are documented by react-hook-form, not here. `Read <pkgRoot>/dist/dts-bundle/exports/form.d.ts` to see what the subpath actually gives you.

## Act and confirm

| Need | Component |
| --- | --- |
| Row actions | `PrimaryActions`, `SecondaryActions`, `More Actions`, `deleteSecondaryAction` |
| Page-level button | `PrimaryPageButton`, `PrimaryActionButton` |
| Acting on a multi-row selection | `MultiBulkActionToolbar`, `bulkActionModal` |
| Immediate feedback, then reconcile | `useOptimisticActions`, `CollectionOptimisticActions` |
| A banner above the table | `TableTopNotification` |

## The states that are not the happy path

| State | Component |
| --- | --- |
| Collection is genuinely empty | `CollectionEmptyState` |
| Filters or search matched nothing | `CollectionNoResultsState` |
| Feature needs a paid plan | `CollectionPremiumEmptyState` |
| Load failed | the collection state's error handling — give the user a way to retry |

Empty and no-results are different messages: one means "add your first record", the other means "loosen the filters". Shipping only the first makes a working filter look broken.

## Export

`ExportButton` (its doc is `ExportTo`) for CSV and similar. Reach for it when the prompt mentions exporting, downloading, or sending records elsewhere.
