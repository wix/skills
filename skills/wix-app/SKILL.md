---
name: wix-app
description: "Build and review Wix CLI app extensions: dashboard pages, modals, plugins, menu plugins, custom element widgets, Editor React components, site plugins, embedded scripts, backend APIs, backend events, service plugins, data collections, and App Market readiness. Use for any Wix CLI app feature, extension, CMS schema, dashboard, widget, plugin, backend API, event, service plugin, or App Market review."
---

# Wix App Builder

Require `@wix/cli` 1.1.192 or newer.

The Wix CLI owns scaffolding. This skill classifies the request, selects one execution route, and loads detailed references only when that route requires them.

## Core Workflow

1. Classify the extension, physical data sources, and primary user workflow.
2. Read one selected extension guide or dashboard playbook.
3. Read only the exact API/component documentation named by that guide.
4. For dashboards, save the selected route in `.dashboard-route.json`, then scaffold with the CLI and implement in generated files.
5. Validate build and the real browser workflow before reporting completion.

Read [CODE_QUALITY.md](references/CODE_QUALITY.md) before implementation. Do not claim completion after a build alone.

## Dashboard Route

For every dashboard request, read [DASHBOARD_ROUTING.md](references/DASHBOARD_ROUTING.md) and select exactly one primary playbook:

| Route | Playbook |
| --- | --- |
| New supported one-collection manager, including contextual record detail, entity-page inputs, or bounded action overlays | [DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md](references/DASHBOARD_AUTO_PATTERNS_PLAYBOOK.md) |
| Change an existing page with `patterns.json` | [DASHBOARD_AUTO_PATTERNS_CHANGE_PLAYBOOK.md](references/DASHBOARD_AUTO_PATTERNS_CHANGE_PLAYBOOK.md) |
| Custom or multi-source WDS table with no analytics regions | [DASHBOARD_CUSTOM_TABLE_PLAYBOOK.md](references/DASHBOARD_CUSTOM_TABLE_PLAYBOOK.md) |
| Unsupported custom table with selected-record detail and no analytics regions | [DASHBOARD_CUSTOM_TABLE_PANEL_PLAYBOOK.md](references/DASHBOARD_CUSTOM_TABLE_PANEL_PLAYBOOK.md) |
| KPIs, charts, calculated summaries, or multiple page regions, including table + panel pages | [DASHBOARD_ANALYTICS_PLAYBOOK.md](references/DASHBOARD_ANALYTICS_PLAYBOOK.md) |
| Focused blocking task | [DASHBOARD_MODAL_PLAYBOOK.md](references/DASHBOARD_MODAL_PLAYBOOK.md) |

The selected playbook owns the behavioral contract and acceptance criteria. Detailed extension, SDK, and WDS documentation owns exact APIs. Do not load other dashboard playbooks unless the selected playbook explicitly requires one for a combined surface.

## Auto Patterns Extension And Fallback Gate

Auto Patterns is the mandatory first route for a new one-collection manager. A contextual SidePanel, Dashboard Modal action, or structured input flow does not make the table custom by itself: first use the documented Auto Patterns row-action/AppContext, Dashboard Modal action, or entity-page path. Read [DASHBOARD_WDS_COMPONENT_GATE.md](references/DASHBOARD_WDS_COMPONENT_GATE.md) when that documented extension needs the exact WDS composition. Only when a required capability is absent from its documented configuration or override path may the agent record it as unsupported and build a custom dashboard surface.

## Extension Directory

| Need | CLI type | Implementation reference |
| --- | --- | --- |
| Dashboard sidebar page | `DASHBOARD_PAGE` | [DASHBOARD_PAGE.md](references/DASHBOARD_PAGE.md) |
| Dashboard Modal | `DASHBOARD_MODAL` | [DASHBOARD_MODAL.md](references/DASHBOARD_MODAL.md) |
| Extend an existing dashboard | `DASHBOARD_PLUGIN` | [DASHBOARD_PLUGIN.md](references/DASHBOARD_PLUGIN.md) |
| Dashboard menu action | `DASHBOARD_MENU_PLUGIN` | [DASHBOARD_MENU_PLUGIN.md](references/DASHBOARD_MENU_PLUGIN.md) |
| App-owned CMS data | `DATA_COLLECTION` | [DATA_COLLECTION.md](references/DATA_COLLECTION.md) |
| HTTP endpoint | Manual | [BACKEND_API.md](references/BACKEND_API.md) |
| Editor React component | `EDITOR_REACT_COMPONENT` | [EDITOR_REACT_COMPONENT.md](references/EDITOR_REACT_COMPONENT.md) |
| Standalone site widget | `CUSTOM_ELEMENT` | [CUSTOM_ELEMENT_WIDGET.md](references/CUSTOM_ELEMENT_WIDGET.md) |
| Fixed slot on a Wix app page | `SITE_PLUGIN` | [SITE_PLUGIN.md](references/SITE_PLUGIN.md) |
| Business-flow integration | `SERVICE_PLUGIN` | [SERVICE_PLUGIN.md](references/SERVICE_PLUGIN.md) |
| Event-triggered backend logic | `EVENT` | [BACKEND_EVENT.md](references/BACKEND_EVENT.md) |
| Scripts or tracking | `EMBEDDED_SCRIPT` | [EMBEDDED_SCRIPT.md](references/EMBEDDED_SCRIPT.md) |

For every CLI-supported extension except Backend API, use `npx wix generate --params`. If the schema is unknown, run `npx wix schema generate --type <extensionType>`. Do not hand-write builder files, UUIDs, registration, or scaffolding.

## Data Routing

| Source | Action |
| --- | --- |
| Existing site CMS collection | Resolve and use it; do not create app-owned storage. |
| New app-owned data | Create a Data Collection extension and obtain the namespace. |
| Wix business data or external API | Read its exact API; create CMS storage only for explicit app-owned persistence. |
| Unknown | Inspect context or ask one targeted question. |

For collection schema, references, joins, assignments, and writes, read [DATA_MODEL_AND_OPERATIONS.md](references/DATA_MODEL_AND_OPERATIONS.md). A reference field defines schema only; separately plan population and missing-reference behavior.

## Documentation Discipline

- Wix Data: [WIX_DATA.md](references/data-collection/WIX_DATA.md)
- Dashboard SDK: [DASHBOARD_API.md](references/dashboard-page/DASHBOARD_API.md)
- Stores: [STORES_VERSIONING.md](references/STORES_VERSIONING.md)
- App Market: [APP_MARKET_REVIEW.md](references/APP_MARKET_REVIEW.md)
- Registration recovery: [EXTENSION_REGISTRATION.md](references/EXTENSION_REGISTRATION.md)

Before importing WDS, invoke the Wix Design System skill and read the exact installed component documentation and examples named by the selected playbook or component gate. Record the component, documentation target, and reason it is required before implementation. Import `@wix/design-system/styles.global.css` once in the main component entry. Do not approximate a documented WDS component with custom markup or positioning.

Use focused discovery only when the selected local guide does not cover the required API. Read the discovered method schema before implementation.

## Validation

1. Run `npx tsc --noEmit`, `npx wix build`, and `npx wix preview`.
2. For every generated dashboard, run `node "$HOME/.agents/skills/wix-app/scripts/audit-dashboard-code.mjs" <dashboard-source-directory>`. This blocking audit validates the route record and generated ownership; a TypeScript/build validator does not replace it.
3. Open the registered dashboard route in a browser. Confirm the loader resolves, representative records render, console and network are clean, and the primary filter/action/detail workflow persists after refresh.
4. Report runtime status as `passed`, `failed`, or `blocked`, followed by separate manual steps.
