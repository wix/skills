# Visualizations

Charts and KPI cards are custom dashboard capabilities unless a documented Auto Patterns component supports the exact requirement.

## Canonical Implementation References

Read [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md) for dashboard layout and page responsibilities. Invoke the Wix Design System skill before implementing the chosen WDS components. This file does not define a chart library or invent an Auto Patterns chart capability.

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
