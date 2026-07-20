# Custom Dashboard

Use a custom dashboard page for capabilities that cannot be represented declaratively: joins, bespoke workflows, external data, custom business logic, calculated views, KPIs, and charts.

## Canonical Implementation References

Before implementation, read [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md) and the relevant Dashboard SDK guidance in [dashboard-page/DASHBOARD_API.md](dashboard-page/DASHBOARD_API.md). If the page uses WDS, read [DASHBOARD_COMPONENTS.md](DASHBOARD_COMPONENTS.md), invoke the Wix Design System skill, and read the exact component guidance before editing UI. Then read only the matching conditional guide: [DASHBOARD_LAYOUT.md](DASHBOARD_LAYOUT.md) for multi-region composition, [WDS_TABLE_GUIDELINES.md](WDS_TABLE_GUIDELINES.md) for a WDS table/list, or [WDS_MODAL_GUIDELINES.md](WDS_MODAL_GUIDELINES.md) for a Dashboard Modal flow. If a prompt asks to select a row and inspect, edit, or assign it in a panel, also read [OVERLAYS.md](OVERLAYS.md) before choosing layout or mounting `SidePanel`.

## Pre-Build Decision Record

Before writing JSX, record only the decisions that change the page behavior:

- primary work surface and page-region hierarchy;
- selected WDS layout span when the page has multiple regions;
- table mode: normal, filtered, selectable, bulk-action, empty, no-results, or error;
- exact overlay primitive and host, when an overlay is required;
- selected component and documentation target for every non-trivial WDS capability.

Do not create this record for an Auto Patterns page; follow its documented capability plan instead.

## Responsibilities

For every custom data surface, define:

- data source and required access;
- query, aggregation, and transformation contract;
- loading state;
- empty-collection state with an appropriate setup or create CTA and a verified destination;
- no-filter-results state with a clear-filters action;
- permission-denied state;
- recoverable error state;
- null, malformed, and partial-response handling;
- primary action and post-mutation refresh behavior.

## Data-State Hierarchy

Choose the visible state from the complete data set before rendering table controls. Keep `allRows`, `visibleRows`, and `selectedId` distinct; do not use one filtered array for every decision.

| State | Surface |
| --- | --- |
| Loading | Stable page shell and loading indicator only. |
| Load failure | Error state with retry action. |
| No source records | EmptyState with the direct creation or setup CTA. Do not show filters, table toolbar, row actions, or a selected-record panel. |
| Source records but no visible rows | Active filters and no-results state with clear-filters action. Close any selected-record panel. |
| Visible rows | Relevant filters, table controls, table, and row selection. |

Use a documented deep link to the native data surface when the manager must create records outside the dashboard. Name the destination in the capability plan and verify that the CTA opens it. Do not replace a CTA with explanatory text. If no documented destination exists, provide the creation flow inside the dashboard.

## Record Detail Hierarchy

For a selected-record panel or detail form, organize information in this order:

1. **Header:** record identity and action-relevant status badges.
2. **Summary:** the 2-4 facts needed to understand the current task.
3. **Context:** related person, account, or secondary metadata.
4. **Working fields:** only fields the manager can actually edit; display read-only facts as text, not disabled-looking inputs.
5. **Footer:** secondary action(s), then the primary action, aligned to the right.

Status badges that determine urgency or available actions belong in the header, not midway through supporting content. A field is editable only when it has a write path, validation, and save behavior. Use standard WDS `Divider` for thin in-content section separation; do not use a heavyweight structural separator merely to create visual spacing.

For a SidePanel with an action, use the documented three-part structure: `SidePanel.Header`, scrollable `SidePanel.Content`, and `SidePanel.Footer`. The header must use the documented title/status composition and its spacing; do not bypass it with unpadded custom markup. The footer stays visible, contains the action controls, and follows the secondary-then-primary, right-aligned order. Do not create an extra scroll wrapper around the panel or substitute custom header/body/footer containers. Mount the panel in a stable dashboard-level overlay host, never inside the table/card/page-content wrapper. `SidePanel.Content` owns the default body padding; its first layout child should provide gaps and grouping, not duplicate root padding.

## Table-To-Detail Continuity

Treat a selected-record SidePanel as the detailed extension of that table row, not as a separate read-only profile.

- Repeat the row's identity and action-relevant status in the panel header. Keep the same source record, labels, and state semantics as the table.
- Carry the row's primary facts into the panel summary before adding deeper context, notes, related data, or editable fields. Do not make a manager hunt for a value that was visible in the row.
- Surface the selected record's applicable primary action in the panel footer. A bulk state-change action normally becomes a single-record primary action; a row-menu action remains available when it applies to that record.
- Do not mirror table-only controls such as row checkboxes, filter controls, pagination, or bulk selection. The panel extends the record; it does not reproduce the entire table.
- After a panel action succeeds, update the table and panel from the same source-of-truth state. Do not leave the panel showing a stale record or an action that is no longer valid.

## Selection And Bulk Operations

When a WDS `Table` supports selection, create a table-row adapter with `id: cmsItem._id`; keep the original CMS `_id` in that adapter or in a source-record map. Resolve `selectedIds` through that map before a write. Do not pass raw CMS items to the table and assume their `_id` is the WDS selection ID; do not rely on a row index or implicit identifier.

For a bulk action:

1. Resolve every selected table `id` back to an existing CMS record before writing.
2. Use the appropriate documented Wix Data write path, including `items.bulkUpdate()` when the same change applies to multiple records.
3. Do not construct an update from a display-only UI DTO that may have dropped source fields.
4. Define the post-success state before coding. For “Mark as reviewed”, persist `isReviewed: true` on the selected CMS records, show a success notification with the affected count, clear selection, and remove those records from an exceptions-only queue after refresh. The exception predicate itself must exclude `isReviewed === true`; a refresh alone does not remove a record from the queue.
5. Keep the selected rows and their source records intact until the write succeeds. On failure, preserve selection, show a recoverable error, and log the request failure rather than reporting a generic completed action.
6. Never use a double cast to force a UI DTO through a Wix Data write. Build the documented update payload from the source CMS record and validate that at least one selected source record exists before calling a bulk operation.

## Action Parity

A bulk action that resolves or changes a record's work state normally requires a single-record equivalent. When a selected-record SidePanel is part of the workflow, expose that equivalent as the panel footer's primary action unless the capability plan explicitly justifies a bulk-only operation.

- For example, **Mark as reviewed** in a bulk toolbar also appears as **Mark as reviewed** for the selected record.
- Reuse the same validated mutation path with that record's stable id. On success, show feedback, close or update the panel intentionally, clear affected selection, and refresh the queue according to its post-action rule.
- Do not make the panel read-only while hiding the only resolution action in an unrelated bulk toolbar or overflow menu.
- A destructive, privileged, or inherently multi-record operation may be bulk-only, but the capability plan must state why.

## Composition Rules

- Prefer documented WDS components over custom approximations.
- Use the correct documented overlay primitive rather than hand-built fixed positioning.
- A request to keep the list visible while showing a selected record means a floating `SidePanel` by default, not a side-by-side flex column. Use a push layout only when the prompt explicitly asks for persistent split-screen work.
- A row click that reveals information about that same row is a desktop `SidePanel` workflow. Do not substitute a Dashboard Modal merely because it is available. A Dashboard Modal is reserved for a blocking, bounded task that interrupts page context.
- Do not place a full-page layout inside a panel or modal host.
- A WDS table must retain its labeled column header row in every state, including selected-row and bulk-action states. Selection controls belong in the toolbar or selection column; they never replace the field labels. Do not set `Table.Content` `titleBarVisible={false}` for a management table with visible columns.
- Keep data fetching separate from rendering and validate response shape before visualizing it.
- For WDS data tables, read the documented `EmptyState` guidance and render it whenever the table has no rows after loading. Do not render `Table.Content` as the only non-loading branch.
- For a multi-source row, define the source of truth for each displayed field and the behavior when a related record is missing.
- A selected-record panel is valid only while its `selectedId` appears in `visibleRows`. Clear selection after filtering, refresh, deletion, or a permission/data change that removes the row.
- A bulk action is incomplete until checked rows visibly remain checked, the write succeeds against those exact CMS records, and a refresh confirms the persisted outcome.
- A state-changing bulk action must have a single-record equivalent in the selected-record workflow unless its bulk-only rationale is explicit.

## Exit Criteria

The feature is incomplete until the primary data request succeeds in-browser and each planned state is intentionally represented.
