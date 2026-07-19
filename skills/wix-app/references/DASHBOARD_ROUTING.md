# Dashboard Routing

## Purpose

Route a dashboard request in two layers. First choose the **host extension** that owns a physical surface. Then choose the **implementation primitive** used inside that host. Do not treat a component or data operation as a CLI extension.

| Layer | Examples |
| --- | --- |
| Host extension | Dashboard Page, Dashboard Modal, Dashboard Plugin, Data Collection |
| Implementation primitive | Auto Patterns, Auto Patterns override, WDS SidePanel, WDS Drawer, custom visualization, Wix Data operation |
| Data source | Existing site CMS collection, new app-owned collection, Wix business data, external API |

## 1. Decompose Before Choosing Technology

For every requested capability, identify data, surface, interaction, placement, and browser proof. Confirm the data model before treating a table as single-collection CRUD.

## 2. Choose the Host and Primitive

| Capability | Host extension | Primitive | Read |
| --- | --- | --- | --- |
| Supported single-collection CRUD page | Dashboard Page | Auto Patterns | [AUTO_PATTERNS_DASHBOARD.md](AUTO_PATTERNS_DASHBOARD.md) and [AUTO_PATTERNS.md](AUTO_PATTERNS.md) |
| Existing Auto Patterns change | Existing Dashboard Page | Auto Patterns override | [CHANGE_ROUTING.md](CHANGE_ROUTING.md) |
| Join, aggregation, custom workflow, external data, KPI, or chart | Dashboard Page | Custom dashboard capability | [CUSTOM_DASHBOARD.md](CUSTOM_DASHBOARD.md), [VISUALIZATIONS.md](VISUALIZATIONS.md) |
| Desktop contextual inspector or assignment | Dashboard Page | WDS SidePanel | [OVERLAYS.md](OVERLAYS.md), [DASHBOARD_COMPONENTS.md](DASHBOARD_COMPONENTS.md) |
| Mobile sliding task surface | Dashboard Page | WDS Drawer | [OVERLAYS.md](OVERLAYS.md), [DASHBOARD_COMPONENTS.md](DASHBOARD_COMPONENTS.md) |
| Focused blocking popup task | Dashboard Modal | Dashboard Modal API | [OVERLAYS.md](OVERLAYS.md) |
| New app-owned schema | Data Collection | Schema configuration | [DATA_MODEL_AND_OPERATIONS.md](DATA_MODEL_AND_OPERATIONS.md) |
| Reference assignment or record update | Dashboard Page | Wix Data operation | [DATA_MODEL_AND_OPERATIONS.md](DATA_MODEL_AND_OPERATIONS.md) |

## Canonical Implementation Rule

The routing references in this directory decide the path; they never replace the upstream implementation guides. Before code is written, read the detailed reference for every selected host extension and primitive. In particular: Auto Patterns → [AUTO_PATTERNS_DASHBOARD.md](AUTO_PATTERNS_DASHBOARD.md); custom page → [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md); dashboard UI component → [DASHBOARD_COMPONENTS.md](DASHBOARD_COMPONENTS.md) plus its exact `packages/wix-design-system` documentation; modal → [DASHBOARD_MODAL.md](DASHBOARD_MODAL.md); app-owned schema → [DATA_COLLECTION.md](DATA_COLLECTION.md); Wix Data operation → [data-collection/WIX_DATA.md](data-collection/WIX_DATA.md).

## 3. Decide Page Composition

Decide how capabilities physically coexist before scaffolding:

1. **Standalone Auto Patterns page:** use when the full page fits Auto Patterns and documented overrides.
2. **Documented Auto Patterns override:** use only when the requested addition has a documented override or slot integration.
3. **Custom Dashboard Page:** use when unsupported capabilities must share the same physical page with the table or each other.
4. **Separate extension:** use Dashboard Modal when the task is a focused blocking popup. Do not create an extra extension merely for SidePanel, Drawer, data operations, or a chart.

An Auto Patterns table plus a custom chart or SidePanel is not automatically composable. Verify the documented integration path. If it does not exist, host the whole page as a custom Dashboard Page or split the manager workflow into separate pages.

## 4. Build a Capability Plan

Use this shape:

```json
{
  "userOutcome": "Managers can assign a class to each student from a registrations table.",
  "capabilities": [
    {
      "id": "registrations-table",
      "surface": "table",
      "hostSurfaceId": "students-management",
      "hostExtension": "DASHBOARD_PAGE",
      "implementationPrimitive": "custom-dashboard",
      "dataSource": { "kind": "existing-site-collection", "collection": "Students" },
      "composition": "custom-dashboard-page",
      "references": ["CUSTOM_DASHBOARD.md"],
      "acceptance": "Rows, filters, and loading state render from Students."
    },
    {
      "id": "class-assignment",
      "surface": "contextual editor",
      "hostSurfaceId": "students-management",
      "hostExtension": "DASHBOARD_PAGE",
      "implementationPrimitive": "wds-side-panel",
      "wdsComponents": ["SidePanel", "FormField", "Dropdown", "Button"],
      "documentationTargets": ["packages/wix-design-system: SidePanel", "packages/wix-design-system: FormField", "packages/wix-design-system: Dropdown", "packages/wix-design-system: Button"],
      "dataSource": { "kind": "existing-site-collection", "collection": "Students" },
      "composition": "custom-dashboard-page",
      "references": ["OVERLAYS.md", "DATA_MODEL_AND_OPERATIONS.md"],
      "acceptance": "A selected student can be assigned a class and the row refreshes."
    }
  ]
}
```

## 5. Data Source Rules

- Existing collection named by the user or verified from site context: resolve and use it. Do not create a new app-owned collection.
- New app-owned data: create a Data Collection extension and obtain the namespace.
- Reference fields require both schema creation and a plan to populate or assign values.
- Data source unclear: inspect or ask before creating storage.

## 6. Overlay Precedence

- **SidePanel:** persistent desktop contextual work while the source page remains visible.
- **Dashboard Modal:** focused, blocking, bounded task such as confirmation or isolated form.
- **Drawer:** mobile sliding task surface.

Do not use the words interchangeably. A SidePanel may only be added to an Auto Patterns page through a documented override/action integration; otherwise use a custom Dashboard Page.

## 7. Runtime Evidence

For every data-driven or interactive dashboard, read [RUNTIME_VALIDATION.md](RUNTIME_VALIDATION.md). The route is incomplete until the primary data request and primary manager action are verified in the browser.
