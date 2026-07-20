# WDS Table Guidelines

Use this reference only for a **custom Dashboard Page implemented with WDS table components**. Do not apply it to an Auto Patterns table unless a documented Auto Patterns override explicitly delegates that part of the UI to WDS.

Read the WDS Dashboard Table guideline, then read the exact `Table`, `TableToolbar`, `TableActionCell`, `Pagination`, `EmptyState`, and selected filter-component documentation needed for the capability plan.

## Table Contract

Before coding, define the table's data contract and its planned states:

- visible columns and their labels;
- sortable fields and server/client sorting behavior;
- search and filter values that match stored data exactly;
- row action and selected-row behavior;
- whether selection and bulk actions are supported;
- loading, empty collection, no-results, error, and pagination/infinite-scroll behavior.

The field-label row remains visible in normal, selected, and bulk-action states. Do not hide table headers to make room for selection controls.

## Toolbar And Filters

- Keep table title, filters, search, and general actions in the table toolbar. Keep search in a consistent right-side toolbar position when present.
- Use at most three visible filter controls. If the task needs more, move advanced filters into a WDS SidePanel with the documented header, scrollable content, and footer; follow [OVERLAYS.md](OVERLAYS.md).
- Keep normal filters and bulk-action controls mutually exclusive: selecting rows replaces the normal toolbar with selected count and available bulk actions.
- Show active filters clearly and provide a clear-filters action for a no-results state.
- Offer saved filters/views only when recurring combinations are a real user workflow. A saved view represents a named filter state; do not conflate it with a layout switcher.

## Actions And Selection

- Put single-row actions in the final column with `TableActionCell`.
- Use descriptive labels for bulk actions. Show no more than three direct bulk actions; place additional secondary actions in a menu.
- Map a CMS record's `_id` to the table's stable `id` and resolve selected ids back to source records before writes.
- Define the exact post-success result: persisted write, feedback, refreshed rows, selection cleared or retained intentionally, and any queue/filter update.

## Data States

| State | Required behavior |
| --- | --- |
| Loading | Keep the table shell stable and show a documented loading state. |
| No source records | Hide irrelevant table controls and show `EmptyState` with a direct create/setup CTA. |
| No matching rows | Keep active filters visible, show a no-results state, and offer clear filters. |
| Request failure | Show a recoverable error and retry path. |
| Loaded data | Show labeled columns, relevant controls, and intentional row/action behavior. |

Use pagination when users work in discrete result sets or need a total count and easy return to earlier records. Use infinite scrolling when users need to explore a continuous list. Document the selection scope when data is paginated: loaded rows versus all matching records.

## Required Evidence

Test sort direction, filter values, checked selection state, each bulk-action write, row action, empty state, no-results state, and error recovery in a browser. A table that renders rows but cannot complete its primary action is not complete.
