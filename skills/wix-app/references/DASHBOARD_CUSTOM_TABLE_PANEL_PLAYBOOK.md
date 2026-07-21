# Dashboard Custom Table And Panel Playbook

Use this self-contained route for a custom WDS table where selecting a desktop row opens contextual record detail, editing, assignment, or resolution work.

## Required Documentation

Read [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md) and [DASHBOARD_WDS_COMPONENT_GATE.md](DASHBOARD_WDS_COMPONENT_GATE.md). Invoke the Wix Design System skill and retrieve the installed `Table`, `TableToolbar`, `TableActionCell`, selected filters, and `EmptyState` documentation. Before writing the panel, retrieve the exact installed `SidePanel` **Skin**, **Height**, **Header**, **Custom header**, **Dividers**, **Content sections**, **Custom footer**, and **Quick view** examples. Keep their JSX available while implementing; parent props do not describe compound Header/Content/Footer APIs. Use the standard `DashboardSidePanelHost` integration defined below, rather than copying Quick View's demo frame. Read [DATA_MODEL_AND_OPERATIONS.md](DATA_MODEL_AND_OPERATIONS.md) for collections, joins, references, and writes.

## Pre-Build Contract

Record the source of truth, join, visible columns, filter values, selected-record behavior, mutation path, post-success state, and these overlay decisions: primitive, stable host, height owner, overflow owner, and scroll owner.

## Table Contract

- **TP-01:** Keep source records, row adapters, visible rows, and selected ID distinct. When a row opens detail, pass that selected ID to the documented `Table.isRowActive` predicate so the open record remains visibly active. The panel is valid only while its ID remains visible; clear selection and close it after filtering, deletion, refresh, or permission changes remove the row.
- **TP-02:** Keep labeled headers visible. Define every column's width and overflow behavior before renderers. When the selected record workflow requires more columns than fit at the supported viewport, enable documented table horizontal scrolling; do not squeeze or clip the final action column.
- **TP-03:** Use one primary status plus `+N` for variable issue sets; show the complete status set in record detail. Every interactive row exposes a documented `TableActionCell` in a dedicated final column with an explicit View/Edit action; row click may mirror it but never replaces its affordance. Reserve a non-zero width for a labeled action and budget the preceding column widths so the action can never be clipped.
- **TP-04:** Precompute toolbar count text as one string. Never compose `{count} item{suffix}` as separate JSX children.
- **TP-05:** Implement stable loading, recoverable load/permission failure, empty source, no-results, and populated states. Compute source-empty from all loaded records and filtered-empty from visible records separately. Empty source data hides filters/actions and shows its primary create/setup CTA inside the empty state; filtered zero results keep active filters and provide clear-filters recovery. Never show `Clear filters` when no source records exist.
- **TP-06:** Bulk selection visibly checks the selected rows and resolves stable table IDs to complete source records before writing.

## SidePanel Contract

- **TP-07:** Use WDS `SidePanel` with `skin="floating"` as an overlay for desktop contextual work. Do not scaffold or substitute Drawer, Dashboard Modal, a fixed-width flex sibling, or a push column unless the prompt explicitly requires that separate behavior.
- **TP-08:** A floating `SidePanel` is not a portal. Mount it through a `DashboardSidePanelHost`, outside `Page`, `Card`, table, and their overflow containers. The host is the only approved custom positioning: `position: fixed`, `top: 0`, `right: 0`, `bottom: 0`, a dashboard overlay `zIndex`, `display: flex`, and `alignItems: stretch`. Render the `SidePanel` as the host's direct child: no intermediate wrapper, `pointerEvents` layer, or content-sized parent. It has no width, height, padding, shadow, or overflow styles. This anchors the WDS panel to the available dashboard viewport instead of page/table content. A bare `<RecordPanel />` after `<Page>` is invalid because it remains in normal document flow.
- **TP-09:** Never combine a `position: relative; overflow: hidden; height: 100%` page wrapper with an absolute `height: 100%` panel child. Never use `position: absolute`, `100vh`, `100dvh`, fixed panel dimensions, or unverified `height: 100%` as a generic host fix. The stretching fixed host owns anchoring; WDS `SidePanel` owns its dimensions, shadow, and internal scrolling.
- **TP-10:** Default record detail uses `SidePanel.Header` with its documented `title` API only. Put status first in Content. Add custom Header children only when the exact Custom header example is required, preserving its documented horizontal inset; never place a bare badge or title against the panel edge.
- **TP-11:** Every contextual record-detail panel uses `SidePanel.Header`, one `SidePanel.Content`, and `SidePanel.Footer`. The Footer always includes a right-aligned secondary `Close` button, even for read-only detail; add a right-aligned primary action when the record has a verified mutation path. Use internal Content groups and the standard thin WDS `Divider` when separation is necessary. Reserve multiple Content regions plus `SidePanel.Divider` for genuinely independent panel regions justified by the Content sections example. Only Content scrolls; Header and Footer stay visible.
- **TP-12:** Let `skin="floating"` own panel shadow and geometry. The fixed overlay host must allow the shadow to render on every edge; do not add wrapper `boxShadow`, `overflow: auto/hidden`, or fixed width/height around the panel.

## Detail Hierarchy And Actions

1. Header: record identity through the documented `title` API; use a custom header only when the retrieved example requires it.
2. Content opening: action-relevant status and 2-4 summary facts needed for the task.
3. Context: related person, account, location, or metadata.
4. Working fields: only fields with a verified write path; show read-only facts as text.
5. Footer: secondary actions, then right-aligned primary action.

Treat the panel as an extension of the selected row. Preserve identity, statuses, and action semantics. A state-changing bulk action normally has a single-record equivalent in the Footer and uses the same mutation path.

## Invalid Implementations

- SidePanel mounted inside a page/card/table wrapper, rendered as a bare page-flow sibling, pushed beside the table, or sized from page/table content.
- Custom header/body/footer containers, bare custom-header badges, routine record groups split by thick `SidePanel.Divider` bands, hard-coded panel geometry, clipped shadow, doubled padding, or a record-detail panel with only the header close icon and no Footer.
- Full status arrays competing with the table action column.
- A stale panel remaining open for a filtered-out record, or an open record without its active table-row state.
- A read-only panel that hides the row's primary operational action.

## Acceptance

Test the densest row and all table states. Hover and keyboard-focus an interactive row and confirm its action appears. Open a known row, compare row and panel facts, complete the single-record action, and verify persistence. Filter the selected row out and confirm the panel closes. Change table height while open: panel bounds and shadow remain stable on all edges, only Content scrolls, and Footer remains visible. Run `node "$HOME/.agents/skills/wix-app/scripts/audit-dashboard-code.mjs" <dashboard-source-directory>` before build validation; this audit is blocking and a successful build does not replace it.
