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

Quick mode maps each public Shopify variant's explicit `available` boolean to untracked
`inStock`; a missing or non-boolean value is a reported gap, never implicit availability.
Products created with the standalone endpoint are followed by shared inventory reconciliation.
Match returned variants by their option/choice identities, not response order or SKU. On
resume, keep the product crosswalk and reconcile stock for existing products too.

`state/inventory-report.json` accounts for all extracted variants (including gaps) and
requires default-location Inventory and Catalog read-back before completion. An inventory
failure leaves the quick completion report partial even when all product IDs exist.
An empty inventory census is `no-data` with `complete:false`; an extraction count that
differs from its manifest blocks before writes. Dry runs write a separate simulated
inventory report and cannot complete or overwrite a live inventory checkpoint.

Setup scope: the quick setup router verifies the normal setup receipt (including required
notification protection and Stores provisioning). Its deterministic setup plan does not
run an inventory write canary. Do not report inventory create/update grants as preverified
from that receipt; a denied inventory write remains partial in the persisted stock report.
