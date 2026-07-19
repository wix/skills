# Auto Patterns

Use Auto Patterns for the supported CRUD surface of a dashboard: a single collection, a management table or grid, supported filters/actions, and entity create/edit/view flows.

## Canonical Implementation Reference

Before scaffolding or editing configuration, read [AUTO_PATTERNS_DASHBOARD.md](AUTO_PATTERNS_DASHBOARD.md). It contains the required permissions, schema generation, `patterns.json` structure, structural limits, configuration rules, validation steps, and the detailed override index. This file only decides whether Auto Patterns is the correct route.

## Required Checks

- Confirm the source is one collection, not a join or aggregate across several collections.
- Confirm the requested interaction maps to a documented declarative feature or override.
- For a collection page, inspect the documented Table and Grid layouts, view-switcher rules, and collection-page action/override rules before treating a request as unsupported.
- Treat a per-record derived state or custom row/bulk action as an eligibility question, not an automatic fallback. Use Auto Patterns when its documented resolver or override can implement the behavior; otherwise record the missing composition path before choosing a custom page.
- For an existing page, inspect `patterns.json` and edit configuration or an override instead of the generated component.
- Keep the initial field set intentionally small and typed correctly.

## Do Not Route Here

Use another route for:

- Multi-collection data displays or custom joins.
- Cross-collection calculations, external APIs, or business logic that has no documented Auto Patterns resolver or override path.
- KPI cards and charts.
- A modal, SidePanel, or Drawer interaction.
- Custom backend endpoints.

## Mixed Dashboard Rule

Use an Auto Patterns page only when the whole physical page fits its documented configuration or a documented override. If an unsupported capability must share that page and no documented integration exists, use a custom Dashboard Page or split the workflow into separate pages.

## Implementation Source

Do not guess configuration keys or modes. Follow the canonical reference above and the installed package’s documented configuration.
