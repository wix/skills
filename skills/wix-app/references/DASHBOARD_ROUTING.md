# Dashboard Routing

Choose one primary playbook from the user's physical page and workflow. Components and data operations do not create separate dashboard routes.

## Route Precedence

Apply these gates in order. Stop at the first match, then load only the secondary module named by that playbook.

1. Existing `patterns.json` selects the Auto Patterns change route.
2. A new supported one-collection manager selects Auto Patterns.
3. Any KPI, chart, calculated summary, or page with multiple information regions selects analytics, even when it also contains a table and SidePanel.
4. Without analytics regions, selected-record contextual work selects table-and-panel.
5. A remaining custom table selects custom-table.
6. A focused blocking task selects Dashboard Modal.

## Route Decision

| Request | Primary playbook |
| --- | --- |
| New one-collection CRUD or management surface | [DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md](DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md) |
| Existing page directory contains `patterns.json` | [DASHBOARD_AUTO_PATTERNS_CHANGE_PLAYBOOK.md](DASHBOARD_AUTO_PATTERNS_CHANGE_PLAYBOOK.md) |
| Custom/multi-source WDS table without selected-record detail or analytics regions | [DASHBOARD_CUSTOM_TABLE_PLAYBOOK.md](DASHBOARD_CUSTOM_TABLE_PLAYBOOK.md) |
| Custom table where a row opens detail, edit, assignment, or resolution, without analytics regions | [DASHBOARD_CUSTOM_TABLE_PANEL_PLAYBOOK.md](DASHBOARD_CUSTOM_TABLE_PANEL_PLAYBOOK.md) |
| KPI, chart, calculated summary, or multi-region page, including table + SidePanel pages | [DASHBOARD_ANALYTICS_PLAYBOOK.md](DASHBOARD_ANALYTICS_PLAYBOOK.md) |
| Focused blocking form or confirmation | [DASHBOARD_MODAL_PLAYBOOK.md](DASHBOARD_MODAL_PLAYBOOK.md) |

If a page combines analytics with a table, use the analytics playbook as primary and read the table playbook it names. If the table opens record detail, use the table-and-panel playbook for that operational region. This is an explicit combined route, not permission to load every dashboard reference.

## Routing Gates

- Check Auto Patterns before custom React for a one-collection manager. Record the exact unsupported capability before falling back.
- A new app-owned collection does not imply Auto Patterns or Dashboard Modal; the physical workflow selects the page route.
- Desktop selected-record context uses WDS SidePanel. Mobile sliding work uses Drawer. A focused blocking task uses Dashboard Modal. Do not scaffold a Dashboard Modal when the selected workflow is a SidePanel.
- Data creation and reference operations add [DATA_MODEL_AND_OPERATIONS.md](DATA_MODEL_AND_OPERATIONS.md) to the selected playbook; they do not replace it.
- Existing `patterns.json` always selects the Auto Patterns change playbook before editing.

## Route Record

Before scaffolding, record:

```text
route: custom-table-panel
secondary: none
source: Students + Classes through classRef
reason: multi-source join and selected-record assignment workflow
proof: filter a known row, assign its class, refresh, and confirm persistence
```

Do not proceed with an unnamed route.
