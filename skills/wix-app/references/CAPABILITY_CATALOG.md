# Capability Catalog

Use this catalog to separate the extension that is scaffolded from the primitive implemented inside it.

## Canonical Implementation Rule

After this catalog selects a host extension and primitive, read that host extension's detailed reference before implementation. For example: Auto Patterns → [AUTO_PATTERNS_DASHBOARD.md](AUTO_PATTERNS_DASHBOARD.md); custom page → [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md); modal → [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md); schema → [DATA_COLLECTION.md](DATA_COLLECTION.md).

| Capability | Host extension | Preferred primitive | Boundary |
| --- | --- | --- | --- |
| Collection table with supported CRUD | Dashboard Page | Auto Patterns | One collection; full page fits declarative configuration or documented overrides |
| Entity create/edit/view | Dashboard Page | Auto Patterns | Use supported entity pages and action configuration |
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
- A custom fixed-position panel behaves like a documented WDS overlay.
- A build or deployment proves runtime data correctness.
