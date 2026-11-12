---
name: rp-quick-runtime
description: Shared deterministic target-limit recovery and final-report runtime every rp-quick-<platform> quick-mode adapter uses before a Wix Stores write.
---

# rp-quick-runtime

Not invoked directly — this is a shared library (`lib/limit-recovery.js`), not a standalone
adapter. Every `rp-quick-<platform>` quick-mode adapter (`rp-quick-shopify`, `rp-quick-woocommerce`)
requires it from its own `scripts/quick-mode.js` and must use it from its first version. Platform adapters own source extraction and field semantics; this runtime owns
target-limit enforcement, recovery-ledger aggregation, and the human-readable final report — so a
Wix Stores validation limit never silently turns an otherwise-valid record into an opaque skip.

```js
const recovery = require('../rp-quick-runtime/lib/limit-recovery.js');

const normalized = recovery.normalizeProduct({ sourceId, sku, tagIds });
// normalized.sku / normalized.tagIds are the capped/trimmed values to write;
// normalized.recoveries lists what was capped or trimmed, if anything.
await writeProduct({ ...product, sku: normalized.sku, tagIds: normalized.tagIds });
// Record written_with_loss only after the target write succeeds, and never in a dry run.
if (normalized.recoveries.length) {
  if (!dryRun) await recovery.appendRecoveries(projectDir, adapterName, sourceId, normalized.recoveries);
  recovery.recordRecoveredRecord(summary, normalized.recoveries);
}
// ...after the run:
await recovery.writeFinalReport(projectDir, summary, { dryRun });
```

`normalizeProduct` applies the two verified Stores limits deterministically: caps `tagIds` at
`STORES_PRODUCT_TAGS_MAX` (first-seen source order, extras omitted) and trims `sku` to
`STORES_SKU_MAX` Unicode-safe characters with a stable source-ID-derived suffix so a trimmed SKU
stays unique. Every cap/trim is reported back in `recoveries[]`, never applied silently.

`appendRecoveries` ledgers each recovery to `execution/quick-limit-recoveries.ndjson` under the
adapter's own name, tagged `outcome: written_with_loss` — the durable record of what was
preserved versus lost, per source record. Call it only after the target write succeeds.

`recordRecoveredRecord` increments `summary.recovered` once for the written source record and
increments `summary.recoveryCounts` once for each recovery event on that record.

`writeFinalReport` renders `execution/quick-mode-final-report.md`: a count of records imported
with deterministic recovery plus a per-recovery-code breakdown, so the operator gets a compact,
actionable account instead of a bare skip count. It adds a "Collections not migrated" section
from `summary.excludedCollections`, a "Products to check" section from
`summary.writtenUnverified.product`, and an inventory pointer when `summary.inventory` is set.
With `{ dryRun: true }` it writes `execution/dry-run-final-report.md` instead and sets
`summary.finalReport` to that path, so a dry run can never overwrite or stand in for the live
report. A dry run must write no live artifact at all (report, ledger, audit log, crosswalk or
marker); adapters skip those writes when `dryRun` is true. `writeFileAtomic` (temp file, then
rename) is the shared way to publish a report that a crash must not leave half-written.

`lib/import-progress.js` holds three more shared pieces. Each adapter's `import` first calls
`assertQuickImportAdapter`, which fails unless the plan and extract manifest both carry exactly
the loaded contract's `{ id, version, fingerprint }`. It then calls
`writeQuickImportStartedMarker(projectDir, plan.adapter)` before its first destination write.
It is skipped on a dry run and never rewritten on resume; concurrent first attempts publish
one marker (temp file, then a no-replace hard link). It writes
`state/quick-import-started.json`, which the router reads as evidence of an interrupted import.
`validateQuickExecutionManifest` is the router's check of the manifest that `plan` writes.
