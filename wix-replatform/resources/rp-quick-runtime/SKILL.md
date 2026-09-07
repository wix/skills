---
name: rp-quick-runtime
description: Shared deterministic target-limit recovery and final-report runtime every rp-quick-<platform> quick-mode adapter uses before a Wix Stores write.
---

# rp-quick-runtime

Not invoked directly — this is a shared library (`lib/limit-recovery.js`), not a standalone
adapter. Every `rp-quick-<platform>` quick-mode adapter (`rp-quick-shopify`, `rp-quick-woocommerce`)
requires it from its own `scripts/quick-mode.js` and must use it from its first version (spec
0051, Decision 1). Platform adapters own source extraction and field semantics; this runtime owns
target-limit enforcement, recovery-ledger aggregation, and the human-readable final report — so a
Wix Stores validation limit never silently turns an otherwise-valid record into an opaque skip.

```js
const recovery = require('../rp-quick-runtime/lib/limit-recovery.js');

const normalized = recovery.normalizeProduct({ sourceId, sku, tagIds });
// normalized.sku / normalized.tagIds are the capped/trimmed values to write;
// normalized.recoveries lists what was capped or trimmed, if anything.
await writeProduct({ ...product, sku: normalized.sku, tagIds: normalized.tagIds });
// Record written_with_loss only after the target write succeeds.
if (normalized.recoveries.length) {
  await recovery.appendRecoveries(projectDir, adapterName, sourceId, normalized.recoveries);
  recovery.recordRecoveredRecord(summary, normalized.recoveries);
}
// ...after the run:
await recovery.writeFinalReport(projectDir, summary);
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
actionable account instead of a bare skip count.
