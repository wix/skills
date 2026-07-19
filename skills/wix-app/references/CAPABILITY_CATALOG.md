# Capability Catalog

Use this catalog to separate the extension that is scaffolded from the primitive implemented inside it.

## Canonical Implementation Rule

After this catalog selects a host extension and primitive, read that host extension's detailed reference before implementation. For example: Auto Patterns → [AUTO_PATTERNS_DASHBOARD.md](AUTO_PATTERNS_DASHBOARD.md); custom page → [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md); modal → [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md); schema → [DATA_COLLECTION.md](DATA_COLLECTION.md).

| Capability | Host extension | Preferred primitive | Boundary |
| --- | --- | --- | --- |
| Collection table or grid with supported CRUD | Dashboard Page | Auto Patterns | One collection; Table and Grid layouts provide the documented built-in layout switcher when the full page fits declarative configuration or documented overrides |
| Named saved worksets or recurring filter presets | Dashboard Page | Auto Patterns Saved Views | Configure Saved Views alongside Table/Grid layouts; use them for named filters and column preferences, not to choose a presentation layout |
| Entity create/edit/view | Dashboard Page | Auto Patterns | Use supported entity pages and action configuration |
| Per-record state or custom row/bulk action | Dashboard Page | Auto Patterns override | Check the documented action resolver and override path before calling it custom-dashboard-only |
| Header, actions, slots, columns, sections | Existing Dashboard Page | Auto Patterns override | Only where `patterns.json` and a documented override exist |
| Multiple collections or a join | Dashboard Page | Custom data/query logic | Define relationship, query, null behavior, and write path |
| Relationship schema | Data Collection or existing site resource | Schema configuration | Reference definition is not data population |
| Assign/change a relationship | Dashboard Page | Wix Data operation plus contextual UI | Persist, refresh, and handle missing references |
| KPI cards | Dashboard Page | Custom metric component | Require source, calculation, loading, empty, and error states |
| Charts | Dashboard Page | Custom visualization | Require aggregation contract and malformed-data handling |
| Desktop inspection/edit flow | Dashboard Page | WDS SidePanel | Use only with a documented integration path; otherwise host the page custom |
| Mobile overlay | Dashboard Page | WDS Drawer | Do not use as a synonym for SidePanel |
| Focused popup | Dashboard Modal | Dashboard Modal API | Do not embed a page modal directly in a Dashboard Page |

## Unsupported-by-Default Assumptions

Do not assume any of these without a documented source:

- Auto Patterns supports charts, KPI widgets, arbitrary multi-collection joins, or arbitrary component composition.
- Creating a reference field populates existing records.
- A table action is automatically inline-editable or can open a SidePanel.
- Auto Patterns can reproduce the CMS `Choose layout` menu, its `List` layout, or configure which Table/Grid layout is initially selected.
- A custom fixed-position panel behaves like a documented WDS overlay.
- A build or deployment proves runtime data correctness.
