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

## Column Layout And Overflow

Read the WDS `Table` **Column width** and **Horizontal scroll** examples, plus the selected text/status component's overflow behavior, before implementing a dense management table.

- Define a width and overflow strategy for every displayed column before writing cell renderers. Prioritize identity, primary status, and row actions; secondary metadata may truncate or move to the selected-record detail.
- A cell must never paint over an adjacent cell. Long text uses the selected WDS text-overflow behavior and an accessible way to reveal the complete value. Numeric, date, action, and status columns must remain legible at the supported table width.
- Do not put a variable number of chips in a non-wrapping flex row inside a bounded cell. For operational queues with several reasons, use one primary issue/status plus a compact `+N` summary in the table and show the complete set in the selected-record detail. Use a deliberately taller wrapping row only when every status must remain directly comparable. Never let status content occupy the final action column or overlap its control.
- Use documented table column sizing. Do not rely on accidental intrinsic widths, negative offsets, z-index, or page-level horizontal clipping to make a dense row fit. Use documented horizontal scrolling only when every required column must remain directly comparable.
- Keep `TableActionCell` in a dedicated final action column with documented column sizing. Its controls must not compete with content columns, overflow the table edge, or be cut off by a surrounding page/overlay wrapper. Test the direct action and overflow menu at the narrowest supported dashboard width.

## Toolbar And Filters

- Keep table title, filters, search, and general actions in the table toolbar. Keep search in a consistent right-side toolbar position when present.
- Render a result count such as `3 sessions` as one semantic, non-wrapping text label. Precompute one string before JSX, then pass that one string to the WDS toolbar label. Do not compose a count from adjacent JSX expressions such as `{count} session{suffix}`: toolbar layouts can treat those fragments as separately spaced children.
- Use at most three visible filter controls. If the task needs more, move advanced filters into a WDS SidePanel with the documented header, scrollable content, and footer; follow [OVERLAYS.md](OVERLAYS.md).
- Keep normal filters and bulk-action controls mutually exclusive: selecting rows replaces the normal toolbar with selected count and available bulk actions.
- Show active filters clearly and provide a clear-filters action for a no-results state.
- Offer saved filters/views only when recurring combinations are a real user workflow. A saved view represents a named filter state; do not conflate it with a layout switcher.

## Actions And Selection

- Put single-row actions in the final column with `TableActionCell`.
- Use descriptive labels for bulk actions. Show no more than three direct bulk actions; place additional secondary actions in a menu.
- For an action that resolves, assigns, reviews, or otherwise changes one record's work state, pair the bulk action with a selected-record equivalent. When the row opens a SidePanel, place that equivalent in the documented panel footer instead of making the manager return to the bulk toolbar.
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

Test sort direction, filter values, checked selection state, each bulk-action write, row action, empty state, no-results state, and error recovery in a browser. Test the densest row: longest text, every displayed status, date, number, and row action must stay inside its own cell without overlap or clipping that hides an action. A table that renders rows but cannot complete its primary action is not complete.
