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

## Route Contract

- **AP-01:** Mark each requested capability `supported`, `supported-via-override`, or `unsupported`, with the checked documentation target.
- **AP-02:** Use Auto Patterns only when the whole physical page has a documented configuration or override path. Do not mix an unsupported chart, join, SidePanel, or custom data surface into the page without a documented slot/override composition.
- **AP-03:** A Table/Grid switch, row action, derived display, or named workset is not automatically unsupported. Check its focused reference before falling back; record that exact file in the capability decision.
- **AP-04:** Auto Patterns documents Table and Grid. Do not promise the native CMS layout menu, List layout, custom layout labels, or a configurable initial layout unless the installed docs explicitly support them.

## Build Contract

1. Reuse a verified collection or create the required app-owned Data Collection and obtain its namespace.
2. Define schema, permissions, references, initial data, and missing-reference behavior before page generation.
3. Scaffold with the Wix CLI and run the bundled Auto Patterns generator exactly as documented.
4. Keep the generated page component thin. Put configuration in `patterns.json` and every override in its documented separate file.
5. When the prompt asks for representative data, create 3-5 realistic records and verify the collection and dashboard show the same items.

## Invalid Implementations

- Rebuilding supported CRUD, filters, pagination, Table/Grid layouts, or actions in custom WDS React.
- Adding JSX directly to an Auto Patterns-owned page instead of using a documented override.
- Creating an unregistered `page.tsx` beside the CLI-scaffolded page component.
- Treating a schema reference field as populated data.

## Acceptance

- The collection, schema, permissions, and representative records exist as planned.
- The generated page uses `patterns.json` and the documented page lifecycle.
- Table/Grid, Saved Views, actions, create/edit/delete flows, and overrides behave as requested.
- Loading, empty, no-results, error, and populated states are intentional.
- Browser, console, network, and persistence checks pass.
