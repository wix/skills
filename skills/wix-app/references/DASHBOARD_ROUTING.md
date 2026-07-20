# Dashboard Routing

Choose the **host extension**, then the **implementation primitive**, then the **data source**. Components and data operations are not CLI extensions.

## Route Once

| Need | Host and primitive | Read next |
| --- | --- | --- |
| Supported one-collection CRUD | Dashboard Page + Auto Patterns | [AUTO_PATTERNS.md](AUTO_PATTERNS.md) |
| Existing page with `patterns.json` | Existing Dashboard Page + Auto Patterns override | [CHANGE_ROUTING.md](CHANGE_ROUTING.md) |
| Join, aggregation, external data, bespoke workflow, KPI, or chart | Custom Dashboard Page | [CUSTOM_DASHBOARD.md](CUSTOM_DASHBOARD.md) and [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md) |
| Desktop selected-record work | Dashboard Page + WDS SidePanel | [OVERLAYS.md](OVERLAYS.md) and [DASHBOARD_COMPONENTS.md](DASHBOARD_COMPONENTS.md) |
| Mobile sliding task | Dashboard Page + WDS Drawer | [OVERLAYS.md](OVERLAYS.md) |
| Focused blocking task | Dashboard Modal extension | [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md) |
| New app-owned schema or relationship operation | Data Collection plus Dashboard Page as needed | [DATA_MODEL_AND_OPERATIONS.md](DATA_MODEL_AND_OPERATIONS.md) |

When a request matches more than one row, read **every** matching next reference before implementation. For example, a custom multi-source table with selected-record detail work requires `CUSTOM_DASHBOARD.md`, `DASHBOARD_PAGE.md`, `OVERLAYS.md`, and `DASHBOARD_COMPONENTS.md`; reading the custom-page route alone is incomplete.

## Auto Patterns Gate

For a one-collection manager, check Auto Patterns before choosing custom React. Mark every requested capability as:

- `supported`: declarative configuration covers it.
- `supported-via-override`: a documented action, resolver, slot, or override covers it.
- `unsupported`: no documented composition path exists.

For an unsupported result, record the exact missing capability and reference checked. A Table/Grid switcher, Saved View, derived state, or row action is not automatically unsupported. Read the narrowest relevant Auto Patterns guide before deciding. Do not assume the native CMS layout picker, List layout, custom layout labels, or configurable default Table/Grid layout are supported.

## Composition Rules

Use a standalone Auto Patterns page only when the whole physical page fits its documented configuration or override. A custom chart, join, SidePanel, or other unsupported capability on the same page requires a documented integration path; otherwise use a custom Dashboard Page or split the workflow.

Use SidePanel, Drawer, and Dashboard Modal as distinct primitives. Their placement and behavior are defined in [OVERLAYS.md](OVERLAYS.md).

## Minimum Capability Plan

Before scaffolding, capture only the decisions that affect implementation:

```text
capability: managers assign a class from a registrations table
host: DASHBOARD_PAGE
primitive: custom dashboard + WDS SidePanel
source: Students plus Classes, joined through classRef
reason: no documented Auto Patterns join/SidePanel composition
proof: filter a known row, assign a class, refresh the row
```

## Data And Runtime Rules

- Use existing verified collections. For new app-owned data, create a Data Collection and obtain the namespace.
- A reference field needs schema, population or assignment, and missing-reference behavior.
- Saved Views filter documented fields; they do not calculate a derived value. Persist a filterable status when a workset needs one.
- For interactive or data-driven dashboards, run [RUNTIME_VALIDATION.md](RUNTIME_VALIDATION.md) after implementation. Build success is not browser proof.
