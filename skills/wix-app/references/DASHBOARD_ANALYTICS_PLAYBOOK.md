# Dashboard Analytics Playbook

Use this route for KPIs, summaries, charts, calculated worksets, or pages combining multiple information regions. It does not imply that Auto Patterns supports charts.

## Required Documentation

Read [DASHBOARD_PAGE.md](DASHBOARD_PAGE.md), [VISUALIZATIONS.md](VISUALIZATIONS.md), and the installed WDS Page/Layout/Cell/Card/StatisticsWidget documentation selected for the composition. Read the custom table playbook when a WDS operational table is also present, or the table-and-panel playbook when rows open contextual detail.

## Build Contract

- **AN-01:** Define each metric's source, formula, date boundary, null behavior, and refresh behavior before choosing a visualization.
- **AN-02:** Put the primary operational surface first. Metrics summarize or prioritize work; they do not push the main workflow below decorative content.
- **AN-03:** Use the documented WDS grid and responsive spans. Do not create arbitrary dashboard columns or nest full-page layout components inside overlays.
- **AN-04:** Validate response shape before rendering. A missing metric or malformed series must not blank the whole page.
- **AN-05:** Give loading, empty, partial, error, and populated data deliberate surfaces. Keep the page structure stable while requests resolve.
- **AN-06:** Use a proven chart library and its exact documentation when a chart is required. Do not claim Auto Patterns chart support without explicit installed documentation.

## Acceptance

Verify every metric against known source records and dates, test empty and partial responses, confirm chart labels and legends remain legible, and exercise the primary operational workflow. Console and network must remain clean; one failed visualization must not erase unrelated content.
