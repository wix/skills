# Runtime Validation

Build and deployment validation are necessary but insufficient. For every dashboard that reads data or supports a manager action, validate the actual workflow in a browser.

## Canonical Implementation Reference

Read [APP_VALIDATION.md](APP_VALIDATION.md) for installation, TypeScript, build, preview, and debug-log validation. This file adds browser workflow evidence; it does not replace the application validation workflow.

## Required Smoke Test

1. Open the generated dashboard and wait for loading to settle.
2. Confirm the primary data request succeeds.
3. Check browser console for uncaught errors and the network panel for failed primary requests.
4. Exercise the main workflow: list, filter, create, edit, assign, or open detail as applicable.
5. For every filter, test one known matching record and confirm the submitted filter value matches the raw value stored in the data source. Also test a zero-results state and its clear-filters recovery action.
6. Verify the applicable loading, empty-collection, permission-denied, and error states. For a custom WDS table, verify the documented `EmptyState` is rendered rather than a blank table area.
7. For a row-detail workflow, select a known row, then apply a filter that removes it. Confirm the panel closes, no clipped overlay remains, and no hidden record can still be edited.
8. Refresh the page and confirm state remains stable.

## Failure Classification

| Signal | Investigate first |
| --- | --- |
| Page blanks after skeletons | Uncaught render error, response-shape assumption, failed data request |
| Table loads but related columns are blank | Reference values, join/query path, missing target records |
| Overlay scrolls unexpectedly | Host/content sizing, overflow ownership, wrong overlay primitive |
| Build succeeded but feature fails | Browser console, network request, permission and runtime data contract |

Record the evidence, the capability affected, and whether the failure is routing, schema, implementation, or runtime validation coverage. Report runtime status as `passed`, `failed`, or `blocked`; do not report implementation complete without it.
