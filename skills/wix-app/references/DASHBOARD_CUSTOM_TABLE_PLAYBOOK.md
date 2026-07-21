# Dashboard Custom Table Playbook

Use this route for a WDS management table that requires multiple sources, joins, external data, unsupported custom logic, or a workflow Auto Patterns cannot represent. Use the table-and-panel playbook instead when selecting a row opens contextual detail.

## Entry Gate

Do not read, select, or execute this playbook for a new one-collection manager until [DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md](DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md) has been evaluated. The route record must include the first required capability marked `unsupported` and the exact Auto Patterns reference that was checked.

The following do **not** qualify a page for this custom route by themselves: Table/Grid or gallery presentation, search, filters, standard CRUD, saved views, sample data, or a same-collection row action. If those are the only requirements, return to the Auto Patterns playbook.

## Required Documentation

Read [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md) for the host extension and [WDS_TABLE_GUIDELINES.md](WDS_TABLE_GUIDELINES.md) for dashboard table behavior. Invoke the Wix Design System skill, then read the installed `Table`, `TableToolbar`, `TableActionCell`, selected filter controls, `EmptyState`, and relevant Pagination examples. Read [DATA_MODEL_AND_OPERATIONS.md](DATA_MODEL_AND_OPERATIONS.md) when creating collections, references, joins, or mutations.

## Pre-Build Contract

Record the source of truth, join/transformation, visible columns, exact filter values, primary action, write path, and post-success state. Define loading, empty collection, no-results, permission, error, and populated states before JSX.

## Table Rules

- **CT-01:** Keep source records, table row adapters, visible rows, and selected IDs distinct. Map CMS `_id` to the stable table `id` and resolve IDs back to source records before writes.
- **CT-02:** Keep labeled column headers visible in normal and bulk-selection states.
- **CT-03:** Define a width and overflow strategy for every column. A value, badge, date, amount, or action must never paint over another cell. When required columns cannot fit at the supported dashboard viewport, preserve their usable widths and enable the documented table horizontal scroll; do not compress, hide, or clip the final action column to force the table to fit.
- **CT-04:** For variable statuses, show one primary status plus a compact `+N` summary, or deliberately use a taller wrapping row. Never invade the final action column.
- **CT-05:** Keep `TableActionCell` in a dedicated final column using documented sizing and behavior. A labeled action always reserves non-zero space; budget preceding columns so its text and focus ring remain visible.
- **CT-06:** Precompute result-count copy as one string before passing it to a toolbar label. Do not compose adjacent JSX text fragments.
- **CT-07:** Use no more than three visible filters. Submitted values must match stored values exactly.
- **CT-08:** Selecting rows replaces normal toolbar actions with selected count and applicable bulk actions; it does not replace column headers.
- **CT-09:** Every empty, no-results, error, or permission surface includes its relevant verified recovery action: create/setup, clear filters, retry, or request access.
- **CT-10:** If a row opens detail or performs work, expose that interaction through the documented final-column `TableActionCell`; row click and its action must invoke the same handler. Use documented hover/focus action visibility by default; a permanently visible row action requires an explicit workflow reason. Row click alone is not a sufficient visible or keyboard affordance.
- **CT-11:** A populated table always renders the documented `<Table.Content />` branch. `Table.EmptyState` is only the source-empty or filtered-empty branch; correcting its API must never remove the populated table content.

## Data States

| State | Required surface |
| --- | --- |
| Loading | Stable page/table shell with documented loading feedback. |
| Load failure | Recoverable error with retry. |
| No source records | Hide filters and row actions; show `EmptyState` with a verified create/setup CTA. |
| No matching rows | Keep active filters visible; show clear-filters recovery. |
| Visible rows | Show relevant controls, labeled columns, and working actions. |

## Actions

- Resolve selected table IDs to complete source records before a mutation.
- Use the documented Wix Data or API write method; do not write display-only DTOs.
- Define success feedback, refresh behavior, selection clearing, and queue membership before coding.
- Preserve context and selection on failure, and expose a useful recovery path.

## Invalid Implementations

- Custom table markup that approximates WDS behavior.
- Hidden column headers, index-based row IDs, or filters using display labels as unverified values.
- Variable non-wrapping badge arrays in bounded cells.
- Page-level clipping used to hide table overflow or the final action. Do not replace required table horizontal scrolling with squeezed cells, truncated controls, or zero-width action columns.
- A blank table area used as an empty state.

## Acceptance

Test the longest row, every status, narrowest supported width, matching and zero-result filters, visible checked selection, hover/focus row actions, every row/bulk mutation, empty-state CTA, retry, console, network, and persisted refresh. Run `node "$HOME/.agents/skills/wix-app/scripts/audit-dashboard-code.mjs" <dashboard-source-directory>` before build validation; this audit is blocking and a successful build does not replace it.
