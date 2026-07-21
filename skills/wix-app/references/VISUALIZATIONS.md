# Visualizations

Charts and KPI cards are custom dashboard capabilities unless a documented Auto Patterns component supports the exact requirement. WDS provides surrounding dashboard layout and metrics components, not an assumed chart implementation.

## Canonical Implementation References

Read [CUSTOM_DASHBOARD.md](CUSTOM_DASHBOARD.md) for custom-page responsibilities, [DASHBOARD_LAYOUT.md](DASHBOARD_LAYOUT.md) for chart/table composition, and [DASHBOARD_WDS_COMPONENT_GATE.md](DASHBOARD_WDS_COMPONENT_GATE.md) for WDS layout lookups. Before coding a chart, identify an installed or explicitly approved chart library, then read its exact API and example for the chosen chart type. If no chart library is available, do not invent one; report the dependency gap. This file does not define a chart library or invent an Auto Patterns chart capability.

## Plan First

For each metric or chart, define:

- source collection or endpoint;
- aggregation and time range;
- expected response shape;
- zero-data behavior;
- loading, error, and partial-data behavior;
- interaction, such as filtering or drill-in;
- accessibility equivalent for visual values.

## Runtime Guardrails

- Validate every response before reading chart series, metric values, or labels.
- Never replace the entire dashboard with a blank page when one visualization fails.
- Keep a stable page shell and render a localized error or retry affordance for the failed capability.
- Do not claim an Auto Patterns chart/statistics widget exists without checking the installed package or its documented catalog.
