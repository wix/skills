---
name: wix-app
description: "Build and review Wix CLI app extensions: dashboard pages, modals, plugins, menu plugins, custom element widgets, Editor React components, site plugins, embedded scripts, backend APIs, backend events, service plugins, data collections, and App Market readiness. Use for any Wix CLI app feature, extension, CMS schema, dashboard, widget, plugin, backend API, event, service plugin, or App Market review."
compatibility: requires `@wix/cli` >= 1.1.192.
---

# Wix App Builder

The Wix CLI owns scaffolding. For every supported extension except Backend API, use `wix generate --params`; it creates builder files, registration, UUIDs, and folder structure. This skill selects the route and supplies implementation guidance.

## Operating Model

1. Classify the requested surface and data source.
2. Read the one selected extension guide and only the API/component references required for that route.
3. Scaffold with the CLI, then implement business logic in the generated files.
4. Validate build and, for interactive dashboards, the real browser workflow.
5. Report completed work and any manual setup separately.

Do not claim completion after a build alone. Do not use MCP discovery until the relevant local reference does not cover the required API.

## Non-Negotiable Safeguards

- Read the selected extension guide **and** [CODE_QUALITY.md](references/CODE_QUALITY.md) before implementation. Routing selects a path; it never replaces the detailed guide.
- For a dashboard request, complete the Dashboard Routing gate before scaffolding. For a WDS UI, choose the exact component and read its documentation and example before writing UI.
- For a single-collection manager, read [AUTO_PATTERNS.md](references/AUTO_PATTERNS.md) **and** [AUTO_PATTERNS_DASHBOARD.md](references/AUTO_PATTERNS_DASHBOARD.md) before choosing custom React. For an existing page with `patterns.json`, use [CHANGE_ROUTING.md](references/CHANGE_ROUTING.md) and its documented override; never add UI directly to the generated page component.
- Do not hand-write CLI scaffolding, UUIDs, builder files, or extension registration. `Backend API` is the only manual extension exception.
- Do not report a data-driven dashboard as complete without browser evidence: primary workflow, console, network request, and visible loading, empty, error, and success states.

## Dashboard Routing

For every dashboard request, start with [DASHBOARD_ROUTING.md](references/DASHBOARD_ROUTING.md). It selects the host extension, implementation primitive, data source, and only the next references to read.

Use this progressive sequence:

| Situation | Read next |
| --- | --- |
| Single-collection management surface | [AUTO_PATTERNS.md](references/AUTO_PATTERNS.md), then [AUTO_PATTERNS_DASHBOARD.md](references/AUTO_PATTERNS_DASHBOARD.md) and the narrowest relevant override. |
| Existing page has `patterns.json` | [CHANGE_ROUTING.md](references/CHANGE_ROUTING.md); do not directly add UI to the generated page component. |
| Join, external data, metrics, charts, or custom workflow | [CUSTOM_DASHBOARD.md](references/CUSTOM_DASHBOARD.md), then [DASHBOARD_PAGE.md](references/DASHBOARD_PAGE.md). |
| Dashboard UI uses WDS | [DASHBOARD_COMPONENTS.md](references/DASHBOARD_COMPONENTS.md), then invoke the Wix Design System skill and read the exact selected component documentation and example. |
| SidePanel, Drawer, or Dashboard Modal | [OVERLAYS.md](references/OVERLAYS.md). |
| App-owned collection or relationship | [DATA_MODEL_AND_OPERATIONS.md](references/DATA_MODEL_AND_OPERATIONS.md), then [DATA_COLLECTION.md](references/DATA_COLLECTION.md) or [WIX_DATA.md](references/data-collection/WIX_DATA.md) as needed. |
| Data-driven or interactive dashboard, after implementation | [RUNTIME_VALIDATION.md](references/RUNTIME_VALIDATION.md). |

For a candidate Auto Patterns page, record each capability as `supported`, `supported-via-override`, or `unsupported`. A custom page requires the exact unsupported capability and missing documented composition path. A table/grid switch, custom row action, or derived state is not an automatic fallback.

## Extension Directory

| Need | Extension | CLI type | Implementation reference |
| --- | --- | --- | --- |
| Dashboard sidebar page | Dashboard Page | `DASHBOARD_PAGE` | [DASHBOARD_PAGE.md](references/DASHBOARD_PAGE.md) |
| Focused blocking dashboard task | Dashboard Modal | `DASHBOARD_MODAL` | [DASHBOARD_MODAL.md](references/DASHBOARD_MODAL.md) |
| Extend an existing dashboard UI | Dashboard Plugin | `DASHBOARD_PLUGIN` | [DASHBOARD_PLUGIN.md](references/DASHBOARD_PLUGIN.md) |
| Add a dashboard menu action | Dashboard Menu Plugin | `DASHBOARD_MENU_PLUGIN` | [DASHBOARD_MENU_PLUGIN.md](references/DASHBOARD_MENU_PLUGIN.md) |
| App-owned CMS data | Data Collection | `DATA_COLLECTION` | [DATA_COLLECTION.md](references/DATA_COLLECTION.md) |
| HTTP endpoint | Backend API | Manual | [BACKEND_API.md](references/BACKEND_API.md) |
| React component in the Wix editor | Editor React component | `EDITOR_REACT_COMPONENT` | [EDITOR_REACT_COMPONENT.md](references/EDITOR_REACT_COMPONENT.md) |
| Standalone site widget | Custom element widget | `CUSTOM_ELEMENT` | [CUSTOM_ELEMENT_WIDGET.md](references/CUSTOM_ELEMENT_WIDGET.md) |
| Fixed slot on a Wix app page | Site Plugin | `SITE_PLUGIN` | [SITE_PLUGIN.md](references/SITE_PLUGIN.md) |
| Business-flow integration | Service Plugin | `SERVICE_PLUGIN` | [SERVICE_PLUGIN.md](references/SERVICE_PLUGIN.md) |
| Event-triggered backend logic | Backend Event | `EVENT` | [BACKEND_EVENT.md](references/BACKEND_EVENT.md) |
| Scripts or tracking | Embedded Script | `EMBEDDED_SCRIPT` | [EMBEDDED_SCRIPT.md](references/EMBEDDED_SCRIPT.md) |

Dashboard Pages cannot use a WDS `Modal` or a hand-built React modal. Use a Dashboard Modal extension for a focused blocking task. `SidePanel` is desktop contextual work; `Drawer` is a mobile sliding surface.

## Data Source Rules

| Source | Action |
| --- | --- |
| Existing site CMS collection | Resolve and use it. Do not create app-owned storage. |
| New app-owned data | Create a Data Collection extension. Get the app namespace before scaffolding. |
| Wix business data or external API | Read the matching API guidance. Do not create a CMS collection unless persistence is explicitly app-owned. |
| Source is unclear | Inspect context or ask one targeted question. |

Infer app-owned storage when the request needs persistent app data, a new managed domain entity, a dedicated collection, data shared across extensions, or service-plugin configuration. Do not wait for the words "CMS collection." Conversely, a verified existing collection, Wix business data, or an external API is not a reason to create app-owned storage.

For a Data Collection extension, obtain the app namespace from Dev Center before scaffolding; do not guess it. Use its `idSuffix` exactly and reference the full scoped collection ID in API calls: `<app-namespace>/<idSuffix>`. When multiple extensions use the collection, agree on the suffix once and use that full ID everywhere. A reference field defines schema only; separately plan population, assignment, and missing-reference handling.

## Reference And Discovery Discipline

Read the selected extension reference first. Then verify the exact API in the matching local guide:

- Wix Data: [WIX_DATA.md](references/data-collection/WIX_DATA.md)
- Dashboard SDK: [DASHBOARD_API.md](references/dashboard-page/DASHBOARD_API.md)
- Backend events: `references/backend-event/COMMON-EVENTS.md`
- Service plugins: [SERVICE_PLUGIN.md](references/SERVICE_PLUGIN.md) and the matching `references/service-plugin/` leaf
- Wix Stores: [STORES_VERSIONING.md](references/STORES_VERSIONING.md) before any Stores API use. Detect the catalog version before every Stores flow, support both V1 and V3, and request both applicable permission scopes. Never assume the two APIs are interchangeable.

Use discovery only for APIs not covered locally, such as Wix Bookings, Members, Pricing Plans, or third-party integrations. Use focused searches and read the method schema before implementation.

## Implementation Rules

- Scaffold every CLI-supported extension with `npx wix generate --params '<json>'`. If its parameter schema is unknown, run `npx wix schema generate --type <extensionType>` and retry. Backend API is the only manual exception.
- Open the files returned by `wix generate` and implement within them; do not hand-write builder boilerplate or registration.
- Before importing `@wix/design-system`, invoke the Wix Design System skill and read the exact component documentation. Import `@wix/design-system/styles.global.css` in the main component entry file only.
- For dashboards, use the chosen component's documented behavior. Do not approximate a WDS component with custom positioning or markup.
- For App Market work, read [APP_MARKET_REVIEW.md](references/APP_MARKET_REVIEW.md). For registration recovery, see [EXTENSION_REGISTRATION.md](references/EXTENSION_REGISTRATION.md).

## Validation And Completion

1. Install dependencies, run `npx tsc --noEmit`, build with `npx wix build`, and preview with `npx wix preview`.
2. For dashboards with data or manager actions, run the browser workflow in [RUNTIME_VALIDATION.md](references/RUNTIME_VALIDATION.md): primary request, primary action, console, network, and planned visible states.
3. If validation fails, fix and repeat. Report runtime status as `passed`, `failed`, or `blocked`.
4. Give a concise completion summary with extensions created and validation evidence. Put every user-owned permission, namespace, site-setup, or external-configuration task in a separate **Manual Steps Required** list; do not bury it in narrative text.

## Supporting References

- [CODE_QUALITY.md](references/CODE_QUALITY.md)
- [APP_VALIDATION.md](references/APP_VALIDATION.md)
- [APP_IDENTIFIERS.md](references/APP_IDENTIFIERS.md)
- [DOCUMENTATION.md](references/DOCUMENTATION.md)
