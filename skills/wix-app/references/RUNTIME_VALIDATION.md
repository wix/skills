# Dashboard Runtime Validation

The selected dashboard playbook owns route-specific acceptance criteria. Apply this common gate after implementation.

1. Open the real Dashboard Page and complete the primary workflow with known data.
2. Inspect browser console and failed network requests from initial load through the final action.
3. Exercise loading, empty source, no-results, permission/error, and populated states that apply.
4. Verify every filter against a known stored value and confirm its recovery path.
5. Complete every primary row, bulk, panel, or modal mutation and refresh to confirm persistence.
6. Test the densest record and narrowest supported viewport for overlap, clipping, hidden actions, or page-level overflow.
7. Run `node "$HOME/.agents/skills/wix-app/scripts/audit-dashboard-code.mjs" <dashboard-source-directory>` for custom WDS dashboards before delegating build validation. This audit is blocking; a successful build does not replace it.

Classify failures as routing, schema/data, implementation, or runtime validation. Report `passed`, `failed`, or `blocked`; a successful build alone is not runtime evidence.
