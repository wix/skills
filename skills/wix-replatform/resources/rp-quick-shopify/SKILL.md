---
name: rp-quick-shopify
description: Runs the bounded deterministic public Shopify catalog quick-import adapter after a qualifying source probe.
---

# rp-quick-shopify

Use only when the router selected this resource for `managementImportMode=quick` and the
source probe identified `shopify` with high confidence. This adapter imports only the catalog
entity graph declared in `quick-mode.json`: public products, collections, product tags, product
media, variants, and collection membership. It reads them through the store's **tokenless
Storefront GraphQL API** (`POST /api/<storefrontApiVersion>/graphql.json`, no access token) at the
API version pinned in `quick-mode.json`. One paginated product query carries each product's
variants, images, and collection memberships, so a store with thousands of collections still
needs only a handful of requests. It never uses credentials, a Storefront or Admin access token,
browser extraction, page scraping, app endpoints, or an LLM mapping step.

Run the adapter from the repository root:

```bash
node skills/wix-replatform/resources/rp-quick-shopify/scripts/quick-mode.js preflight <projectDir>
node skills/wix-replatform/resources/rp-quick-shopify/scripts/quick-mode.js plan <projectDir>
node skills/wix-replatform/resources/rp-quick-shopify/scripts/quick-mode.js extract <projectDir>
node skills/wix-replatform/resources/rp-quick-shopify/scripts/quick-mode.js import <projectDir> [--dry-run]
node skills/wix-replatform/resources/rp-quick-shopify/scripts/quick-mode.js request-reverify <projectDir>
node skills/wix-replatform/resources/rp-quick-shopify/scripts/quick-mode.js reverify <projectDir>
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

`preflight` pages through the product and collection connections (completing any product whose
variants, images, or collections exceed the first nested page) and stores the capture that
`extract` reuses, before `plan` writes the authoritative quick plan and execution manifest. HTTP
429, 5xx, `THROTTLED`, dropped connections, and hung calls are retried: one first call plus at
most six retries per request, each call time-limited, and every wait (including a server-requested
`Retry-After`, as seconds or an HTTP date) capped at 30 seconds. Any other error is a real answer
and blocks at once. When retries run out, `quick-mode/preflight.json` records a blocked check
with the connection, page, status, error codes and `attempts`. Normal setup discovery/execution and execution approval remain mandatory before
import. An inaccessible (e.g. password-protected), malformed, or changed endpoint is a durable
blocker: do not substitute a browser, credentials, or a different endpoint; create a durable
choice between stopping and standard mode instead. The standard-mode choice must carry this
effect so the CLI applies the user's selection before it resumes:

```json
{"kind":"decision","key":"managementImportMode","choices":{"switch_to_standard":"standard"}}
```

Records are normalized to the storefront-JSON row shape the import consumes (numeric legacy ids,
`body_html`, `variants[].option1..3`, `variants[].available`, `images[].src`), so crosswalks keyed
by Shopify id stay valid across adapter versions. A dry run writes only
`execution/dry-run-completion-report.json`, `execution/dry-run-final-report.md`,
`execution/dry-run-inventory-report.json` and `execution/dry-run-category-capacity.json`; it
never creates or changes a live artifact (the live completion, final and inventory reports, the
crosswalk, the limit-recovery log, the capacity file, the import-started marker or a re-check
file), so the router still sends the project to the live import afterwards.

Extraction persists the raw records and membership edges. Only collections that contain at
least one extracted product become categories (`manifest.entities.collection.excludedEmptyCount`
counts the rest): Wix Stores allows at most 1,000 categories per site, including the built-in
All Products category. Import checks that limit against the destination's current categories
before its first write and refuses, naming both counts, rather than creating categories up to
the cap and stranding the remaining memberships. The check counts only categories still to be
created (ones already crosswalked or already on the destination by slug are reused) plus the
built-in All Products category, and records `quick-mode/category-capacity.json`. When it is
`blocked`, nothing was written and the router returns `quick_mode_category_capacity_blocked`:
create a durable choice between `free_destination_categories_and_retry` (the operator frees
categories on the destination, then the import is re-run and rewrites the file as `passed`) and
`stop`. A dry run cannot see the destination, so it applies the same rule with the built-in
category as the floor and reports the real headroom as unknown. Collections left out for having
no imported product are listed by name in the completion report (`excludedCollections`) and the
final report, so the operator can recreate any the merchant still needs. Import uses the shared Stores V3
runtime, durable crosswalks, and checkpoints. The shared writer validates the product option and
variant payload; a record that cannot be represented safely is skipped and reported rather than
collapsed to a different product shape.

Quick mode maps each public Shopify variant's explicit `available` boolean to untracked
`inStock`; a missing or non-boolean value is a reported gap, never implicit availability.
Products created with the standalone endpoint are followed by shared inventory reconciliation.
Match returned variants by their option/choice identities, not response order or SKU. On
resume, keep the product crosswalk and reconcile stock for existing products too.

A product that exists on the destination with uniquely correlated variants but fails a field
read-back (for example a description fragment Wix dropped) is still reported as skipped and
listed in the summary's `writtenUnverified.product` (`sourceId`, `targetId`, `name`,
`failedFields`), but its stock is reconciled and its category memberships are written: both
depend only on product and variant identity, and a for-sale item must not be left with the wrong
stock because of an unrelated field. The run stays `partial` and the final report lists each such
product under "Products to check". A product whose variants do not correlate one-to-one gets no
stock and no category link, and is reported as a gap.

After the operator fixes or accepts those differences, `request-reverify` records a request
(`quick-mode/reverify-request.json`; refused when the live completion report lists none) and the
router returns `quick_mode_reverification_required` for a finished partial import. `reverify`
(refuses `--dry-run`) re-reads each listed product once with the import's read-back comparison and
only ever reads from Wix. It first stages its complete result in
`quick-mode/reverification-staged.json`, then publishes it by replay — completion report, final
report, then the receipt `quick-mode/reverification.json` — so a crash at any step is finished by
the next routing step without re-reading Wix. Once the receipt matches the request the same
request never routes again; a later fix needs a new request.

The post-create read retries a transient 404 briefly (the product can be unreadable for a moment
after its create); a failed create is never retried inline, because resume reuses it by slug.

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
