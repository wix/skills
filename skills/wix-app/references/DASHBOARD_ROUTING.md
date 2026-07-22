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
- A contextual detail panel, an input flow, or a bounded confirmation does not by itself make a one-collection manager custom. First evaluate the documented Auto Patterns row action, child-component/AppContext, and entity-page paths. A custom dashboard route is **invalid** until the route record names each required Auto Patterns capability, the exact checked reference, and the first capability that is `unsupported`. Search, filters, Table/Grid, standard CRUD, saved views, documented row or bulk actions, contextual SidePanel detail, and entity-page edits are not evidence of unsupported complexity when their documented extension path exists.
- Do not classify a page as `custom-table` merely because it has a Table/Grid switch, gallery/card presentation, search, filters, a restock-style action, or sample records. These are Auto Patterns candidates and must be evaluated there first.
- Read [DASHBOARD_WDS_COMPONENT_GATE.md](DASHBOARD_WDS_COMPONENT_GATE.md) when a documented Auto Patterns extension needs the exact WDS composition for its supplemental surface. Select a custom route only after an exact unsupported capability is recorded.
- A new app-owned collection does not imply Auto Patterns or Dashboard Modal; the physical workflow selects the page route.
- Desktop selected-record context uses WDS SidePanel. Keep Auto Patterns as the primary page owner when that panel is opened from its documented row-action/AppContext extension path. Use the linked Auto Patterns entity page for structured create or edit inputs. A focused blocking task uses Dashboard Modal, including when launched from a documented Auto Patterns action. Do not scaffold a Dashboard Modal when the selected workflow is a SidePanel.
- Data creation and reference operations add [DATA_MODEL_AND_OPERATIONS.md](DATA_MODEL_AND_OPERATIONS.md) to the selected playbook; they do not replace it.
- Existing `patterns.json` always selects the Auto Patterns change playbook before editing.

## Route Record

Before scaffolding, record:

```text
route: auto-patterns
secondary: SidePanel detail via row-action override
source: Inventory Products collection
capabilities:
  - Table/Grid layouts: supported (AUTO_PATTERNS_DASHBOARD.md)
  - search and filters: supported (AUTO_PATTERNS_DASHBOARD.md)
  - Mark restocked row action: supported-via-override (auto-patterns-dashboard/action-cell.md)
  - selected product detail: supported-via-override (auto-patterns-dashboard/collection-page-actions.md, auto-patterns-dashboard/app-context.md)
reason: one collection with documented layouts, filters, actions, and contextual-detail extension path
proof: create sample products, switch Table/Grid, filter low stock, open a product detail SidePanel, mark one item restocked, refresh, and confirm persistence
```

For a custom fallback, replace the capability list with the exact first unsupported capability and reference checked. A statement such as "gallery + table + action" is not a valid fallback reason.

Do not proceed with an unnamed route.
