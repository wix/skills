# Custom Dashboard

Use a custom dashboard page for capabilities that cannot be represented declaratively: joins, bespoke workflows, external data, custom business logic, calculated views, KPIs, and charts.

## Canonical Implementation References

Before implementation, read [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md) and the relevant Dashboard SDK guidance in [dashboard-page/DASHBOARD_API.md](dashboard-page/DASHBOARD_API.md). If the page uses WDS, read [DASHBOARD_COMPONENTS.md](DASHBOARD_COMPONENTS.md), invoke the Wix Design System skill, and read the exact component guidance before editing UI.

## Responsibilities

For every custom data surface, define:

- data source and required access;
- query, aggregation, and transformation contract;
- loading state;
- empty-collection state with an appropriate setup or create CTA;
- no-filter-results state with a clear-filters action;
- permission-denied state;
- recoverable error state;
- null, malformed, and partial-response handling;
- primary action and post-mutation refresh behavior.

## Composition Rules

- Prefer documented WDS components over custom approximations.
- Use the correct documented overlay primitive rather than hand-built fixed positioning.
- Do not place a full-page layout inside a panel or modal host.
- Keep data fetching separate from rendering and validate response shape before visualizing it.
- For WDS data tables, read the documented `EmptyState` guidance and render it whenever the table has no rows after loading. Do not render `Table.Content` as the only non-loading branch.
- For a multi-source row, define the source of truth for each displayed field and the behavior when a related record is missing.

## Exit Criteria

The feature is incomplete until the primary data request succeeds in-browser and each planned state is intentionally represented.
