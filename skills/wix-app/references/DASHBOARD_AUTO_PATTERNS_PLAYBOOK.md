# Dashboard Auto Patterns Playbook

Use this route for a new management surface backed by one CMS collection when Auto Patterns supports the complete physical page.

## Required Documentation

Read [AUTO_PATTERNS_DASHBOARD.md](AUTO_PATTERNS_DASHBOARD.md) for generation, configuration, permissions, supported layouts, actions, and validation. Then use the narrowest matching capability reference below. Do not load custom WDS dashboard playbooks unless the required capability has no documented Auto Patterns path.

| Requested capability | Exact Auto Patterns reference |
| --- | --- |
| Saved Views or named worksets | [views.md](auto-patterns-dashboard/views.md) |
| Row actions | [action-cell.md](auto-patterns-dashboard/action-cell.md) |
| Custom row or bulk actions | [custom-actions-override.md](auto-patterns-dashboard/custom-actions-override.md) and [bulk-actions.md](auto-patterns-dashboard/bulk-actions.md) |
| Custom displayed field or column | [custom-columns-override.md](auto-patterns-dashboard/custom-columns-override.md) |
| Custom section, header, or slot | [custom-sections-override.md](auto-patterns-dashboard/custom-sections-override.md), [custom-header-override.md](auto-patterns-dashboard/custom-header-override.md), or [custom-slots-override.md](auto-patterns-dashboard/custom-slots-override.md) |
| External child component needs collection data or refresh | [app-context.md](auto-patterns-dashboard/app-context.md) |
| Record detail, viewing, or editing beyond the collection row | [collection-page-actions.md](auto-patterns-dashboard/collection-page-actions.md), [custom-actions-override.md](auto-patterns-dashboard/custom-actions-override.md), and [app-context.md](auto-patterns-dashboard/app-context.md); choose SidePanel, Modal, or entity page through [DASHBOARD_WDS_COMPONENT_GATE.md](DASHBOARD_WDS_COMPONENT_GATE.md) |
| Deep or multi-section record flow | [entity-page.md](auto-patterns-dashboard/entity-page.md) and the relevant entity-page action reference |
| Short focused or blocking record flow | a documented Auto Patterns action plus [DASHBOARD_MODAL_PLAYBOOK.md](DASHBOARD_MODAL_PLAYBOOK.md) |

## Route Contract

- **AP-01:** Mark each requested capability `supported`, `supported-via-override`, or `unsupported`, with the checked documentation target.
- **AP-02:** Use Auto Patterns when the collection manager and every extension of its physical workflow have a documented configuration or override path. A contextual WDS `SidePanel` is supported-via-override when a documented row action sets the selected record and the panel is an `AutoPatternsApp` child with AppContext/refresh access. A Dashboard Modal is supported as a bounded action launched through the dashboard API. Do not mix an unsupported chart, join, or custom data surface into the page without a documented composition path.
- **AP-03:** A Table/Grid switch, row action, derived display, or named workset is not automatically unsupported. Check its focused reference before falling back; record that exact file in the capability decision.
- **AP-04:** Auto Patterns documents Table and Grid. Do not promise the native CMS layout menu, List layout, custom layout labels, or a configurable initial layout unless the installed docs explicitly support them.
- **AP-05:** Do not read or select a custom WDS dashboard playbook until this evaluation records the first `unsupported` capability. A new one-collection manager stays on this route when every requested capability is `supported` or `supported-via-override`.
- **AP-06:** Keep one physical collection classified as one source even when the workflow uses OR conditions, elapsed-time rules, comparisons, or several saved subsets. Materialize operational state as maintained fields and configure filters/Views against those fields; do not rebuild the table to express query logic.

## Extension Choice

Keep Auto Patterns as the owner of the collection table, layouts, filters, selection, CRUD, and refresh lifecycle. Add only the narrow supplemental surface required by the workflow:

| Workflow shape | Recommended extension |
| --- | --- |
| Moderate view/edit depth where table context should remain visible | Custom row/action override opens a WDS `SidePanel` child of `AutoPatternsApp`. |
| Short, focused, blocking view/edit task or confirmation | Launch a Dashboard Modal from a documented custom action. |
| Extensive or multi-section view/edit flow, complex validation, deep linking, or long work | Link to an Auto Patterns `entityPage` in the appropriate mode. |

These are best-practice defaults, not intent-to-component rules: viewing and editing may use any surface when its depth and context justify it. Record the chosen `detailSurface` and reason before implementation. The supplemental surface is not evidence that the table itself should be rebuilt in WDS.

## Action Coherence

- Treat inspect, edit, workflow transition, create, and delete as different intents.
- Give a bulk workflow transition a single-record equivalent in the row detail surface or row actions unless it is inherently bulk-only.
- Do not add create or delete merely because the collection supports CRUD. Follow the managed entity lifecycle from [DATA_MODEL_AND_OPERATIONS.md](DATA_MODEL_AND_OPERATIONS.md).
- For an inspect-first workflow, use `View` or the specific workflow verb as the row action; keep full-record editing available from the chosen detail surface when appropriate.

## Canonical Auto Patterns Profile: Inventory Manager

Use Auto Patterns for a single `Inventory Products`-style collection that needs product name, image, SKU, category, stock/reorder values, standard search or filters, Table and Grid presentation, and a documented row action such as **Mark restocked**.

This remains an Auto Patterns page even when the user asks for:

- a card/gallery-first presentation alongside a table;
- filters for category or stock status;
- representative sample records; or
- a row action that updates the same collection.

Configure the documented Auto Patterns Table/Grid layouts and action override. Do not replace them with a custom WDS gallery, a hand-built layout toggle, or a custom React table unless a required capability is explicitly documented as unsupported.

## Build Contract

1. Reuse a verified collection or create the required app-owned Data Collection and obtain its namespace.
2. Define schema, permissions, references, operational derived fields, indexes, initial data, and missing-reference behavior before page generation.
3. Scaffold with the Wix CLI and run the bundled Auto Patterns generator exactly as documented.
4. Keep the generated page component thin. Put configuration in `patterns.json` and every override in its documented separate file.
5. When the prompt asks for representative data, create 3-5 realistic records and verify the collection and dashboard show the same items.
6. Before adding any custom dashboard JSX, verify `.dashboard-route.json` says `auto-patterns`, `patterns.json` exists, and the generated Auto Patterns wrapper is registered by the CLI-scaffolded extension.

## Invalid Implementations

- Rebuilding supported CRUD, filters, pagination, Table/Grid layouts, or actions in custom WDS React.
- Adding JSX directly to an Auto Patterns-owned page instead of using a documented override.
- Creating an unregistered `page.tsx` beside the CLI-scaffolded page component.
- Treating a schema reference field as populated data.

## Acceptance

- The collection, schema, permissions, and representative records exist as planned.
- The generated page uses `patterns.json` and the documented page lifecycle.
- Table/Grid, Saved Views, actions, create/edit/delete flows, and overrides behave as requested.
- Individual, bulk, and detail-surface actions form one coherent workflow and follow the managed entity lifecycle.
- Loading, empty, no-results, error, and populated states are intentional.
- Browser, console, network, and persistence checks pass.
- The registered dashboard page opens, its loader settles, and a build-only success is not reported as runtime success.
