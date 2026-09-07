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

The first two commands create the authoritative `quick-mode/preflight.json`,
`quick-mode/plan.json`, and `execution/execution-manifest.json`. Setup discovery consumes the
quick plan; normal setup execution and execution approval are still mandatory before the
extract/import run. Do not replace the deterministic entity list with data discovered from
pages. If an endpoint preflight fails, persist the reported blocker and offer standard mode.

The `setup-author` command is a setup step: it idempotently creates the dedicated fallback
Blog member and records only its ID as `WIX_BLOG_FALLBACK_MEMBER_ID`. It uses the shared
`rp-target-wix` writer runtime and sends no email. The import entrypoint requires normal setup
verification and that setup-provisioned value before creating posts.
