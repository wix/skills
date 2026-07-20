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
6. Verify the applicable loading, empty-collection, permission-denied, and error states. For a custom WDS table, verify the documented `EmptyState` is rendered rather than a blank table area. When records are created outside the dashboard, click the empty-state CTA and confirm it opens the stated native creation or setup destination.
7. For a row-detail workflow, select a known row, then apply a filter that removes it. Confirm the panel closes, no clipped overlay remains, no table space is reserved for a floating panel, and no hidden record can still be edited. Confirm the panel is full-height at the dashboard's right edge, with a visible floating-surface gap/shadow, and that the table keeps its original width beneath it. Change the table height through filtering or a bulk action while a panel is open; its outer top and bottom bounds must not change. Confirm the header title and status use the same horizontal alignment, content has one standard WDS padding inset rather than a doubled inset, only the content region scrolls, and an action footer remains visible with secondary action(s) before a right-aligned primary action.
8. For a bulk-selection workflow, select known rows and confirm every selected checkbox visibly enters the checked state while labeled table headers remain visible. Run the bulk action, confirm it succeeds without a console or network error, verify a success notification with the affected count, refresh, and verify the same CMS records changed and the queue reflects its documented post-action rule. Inspect one selected ID against its source CMS `_id` before the action; test that the queue excludes a reviewed record after refresh.
9. For each displayed date, verify one known date is formatted successfully in both the table and record-detail surface. Never ship an `Invalid Date` value.
10. Refresh the page and confirm state remains stable.

## Failure Classification

| Signal | Investigate first |
| --- | --- |
| Page blanks after skeletons | Uncaught render error, response-shape assumption, failed data request |
| Table loads but related columns are blank | Reference values, join/query path, missing target records |
| Overlay scrolls unexpectedly | Host/content sizing, overflow ownership, wrong overlay primitive |
| Build succeeded but feature fails | Browser console, network request, permission and runtime data contract |

Record the evidence, the capability affected, and whether the failure is routing, schema, implementation, or runtime validation coverage. Report runtime status as `passed`, `failed`, or `blocked`; do not report implementation complete without it.
