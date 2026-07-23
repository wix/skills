# Dashboard Routing

Choose one primary playbook from the user's physical page and workflow. Components and data operations do not create separate dashboard routes.

## Route Precedence

Apply these gates in order. Stop at the first match, then load only the secondary module named by that playbook.

1. Existing `patterns.json` selects the Auto Patterns change route.
2. A new supported one-collection manager selects Auto Patterns, including a documented Auto Patterns table extended by a contextual SidePanel, a Dashboard Modal action, or an entity page.
3. Any KPI, chart, calculated summary, or page with multiple information regions selects analytics, even when it also contains a table and SidePanel.
4. Only after the Auto Patterns extension path is unavailable, selected-record contextual work selects table-and-panel.
5. A remaining custom table selects custom-table.
6. A focused blocking task that is not an action of an Auto Patterns manager selects Dashboard Modal.

## Route Decision

| Request | Primary playbook |
| --- | --- |
| New one-collection CRUD or management surface, including an Auto Patterns table plus contextual detail, an entity edit page, or a bounded action overlay | [DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md](DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md) |
| Existing page directory contains `patterns.json` | [DASHBOARD_AUTO_PATTERNS_CHANGE_PLAYBOOK.md](DASHBOARD_AUTO_PATTERNS_CHANGE_PLAYBOOK.md) |
| Custom/multi-source WDS table without selected-record detail or analytics regions | [DASHBOARD_CUSTOM_TABLE_PLAYBOOK.md](DASHBOARD_CUSTOM_TABLE_PLAYBOOK.md) |
| Unsupported custom table where a row opens detail, edit, assignment, or resolution, without analytics regions | [DASHBOARD_CUSTOM_TABLE_PANEL_PLAYBOOK.md](DASHBOARD_CUSTOM_TABLE_PANEL_PLAYBOOK.md) |
| KPI, chart, calculated summary, or multi-region page, including table + SidePanel pages | [DASHBOARD_ANALYTICS_PLAYBOOK.md](DASHBOARD_ANALYTICS_PLAYBOOK.md) |
| Focused blocking form or confirmation | [DASHBOARD_MODAL_PLAYBOOK.md](DASHBOARD_MODAL_PLAYBOOK.md) |

If a page combines analytics with a table, use the analytics playbook as primary and read the table playbook it names. If the table opens record detail, use the table-and-panel playbook for that operational region. This is an explicit combined route, not permission to load every dashboard reference.

## Routing Gates

- **Auto Patterns is a mandatory first gate for every new one-collection manager.** Before reading a custom table, table-and-panel, analytics, or WDS component playbook, open [DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md](DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md) and evaluate the requested physical page against its focused references.
- Count physical systems or collections, not query branches. Search, projections, OR predicates, date comparisons, derived statuses, saved worksets, and filtered subsets of one collection still have `sourceCount: 1`.
- Query complexity does not transfer table ownership. For a one-collection manager, adapt the data model with maintained filterable fields when needed, then keep Auto Patterns as the collection surface.
- A contextual detail surface, input flow, or bounded confirmation does not by itself make a one-collection manager custom. First evaluate the documented Auto Patterns row action, child-component/AppContext, Modal, and entity-page paths. A custom dashboard route is **invalid** until the route record names each required Auto Patterns capability, the exact checked reference, and the first capability that is `unsupported`. Search, filters, Table/Grid, lifecycle-appropriate CRUD, saved views, documented row or bulk actions, and documented SidePanel/Modal/entity-page extensions are not evidence of unsupported complexity.
- Do not classify a page as `custom-table` merely because it has a Table/Grid switch, gallery/card presentation, search, filters, a restock-style action, or sample records. These are Auto Patterns candidates and must be evaluated there first.
- Read [DASHBOARD_WDS_COMPONENT_GATE.md](DASHBOARD_WDS_COMPONENT_GATE.md) when a documented Auto Patterns extension needs the exact WDS composition for its supplemental surface. Select a custom route only after an exact unsupported capability is recorded.
- A new app-owned collection does not imply Auto Patterns or Dashboard Modal; the physical workflow selects the page route.
- Desktop selected-record context uses WDS SidePanel. Keep Auto Patterns as the primary page owner when that panel is opened from its documented row-action/AppContext extension path. Use the linked Auto Patterns entity page for structured create or edit inputs. A focused blocking task uses Dashboard Modal, including when launched from a documented Auto Patterns action. Do not scaffold a Dashboard Modal when the selected workflow is a SidePanel.
- Data creation and reference operations add [DATA_MODEL_AND_OPERATIONS.md](DATA_MODEL_AND_OPERATIONS.md) to the selected playbook; they do not replace it.
- Existing `patterns.json` always selects the Auto Patterns change playbook before editing.

## Route Record

Before reading a custom playbook or scaffolding, save `.dashboard-route.json` in the dashboard source directory:

```json
{
  "route": "auto-patterns",
  "sourceCount": 1,
  "sources": ["Inventory Products"],
  "secondary": "SidePanel detail via row-action override",
  "detailSurface": "side-panel",
  "detailSurfaceReason": "Moderate record detail; preserve table context",
  "dataAdaptation": "Maintain inventoryStatus for saved filtering",
  "fallbackCategory": null,
  "firstUnsupportedCapability": null,
  "checkedReference": "auto-patterns-dashboard/views.md"
}
```

Allowed custom fallback categories are `multi-source`, `external-data`, and `unsupported-presentation`. A one-source custom fallback must use `unsupported-presentation` and also provide non-empty `firstUnsupportedCapability`, `checkedReference`, and `whyDataAdaptationCannotSolve`. Filtering, OR/date logic, derived state, a gallery/table switch, or a detail overlay are never valid fallback categories.

When record detail exists, set `detailSurface` to `side-panel`, `modal`, or `entity-page` and explain the choice in `detailSurfaceReason`. This records a design decision; it does not make one surface mandatory for viewing or editing.

Do not proceed without this record. Update it if evidence changes the route.
