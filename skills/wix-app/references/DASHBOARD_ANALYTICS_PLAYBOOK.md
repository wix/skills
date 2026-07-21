# Dashboard Analytics Playbook

Use this route for KPIs, summaries, charts, calculated worksets, or pages combining multiple information regions. It does not imply that Auto Patterns supports charts.

## Required Documentation

Read [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md), [VISUALIZATIONS.md](VISUALIZATIONS.md), and [DASHBOARD_WDS_COMPONENT_GATE.md](DASHBOARD_WDS_COMPONENT_GATE.md). Retrieve the installed WDS `Page`, `Layout`, `Cell`, `Card`, and `StatisticsWidget` props and composition examples. For every chart, read the exact supported chart-library documentation before implementation; a WDS card or metric component does not supply chart behavior. Read the custom-table playbook when a WDS operational table is present, or the table-and-panel playbook when rows open contextual detail. Those secondary playbooks own only their region; this playbook still owns the whole-page composition.

## Pre-Build Contract

List the page regions in reading order, name the primary operational surface, and record each region's WDS layout span at wide and narrow dashboard widths. Define every metric's source and every data state before JSX.

## Build Contract

- **AN-01:** Define each metric's source, formula, date boundary, null behavior, and refresh behavior before choosing a visualization.
- **AN-02:** Keep summary content compact and coherent. Put the primary operational surface before secondary explanation; do not create an isolated card for legends or copy that belongs beside the relevant metric.
- **AN-03:** Compose page regions with WDS `Layout` and `Cell`, using documented responsive spans. Do not build the page grid from horizontal `Box` rows, ad hoc `flex: 1`, fixed widths, or manual gaps.
- **AN-04:** Validate response shape before rendering. A missing metric or malformed series must not blank the whole page.
- **AN-05:** Give loading, empty, partial, error, and populated data deliberate surfaces. Keep the page structure stable while requests resolve.
- **AN-06:** Use a proven chart library and its exact documentation when a chart is required. Do not claim Auto Patterns chart support without explicit installed documentation.
- **AN-07:** Keep equal-level metric groups visually equal and fill their intended grid row. Use one compact summary band or a deliberate documented grid; do not leave arbitrary holes between cards.
- **AN-08:** Keep filters and their results together. A dense operational table is normally full width, including when a floating SidePanel opens above it.
- **AN-09:** When an analytics page includes selected-record detail, inherit the table-and-panel SidePanel contract in full: use the standard stretching fixed `DashboardSidePanelHost`, preserve the selected row with `Table.isRowActive`, keep the table full width beneath it, and validate that the panel stays anchored when table or page height changes.
- **AN-10:** Separate source-empty from filtered-empty operational data. Source-empty hides table controls and presents an in-context primary setup/create CTA. Filtered-empty preserves active filters and presents clear-filters recovery. Do not render a filtered-empty message or `Clear filters` when the source has no records.
- **AN-11:** A chart lives in a bounded chart region inside its Card. Use the selected chart library's documented responsive-container pattern so its canvas or SVG fills that region and cannot paint into the next dashboard surface. For Chart.js, use `responsive: true` with `maintainAspectRatio: false` when the chart region has an intended height; do not combine a fixed-height chart wrapper with `maintainAspectRatio: true`.

## Invalid Implementations

- Selecting the table-and-panel route as primary for a page that also requests KPIs or several page regions.
- Multiple `StatisticsWidget` cards arranged by nested horizontal `Box` elements instead of `Layout` and `Cell`.
- Unequal card widths, unused grid gaps, or a small explanatory card competing with the operational surface.
- A table or filter region narrowed, clipped, or pushed by the selected-record panel.

## Acceptance

Verify every metric against known source records and dates, inspect the composition at wide and narrow dashboard widths, and test source-empty, filtered-empty, partial, and populated responses. Confirm equal-level cards align, every chart remains inside its own Card, the operational region stays full width, and any combined table/SidePanel acceptance checklist passes. Console and network must remain clean; one failed visualization must not erase unrelated content. Run `node "$HOME/.agents/skills/wix-app/scripts/audit-dashboard-code.mjs" <dashboard-source-directory>` before build validation.
