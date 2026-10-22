---
name: rp-quick-woocommerce
description: Runs the bounded deterministic public WooCommerce quick-import adapter after a qualifying source probe.
---

# rp-quick-woocommerce

Use only when the router selected this resource for `managementImportMode=quick` and the
source probe identified `woocommerce` with high confidence. This adapter imports only the
entity graph declared in `quick-mode.json`; it never uses WordPress/WooCommerce credentials,
browser extraction, page scraping, plugin endpoints, or an LLM mapping step.

Run the adapter from the repository root:

```bash
node skills/wix-replatform/resources/rp-quick-woocommerce/scripts/quick-mode.js preflight <projectDir>
node skills/wix-replatform/resources/rp-quick-woocommerce/scripts/quick-mode.js plan <projectDir>
node skills/wix-replatform/resources/rp-quick-woocommerce/scripts/quick-mode.js setup-author <projectDir>
node skills/wix-replatform/resources/rp-quick-woocommerce/scripts/quick-mode.js extract <projectDir>
node skills/wix-replatform/resources/rp-quick-woocommerce/scripts/quick-mode.js import <projectDir> [--dry-run]
```

`plan` also writes `discovery/source-coverage.json`: one `adapter-excluded` row per `excluded[]`
entry, each dispositioned as the adapter's declared exclusion and carrying the committed
`excludedCapabilities` translation from `quick-mode.json` (a target capability, or
`source-scope.<name>` when Wix has none). The plan refuses if that translation is missing, extra,
duplicated or outside both namespaces, and stamps `sourceCoverageContract: 1` in
`quick-mode/plan.json`. `import` refuses to write its completion summary when the plan is
missing or unstamped, or its coverage file is missing or does not reconcile (a declared
exclusion must name an `excluded[]` entry of the committed contract, with its committed
capability); re-run `plan` to fix any of these. The summary carries `sourceCoverage[]` and
`sourceCoverageStatus`.

The first two commands create the authoritative `quick-mode/preflight.json`,
`quick-mode/plan.json`, and `execution/execution-manifest.json`. Setup discovery consumes the
quick plan; normal setup execution and execution approval are still mandatory before the
extract/import run. Do not replace the deterministic entity list with data discovered from
pages. If an endpoint preflight fails, persist the reported blocker and create a durable choice
between stopping and standard mode. The standard-mode choice must carry this effect so the CLI
applies the user's selection before it resumes:

```json
{"kind":"decision","key":"managementImportMode","choices":{"switch_to_standard":"standard"}}
```

The `setup-author` command is a setup step: it idempotently creates the dedicated fallback
Blog member and records only its ID as `WIX_BLOG_FALLBACK_MEMBER_ID`. It uses the shared
`rp-target-wix` writer runtime and sends no email. The import entrypoint requires normal setup
verification and that setup-provisioned value before creating posts.

A dry run (`--dry-run`) writes only `execution/dry-run-completion-report.json` and
`execution/dry-run-final-report.md` (plus the shared client's dry-run request capture). It never
creates or changes a live artifact: the live completion and final reports, the crosswalk, the
limit-recovery log, the import-started marker, or the post audit log
`logs/quick-mode-audit.ndjson`. The router therefore still sends the project to the live import
after a dry run.
