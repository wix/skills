---
name: rp-quick-shopify
description: Runs the bounded deterministic public Shopify catalog quick-import adapter after a qualifying source probe.
---

# rp-quick-shopify

Use only when the router selected this resource for `managementImportMode=quick` and the
source probe identified `shopify` with high confidence. This adapter imports only the catalog
entity graph declared in `quick-mode.json`: public products, collections, product tags, product
media, variants, and collection membership. It never uses credentials, Storefront/Admin APIs,
browser extraction, page scraping, app endpoints, or an LLM mapping step.

Run the adapter from the repository root:

```bash
node skills/wix-replatform/resources/rp-quick-shopify/scripts/quick-mode.js preflight <projectDir>
node skills/wix-replatform/resources/rp-quick-shopify/scripts/quick-mode.js plan <projectDir>
node skills/wix-replatform/resources/rp-quick-shopify/scripts/quick-mode.js extract <projectDir>
node skills/wix-replatform/resources/rp-quick-shopify/scripts/quick-mode.js import <projectDir> [--dry-run]
```

`preflight` verifies every paginated public route, including every preflighted collection's
product feed, before `plan` writes the authoritative quick plan and execution manifest. Normal
setup discovery/execution and execution approval remain mandatory before import. An inaccessible,
malformed, or changed endpoint is a durable blocker: do not substitute a browser, credentials,
or a different endpoint; offer standard mode instead.

Extraction persists the raw records and membership edges. Import uses the shared Stores V3
runtime, durable crosswalks, and checkpoints. The shared writer validates the product option and
variant payload; a record that cannot be represented safely is skipped and reported rather than
collapsed to a different product shape.
