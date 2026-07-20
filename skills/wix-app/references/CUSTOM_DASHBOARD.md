# Custom Dashboard

Use a custom dashboard page for capabilities that cannot be represented declaratively: joins, bespoke workflows, external data, custom business logic, calculated views, KPIs, and charts.

## Canonical Implementation References

Before implementation, read [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md) and the relevant Dashboard SDK guidance in [dashboard-page/DASHBOARD_API.md](dashboard-page/DASHBOARD_API.md). If the page uses WDS, read [DASHBOARD_COMPONENTS.md](DASHBOARD_COMPONENTS.md), invoke the Wix Design System skill, and read the exact component guidance before editing UI. If a prompt asks to select a row and inspect, edit, or assign it in a panel, also read [OVERLAYS.md](OVERLAYS.md) before choosing layout or mounting `SidePanel`.

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

For a SidePanel with an action, use the documented three-part structure: `SidePanel.Header`, scrollable `SidePanel.Content`, and `SidePanel.Footer`. The header must use the documented title/status composition and its spacing; do not bypass it with unpadded custom markup. The footer stays visible, contains the action controls, and follows the secondary-then-primary, right-aligned order.

## Selection And Bulk Operations

When a WDS `Table` supports selection, map every CMS row to a stable table `id` equal to its CMS `_id`. Keep the CMS `_id` available for data operations. Do not rely on the table's row index or an implicit identifier.

For a bulk action:

1. Resolve every selected table `id` back to an existing CMS record before writing.
2. Use the appropriate documented Wix Data write path, including `items.bulkUpdate()` when the same change applies to multiple records.
3. Do not construct an update from a display-only UI DTO that may have dropped source fields.
4. Update local state only after the write succeeds, then clear selection and refresh affected rows.

## Composition Rules

- Prefer documented WDS components over custom approximations.
- Use the correct documented overlay primitive rather than hand-built fixed positioning.
- A request to keep the list visible while showing a selected record means a floating `SidePanel` by default, not a side-by-side flex column. Use a push layout only when the prompt explicitly asks for persistent split-screen work.
- Do not place a full-page layout inside a panel or modal host.
- Keep data fetching separate from rendering and validate response shape before visualizing it.
- For WDS data tables, read the documented `EmptyState` guidance and render it whenever the table has no rows after loading. Do not render `Table.Content` as the only non-loading branch.
- For a multi-source row, define the source of truth for each displayed field and the behavior when a related record is missing.
- A selected-record panel is valid only while its `selectedId` appears in `visibleRows`. Clear selection after filtering, refresh, deletion, or a permission/data change that removes the row.
- A bulk action is incomplete until checked rows visibly remain checked, the write succeeds against those exact CMS records, and a refresh confirms the persisted outcome.

## Exit Criteria

The feature is incomplete until the primary data request succeeds in-browser and each planned state is intentionally represented.
