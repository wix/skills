# Dashboard Auto Patterns Change Playbook

Use this route when the existing Dashboard Page directory contains `patterns.json`.

## Required Documentation

Read [AUTO_PATTERNS_DASHBOARD.md](AUTO_PATTERNS_DASHBOARD.md) Part B and only the matching leaf under `auto-patterns-dashboard/` for the requested change.

## Change Contract

- **APC-01:** Treat `patterns.json` as ownership evidence. Inspect configuration and registered overrides before editing.
- **APC-02:** Change content, layouts, columns, actions, and page configuration in `patterns.json` when supported.
- **APC-03:** Put action, column, component, header, section, and slot overrides in their documented separate files and register them through the existing page component.
- **APC-04:** Do not hand-write UI in the generated page component or create a second page component.
- **APC-05:** If no documented configuration, slot, or override supports the requested capability, record the missing path and move the entire physical page to a custom Dashboard Page or split the workflow. Do not partially replace the generated lifecycle.

## Acceptance

- Existing collection/entity navigation and CRUD behavior remain intact.
- The change uses the narrowest documented configuration or override.
- No generated lifecycle logic is duplicated in custom React.
- The changed workflow passes browser, console, network, and persistence checks.
