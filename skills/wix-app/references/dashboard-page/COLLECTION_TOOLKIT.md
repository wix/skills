# Collection Toolkit — what to reach for, per user need

[UX_SUCCESS_MODEL.md](UX_SUCCESS_MODEL.md) says what a dashboard must do for the person using it. This file says which component does it, so the stage list resolves to real names instead of a hand-rolled approximation.

Everything below is a real name in the installed `@wix/patterns`. Confirm the props before writing JSX — `node <this-skill-dir>/scripts/patterns.cjs docs <Name>` — and if a name is missing from `list`, the installed version is older than this file; work from `list`, not from memory.

> **The two requirements below are not suggestions.** A page that renders a filtered table and nothing else is the single most common failure of a generated dashboard: it answers "what are all the records" and nothing about how many, which one needs attention, or why something happened. Measured runs produce exactly that page unless the requirement is stated.
>
> 1. **A dashboard that reports on records shows aggregate numbers**, not only rows.
> 2. **A dashboard whose rows represent real business records lets the user open one**, unless the prompt is explicitly a report or an export.

## Understand — the aggregate

| Need | Component |
| --- | --- |
| Totals, counts, status breakdown above the table | `SummaryBar` |
| Which subset the numbers describe | wire each metric to the collection's filter state so the count follows the filters |

`SummaryBar` sits inside the page shell, above the collection. Compute the values from the same query the table uses, or a count query alongside it — a metric that disagrees with the visible rows is worse than no metric.

## Focus — narrowing

| Need | Component |
| --- | --- |
| Free-text search | `CollectionSearch` |
| The filter bar itself | `CollectionToolbarFilters` (its doc is published as `ToolbarFilters`) |
| Pick several values from a known list | `MultiSelectCheckboxFilter`, `MultiInlineCheckboxFilter`, `MultiAutoInlineCheckboxFilter` |
| Pick one value | `SingleSelectFilter`, `RadioGroupFilter`, `TabsFilter` |
| Values fetched from an API, not a fixed list | `MultiSelectCollectionFilter` + `useFilterCollection` |
| Type-ahead over many values | `AutoCompleteFilter` |
| Date or number ranges | `DateRangeFilter`, `NumberRangeFilter` |
| Comparison operators (greater than, contains) | `OperatorFilterPicker` + `operatorFilter` |
| The filter's state object | `idNameArrayFilter`, `stringFilter`, `stringsArrayFilter`, `arrayFilter`, `dateRangeFilter`, `customFilter` |
| A fixed in-memory option list for a filter | `useStaticListFilterCollection` |
| Sorting | `Sortable Columns`, `MultiLevelSorting` |

**A filter must narrow the result.** Declare it in the collection hook's `filters` map and read it inside `fetchData`, so the value reaches the query. Filter UI that renders but never changes the rows is a defect that looks like a feature — and it is the failure mode these components exist to prevent.

## Investigate — opening one record

| Surface | Use when | Built from |
| --- | --- | --- |
| **Side panel** | Inspect or lightly edit one record while keeping the filtered list on screen. The V1 default for review dashboards. | WDS `SidePanel` — patterns has no side panel |
| **Entity page** | Multi-section detail, editing, history, or a link someone can share. | `EntityPage` + `useEntityPage`, reached with `usePatternsNavigate().navigateToEntityPage`, form state from `@wix/patterns/form` |
| **Expanded row** | A couple of extra fields, no separate workspace needed. | The collection's own row expansion |
| **Picker / bulk confirm** | Choosing records, or confirming an action on many. | `PickerModal` + `usePickerModal`, `bulkActionModal` |

Adding, editing or viewing a collection item is **not** a dashboard modal — see [DASHBOARD_MODAL.md](../DASHBOARD_MODAL.md). A row the user cannot open is the second most common failure after the missing aggregate.

**Form state on an entity page** comes from `@wix/patterns/form` — `useForm` for the form, `useController` for a single field. That subpath re-exports `@wix/bex-core/form`, which wraps `react-hook-form`, so its API is react-hook-form's and only a handful of its names appear in the patterns docs: `FieldValues`, `ControllerProps` and most of the rest are documented by react-hook-form, not here. `node <this-skill-dir>/scripts/patterns.cjs exports form` lists what the subpath actually gives you.

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

`ExportTo` (the component is exported as `ExportButton`) for CSV and similar. Reach for it when the prompt mentions exporting, downloading, or sending records elsewhere.
