---
name: rp-import-codegen
description: >-
  Generates migration readers, transforms, setup plans, and thin Wix write specs from schema and mapping
  artifacts. Use when producing runnable extract/import code under the migration project.
---

# rp-import-codegen

Generate source readers, transforms, setup/import entrypoints, and thin Wix write specs from approved migration artifacts.

## Purpose

This skill turns the schema, mapping, and setup decisions into implementation files under the active migration project.

## Required inputs

- `migrations/<project>/source-schema.json`
- `migrations/<project>/mapping/mapping-plan.json`
- `migrations/<project>/setup/setup-plan.json`
- `migrations/<project>/setup/setup-requirements.json` when setup affects write paths

Prefer the machine-readable artifacts above. Markdown review files are secondary renderings
for humans, not the primary codegen contract.

## Source read contract

Generating a correct reader requires platform-specific knowledge — auth model,
pagination, rate limits, and REST quirks. That knowledge lives in the matching **source
adapter** skill, not here, so this skill never names a platform. Resolve the adapter from
the `platform` field in `source-schema.json` via the naming convention `rp-source-<platform>`
(e.g. `platform: "wordpress"` → `rp-source-wordpress`) and read its "Read contract"
section. The operational facts should already be recorded in `source-profile.md`; use the
adapter to fill any gaps rather than guessing. `rp-execute-import` runs the reader you
generate and stays platform-agnostic — so the platform specifics must be baked into this
generated code, not deferred to execution.

Adding a new source platform therefore requires no change to this skill: a new
`rp-source-<platform>` adapter is enough.

### Reading plugin-provided entities

Entities that came from a source plugin carry extra `sourceMeta` the generated reader must
respect. These are read mechanics, not mapping decisions:

- **`origin: "embedded"`** — the records live inside a property of a parent record
  (`propertyPath`) on an already-fetched route (`embeddedIn`). Extract them from the parent
  fetch. Do **not** issue a second request per parent; some of these plugins have no route of
  their own at all.
- **`requiresParent`** — a sub-collection route parameterized by the parent id
  (`.../{id}/notes`). Read the parent first and iterate; order this after the parent entity in
  the dependency graph.
- **`channel: "plugin-rest-child"`** — a sub-resource on a CORE collection this plugin does
  not itself profile (e.g. WooCommerce orders), so it cannot use `requiresParent` (which
  points at another entity declared in the same profile). `route` carries a `{parentId}`
  template (`/wc/v3/orders/{parentId}/notes`); `parentRoute` names the collection route to
  iterate for real parent ids. Unlike discovery's `sampleChildEntities` (which checks only a
  representative few parents), the generated reader must iterate **every** parent record from
  `parentRoute` and fetch its child route — that full iteration is what actually migrates the
  data; the discovery-time sample only confirmed the shape is real.
- **`context`** — when the adapter says view and edit contexts return different data, request
  the one the entity declares. Requesting only one context can silently halve the result set.
- **Per-plugin credentials** — some plugin APIs use their own key system rather than the
  platform credential. Load them from project-local config like any other secret, and fail
  loudly with the missing key name rather than falling back to unauthenticated reads.
- **`recognized: false`** (derived entity) — no plugin-specific read contract exists; read it as an ordinary
  `wp/v2`-style collection using the shared transport. Do not invent plugin-specific handling
  for it.
- **`requestMethod`/`requestBody`** — the entity's real read path is not a plain GET
  collection; it is a declared non-GET method with a JSON body template (spec 0044). The
  generated reader must issue that exact method/body, not fall back to a GET.
  - A body value of the form `"$SAMPLED_IDS:<route>"` names another route whose record count is
    UNKNOWN and possibly unbounded (e.g. an entire product catalog) — never resolve it against
    one fixed id list fetched in a single request, at discovery time or at execution time,
    because `<route>` may hold far more ids than fit in one page or one request body. The
    generated reader must instead: (1) paginate `<route>` to exhaustion (every page, not a
    capped sample); (2) split the collected ids into bounded batches (mirror
    `lib/sampled-ids-batch.js`'s default of 50 ids per batch — do not send an unbounded id list
    in one request); (3) issue one request per batch against this entity's own route, with the
    placeholder resolved to just that batch's ids; (4) normalize each batch's RAW, unmodified
    response (envelope resolution, then `responseFragmentGroupSize` reassembly below — never
    pre-coerce a non-array raw response to an empty list before normalizing it, since an
    enveloped response is legitimately an object, not an array, until unwrapped) and merge the
    batches, deduplicating by `recordKeyField` (default `id`) — the same record can otherwise
    appear once per batch it happened to match; (5) stop and record the run as an explicit
    failure/deferred outcome on the first page or batch that cannot be read OR whose normalized
    result is not a valid array shape (a batch that doesn't match the declared envelope/fragment
    contract must defer the whole entity, not be counted as a legitimate empty batch — that
    would produce an exact-looking but false zero) — never emit a partial/undercounted or
    falsely-exact result as if it were complete. `rp-source-wordpress/lib/sampled-ids-batch.js`
    implements this exact algorithm (`collectAllIds`, `queryInBatches`) for `wp-discovery.js`
    itself; a generated reader for another platform must reproduce the same five steps, not
    invent a different policy.
- **`responseFragmentGroupSize`** — the response arrives as N separate flat single-key array
  entries per logical record instead of one object (a plugin bug some source APIs have). The
  generated reader must chunk the raw array into groups of N and merge each group with
  `Object.assign` into one record before any mapping/transform runs or any count is emitted —
  per batch when combined with a `$SAMPLED_IDS` requestBody above, mirroring
  `wp-discovery.js`'s `inspectEntity`/`normalizeResponseRecords` handling of the same field.

### `structure-bridge-plugin` entities (`channel: "db-only"`, spec 0101/0102)

An entity whose `blocked[].fulfillment.kind` is `structure-bridge-plugin` has no REST
route at all — its declared readiness (self-test passing, checked via
`blocked-data-handlers.js` at planning time, per `rp-mapper`) means it is safe to treat
as a normal candidate target, but its generated reader is genuinely different from every
other reader this skill generates: it reads through `wix-wp-plugin-v2`'s `/query` or
`/query/admin-key` route, not the platform adapter's own transport. This is **not**
resolved through `blocked-data-requests.js`'s one-shot `attemptFulfillment()`/snapshot
mechanism the way `csv-upload` is — that mechanism exists for a small, static,
human-provided document; a `structure-bridge-plugin` table is a live, potentially large,
paginated dataset, so it gets a normal incremental reader like any REST entity, just
reading from a different transport.

- **Vendor `rp-source-wordpress/lib/wix-wp-plugin-v2-client.js` into `src/lib/`**, the
  same way an ordinary WordPress reader vendors `wp-http.js`. Do not re-implement
  `discoverStructure()`/`queryStructure()` or their response validation.
- **Generate the same bridge credential selection discovery used.** When
  `WMH2_MIGRATION_KEY` is configured, call `queryStructure()` with
  `auth: { type: 'migration-key', migrationKey, siteId, migrationId, timeoutMs }` so the
  vendored client uses signed `/query`; preferring the key when it is available avoids
  capability drift on the `manage_woocommerce`-gated route. Otherwise, when WooCommerce is
  present and a WordPress REST credential is configured, pass the generated `httpClient`
  and omit `auth` to use `/query/admin-key`. Keep one stable `migrationId` for the
  extraction process and let the client create a fresh request `jti` per page. If neither
  usable bridge credential exists, halt to needs-user before opening the output file.
- **The structureRequest is fixed, not derived at codegen time.** Read it verbatim from
  the machine-readable artifact discovery already persisted:
  `data/wp-discovery/wix-wp-plugin-v2--<table>.structure-request.json`. **Never re-call
  `discoverStructure()` and rebuild a fresh default at codegen time**, even when the
  fulfillment declares no `sampleStructureRequest` of its own — the table's live schema
  could have changed between the discovery run and this codegen run, and re-deriving
  independently is exactly the drift this artifact exists to prevent; the sample and the
  full extraction must run the literal same request, not two requests that happen to
  usually agree. If the artifact does not exist (discovery never ran for this table, or
  discovery deliberately skipped building one — e.g. a >50-column table with no declared
  `sampleStructureRequest`, or a zero-column schema), this entity cannot be extracted
  yet: fail clearly, name the missing artifact path, and stop — do not invent a request.
- **Page at the plugin's maximum, 200 — not discovery's small sample limit.** Loop: call
  `queryStructure({ httpClient, auth: bridgeAuth, structureRequest, cursor, limit: 200,
  onSourceRead })`, append every returned row, and continue only while
  `pagingMetadata.hasNext` is true. `bridgeAuth` is `undefined` for the admin-key path and
  the migration-key auth object above for the signed path.
- **Pass `onSourceRead` on every `queryStructure` call, and file the totals once at the end**
  (spec 0122 §7):

  ```js
  const totals = { discovery_queries: 0, scoped_queries: 0, tier_refusals: 0, redacted_values: 0 };
  const tables = { discovery_tables: new Set(), scoped_tables: new Set() };
  const onSourceRead = (counts) => {
    for (const k of Object.keys(totals)) totals[k] += counts[k] || 0;
    for (const t of counts.discovery_tables || []) tables.discovery_tables.add(t);
    for (const t of counts.scoped_tables || []) tables.scoped_tables.add(t);
  };
  // ...after the read loop, once:
  //   node <rp-telemetry>/scripts/rp-telemetry.js source-read '<totals JSON>' --project <dir>
  ```

  The client derives the counts; the generated reader only accumulates and files them. Omitting
  the hook does not error — it just makes the run report that it read no key/value data, which
  is indistinguishable from a run that genuinely did not. Never abort an extraction because
  telemetry failed.
- **Check `redactionMetadata.redactedValueCount` on every page.** Non-zero means a returned
  value matched a credential shape and arrived as `[REDACTED:secret-shaped]`. Write the row
  through as-is — the redaction is the plugin's decision, not something to work around — and
  surface the count and column names in the extraction's own report. It is a finding about the
  source site: something there keeps a secret in that column.
- **A key/value table has TWO artifacts, and the second one is where the values come from.**
  `…--<table>.structure-request.json` selects key names only; running it verbatim extracts no
  values at all. The values come from `…--<table>.eav-read-plan.json`, which discovery writes
  beside it:

  ```jsonc
  {
    "table": "postmeta",
    "distinctKeyCount": 213,          // across every pair
    "keysTruncated": false,
    "expectedBatches": 5,             // total across all pairs
    "pageLimit": 200,
    "identityColumns": ["meta_id", "post_id"],   // ride every batch, so values attribute to a record
    "orderColumn": "meta_id", "orderByIsUnique": true,
    "pairs": [ { "keyColumn": "meta_key", "valueColumn": "meta_value", "distinctKeyCount": 213,
                 "batches": [ { "batchIndex": 0, "keys": ["…"],
                                "structureRequest": { /* runnable as-is */ } } ] } ]
  }
  ```

  **Run every `pairs[].batches[].structureRequest` verbatim, page each at `pageLimit`, and
  concatenate into the same NDJSON the single-request path writes.** The batching is already
  done — each batch pins at most the plugin's 50-key cap, carries the table's identity columns
  so a value can be attributed to the record it belongs to, and selects only the value column
  belonging to the key it pins. Never merge batches, never add another pair's value column, and
  never author a scoped request yourself: an unpinned value column is refused with a 400 that
  looks exactly like naming a nonexistent column, so a hand-built request fails in the least
  diagnosable way available.

  **The EAV checkpoint replaces the single-request checkpoint below — do not write both.** The
  single-request shape (one cursor, one snapshot total, one request hash) cannot resume a
  multi-batch plan: on restart there is no way to tell which batches already finished. Every
  property that shape has is still needed, but *per active batch*:

  ```jsonc
  { "planFile": "…--postmeta.eav-read-plan.json",
    "planHash": "6cbfc47c83d83264",  // the plan's own planHash, checked on resume
    "activeBatch": {                 // null between batches and when the plan is finished
      "batchIndex": 2,
      "cursor": "…",                 // opaque; null before the first page of this batch
      "hasNext": true,               // REQUIRED — see below
      "rowsRead": 88,
      "snapshotTotal": 412           // this batch's first page total, then carried unchanged
    },
    "completedBatches": [            // one entry per FINISHED batch, no duplicates
      { "batchIndex": 0, "rowsRead": 412, "snapshotTotal": 412 },
      { "batchIndex": 1, "rowsRead": 130, "snapshotTotal": 130 }
    ],
    "rowsWritten": 542 }
  ```

  - `hasNext` is required for the same reason the single-request checkpoint requires it: the
    plugin returns `cursors.next: null` on the last page, so `cursor: null` alone cannot
    distinguish "this batch has not started" from "this batch just finished its final page".
  - `planHash` replaces `structureRequestHash`, and for the same reason: discovery can re-run
    and rewrite the plan — the site gained or lost keys — and resuming a half-finished
    extraction into a different batch layout silently mixes two reads. `reconcileEavReadPlan`
    rejects a checkpoint whose `planHash` does not match the plan on disk; on a mismatch,
    restart the extraction rather than resuming it.
  - `batchIndex` is unique across the whole plan, including across pairs, so resume means "skip
    every `completedBatches` index, then restart `activeBatch` from its cursor".
  - ⚠️ Never record a batch in `completedBatches` twice. A resume that re-runs a finished batch
    duplicates its rows in the output; reconciliation rejects the duplicate rather than letting
    a doubled file promote.

  **Which keys?** The plan contains every key the site actually has, which is the complete
  extraction and the right default. A mapping step may narrow `batches` to the keys that matter;
  because the plan is a persisted, diffable artifact, that narrowing is reviewable instead of
  buried in generated code. Regenerate the plan rather than editing requests inside it.

  **Reconcile before promoting the `.tmp` file**, with `reconcileEavReadPlan(plan, {
  planHash: checkpoint.planHash, batches: completedBatches, rowsWritten })` from
  `wix-wp-plugin-v2-client.js`. ⚠️ `planHash` is required and must come from the CHECKPOINT —
  passing the plan's own makes the check compare the plan to itself. It returns the
  problems; a non-empty result must fail the extraction loudly. "It did not throw" is not
  completeness — it catches four things a partial run gets wrong silently:

  - a batch the plan expects never ran, named by index rather than merely counted;
  - a batch that read fewer rows than its own first page promised, i.e. its page loop stopped
    early;
  - `rowsWritten` disagreeing with the sum of what the batches actually read;
  - `keysTruncated: true`, meaning key discovery hit its cap, so the key list itself is
    incomplete and the extraction cannot be called whole-table;
  - a non-empty `droppedIdentityColumns`, meaning the table is wider than the 50-column select
    cap so **every extracted row is missing columns**. Narrow the mapping and regenerate the
    plan with an explicit column choice, or set `acknowledgedDroppedColumns: true` on the plan
    to record that the omission was chosen. It does not pass by default, because a per-record
    incompleteness nobody decided on is the kind that reaches an import unnoticed.

  ⚠️ It also reports `orderByIsUnique: false` — a table with no primary or unique column is
  paged on a repeating sort key, so rows can shift between pages. That extraction is
  best-effort and must be reported as such, never as complete.

  **If the plan is absent for a table whose schema reports an `eavPair`, stop.** That means key
  discovery failed during the discovery run; the entity's markdown says so. Do not fall back to
  the key-names request and report the result as an extraction.
- **Write through a temporary file, promoted atomically only after reconciliation
  passes — never write `data/source-extract/<entity>.ndjson` directly while the read is
  still in progress.** Append to `data/source-extract/<entity>.ndjson.tmp` and, after
  each durable append, checkpoint `data/source-extract/<entity>.ndjson.tmp.cursor.json`.
  ⚠️ **For a key/value table this is the EAV checkpoint shape above, not the single-request
  shape here** — the two are alternatives, never both. The single-request shape is
  (`{ "cursor": "...", "hasNext": true|false, "rowsWritten": N, "snapshotTotal": M,
  "structureRequestHash": "..." }`). `snapshotTotal` is the first page's
  `pagingMetadata.total`, captured once and carried through every subsequent checkpoint
  unchanged. `structureRequestHash` is a hash of the exact structureRequest this read
  started with (the JSON read from the sidecar at the start of THIS read, not re-read on
  every page) and is likewise carried unchanged through every checkpoint of the same
  read. wix-wp-plugin-v2's cursor is an opaque, HMAC-signed token encoding a frozen
  snapshot (spec 0101's "Pagination" section) — unlike an ordinary REST reader's
  `page`/`offset`, it cannot be reconstructed from row count alone, so the checkpoint is
  the only way to resume correctly. **`hasNext` is required, not cosmetic: the plugin
  returns `cursors.next: null` on the last page precisely because there is nothing
  further to fetch, so a checkpoint's `cursor: null` is ambiguous between "never started"
  and "just finished the final page" unless `hasNext` is also recorded.**
  **`structureRequestHash` is required for the same reason a final file needs a
  manifest: discovery can re-run and rewrite the sidecar to a different approved query
  while a `.tmp` from an earlier read is still in progress, and the plugin's cursor
  encodes only an offset and a snapshot total — it has no way to detect that the query
  underneath it changed. Without this check, a resume would silently splice rows queried
  under the old request with a continuation queried under the new one, and the file would
  end up permanently mislabeled by whichever request happened to be current when it was
  promoted.** On resume, first hash the CURRENT sidecar and compare it against the
  checkpoint's `structureRequestHash`:
  - If they differ, the approved query changed since this `.tmp` was started. DELETE both
    the `.tmp` file and its checkpoint and restart the read from `cursor: null` into a
    freshly created `.tmp`, using the current sidecar's request and hash — do not attempt
    to salvage or continue rows written under the old request.
  - If they match, compare the `.tmp` file's own line count against the checkpoint's
    `rowsWritten`:
    - If they match and `hasNext` is `true`, continue paging from the saved `cursor`,
      using the same structureRequest this read started with.
    - If they match and `hasNext` is `false`, the read itself is already complete — skip
      straight to the completion reconciliation below (comparing `rowsWritten` against
      the checkpoint's own `snapshotTotal`, with no further plugin call) and promote.
      **Do not call `queryStructure` again with `cursor: null` in this case** — that
      re-issues page one and appends a full duplicate copy onto an already-complete temp
      file.
    - If they do not match (a prior interrupted write), DELETE both the `.tmp` file and
      its checkpoint and restart the read from `cursor: null` into a freshly created
      `.tmp` file — resuming a mismatched cursor against stale content, or restarting
      from `cursor: null` while appending onto the existing (possibly stale or partial)
      file, both duplicate rows.

  Reconciliation passing is not the last check. **Immediately before promoting — even on
  a single uninterrupted run that never needed to resume — re-hash the current sidecar
  one more time and compare it against the checkpoint's carried `structureRequestHash`.**
  All of the pages in this read could have completed correctly under request A while
  discovery replaced the sidecar with request B somewhere in the middle; nothing earlier
  in this contract catches that, because the resume-time hash check above only ever runs
  when a read is picked back up after being interrupted, not at the end of one that ran
  straight through. If the hashes differ at this final check, do **not** promote — leave
  the `.tmp` file and its checkpoint in place (recording `structureRequestHash: A`,
  exactly as it was throughout the read) and report the entity as a deferred extraction,
  the same as any other unresolved page error; the next run's resume logic will see the
  mismatch and correctly restart under the now-current request. Writing the manifest with
  request A's hash after promoting under request B would make the bookkeeping honest but
  would still let request A's data reach `data/source-extract/<entity>.ndjson` and
  everything downstream of it after B became the approved query — the check has to block
  the promotion itself, not just label what already happened.

  ⚠️ **For a key/value table, substitute `planHash` for `structureRequestHash` throughout the
  paragraph above.** The hazard is identical — discovery can replace the plan mid-read, and only
  a final re-hash catches a read that ran straight through under the old one — but the artifact
  is the read plan, so re-derive the hash of `…--<table>.eav-read-plan.json` and compare against
  the checkpoint's `planHash`. **Use `eavReadPlanHash(plan)` from
  `wix-wp-plugin-v2-client.js` — never `JSON.stringify` and hash it yourself.** It excludes the
  plan's own `planHash` field (a hash cannot cover itself) and sorts keys, so the value it
  returns is the one discovery stamped. Three call sites hashing "the plan" three slightly
  different ways is how this check ended up unable to detect anything. There is no single `structureRequest` to hash: an EAV read runs one
  request per batch, all of them derived from the plan, which is why the plan is the unit of
  provenance. `reconcileEavReadPlan()` **requires** `planHash` in the observation it is given —
  pass the checkpoint's, never the plan's own, or the check compares the plan to itself and
  proves nothing.

  Only once this final hash check and the completion reconciliation above both pass does
  the `.tmp` file get renamed (atomically) to `data/source-extract/<entity>.ndjson` and
  its checkpoint deleted, and the manifest below written using the checkpoint's own
  `structureRequestHash` (now confirmed current, not merely carried).

  ⚠️ **That order is load-bearing: rename first, write the manifest second.** The two writes
  cannot be atomic together, so one has to survive a crash between them. Writing the manifest
  first means a crash leaves a NEW manifest sitting beside an OLD final file — it verifies
  cleanly against data it does not describe, and the next run reuses stale rows silently.
  Renaming first means a crash leaves a fresh file with a missing or stale manifest, which the
  reuse check refuses, so the entity is re-extracted. Re-doing work is the acceptable failure;
  trusting the wrong rows is not. If
  `data/source-extract/<entity>.ndjson` already exists (no `.tmp` in progress), do not
  assume it is complete just because the file is present — see the manifest/provenance
  check below before trusting it.
- **A final `.ndjson` file is only trustworthy if it was produced by the structureRequest
  currently on file.** On promotion, write
  `data/source-extract/<entity>.manifest.json` recording the read's own
  `structureRequestHash` (the same value carried through its checkpoints, not
  recomputed), plus `rowsWritten`, `snapshotTotal`, and the extraction timestamp. Before
  treating an existing `data/source-extract/<entity>.ndjson` as already fully extracted,
  hash the CURRENT sidecar and compare it against the manifest's stored hash. A match
  means skip re-extraction. A mismatch — the table's approved query changed since that
  file was written — or a missing manifest means the existing file is stale: do not reuse
  it; re-extract from `cursor: null` into a fresh `.tmp` the same as if no file existed.

  ⚠️ **A key/value table's manifest has a different shape, because the read did.** There is no
  single `snapshotTotal` — each batch has its own — and no single `structureRequestHash`:

  ```jsonc
  { "kind": "eav-read-plan",
    "planFile": "…--postmeta.eav-read-plan.json",
    "planHash": "6cbfc47c83d83264",
    "completedBatches": [ { "batchIndex": 0, "rowsRead": 412, "snapshotTotal": 412 } ],
    "rowsWritten": 542,
    "keysTruncated": false,
    "droppedIdentityColumns": [],       // non-empty = rows are incomplete per record
    "acknowledgedDroppedColumns": false, // the APPROVAL that let an incomplete read promote
    "orderByIsUnique": true,            // false = paging was best-effort
    "ndjsonDigest": "sha256…",          // binds this manifest to the file it describes
    "extractedAt": "…" }
  ```

  Build it with `eavExtractionManifest(plan, { planFile, completedBatches, rowsWritten,
  extractedAt, ndjsonDigest })` rather than by hand, so a new qualifier cannot be forgotten at
  one call site. It refuses a missing `planFile` or `ndjsonDigest`, and
  `eavExtractionIsReusable()` requires every field it emits — the documented shape and the
  builder are the same contract, checked both ways.

  ⚠️ **Compute `ndjsonDigest` from the promoted file, with `eavExtractionFileDigest()`, AFTER
  the rename.** Every other field describes the read that was supposed to happen; this is the
  only one that says what actually landed on disk.

  Decide reuse with `eavExtractionIsReusable(plan, manifest, observed)`, which returns the
  reasons an existing file cannot be trusted; empty means skip re-extraction. `observed` is what
  is on disk **right now** and is required:

  ```jsonc
  { "planFile": "…--postmeta.eav-read-plan.json",  // the path YOU resolved for this entity
    "ndjsonDigest": "sha256…",                     // eavExtractionFileDigest(<final file>)
    "ndjsonRowCount": 542 }                        // lines in the final file
  ```

  ⚠️ **Never open `manifest.planFile`.** A manifest is untrusted input — it can name
  `../../something-else.json` — so following its path would let the file choose what it is
  validated against. Pass the sidecar path you already resolved; the check compares the two and
  refuses a mismatch. The same reasoning is why the digest and row count come from the file you
  are about to reuse, not from the manifest: a manifest that is only checked against itself
  cannot detect a truncated, replaced or half-written NDJSON beside it. ⚠️ **The plan hash alone is
  not the whole decision.** `acknowledgedDroppedColumns` is deliberately excluded from the hash
  so that acknowledging an omission cannot invalidate an in-flight resume — which means
  *withdrawing* it would leave the hash unchanged, and an extraction that promoted only because
  someone approved its missing columns would still look reusable. The reuse check compares the
  approval directly, in both directions: withdrawn, and no-longer-needed.

  The staleness half is the same idea against the plan: `eavReadPlanHash()` the current plan
  file and compare with the manifest's `planHash`; a mismatch or a missing manifest means
  re-extract. ⚠️ `reconcileEavReadPlan()` additionally verifies the plan against ITS OWN embedded
  hash before anything else, so a plan file edited by hand after discovery wrote it is refused
  outright — without that, `planHash` only proved two strings matched. Carry
  `keysTruncated`, `droppedIdentityColumns` and `orderByIsUnique` into the manifest **because
  they qualify what the file contains** — a downstream consumer reading an extraction that
  silently omitted columns, or was paged on a tying sort key, must be able to learn that from
  the artifact rather than from whoever happened to run it.
- **Fail clearly, never loop or silently truncate**, if `hasNext` is true but the
  returned `cursors.next` is missing or identical to the cursor just used — record the
  entity as a failed/deferred extraction with that reason (leaving the `.tmp` file and
  its checkpoint in place for the next resume attempt), the same as any other reader's
  unrecoverable page error.
- **Reconcile before promoting, never after.** The first page's `pagingMetadata.total`
  is the frozen snapshot total for the whole read. Before renaming `.tmp` to the final
  `.ndjson`, compare it against the `.tmp` file's own line count; a mismatch is reported
  as a failed/deferred extraction, and the `.tmp` file is NOT promoted — a row inserted
  or deleted mid-read can still shift a page's contents (the accepted residual gap spec
  0101 documents), but the counts themselves must always be checked before anything
  downstream is allowed to treat this entity as complete.
- **Authorization and query validation are the plugin's job, not the reader's.**
  wix-wp-plugin-v2 re-validates every identifier against a live `DESCRIBE` on every
  request; the generated reader only needs to treat the plugin's 403/404 responses as a
  failed extraction for that entity, not re-derive its own authorization logic.

### CSV sources (`platform: "csv"`)

When `source-schema.json.platform === "csv"`, generate a **file reader** instead of an HTTP
reader and read `rp-source-csv` → "Read contract". The differences that matter:

- **Vendor `lib/csv-parse.js` into `src/lib/`** and import it, exactly as a WordPress reader
  vendors `wp-http.js`. Do not re-emit parsing: the sampler and the reader must agree on what
  the file contains. There is no auth, no pagination, and no rate limiting to generate.
- **Grouping is the reader's core job.** Replay `sourceMeta.sourceFiles[].layout`: with
  `continuation: "blank-key"` a blank key extends the current group; with a `sectioned`
  pattern the discriminator column routes parent vs child rows and `parentRefColumn` resolves
  a child to its parent (it may hold `id:123` or a SKU, and the child is not guaranteed to
  follow its parent).
- **Iterate the file set** by role, treating `sourceFiles[].partOf` entries as continuations
  of the same logical stream and honoring each part's own column order.
- **Materialize `column-values` entities**: collect the distinct values of the source column
  and their ancestors into their own entity file, emitted depth-ascending so a parent
  category exists before its child, plus the linking relation. Do not invent Wix ids at
  extract time — the `ImportCrosswalk` resolves them at import time.
- **Apply `sourceMeta.dialect.emptyPolicy`** through the shared `coerceEmpty` helper so a
  required Wix field is never fed an empty string the source did not have.
- CSV values are plain text; write them as-is with no entity-decoding step.

## Target write contract

Symmetrically, do **not** re-derive the Wix write surface here. It is identical for
every migration and is pre-verified in the **`rp-target-wix`** internal resource (see
`CONVENTIONS.md`), which ships shared Wix runtime code: verified request builders,
executors, and reusable execution logic for retries, throttling, checkpoints, and
reporting. **Vendor copies of the shared runtime modules from `rp-target-wix` into the
project** (like the source transport) and generate thin project-specific write specs and
transforms that **call those shared primitives/runtime functions**. Never hand-emit Wix
endpoints/bodies inline —
that path repeatedly shipped wrong shapes (lowercase Ricos plugin enums, `{tag:{…}}`
tag bodies, `media.wixMedia.image.id` featured images) that only failed at execution.

**Validate by real call, not by doc example.** MCP doc checks confirm an endpoint
*exists*; they do not confirm the request *shape works* — public examples have been
wrong (e.g. Ricos plugin enums shown lowercase that 400). Trust a Wix request shape only once a real call (or
`tests/target-wix/contract-test.js` in live mode, run from the repo root) has succeeded. Treat the
adapter's `// VERIFIED:` shapes as the source of truth over any docs example.

Adding a new source platform requires no change here, and the Wix surface change for
*all* migrations is a one-place edit in `rp-target-wix` (caught by its contract test),
not a per-project regeneration.

## Workflow

1. Read the discovery, mapping, and setup artifacts, plus the source adapter's read
   contract and the `rp-target-wix` write contract.
   If a mapping entity includes `targetRef`, validate its selected writer and reliability
   against `rp-target-wix/scripts/domain-knowledge.js summarize-entities`; do not remap
   source entities independently.
2. Generate machine-readable execution artifacts:
   - `execution/execution-manifest.json`
   - `execution/llm-handoff.json`
   - when `SAFE_MODE=true` or `DRY_RUN=true`, `execution/review/code-safety-review.md`
   - optional supporting execution subplans only when the runtime truly needs them
3. Generate setup code that can verify/provision Wix prerequisites by executing the
   machine setup artifacts through the shared setup runtime.
4. Generate source reader code that can enumerate and fetch source entities. If the adapter
   ships a shared transport module (auth, pagination, throttling, retries), vendor a copy of
   it into the project (e.g. `migrations/<project>/src/lib/`) and import from it instead of
   re-emitting that plumbing — the reader should hold only per-project orchestration.
   The reader must extract source records to durable files on disk; it must not require the
   whole source dataset to live in memory before import begins.
5. Generate transform code that maps source records into Wix-shaped objects — thin glue over
   `wix-build.js`, which already owns slug sanitizing and the money/price/variant rules; see
   "Never hand-write slug sanitizing" below.
   **Wix Stores products: Catalog V3 only. Catalog V1 is not supported by this workflow —
   there is nothing to generate for it.** The only destination a migration ever writes to is
   a `V3_CATALOG` site (guaranteed at provisioning — see
   `0079-catalog-v3-guaranteed-retire-v1-gate.md`), so generated code may
   assume V3 unconditionally: no version detection, no branch, no V1 shape, no V1 fallback
   for a failing V3 write. A V1 site (only reachable on a pre-existing site this run did not
   create) is a **blocker the run halts on**, never a case codegen handles. Concretely: never
   emit Catalog V1-style top-level `price`, `sku`, or legacy inventory objects.
   V3 `variantsInfo.variants[].inventoryItem` is handled by the inventory contract below. For simple products, emit one variant under
   `variantsInfo.variants[]` with variant-level `price`, `sku`, and physical properties.
   When the source product is subscription-based and the source payload exposes explicit
   recurring cadence in structured product data, emit native
   `product.subscriptionDetails` with at least `allowOneTimePurchases` and one
   `subscriptions[]` entry carrying `title`, `description`, `frequency`, `interval`, and
   `autoRenewal`. Do not emit placeholder-only metadata or skip those products on create
   when that cadence can be inferred deterministically; live create coverage for this
   shape was verified on July 26, 2026.
   Product HTML descriptions land in `plainDescription`, which Wix converts to rich content
   server-side — it is HTML, not a plain-text flattening, so there is no fidelity loss to
   accept. Do NOT call the Ricos conversion endpoint on the product path: it costs one HTTP
   round-trip per product ahead of a bulk create, and that burst is what the endpoint throttles
   with a 403. Two traps: `plainDescription` is silently ignored when `description` is also set
   (set exactly one), and it is capped at 16,000 characters — longer bodies need truncation or
   an info section, recorded in `mapping-gaps.json`. Ricos conversion remains correct for blog
   posts, where `richContent` really is a Ricos document.
   Media scope should be relationship-driven by default: generate imports only for media
   referenced by mapped entities, not for the entire unattached source library. When the
   target adapter says an entity can ingest external URLs directly (for example Wix Stores
   product media), generate that entity-native path instead of routing those files through
   the slower generic Media Manager import flow.
   **Never let generated code name an image field.** A source image reference usually carries
   several URLs for the same picture at different sizes, and the field that holds the original
   differs between routes of the same source — so `images.map((i) => i.src)` is a codegen
   defect, not a shortcut. Emit a call to the source adapter's resolver instead (WordPress:
   `resolveImageUrls` in `rp-source-wordpress/lib/wp-image-url.js`), which returns the
   original at maximum resolution, percent-encoded, with `altText` and `displayName` attached.
   The destination copies the one URL it is given and cannot be upgraded later, so a crop
   emitted here is permanent.
   **Never let generated code treat a media write's 200 as done.** Entity-native ingestion is
   asynchronous: the destination acknowledges the queue entry and fetches the file afterwards,
   and the write is a full replace, so a fetch that fails later leaves the entity with **no
   image at all** — no error, and the previous image already discarded. Measured live on one
   catalog, 17% of items had not ingested 60 s after an accepted write. Generated media code
   must therefore read the entity back and re-send whatever did not land, and must feed BOTH
   failure kinds — the write that was refused (429) and the write that was accepted but never
   ingested — into the same retry list. Call `patchStoresProductMediaVerified` rather than
   `patchStoresProductMedia`; emitting the unverified writer for a media-bearing import is a
   codegen defect. Whatever never lands is reported per entity, by name — never summarised
   into a count.
6. Generate thin project-specific write specs and import orchestration code that pass
   those Wix-shaped objects into the shared `rp-target-wix` runtime. Generated code should
   describe *what* to write and in what order, not *how* to implement retries, throttling,
   checkpointing, or audit logging.
   Prefer the selected entity's `preferredWrite`; if it is not `verified-live`, surface an
   execution warning before consent. Native mappings must have a known `writerId`, a
   direct REST plan that calls `notifyMissingWriter`, or an explicit unsupported/gap
   fallback.
7. Generate or wire the deterministic execution-state preparation step before any import
   write. The generated runner should call the shared `execution-state` preparation
   contract, or the execution instructions should run
   `skills/wix-replatform/scripts/execution-state-prepare.js` before the generated import
   entrypoint.
8. Generate the runnable setup/extraction/import entrypoints (see below) — the artifacts
   `rp-execute-setup` and `rp-execute-import` actually run. This is required, not optional.
   Then run the **sample-preview gate** (see below) before the execution-plan approval.
9. Generate `execution/review/import-plan.md` plus
   `execution/review/import-plan.freshness.json` using
   `skills/wix-replatform/scripts/artifact-freshness.js write ...`. The freshness metadata
   must include hashes for `source-schema.json`, `mapping/mapping-plan.json`,
   `setup/setup-verification.json`, generated import code, and the target contract ledger
   revision. If codegen follows a newly promoted write contract, regenerated code and this
   metadata must reflect that promotion.
10. Document any manual code follow-up still required.
11. Generate any post-import remediation helpers that are required to reach the accepted
   mapping fidelity when the source capture cannot express the relationship inline during
   the first create pass.

## Post-codegen code-safety review checkpoint

When either `SAFE_MODE=true` or `DRY_RUN=true` for the active project, codegen must
produce a mandatory review artifact before the execution approval gate:

- `migrations/<project>/execution/review/code-safety-review.md`

This review is performed by the agent, not delegated to the user. It verifies the
generated code itself. It must check:

- every generated write path that can carry email/phone data passes `safeModeOptions`
  into the shared Wix runtime or direct REST wrapper
- every shared/native writer reached by generated code actually consumes those
  `safeModeOptions` and routes the request body through the shared sanitizer rather than
  silently ignoring the parameter
- no generated writer path silently bypasses safe mode because of a missing function
  parameter or a direct call that skips the shared sanitizer
- dry-run uses the same generated write code path as live import, with Wix calls skipped
  only at the shared `wix.send` boundary
- dry-run reporting does not label would-send placeholders as live-created/imported site
  objects
- mapping-declared `safeModeReplacements[]` are reflected in the generated write specs and
  runner wiring, and any entity that still carries outbound contact data without matching
  replacement-path coverage is treated as a review failure rather than left for the user
  to reason about manually

If the review finds a gap, execution approval must remain pending until the generated
code is corrected and the review artifact is regenerated with a passing verdict. The
user's role at this checkpoint is final go/no-go approval after the agent has already
completed the review and surfaced the findings.

## Codegen boundary

This skill owns the **project-specific layer** only.

It should generate:

- setup plan renderings and setup runner wiring
- source readers
- transforms
- per-entity write specs
- import ordering and dependency wiring
- project-local config loading
- execution review artifacts
- post-codegen code-safety review artifacts when safe mode or dry-run is enabled

It must not regenerate for each migration:

- raw Wix auth/client plumbing
- generic retry loops
- throttling behavior
- audit log shape
- compact execution report shape
- checkpoint store mechanics
- generic bulk-write orchestration

Those behaviors belong in `rp-target-wix`.

## Final handoff expectations

The generated plan and downstream execution path must make the final state legible to the
user. Treat these as required handoff details, not optional niceties:

- Surface the **dashboard URL** for the destination site.
- Surface the **editor URL** only when editor work was actually performed or the next
  required step is explicitly in the editor.
- Surface the **preview URL** only when public route/site verification is relevant to the
  completed work.
- Distinguish clearly between:
  - **catalog/data imported**
  - **website/homepage built**
- Do not imply that a successful Stores import means the site's homepage or full website
  experience exists. A migration can finish with valid catalog/product/cart/checkout
  routes while the homepage is still blank or unbuilt.
- If Shopify quick mode relies on public collection feeds such as
  `/collections/{handle}/products.json` to recover category membership, bake that into the
  generated extractor/importer or emit an explicit remediation helper and call it out in
  `execution/review/import-plan.md`.

## Runnable setup/extraction/import entrypoints — the artifacts are the execution path (required)

`rp-execute-setup` and `rp-execute-import` run the migration by **executing these
artifacts**, never by the agent hand-issuing Wix MCP calls. So codegen must emit real,
runnable entrypoints:

- **`src/setup/run-setup.js`** or equivalent setup entrypoint — reads the machine setup
  artifacts and executes them through the shared setup runtime.
- **`src/extract/run-extract.js`** or equivalent reader entrypoint — reads the source APIs and
  writes durable extracted files under the project. Extraction is a separate step from
  destination writes, so large migrations can be resumed or re-imported without re-reading
  the whole source.
- **`src/import/run-import.js`** or equivalent import entrypoint — reads the extracted files,
  applies transforms, and writes to Wix in dependency order through the vendored shared
  write runtime. It must:
  - load project-local config files, then process env, for all expected env-style values
    (never hardcoded; fail fast if absent — do not fall back to any agent/MCP auth),
  - run the **notification-mute preflight** before the first entity write whenever mute
    is in effect (see "Notification-mute preflight" below),
  - consume extracted source files from disk rather than materializing the entire source in
    memory,
  - apply idempotent dedupe keyed by source ID, using either a client-controlled source-id
    field on the target or the authoritative local
    `state/crosswalk/crosswalk.ndjson` durable `sourceId -> targetId` crosswalk for native Wix
    entities with server-assigned IDs, reading existing target state under the rules in
    "Reading existing target state" below — an empty read is not an empty site,
  - honor `DRY_RUN=true` and `--dry-run` for the safe-validation pass; `--dry-run` takes
    precedence over config and enables the shared Wix runtime's dry-run mode.
  - `--sample` may be supported as a narrower dry-run-style validation mode, but it must
    not replace `--dry-run` as the primary safe-validation control.
  - honor deterministic selective resume flags: `--entity <entity>`,
    `--source-type <subtype>`, `--missing-only`, `--failed-only`, and `--deferred-only`.
    `--missing-only`, `--failed-only`, and `--deferred-only` are mutually exclusive. These
    flags must drive the same import path as a full run after selecting a stable record
    set; do not generate one-off recovery drivers.
  - support a `--rerun` catch-up mode (spec 0140) built on `lib/import-recovery.js`'s
    `selectRerunRecords`, which buckets the refreshed scope into create / update / unchanged /
    unknown against the crosswalk baseline. **Do not build this out of `--missing-only` plus
    `--failed-only`** — those filters do not compare source versions. Contacts/products
    deliberately recheck crosswalk hits, while other entities may exclude them; failed-only
    only revisits what was already attempted. On every confirmed write,
    persist the version pair (`sourceVersionField` + `sourceVersion`, or the declared
    `sourceHash` fallback, plus the returned `targetRevision`) through
    `nextCrosswalkBaseline`, which refuses to advance on a failed, conflicted, dry-run or
    skipped write. Route an update through the entity's **verified revision-taking update
    writer** and, on a revision conflict, through `lib/rerun-conflicts.js` to a user decision —
    never through a silent revision refresh, and never through a same-id create/import as a
    substitute for an update. `updateSupportFor` enforces that in code rather than leaving it
    to this prose: declare `{ writerId, revisionParam }` per entity in the accepted mapping,
    and honour its `report_for_review` outcome. The order family is denied there outright, so a
    changed order must be reported, never written. Honour the selector's other buckets too —
    `needsReconciliation` (an uncertain prior attempt, or an unchanged contact/product
    that still needs target identity/value verification), `outOfScope` (pass the accepted scope as `inScope`), and `reportForReview`.
  - emit a stable `runId` at process start and include it in every audit event, dry-run
    request capture, placeholder crosswalk row, and summary artifact.
  - emit `execution/live-import-summary.json` and `execution/completion-report.json`
    through the shared completion-report runtime, with entity/subtype completeness counters
    for extracted, in-scope, attempted, imported, already present by crosswalk, deferred,
    failed, and skipped-out-of-scope records.
  - stop before dependent phases when required upstream entities fail. For example, do not
    create products after product-category failures unless the execution plan explicitly
    marks category assignments as non-blocking.
  - pass `safeModeOptions` to every relevant writer path, including direct REST fallback
    paths and unverified native writers that can carry contact values.
- **The dry-run is the same import code path with Wix calls skipped at the shared Wix
  boundary** — not a separate driver. Generated code must construct the same Wix client,
  call the same writer helpers, run `SAFE_MODE` sanitization, and pass request metadata
  (`phase`, `operation`, `entity`, `sourceId`, `verification`, and when needed
  `responseShape`) into `wix.send` so the runtime can capture would-send requests and
  return live-compatible dry-run placeholders.

Extraction format requirements:

- write extracted data to project-local files, not process memory
- chunk by entity and page/batch so a large source does not become one giant file
- write a manifest that lets the import step discover which entity files exist and in what
  order to consume them
- make the extracted files deterministic enough for resume, replay, and debugging

### Notification-mute preflight (required)

When mute is in effect — **always** for `WIX_SITE_STRATEGY=new` (unconditional,
regardless of `WIX_MUTE_NOTIFICATIONS`), and for existing sites only when
`WIX_MUTE_NOTIFICATIONS=on` — the generated import script must contain a mandatory
preflight step, **before the first entity write**, that asserts the site is muted:

- Primary: `getSiteMuteState(wix)` (rp-target-wix, VERIFIED 2026-08-04) returns
  `muted: true`.
- Fallback (only if the status read is unavailable): an idempotent
  `muteSiteNotifications(wix, { reason })` call — passing the **same
  project-identifying reason as setup** (`RePlatform migration — <project>`), because a
  re-mute overwrites the recorded reason (last caller wins).

If the preflight call fails or reads `muted: false` and the re-mute fails, the script
**aborts before any write** with a clear error routing back to setup — exit non-zero, no
degraded mode, no `--skip-mute-preflight`-style flag, no warning-and-continue. For
new-site projects the preflight is emitted unconditionally and never appears as a
skippable option; for existing-site projects with `WIX_MUTE_NOTIFICATIONS=off` (the
default), no preflight is emitted. The preflight logs its re-verification and outcome
into the run's execution/progress log (keyed by `runId`) — terminal reports read this
recorded state, never strategy/config inference. In dry-run mode the preflight follows
the shared dry-run contract like any other Wix call: the intent is captured and the
state read is skipped (`stateKnown: false`), not asserted as muted. The generated script
must never call `unmuteSiteNotifications` — unmute is an explicit owner request outside
the import path. A preflight mute-verification failure is recorded through the standard
`rp-telemetry` recorder as an `error` event (with `error_code`) like any other run
event — no new telemetry surface.

### Use the target's BULK write path (required)

**A generated importer must write through the target's bulk endpoint whenever one exists.**
Per-record creates are acceptable only when the target has no bulk equivalent, or for a
deliberate single-record contract probe. This is not an optimization to add later: at 1000
products, per-record creates are 1000 round trips where bulk is ~11, and the latency
difference is the difference between a minute and half an hour.

Derive the batch shape from the endpoint's **own limits, all of them at once**. Bulk
endpoints routinely cap several dimensions simultaneously and exceeding **any one** rejects
the entire request — Wix bulk product create caps products (100), variants (1000), options
(100), modifiers (100) and infoSections (100) per request, so with 2 options per product the
options cap binds at 50 products, not 100. Batch with `ndjson.readBatchesByLimits` and the
limits/cost helpers the target adapter exports (`BULK_PRODUCT_LIMITS`,
`storesProductBulkCost`); never batch on record count alone.

Three properties of bulk responses that generated code must handle explicitly, because each
one silently corrupts a report if ignored:

- **Bulk is not atomic.** A `200` can contain per-item failures. Walk every
  `results[]` entry; never infer success from the HTTP status.
- **Correlate by the response's own index field** (`itemMetadata.originalIndex` for Wix), not
  by response position, and verify that every input is accounted for. A mis-correlated
  result crosswalks the wrong target id onto a source record.
- **Count the "undetailed failures" bucket.** Servers drop failure detail past a threshold;
  those are still failures and must appear in the completion report.

Dedupe **before** building the batch — a skipped record must never reach the API — and
retain each successful item’s source identity. The verified wrappers durably checkpoint
these outcomes in batches before publishing verified crosswalk references; do not rewrite
the full crosswalk and its indexes for each item.

### Contact and product identity verification

Generate standard contact/product imports through `contact-import.js` and
`product-import.js`, not a loop that publishes `bulk.succeeded` directly. Vendor their
`bulk-results.js`, `write-verification.js`, and root `lib/write-verification-state.js`
dependencies with the existing local-state/runtime files, preserving the relative layout.
The wrappers own prewrite reconciliation, source-index correlation, candidate persistence,
read-back, and publication of verified mappings. Raw writers remain request primitives.

Select `sourceKey` and all expected fields from the source mapping BEFORE sending a write.
Contact rows carry `{sourceKey, sourceId, sourceSystem, contact, safeModeOptions,
updateMember}`. Supply per-record safe-mode options so a batch cannot acquire one shared
replacement identity. Phone-only identities and conflicting source/target identifiers
block and report; there is no automatic merge or V4 fallback. Contact custom-field setup
must already be resolved; the shared DES setup helper still supports orders only.

Product rows carry `{sourceKey, product, expected, marker, variantExpectations}`.
`expected` includes every mapped readable product field; exclude write-only inventory
fields and verify them through the inventory pass. `marker: {path, value}` is source-derived
(e.g. a unique mapped slug), not copied from a returned product. Each variant expectation
carries `{sourceKey, expected, inventory}` with an unambiguous source-fixed SKU/choice
projection. Include submitted variant choices in that projection; an unverified choice
shape must remain a gap, even when SKU and price agree. The wrapper resolves exact target
variant IDs, retaining the correspondence
in each verified receipt. A missing or ambiguous match remains a gap, never a positional zip.

Use this caller shape; `toolkitRoot` is the installed or vendored wix-replatform root
and `dryRun` is the shared runtime's resolved dry-run flag:

```js
// BEGIN verified-contact-import
const { importContacts } = require(require('node:path').join(toolkitRoot, 'resources/rp-target-wix/lib/contact-import.js'));
const { createCompletionReport } = require(require('node:path').join(toolkitRoot, 'lib/completion-report.js'));
const contactVerification = await importContacts(wix, {
  projectDir, siteId, rows: contactRows, dryRun,
});
const completion = dryRun ? { status: 'simulated', verification: { contacts: contactVerification } } : createCompletionReport({
  siteId,
  entityCompleteness: [{
    entity: 'contacts', verificationKind: 'contact', sourceKeys: contactRows.map(row => row.sourceKey),
    inScope: contactRows.length, imported: contactVerification.verified,
    deferred: contactRows.length - contactVerification.verified,
  }],
  verification: { contacts: contactVerification },
});
// Persist completion to execution/completion-report.json using the shared runtime.
// END verified-contact-import
```

Both wrappers create absent records and verify existing ones; they never update an existing
record whose values differ. Route such differences to the declared revision-protected
update/conflict-review flow, then verify the result. Pass optional `sourceVersion`,
`sourceVersionField`, `sourceHash`, and `sourceHashDefinition` with each row to establish
its baseline after a confirmed create with a returned revision. Read-only reconciliation
preserves the saved baseline, including across verification failure and resume; it never
advances a source version or refreshes the saved revision. Run unchanged contact/product
rows from `selectRerunRecords().needsReconciliation` through these same wrappers.

Declare `verificationKind` in the accepted mapping and carry it into completion and
selection options independently of source table names: `contact` or `product` for these
comparators, `none` for other entities with their own verification flow. Unknown names
without a declaration require verification; they cannot silently opt out. Reject undefined
projection fields before any API call, naming the field to omit or replace with a JSON value.

Call `importProducts` with the equivalent product rows. Add its verification report and
source-key set to the same completion input, then pass its verified variant correspondence
to `reconcileInventory` below. Every intended variant stays in the inventory denominator,
including products that failed identity checks. Do not send stock or category membership
writes for an unverified product mapping. Keep inventory outcomes separate from product
identity outcomes.

Run the SAME wrappers on retries, single-record batches, existing crosswalks and
`--missing-only`; selection is not evidence that a target exists. An uncertain write
remains pending until target reconciliation resolves it. Do not hand-code per-record
fallbacks that turn errors or missing indexes into create permission. When using dry-run,
pass `dryRun: true` and report simulated outcomes, not verified live completion.

The inspected contact and products-with-inventory endpoints require unique request-local
`originalIndex`. Their endpoint adapters enforce this; Blog bulk is not covered by that
contract. `undetailedFailures` counts failures but cannot identify their input rows, which
stay unresolved. Counts, HTTP 200, and old presence-only receipts do not establish identity.

### Product inventory: inline create, then reconcile and verify

For default-location inventory, the shared reconciler also reads Catalog products and verifies each exact variant's availability. Inventory success alone cannot complete the report; disagreement stays unverified after bounded read retries. Never toggle stock to force Catalog propagation. Non-default locations record this Catalog check as not applicable.

Vendor `rp-target-wix/lib/stores-inventory.js` with `wix-build.js` and `wix-writers.js`.
The builder consumes each canonical variant's `inventoryTracked`, `inventoryQuantity`, and
`inStock`; it emits `inventoryItem` on variants when stock is known. Use the existing bulk
products-with-inventory writer so initial stock costs no separate write. Send `quantity`
OR `inStock`, never both; `trackQuantity` is read-only. Explicit non-default stock belongs
in the separate inventory pass, not in default-location inline fields.

Collect inventory identities after each product batch, including products already found in
the crosswalk. Generate a resumable inventory pass through `reconcileInventory`. Resolve actual product and variant
IDs from returned/read-back entities and source-option correspondence; never zip unordered
results or variants by position. Persist that correspondence. Keep source gaps and failed
product-to-variant mappings in `inventoryGaps` so every intended source variant is counted.

```js
const { reconcileInventory, persistInventoryReport } = require('../resources/rp-target-wix/lib/stores-inventory.js');
// resolvedInventoryRows: [{productId, variantId, inventory: {inStock} OR {quantity}}]
// sourceVariantCount is counted BEFORE filtering gaps or failed product mappings.
const inventoryReport = await reconcileInventory(wix, resolvedInventoryRows, {
  expectedCount: sourceVariantCount,
  gaps: inventoryGaps,
  // locationId may be supplied from verified setup; otherwise resolve the default.
});
await persistInventoryReport(inventoryReportPath, inventoryReport);
// The generated completion report consumes inventoryReport.status and counts directly.
```

Set `inventoryReportPath` to the project's `state/inventory-report.json`. Supply the full
intended variant set and gaps once per inventory pass; the helper handles bounded API batches
internally. Persist lightweight resolved identities during product import so interrupted runs
can reconstruct this set without recreating products. Do not replace the report with only the
last product batch. The completion report consumes `status`, `counts`, and `complete` directly;
only `complete:true` can mark the inventory checkpoint complete.

Product and inventory checkpoints are independent. Product success followed by inventory
failure preserves the product crosswalk; resume queries existing inventory and repairs it.
A successful bulk product receipt or `inventoryResults` count never substitutes for per-variant
read-back. Report unresolved inventory as partial, while allowing independent records to
continue. The setup inventory probe must pass before stock writes. Existing notification
protection and dry-run boundaries still apply; a dry-run does not produce a live inventory
verification receipt.

### Record streams are NDJSON, single documents are JSON (required)

**Every file that holds a stream of records must be newline-delimited JSON (`.ndjson`), one
record per line — never a `{ "records": [ … ] }` array.** Vendor
`rp-target-wix/lib/ndjson.js` into the project (like `wix-writers.js`) and use it; do not
hand-roll line splitting, which gets chunk boundaries and CRLF wrong.

This applies to:

- `data/source-extract/<entity>.ndjson` — the extractor's output
- the `sourceId -> targetId` crosswalk
- audit logs (already NDJSON)

It exists because every downstream stage does the same three things with these files, and an
array is the wrong shape for all of them:

- **scan** — `countRecords` counts lines; nothing is parsed and nothing is held in memory. A
  JSON array must be fully parsed to be counted.
- **batch** — a bulk endpoint's page is `readBatches(file, 100)`. Use `readBatchesBy` when the
  target caps more than one dimension: Wix bulk product create allows **≤100 products AND
  ≤1000 variants per request**, which is `{ maxCount: 100, maxCost: 1000, cost: p =>
  p.variantsInfo.variants.length }`.
- **cursor / resume** — `readSlice(file, { offset, limit })` skips what is already done
  without rebuilding it into objects.

Two more properties that matter in practice: a producer can append records as it finds them
instead of buffering the whole entity, and an interrupted write leaves a **valid readable
prefix** — a truncated JSON array is unparseable, so a crash mid-extract loses everything.

**Do not line-delimit single documents.** A manifest, `mapping-plan.json`,
`decisions.json`, `execution-manifest.json`, `preview-result.json` or
`completion-report.json` is one object; it stays `.json`. NDJSON buys nothing there and makes
it unreadable.

Generated importers must **stream** these files (`for await (const batch of
readBatches(...))`), not `readAllRecords` them. `readAllRecords` is an escape hatch for
genuinely small streams (a six-record category list) and is named to make its misuse on a
large stream obvious.

Projects generated before this rule can be moved forward with
`convertLegacyJsonFile(jsonPath, ndjsonPath)` rather than re-extracting.

### Reading existing target state (required)

An idempotent importer has to know what is already on the site before it writes. Every bug in
this section is the same bug: **a read that returns nothing looks exactly like a site that
contains nothing**, and nothing-on-the-site is the branch that writes. None of them throw, so
none of them show up in a dry-run.

**The adapter's `query*` executors already return the array.** `queryStoresCategories`,
`queryStoresProducts`, `queryContacts`, `queryCoupons` and `queryOrders` unwrap the response
before returning it, so the value **is** `categories` / `products` / etc. Generated code must
use it directly:

```js
const existing = await W.queryStoresCategories(wix);          // an array
const existing = (await W.queryStoresCategories(wix)).categories;  // WRONG → undefined → []
```

The second form is what shipped, and reading `.categories` off an array yields `undefined`,
which the usual `|| []` turns into an empty array. It silently disabled a category dedupe
index, silently disabled a product name-match safety net, and made a setup verification
report **0 categories on a site that had 25** — all without one error line.

**Never cursor-page through those executors.** Unwrapping discards `pagingMetadata`, so the
cursor a loop needs is already gone; a loop built on them cannot advance past page one, and
reading `.pagingMetadata` off the returned array is the same `undefined` as above. Prefer the
adapter's sweep primitives, which own the loop and the failure semantics:

- `queryAllStoresCategories(wix)`, `queryAllStoresProducts(wix)`, `queryAllDataItems(...)`

When a sweep is needed for an entity that has no `queryAll*` primitive yet, generate the loop
against the **raw** response and add the primitive to `rp-target-wix` rather than leaving the
loop in project code:

```js
let cursor = null;
do {
  const body = cursor ? { cursorPaging: { limit: 100, cursor } } : { cursorPaging: { limit: 100 } };
  const response = await wix.send(W.buildQueryStoresProductsRequest(body));   // raw, not the executor
  for (const p of response.products || []) { /* index it */ }
  cursor = (response.pagingMetadata && response.pagingMetadata.cursors && response.pagingMetadata.cursors.next) || null;
} while (cursor);
```

**An incomplete sweep must throw, not fall through.** If any page fails, or the loop hits its
page ceiling with a cursor still outstanding, the generated code must abort the import with a
message naming the sweep. It must **not** continue with the partial index, and must not treat
"the sweep failed" as "nothing exists" — that is precisely the state in which a re-run
re-creates the entire catalog it already imported. The single most expensive failure in this
whole pipeline is a duplicate import, and it arrives through an empty net.

**A match must be ADOPTED into the crosswalk, not skipped.** When a safety net (name match,
slug match, source-id field) finds that the target entity already exists, record it in the
crosswalk with its **target id and revision** and count it as reused. A bare `continue` that
skips the write without recording the id looks correct — nothing is duplicated — but every
later phase that resolves ids *from the crosswalk* then silently drops the record. Concretely:
the product was already on the site, so it was skipped, so it had no crosswalk row, so the
category-link phase could not resolve its id and it ended up in no category at all. Index the
net as `name -> { id, revision }`, not as a `Set` of names, so the id is available to adopt.

An ambiguous match is the one case that must not be adopted: if the source key is not unique
(e.g. four source products share a title), the net cannot tell which existing entity
corresponds to which source record. Import rather than guess, and report the ambiguity in the
completion report.

### Never hand-write slug sanitizing (required)

A source handle is **not** already a valid Wix slug. Wix rejects anything outside `[a-z0-9-]`,
and because slug validation happens before the batch is applied, **one bad slug fails the
entire bulk request** — 100 products lost for one character. Shopify mints underscores from
decimal titles ("pH 5.5" → `ph-5_5`), so this is routine input, not an edge case.

It is already solved: `wix-build.js` exports `toWixSlug` and applies it automatically through the
`coerce: 'slug'` rule on `product.slug` in `wix-target-spec.js`. Generated transforms that call
the build layer (see the `src/import/transforms/` note under "File targets") get it for free and
must not re-derive it — a per-project copy is how the underscore bug reached a live site in the
first place.

Two properties to preserve when a generated transform sets a slug explicitly:

- **Sanitize in the build layer, not the writer**, and keep both values. URL preservation needs
  the original `sourceSlug` alongside the `plannedTargetSlug` actually derived from it (see the
  URL preservation rules under "Codegen rules"), which a silent rewrite inside the writer would
  falsify. `normalizeStoresProductV3` therefore passes a slug through untouched.
- **`toWixSlug` throws when a value sanitizes to empty** (an all-non-latin title, for example).
  That is a signal to supply a deterministic fallback — the record's source id — not to omit the
  slug and let Wix derive one, which breaks URL preservation with no trace.

## Sample-preview gate

Between the extractor being generated and the execution-plan approval, show the user what
their data actually became. The mapping review checkpoint validates *intent*; this validates
*structure* — how source rows turned into entities — before any full run.

Required whenever the source cannot be read back from a live API — in particular every
`platform: "csv"` run, where a misread layout silently produces the wrong entity split.

1. Generate the extractor first (`src/extract/run-extract.js`).
2. Run it in sample mode (`--sample`) to materialize a small `data/source-extract/` slice.
3. Write two artifacts under `migrations/<project>/preview/`:
   - `preview-summary.md` — a short human-readable structure preview: how rows became grouped
     entities (e.g. one product with its variants and images), per-entity record counts, and
     which columns landed in which Wix fields.
   - `preview-result.json` — `{ "status": "pending", "decidedAt": null, "decidedBy": null,
     "entityCounts": {...}, "warnings": [] }`.
4. Pause and ask the user to validate the structure. On accept, set `status: "accepted"` with
   `decidedAt`/`decidedBy`; on reject, set `status: "rejected"` and set
   `approvals.mapping.status` back to `pending` so the router returns to `rp-mapper`.
   In explicit user-requested `1-click mode` (`automationMode=one_click`, `source=user`),
   validate the structure automatically from the preview artifacts, set the result to
   `accepted` with `decidedBy: "agent"` when it passes, and continue without a user pause.
   Otherwise every CSV run pauses here, including a run whose `one_click` value was inferred
   or copied with a non-user decision source.
5. Record the artifacts on the codegen checkpoint (`checkpoints.codegen.artifactRefs` +
   `lastCompletedStep: "codegen.sample-preview"`).

This is a **codegen sub-gate, not an orchestration phase**: it adds no state to
`orchestration-state.js`. While `preview-result.json` says `pending`, the router keeps routing
back to this skill instead of advancing to the execution-plan gate — that routing behavior is
the enforcement, so the artifact must be written honestly. The gate rides on the existing
extract→import split and does not change how import writes to Wix.

## Project-local config files

Generated code should treat `migrations/<project>/config/` as the canonical home for all
values that are otherwise expected as environment variables. Use simple `.env` syntax and
load these files before reading config:

- `config/wix.env` always exists. Default `DRY_RUN=false`, except when the user has
  explicitly asked to start, create, prepare, or run the migration in dry-run mode; in
  that case scaffold or preserve `DRY_RUN=true`:

  ```bash
  WIX_SITE_STRATEGY=
  WIX_SITE_ID=
  WIX_AUTH_TOKEN=
  WIX_MUTE_NOTIFICATIONS=
  DRY_RUN=false
  SAFE_MODE=true
  SAFE_MODE_PHONE_NUMBER=+972 50 0000000
  ```

- `config/source.<platform>.env` exists after the source platform is known. For WordPress:

  ```bash
  WP_BASE_URL=
  WP_USERNAME=
  WP_APPLICATION_PASSWORD=
  WMH2_MIGRATION_KEY=
  WP_MEDIA_URL_REWRITE_FROM=
  WP_MEDIA_URL_REWRITE_TO=
  WC_CONSUMER_KEY=
  WC_CONSUMER_SECRET=
  ```

  For CSV sources this is `config/source.csv.env`, which is **not** secret-bearing — all keys
  are optional hints (`CSV_INPUT_ROOT`, `CSV_DELIMITER`, `CSV_ENCODING`, `CSV_VENDOR`,
  `CSV_MEDIA_URL_REWRITE_FROM`, `CSV_MEDIA_URL_REWRITE_TO`). Generated readers must resolve
  input paths against `CSV_INPUT_ROOT` (falling back to the project directory) rather than
  baking absolute paths into generated code.

Codegen rules:

- Generate a small dependency-free config loader in the runnable entrypoint or `src/lib/`.
- Load `config/wix.env` and the selected source config before constructing source/Wix
  clients.
- Default `DRY_RUN` to disabled. Treat `true`, `1`, `yes`, and `on` as enabled and
  `false`, `0`, `no`, and `off` as disabled. `--dry-run` must override config and enable
  dry-run. `--no-dry-run` may be supported to override `DRY_RUN=true`.
- When scaffolding a project that is in dry-run mode, generated review artifacts must say
  that leaving dry-run later requires explicit user approval for any step other than
  new-site creation, and that such overrides should be avoided when a dry-run or report
  is sufficient.
- Preserve an explicit `DRY_RUN=true` from project config when regenerating code or
  config. Do not reset it to `false` during later codegen passes.
- Default safe mode to enabled when `SAFE_MODE` is missing or blank. Honor
  `SAFE_MODE=false` when the user set it before mapping: do not require
  `safeModeReplacements[]`, do not replace contact values, and do not write safe-mode email
  recovery rows.
- When safe mode is enabled, require `SAFE_MODE_PHONE_NUMBER`, default missing/blank values
  to `+972 50 0000000`, and make the generated config explicit.
- Real process environment variables may override file values.
- Blank values in config files must not overwrite non-empty process env values.
- If a required key is still missing after loading file + env, fail fast with the key
  name, not a downstream 401.
- In dry-run, missing or blank `WIX_AUTH_TOKEN` and `WIX_SITE_ID` are `would_block_live`
  findings, not blockers, unless a generated local artifact requires the site ID as a
  stable namespace. Do not mint a Wix CLI token solely for dry-run.
- `WIX_MUTE_NOTIFICATIONS` resolves by strategy when blank: `new` → `on`,
  `existing` → `off`; record the resolved value explicitly (mirrored from
  `orchestration/decisions.json`). **`WIX_MUTE_NOTIFICATIONS=off` together with
  `WIX_SITE_STRATEGY=new` fails codegen validation** — halt with the config conflict
  rather than generating artifacts (the same rule fails in `rp-setup-discovery`; fail
  fast at whichever runs first). Note the preflight emission rule below ignores the
  config for new sites anyway — it is unconditional.
- Treat `WIX_SITE_STRATEGY` as required. `WIX_SITE_ID` becomes required no later than the
  point where generated code needs to construct Wix clients or destination-specific
  artifacts. For `WIX_SITE_STRATEGY=new`, codegen should fail with a clear message to
  create/select the new Wix site first rather than assuming an existing site flow.
- For RePlatform `new site` + `headless`, that unblock message must point back to
  `resources/rp-destination/`, which scaffolds via `npm create @wix/new@latest headless`.
  The account-level Projects API is deprecated for this workflow.
- `WIX_AUTH_TOKEN` is the canonical Wix auth key in project-local config and holds the
  **site write credential** for import. With CLI-scaffolded headless sites this is a
  short-lived CLI token sent as a **Bearer** token — the generated Wix client must send
  `Authorization: Bearer <token>` (plus `wix-site-id`). Do not assume a raw, non-expiring API
  key; mint the token at write time.
- Never log secret values. It is okay to log that a key is present/missing.
- Dry-run must write request captures under `state/attempts/wix-request-captures.ndjson`
  and dry-run placeholder target IDs only under `state/crosswalk/dry-run-crosswalk.ndjson`
  or in memory. It must never append simulated target IDs to
  `state/crosswalk/crosswalk.ndjson`.
- Do not generate debug output that dumps config file contents, environment snapshots, or
  request headers carrying credentials.

## WooCommerce subscription product codegen

For WooCommerce Stores products, subscription products are a native Wix Stores product
subtype when the target metadata marks `product.subscriptionDetails` writable for
Catalog V3 create. Codegen must read the `stores/product` `fieldContracts[]` metadata and
vendor/use the matching `rp-target-wix/lib/wix-writers.js` helpers:

- `STORES_SUBSCRIPTION_CONTRACT`
- `normalizeStoresProductSubscriptions`
- `validateStoresProductSubscriptionDetails`

Generate deterministic native subscription mapping only from recognized structured
WooCommerce subscription fields. Accepted first-pass source keys include:

- `_subscription_period_interval`
- `_subscription_period`
- `_subscription_length`
- `_subscription_trial_period`
- `_subscription_trial_length`
- `_subscription_sign_up_fee`
- `_subscription_price`

Equivalent public REST fields may be used when discovery normalized them into the source
schema, but do not infer cadence from product titles, descriptions, prose, shortcode
blobs, or unrecognized plugin metadata.

Mapping rules:

- Treat source `type: "subscription"` or recognized subscription metadata as the product
  subtype signal.
- Parse billing interval as an integer `>= 1`.
- Parse billing period from `day`, `week`, `month`, or `year`, then emit Wix frequency
  `DAY`, `WEEK`, `MONTH`, or `YEAR`.
- Use subscription price when present, otherwise the normal product price, and still emit
  the Catalog V3 variant-level money object required by the shared writer.
- Parse optional length/trial/signup-fee fields only when they are clean structured
  values. If a field is present but malformed and needed for the selected mapping, defer
  the record rather than guessing.
- Build subscription descriptions deterministically from source subscription labels or
  product names, then pass them through `normalizeStoresProductSubscriptions` so the Wix
  `description <= 60` contract is satisfied before write.
- Run `validateStoresProductSubscriptionDetails` in the generated dry-run path and before
  live create for every product carrying `subscriptionDetails`.

Do not generate a generic subscription skip gate. If a subscription product lacks
structured cadence or required values, emit an explicit deferred record such as
`unsupported_subscription_shape`, `missing_subscription_cadence`, or
`invalid_subscription_interval`, and include that reason in the execution summary. A
deferred subscription is a counted import outcome, not a silent skip.

**Token minting — always route through `scripts/mint-token.sh`.** Every migration project
must include `scripts/mint-token.sh`. The script reads `WIX_SITE_ID` from `config/wix.env`,
runs `npx @wix/cli@latest token --site "$WIX_SITE_ID"`, captures the token (shape:
`OauthNG.JWS.<base64>.<base64>.<sig>` — single line, no JSON wrapper), and writes it
directly to `config/wix.env` as `WIX_AUTH_TOKEN` without printing the value. Run via Bash:

```bash
bash migrations/<project>/scripts/mint-token.sh
```

**Do NOT** run `npx @wix/cli@latest token` raw in a Bash tool call — it prints the
credential to stdout which lands in the transcript. Always use `mint-token.sh`.

**During scaffolding, copy `scripts/mint-token.sh` from the canonical skills location** —
do not generate it from scratch:

```bash
cp skills/wix-replatform/resources/rp-execute-setup/scripts/mint-token.sh \
   migrations/<project>/scripts/mint-token.sh
```

The preferred
pre-import flow is:

1. verify `wix whoami`,
2. run `bash scripts/mint-token.sh` (writes `WIX_AUTH_TOKEN` silently),
3. run the import — the generated client reads `WIX_AUTH_TOKEN` and sends it as
   `Authorization: Bearer <token>` with `wix-site-id`.

## Members: full-fidelity create/reconcile, so orders can link to a buyer (spec 0135)

`resolveOrderBuyer` (below) links an order to a member only when the member crosswalk row for that
source customer carries a `loginEmail` — nothing produces that row unless the member pass runs
FIRST, in its own loop, before order history. Generate the call, not a hand-rolled `createMember`.

```js
const CM = require('./src/resources/rp-target-wix/lib/customer-member.js');
const memberCrosswalk = require('./src/lib/member-crosswalk.js').createProjectMemberCrosswalk({ projectDir: ROOT });

for (const customer of registeredCustomers) { // registered only -- guest buyers are 0089's, not this pass
  const { contact, findings } = CM.buildMemberContact({
    firstName: customer.first_name, lastName: customer.last_name,
    phone: customer.billing && customer.billing.phone, countryCode: customer.billing && customer.billing.country,
    address: customer.billing && { addressLine: customer.billing.address_1, addressLine2: customer.billing.address_2, city: customer.billing.city, subdivision: customer.billing.state, postalCode: customer.billing.postcode, country: customer.billing.country },
  });
  const known = await memberCrosswalk.get(customer.id);
  const result = await w.ensureMember(wix, { loginEmail: customer.email, contact, knownMemberId: known && known.memberId });
  if (result.memberId) await memberCrosswalk.put(customer.id, { memberId: result.memberId, loginEmail: customer.email, contactId: result.contactId });
  report(result); // result.outcome, result.findings (member-phone-not-normalized, member-phone-collision-dropped, member-crosswalk-row-stale)
}
```

What the call does, so the generated code must not:

- **Converts the phone to E.164 or drops it, never sends it as-is and never guesses.** Create
  Member 400s on anything that is not already E.164 (VERIFIED LIVE). `normalizePhoneE164` covers a
  small set of countries (`customer-member.js`'s `COUNTRY_PHONE_RULES`); an unlisted country is a
  finding, not a guess -- extend the table rather than hand-rolling a conversion in generated code.
- **Queries Contacts by phone before every create that carries one.** Create Member reuses an
  EXISTING contact that already carries the phone being sent -- even one belonging to a member
  deleted earlier in the same run (deleting a member does not delete its contact). Two source
  customers who share a phone would otherwise be silently merged into one Wix identity. Never call
  Create Member directly with a phone; `ensureMember` is where this guard lives.
- **Reconciles by the crosswalk row first (read back and verified), then by `loginEmail`.** One
  match reconciles, more than one is ambiguous and creates nothing. A stale crosswalk row (the
  member was deleted, or the row points at a different email) falls through to the `loginEmail`
  query rather than being trusted blind.
- **Persist `loginEmail` on the crosswalk row, or `resolveOrderBuyer` cannot link anything.** The
  member pass must run to completion (or at least for every registered buyer the order pass will
  see) BEFORE the order-history loop below.

## Order history: payments, refunds and preserved invoice documents (specs 0124, 0129)

An imported order reads back with `payments: []` — Import Order creates no payment record — and
the order write has no idempotency of its own unless it is given an id. Payment history, refunds
and the invoice document are separate target writes with an ordering constraint, a shared
identity and state that must outlive a crash. **All of that is sequenced by one library call.
Generate the call, not the sequence.**

```js
const H = require('./src/resources/rp-target-wix/lib/order-history.js'); // vendored layout, see below
const { resolveOrderBuyer } = require('./src/resources/rp-target-wix/lib/order-buyer.js');
const crosswalk = H.createProjectOrderCrosswalk({ projectDir: ROOT }); // state/crosswalk/crosswalk.ndjson
const setupVerification = readJson('setup/extended-field-verification.json'); // ONCE per run

for (const source of orders) {
  const result = await H.importOrderHistory(wix, {
    order: toWixOrder(source),         // the mapped Import Order body — never set `id`; buyerInfo.email = source.billing.email
    sourceId: source.id,
    sourceSiteHost,                    // new URL(WP_SITE_URL).host
    evidence: {                        // FACTS from the source, nothing else
      amount: source.total,
      paidDate: source.date_paid_gmt, altPaidDate: source.date_paid,
      currency: storeCurrency,         // rp-source-wordpress/lib/store-currency.js, not order.currency
      status: source.status,
      methodName: gateway.displayName, providerTransactionId: gateway.reference, offlinePayment: gateway.offline,
      refunds: qualified.map((r) => ({ sourceId: r.id, amount: r.amount, reason: r.reason })),
      invoice: approval && { approval, sourceUrl: approval.documentUrl, invoiceNumber: approval.number },
    },
    crosswalk,
    setupVerification,
    // the buyer, corroborated from the member crosswalk (rows carry memberId + loginEmail)
    // contactCrosswalk is OPTIONAL (a guest/contact-only buyer's contactId, when one is tracked
    // separately from members) -- omit the property entirely when there is no such crosswalk in
    // this project, never pass a variable that is not actually declared (confirmed live 2026-09-06:
    // an earlier version of this snippet did exactly that and threw ReferenceError: contactCrosswalk
    // is not defined the moment this line ran, not at require() time).
    buyer: await resolveOrderBuyer({ sourceCustomerId: source.customer_id, billingEmail: source.billing.email, memberCrosswalk }),
  });
  report(result); // result.outcomes.{order, payment, refunds[], invoice, buyer}, result.findings, result.errors
}
```

What the composite does, so the generated code must not:

- **Derives the order id** from `sourceSiteHost` and `sourceId` (Import Order accepts a
  caller-supplied GUID — verified live 2026-09-05), writes the crosswalk row before any further
  write, and on a crosswalk miss asks the target by that id. A lost crosswalk is a read, not a
  duplicated store. An order that already exists is reconciled, never re-sent: a re-send silently
  replaces the whole body.
- **Runs the payment gate from `evidence`.** A key the contract does not read (`sourceAmount`,
  `total`, `transaction_id`, …) throws, naming the key it should have been. It does not read as
  "never paid".
- **Reads the order's payments once** and reconciles both the payment and every refund against
  that read. Occurrence numbers for equal refunds are assigned from the refunds' source ids — pass
  ALL of an order's refunds in the one call.
- **Returns every outcome**, including the payment's when a refund exists, and a named
  partial-failure outcome (`payment-failed`, `refund-failed`, `invoice-failed`, with the cause in
  `errors`) instead of throwing, so a resume retries only what failed.
- **Sets `buyerInfo.memberId` only from `resolveOrderBuyer`** (`rp-target-wix/lib/order-buyer.js`):
  a member crosswalk row whose `loginEmail` equals the order's billing email. Persist `loginEmail`
  on the member crosswalk row when creating members, or nothing can be linked. Never put a
  `memberId` on the order body yourself; the composite refuses it.
- **Binds the body's `buyerInfo.email` to the buyer it was resolved for.** The mapped body must carry
  the order's billing email (the same value passed as `billingEmail`); a linked buyer beside a body
  carrying another email, or none, is refused — a resolution for one order must not attribute
  another order to that member.
- **Hands the invoice approval to the writer unchanged.** The merchant opt-in is an input to
  `resolvePreservationPlan()`, which STAMPS every approval it issues; the writer believes an opt-in
  only with that stamp, so an approval assembled by hand (or lifted from the plan's `refused` list)
  is refused as `invoice-preservation-not-approved`. Pass the plan's objects, never rebuild them.
- **Remembers a document that reached Media but whose order patch failed** — in the crosswalk
  (`state/crosswalk/pending-invoice-files.ndjson`), so the resume records that file instead of
  importing a second private copy. No caller state; `createProjectOrderCrosswalk` holds it.
- **Verifies every crosswalk hit with one order read.** A row pointing at an order the target no
  longer has (a migration cleared with Bulk Delete Imported Orders) is re-imported under the
  derived id and counted as `order-reimported-after-deletion`.

What is still the caller's, because it is source knowledge:

- Which processor a payment-method slug names: `rp-source-wordpress/lib/gateway-source-keys.js`.
- Whether a refund is real: `lib/refund-corroboration.js` `qualifyRefund()` (its
  `assignRefundOccurrences()` is no longer needed — the composite assigns them).
- Which document and whether it may be copied: `lib/invoice-discovery.js` through
  `resolvePreservationPlan({ selection, merchantOptedIn })`.
- The store currency, resolved once at extract time — `order.currency` on WooCommerce REST is not
  reliably ISO 4217 (a live store returned the HTML-encoded shekel symbol on every order).
- The verification receipt, read once, and the report: every `outcomes` value is a line for
  `rp-execution-policy/lib/payments-report.js`, including the zeros.

Vendoring mirrors the skill's layout: the shared modules require each other across resources
(`../../../lib/…`), so `src/` reproduces `lib/` + `resources/<resource>/lib/` — `order-history.js`
lives at `src/resources/rp-target-wix/lib/` and reaches `src/lib/local-state.js`. A flat copy loads
nothing.

**Two dependency shapes `require()` alone will not surface, both hit live 2026-09-06 running a
generated-style project end to end:** a lib can read a **domain entity JSON file directly**
(`order-invoice-contract.js` reads `../domains/ecom/entities/order-invoice-document.json` with
`path.join` + `readFileSync`, not `require`, so a dependency scan that only follows `require` calls
misses it — vendor `domains/ecom/entities/order-invoice-document.json` alongside
`order-invoice-contract.js`), and a lib can have a **sibling JSON registry** next to its own `.js`
file (`gateway-source-keys.js` → `gateway-source-keys.json`, `refund-corroboration.js` →
`refund-corroboration.json`) that must be copied too, or it throws `ENOENT` the first time the
function that reads it is actually called — not at `require()` time, so a smoke test that only
does `require()` on every vendored file will not catch a missing one. Copy the `.json` file
wherever you copy the `.js` file next to it.

If the source has no payment evidence at all, make the call anyway with what evidence there is and
let it report zero under a named reason. An importer that omits the path is indistinguishable from
one that ran and found nothing, and only one of those is a correct migration.

**Never call the invoicing service**, and never generate a fallback that does. Re-issuing a
historical tax document mints a second legal document under a different number.
`tests/target-wix/no-invoices-api-contract-test.js` scans the published tree for this.

## Coupons, currency and pricing-plan definitions

Generate three passes, in this order, and one report section. The decisions are in the libraries;
codegen supplies reads and facts.

1. **Currency gate, before any order write.** Read `wc/v3/settings/general` →
   `store-currency.js` `readStoreCurrency`; resolve every order's currency with
   `resolveOrderCurrency(order, storeCurrency)` (the order field is `&#8362;` on a real store);
   read the target site currency; call `currency-gate.js` `evaluateCurrencyGate`. `halt: true`
   stops the run at the approval gate with the named finding. `currency-validated` is a line too.
2. **Coupons.** `sweepCoupons(page => wc/v3/coupons?per_page=100&page=N)` to exhaustion; the
   `posts` count by `post_status` through the plugin bridge (0122) for reconciliation;
   `summarizeCoupons` for the counts; per coupon `mapCouponToWix(coupon, { resolveProduct,
   resolveCategory })` through the catalog crosswalks, then write them in BATCHES with
   `bulkCreateCoupons(wix, specifications)` -- 100 per call, and it returns one outcome per input
   specification in input order, so the coupon crosswalk row (`code → couponId`) is written per
   coupon exactly as before and a re-run still resumes. A few thousand coupons is ordinary for
   this source, and `ensureCoupon` one at a time makes it a few thousand round trips; reach for
   `ensureCoupon` only for a single coupon or a repair.
   ⚠️ **Batching and tagging cannot be combined.** The batch discards the tag field and still
   answers 200, so `bulkCreateCoupons` refuses a tagged specification. Pick one and report which:
   write tagged coupons with `ensureCoupon` one at a time, or batch them untagged and then tag
   each with `updateCouponFields({ tags })`, which is a call per coupon.
   ⚠️ Do NOT re-implement the batch call. `bulkCreateCoupons` already handles the two traps that
   make it dangerous: a batch fails as a whole while reporting the same error against every row
   in it (so any failure re-sends that batch as individual creates), and `originalIndex` is
   omitted on the first result (so results are correlated by index, never by position, and a
   duplicate or incomplete index cover reconciles per coupon rather than guessing). Outcomes
   `coupon-reconciled-existing` and `coupon-write-unknown` are not failures: the first recovered
   an id for a coupon that was already there, the second means the code exists but is not
   readable yet and must be re-read rather than re-written. A
   `coupon-type-unmappable` / `coupon-scope-unmappable` / `coupon-usage-limit-unresolved` result
   is a report line, not a write. `sweepCoupons` runs to an EMPTY page when the server sends no
   `X-WP-Total`; pass the header through as `total` whenever it is present.
2a. **Decide a coupon's final shape from the FRESH read, not from the mapped snapshot**
   (spec 0142, `rp-target-wix/lib/coupon-redemption-drift.js`). Gate the whole coupon pass on
   `classifySnapshot({ capturedAt, now, maxAgeMs })` and halt on `snapshot-stale` or
   `snapshot-undated`.

   Then, for each coupon where `isBearerVoucher(coupon)` is true and only those, re-read
   `wc/v3/coupons/{id}` immediately before writing and pass both rows to `classifyPreWriteDrift`.
   **The verdict is not a boolean gate — it is the specification's final state**, and the payload
   must be rebuilt from it rather than from the mapper's output:

   | Verdict field | What the outgoing specification must carry |
   | --- | --- |
   | `write: false` | nothing — the coupon is not written at all; report the outcome |
   | `writeActive` | `specification.active`. `false` for a coupon the fresh read found used up |
   | `writeUsageLimit` | `specification.usageLimit` — the uses the holder has LEFT |
   | `usageUnlimited: true` | **delete** `specification.usageLimit` entirely; a stale limit left on an unlimited coupon caps it |
   | `setTags` | `specification.tags` — replaces whatever the mapper stamped |

   ⚠️ Mapping and then only checking `write` is the failure this table exists to prevent: a coupon
   spent after the snapshot comes back `write: true, writeActive: false` with `Already_Used`, and a
   payload built from the mapper alone goes out `active: true` tagged only `Imported` — the
   redeemable-again defect this spec exists to fix, reintroduced one layer down.

   **Why it cannot be skipped:** the target starts its own usage count at zero and nothing seeds a
   prior redemption, so a coupon used up between the read and the write lands fully redeemable and
   stays that way until somebody notices. Measured on one migration: ten single-use money vouchers
   of equal face value, all live on the target.

   ⚠️ `write: false` has two distinct causes and they are different report lines, not one:
   `voucher-usage-unknown-at-write` (the fresh read failed) and
   `voucher-face-value-precision-unsupported`. Neither is a skip.

   ⚠️ **Precision is gated for EVERY monetary coupon, not just bearer vouchers**, and that gate is
   in the mapper: `mapCouponToWix` returns `coupon-amount-precision-unsupported` and no
   specification for any amount carrying more than two decimal places. A fixed-money coupon with a
   usage limit of 6, or a percentage of `12.3456`, never reaches `classifyPreWriteDrift` at all —
   it is not a bearer instrument — and would otherwise put an amount on the target that differs
   from the source while every later check reported a match.

   **Report lines.** `coupons-spent-after-capture` and `coupons-partially-used-limit-reduced` are
   sub-counts of `coupons-written` — those coupons ARE created, just not as the snapshot described
   them — and must NOT be added to the accounting identity. The identity term is
   `coupons-face-value-precision-unsupported`, because that coupon is refused:

   ```
   discovered = written + type-unmappable + scope-unmappable
              + usage-limit-unresolved + face-value-precision-unsupported + skipped
   ```

2b. **Reconcile voucher drift at cutover, never inside the import.** A trading source keeps
   spending vouchers after the import finishes. `classifyPostImportDrift` + `buildVoucherDriftPlan`
   take the receipts, a fresh source read and a target read-back and produce a read-only remedy
   plan (face value and affected orders per code). Generated code may BUILD and report that plan;
   it must not act on it — closing a voucher needs an explicit owner decision per code, including
   in one-click mode. The remedy is `buildRemedyRequest`: a `PATCH` carrying ONLY
   `{active: false, tags: [...]}` plus `fieldMask: {paths: ['active','tags']}`, which keeps the
   coupon id, code, dates and amount. **Never build that body from the coupon you just read** —
   the full specification alongside a narrow mask returns 200 and writes nothing, so counting 2xx
   responses produces a false pass on money. `verifyRemedyApplied` decides the outcome from a
   post-settle read-back, never from the status code.
3. **Coupon usage**, inside the order pass: `buildCouponAppliedDiscounts({ couponLines:
   order.coupon_lines, resolveCoupon })` and put `appliedDiscounts` on the mapped order body handed
   to `importOrderHistory`. Name the surface (`rest-order-coupon-lines` on legacy storage,
   `wc_order_coupon_lookup` on HPOS, `none-found`).
4. **Plan definitions.** Row counts for `B1`/`B2`/`B3` → `evaluatePlanSources`; when it runs,
   normalize each source offer to `{ sourceId, name, description, amount, period, interval,
   lengthCycles, trialDays, signupFee }`, `buildPlanDefinition`, `ensurePlanDefinition`. Install
   the Pricing Plans app first (`WIX_PRICING_PLANS_APP_DEF_ID`); it is absent on a commerce site.
5. **Report** through `rp-execution-policy/lib/coupon-currency-plan-report.js`
   `buildCouponCurrencyPlanReport({ counts, notPublishedByStatus, couponUsageSurface,
   voucherLiabilityLive })`. Build
   `counts` from ONE surface: `summarizeCoupons({ restCoupons, postsByStatus, mappings,
   writeOutcomes })`, where `mappings` is the per-coupon `mapCouponToWix` result (it owns the
   unmappable numerators — the type table alone under-counts) and `writeOutcomes` the per-coupon
   `ensureCoupon` outcome (`coupon-reconciled-existing` folds into `coupons-written`; failed,
   read-failed and ambiguous fold into `coupons-skipped` with reasons as notes). Plans fold the
   same way through `tallyPlanWriteOutcomes`. Every Appendix D line, zeros included; `written +
   unmappable + skipped = discovered` or the gate blocks; "imported N coupons" and "not supported"
   are refused.

## Localhost media sources

If the source profile shows `localhost`, `127.0.0.1`, or another private-only source URL,
generated media import code must not assume Wix can fetch those URLs. Wix Media import is
URL-based (`rp-target-wix` import-from-URL primitive), so live media import needs a public
URL reachable by Wix servers. This is optional and, as far as we know today, only affects
media import. Entity-native background ingestion from external URLs follows the same
reachability requirement: if the target API ingests a source URL itself, that URL must
still be publicly reachable by Wix.

Codegen/runtime should support one of these explicit paths:

- Use a public HTTPS tunnel/source URL for live media import. For ngrok on macOS:

  ```bash
  brew install ngrok
  ngrok config add-authtoken "<YOUR_AUTHTOKEN>"
  ngrok http 8090
  export WP_BASE_URL=https://<id>.ngrok-free.app
  ```

- If the source REST responses still contain local media URLs, generate a configurable
  rewrite from the local base URL to the public tunnel base URL. For WordPress, use
  `WP_MEDIA_URL_REWRITE_FROM` and `WP_MEDIA_URL_REWRITE_TO`; when those are blank, it is
  acceptable to rewrite localhost/private origins to public `WP_BASE_URL`.
- Or generate/allow a media-skip/defer mode and document that media-dependent references
  such as hero images, galleries, and downloadable files will be absent until media is
  imported.

Surface the selected path in `execution/review/import-plan.md` and the execution plan before any live
write. Do not let a dry-run with localhost media URLs imply live Wix Media import is ready.

## File targets

Write code under the project-local source tree:

- `migrations/<project>/execution/`
- `migrations/<project>/src/setup/`
- `migrations/<project>/src/extract/`
- `migrations/<project>/src/import/`
- `migrations/<project>/src/lib/` — vendored shared modules (the source adapter's transport
  module, `rp-target-wix/lib/ndjson.js`, `rp-target-wix/lib/wix-writers.js`,
  `rp-target-wix/lib/wix-target-spec.js`, `rp-target-wix/lib/wix-build.js`), copied here so
  the project runs standalone with no external deps
- `migrations/<project>/src/extract/readers/`
- `migrations/<project>/src/import/transforms/` — **thin glue only.** Vendor and call
  `wix-build.js`; do **not** re-derive the canonical→Wix payload layer here. Money objects, slug
  sanitization, the empty `physicalProperties` trap, choice-by-name variant references, the
  compare-at-must-exceed-price rule and the regular/sale price resolution are all settled in
  `wix-target-spec.js` + `wix-build.js` and regression-locked by
  `tests/mapping/wix-build-oracle-test.js` against 220 payloads from two live-verified imports.
  That layer is vendor-independent, so a per-project reimplementation only re-introduces bugs
  that were already found and fixed. This directory should hold at most the mapping from THIS
  project's reader field names onto the canonical vocabulary — and once the reader emits canonical
  records directly, nothing at all.
- `migrations/<project>/src/import/write-specs/`
- `migrations/<project>/src/setup/run-setup.js` — setup execution entrypoint
- `migrations/<project>/src/extract/run-extract.js` — extraction entrypoint. It must accept
  `--sample` (extract a small slice only); that is what the sample-preview gate runs.
- `migrations/<project>/src/import/run-import.js` — the runnable import entrypoint
  (required; see "Runnable setup/extraction/import entrypoints" above). `--dry-run`
  drives the safe-validation pass through the same import code path.
- `migrations/<project>/data/source-extract/` — extracted `<entity>.ndjson` record streams plus
  a `manifest.json` (the manifest is a single document, so it stays JSON)
- `migrations/<project>/state/crosswalk/crosswalk.ndjson` — authoritative local
  `sourceId -> targetId` crosswalk for native Wix entities
- `migrations/<project>/state/attempts/write-attempts.ndjson` — append-only write attempt
  journal for resume/reconciliation. When a write consumes blocked-source data, include
  `blockedDataSnapshot: {sourceEntityRef, snapshotVersion, extractedAt, checksum}` from the exact
  immutable snapshot loaded for that write.
- `migrations/<project>/state/url-preservation/base-paths.json` — entity-level public
  route intent from mapping `urlPolicy`
- `migrations/<project>/state/url-preservation/url-ledger.ndjson` — append-only URL
  preservation upsert log, one latest row per `sourceStableKey + sourceRelativeUrl`
- `migrations/<project>/state/url-preservation/redirects.ndjson` — planned redirect rows
  when source and target relative URLs are both known and differ
- `migrations/<project>/state/url-preservation/unresolved.ndjson` — public source URLs
  waiting on target route configuration, target lookup, or manual review
- `migrations/<project>/logs/` — audit/error logs emitted by the shared runtime
- `migrations/<project>/execution/review/import-plan.md`
- `migrations/<project>/execution/review/code-safety-review.md` when `SAFE_MODE=true` or
  `DRY_RUN=true`
- `migrations/<project>/execution/recovery-log.json` — append-only standard recovery
  actions emitted by every resumed, partial, missing-only, failed-only, or deferred-only
  run

Recommended machine-readable artifacts:

- `migrations/<project>/execution/setup-plan.json`
- `migrations/<project>/execution/execution-manifest.json`
- `migrations/<project>/execution/llm-handoff.json`
- `migrations/<project>/execution/live-import-summary.json`
- `migrations/<project>/execution/completion-report.json`

## Generated write spec contract

Generated writer code should be thin. It should primarily define deterministic per-entity
write specs, then pass Wix-shaped objects into the shared runtime.

Each write spec should define, as applicable:

- `entity`
- `mode`: `create | update | upsert | bulk_create | bulk_upsert`
- `create`
- `update`
- `lookup`
- `bulk`
- `batchSize`
- `concurrency`
- `retryPolicy`
- `throttlePolicy`
- `auditKeys`
- `crosswalkAuthority: "local"`
- `cmsMirror: "none" | "download" | "upload" | "download-and-upload"`
- `crosswalkStrategy`
- `reconciliationStrategy`
- `dependencyRefs`: derive from each in-scope entity's domain-knowledge `dependsOn` (see spec 0041),
  topologically sorted across the whole mapping plan — not re-derived from prose per project.
- `verificationLevel`: `verified | unverified`
- `safeMode.replacePaths[]`: resolved request-body paths copied from mapper
  `safeModeReplacements[]`, with `{ kind: "email" | "phone", path }` entries. Paths use
  the shared safe-mode grammar (`field`, `field[]`, `field.items[]`) and are relative to
  the request body passed to the shared writer builder. The mapper is required to surface
  these replacements in both machine artifacts and review markdown; codegen should treat
  missing `safeModeReplacements[]` for an entity with outbound contact fields as a mapper
  contract failure, not as a cue to infer or invent replacements silently.

The transform layer should output Wix-shaped objects only. Request-envelope building and
retry/reporting logic belong in the shared runtime.

When safe mode is enabled, generated import code must derive one `safeModeOptions` object
per source record and pass it to every Wix writer call. The options must include origin
`entityType`, deterministic origin `entityId`, `safeModePhoneNumber`, and the write spec's
resolved replacement paths. `entityId` must be the source ID or deterministic
`sourceStableKey`, never the target Wix ID. If no deterministic origin identity exists,
fail before writing.

Generated code must not query Wix by original email or phone values while safe mode is
enabled. Any destination lookup keyed by contact data must use the same mock value that the
writer will send, with local crosswalk state remaining the primary idempotency authority.

## Execution artifact contract

Codegen should emit machine-readable execution artifacts alongside runnable code.

- `execution/setup-plan.json`: execution-ready rendering of setup work
- `execution/execution-manifest.json`: authoritative ordered task graph covering setup,
  extraction, transform/write execution, artifact refs, checkpoint ids, and plan version
- `execution/llm-handoff.json`: whether unresolved codegen/execution decisions remain

This manifest is the primary downstream contract for `rp-execute-setup` and
`rp-execute-import`.

For every import task that handles public routed entities, include:

```json
{
  "urlPreservation": {
    "enabled": true,
    "basePathsPath": "state/url-preservation/base-paths.json",
    "ledgerPath": "state/url-preservation/url-ledger.ndjson",
    "redirectsPath": "state/url-preservation/redirects.ndjson",
    "unresolvedPath": "state/url-preservation/unresolved.ndjson",
    "applyRedirects": false
  }
}
```

Do not set `applyRedirects` to `true`; the current phase records redirect plans but does
not configure Wix redirects or site routes.

## Import completeness accounting contract

Generated import runners must treat completeness accounting as a first-class runtime
output. For each mapped entity class and meaningful subtype, the runner must produce an
`entityCompleteness` row with these counters:

- `extracted`
- `inScope`
- `attempted`
- `imported`
- `alreadyPresentByCrosswalk`
- `deferred`
- `failed`
- `skippedOutOfScope`
- `unexpectedSkipped`

Subtype is required whenever source records with the same entity map through materially
different write paths or deferral rules, for example simple vs subscription Stores
products. `deferred` means intentionally not attempted with a recorded reason. `failed`
means attempted and not successfully written. `unexpectedSkipped` is for in-scope mapped
records that were skipped outside an accepted out-of-scope rule.

The generated runner must call or vendor `skills/wix-replatform/lib/completion-report.js` and
write both:

- `execution/live-import-summary.json` during/after live import for machine inspection
- `execution/completion-report.json` as the authoritative final outcome artifact

For each row, reconciliation is:

```text
imported + alreadyPresentByCrosswalk + deferred + failed == inScope
```

Any reconciliation mismatch, non-zero `failed`, non-zero `deferred`, or non-zero
`unexpectedSkipped` count must appear in the report headline and in the deterministic
human completion summary. Do not report a run as cleanly complete when source, import, and
crosswalk counts do not reconcile.

## Verifying Wix APIs

**The primary control is the Target write contract above: call `rp-target-wix`'s
verified primitives when they exist.** That adapter is where each stable shape is
verified-once (by a real call) and where a Wix surface change is fixed in one place.
When Wix has a native entity but `rp-target-wix` does not yet have a dedicated writer,
codegen must generate a Wix REST call for that native entity via the adapter's generic
direct REST helper, log the missing writer, and call the RePlatform notification hook.
Do **not** route to CMS merely because the writer is missing.

- If a Wix tool surface such as Wix MCP is available, prefer it to locate the endpoint
  and request/response shape. If the shape is common enough, add a dedicated primitive to
  `resources/rp-target-wix/lib/wix-writers.js`; otherwise generate a project-local native
  REST call through `sendDirectRest` and mark it `UNVERIFIED`.
- **Confirm the shape with a real call, not a doc example** — public examples have been
  wrong (e.g. lowercase Ricos plugin enums that 400). Cover the new primitive in
  `tests/target-wix/contract-test.js` so drift stays visible.
- **Fallback when no Wix tool surface is available:** rely on published Wix REST/SDK docs
  and conservative names. Mark the generated native call `// UNVERIFIED:` until a real
  call confirms it — never ship an unchecked Wix call to a user's live site without
  surfacing it in the execution plan.

## Runtime policy

Verify each Wix endpoint and field at codegen time. The `// UNVERIFIED:` marker is a
fallback only for environments where no direct verification aid is available, not a way
to ship unchecked calls that fail later on the user's live site. Anything unverified must
be surfaced explicitly in downstream artifacts before execution.

## Missing writer policy

CMS fallback is for source concepts that do **not** have a suitable native Wix entity, or
for native entities explicitly rejected because they cannot preserve fidelity or would
cause unsafe side effects. CMS is **not** a fallback for a missing writer, and it is not a
special default for coupons just because coupon scoping/restrictions need mapping.

When the mapping targets a native Wix entity and no dedicated `rp-target-wix` writer
exists:

1. Generate project-local code that calls the native Wix REST endpoint through
   `sendDirectRest`.
2. Add a clear log line before the first use of that generated REST path.
3. Call `notifyMissingWriter({ sourceEntity, wixEntity, method, path, reason })`. The
   current implementation may be a no-op; the generated code must still call it.
4. Mark the path `UNVERIFIED` in `execution/review/import-plan.md` and the execution-plan report until a
   live/sandbox call promotes it.
5. Maintain the same idempotency rules as dedicated writers: crosswalk by source ID in
   local state and never dedupe by slug.

## Codegen rules

- **Never generate a reader that works around a route the source adapter's transport refuses.**
  An adapter transport may refuse a route because its response carries live credentials — a
  payment-gateway configuration route is the case that exists today. When it does, the adapter
  exports a purpose-built reader that returns the facts without the secret; generate a call to
  that, and record what it reports. Do not hand-roll a request, do not vendor or reconstruct a
  raw transport, and do not add a flag to the shared one. A generated reader that reaches the
  route directly puts a live credential into the extract files, the import logs and the
  transcript, where nothing downstream can take it back.
- Keep reader and writer responsibilities separate.
- Keep setup, extraction, and import responsibilities separate.
- Do not generate a read-all-into-memory importer for the general case. The reader extracts
  to disk first; the importer consumes extracted files from disk.
- Make transforms deterministic and testable.
- Make generated write specs deterministic and declarative.
- Preserve **source IDs** for traceability, but do not assume native Wix target IDs can
  be preserved or client-assigned.
- Generate a stable selection layer before executing writes. Use the shared
  `import-recovery.js` runtime helpers where available, or vendor equivalent helpers into
  the project. Selection must:
  - apply `--entity` before entity write execution,
  - apply `--source-type` against deterministic source subtype fields such as
    WooCommerce `type: "subscription"`,
  - exclude local-crosswalk hits in `--missing-only` mode and count them as
    `alreadyPresent`,
  - select latest failed attempt rows for `--failed-only`,
  - select latest deferred/needs-verification attempt rows for `--deferred-only`,
  - emit an execution selection summary before the first write.
- Native Wix creates must perform a local crosswalk lookup immediately before every create,
  even after pre-selection. If a crosswalk row is found, skip idempotently and count the
  record as already present instead of writing a duplicate.
- Every selective/resumed/partial run must append `execution/recovery-log.json` with a
  standard recovery entry containing: recovery id, timestamp, selection filters, reason,
  records selected, records attempted, imported, already present, failed, deferred,
  crosswalk changes, summary changes, operator-visible outcome, and links to detailed logs.
  Recovery artifacts are append-only; never overwrite or collapse prior recovery actions.
- Update `execution/live-import-summary.json` through a shared summary writer, not by
  hand-editing counters in recovery-specific code. The recovery-log entry must include
  the summary delta so final state can be reconstructed from standard execution artifacts.
- For public routed entities, consume mapping `urlPolicy` and initialize local URL
  preservation state before writes. Generate deterministic helpers, or vendor the shared
  `url-preservation-state.js` behavior, to:
  - write `base-paths.json` from entity-level route policies
  - derive `sourceRelativeUrl` from `sourceUrlField` or `sourceBasePath + sourceSlugField`
  - preserve the original `sourceSlug` before any normalization
  - record `plannedTargetSlug` before create/update
  - record `actualTargetSlug` and `actualTargetRelativeUrl` only after the Wix response or
    a safe target lookup proves them
  - append replacement rows to `url-ledger.ndjson` instead of editing rows in place
  - write `redirects.ndjson` only when both relative URLs are known and differ
  - write `unresolved.ndjson` with `pending_target_route`, `target_url_missing`,
    `source_url_missing`, or `manual_review` when a concrete preserved URL or redirect
    cannot be derived safely
  - never silently overwrite a source slug with a normalized slug
- URL ledger resume must replay the latest valid `url-ledger.ndjson` row by
  `sourceStableKey + sourceRelativeUrl`, derive expected rows from extracted source
  records and `urlPolicy`, merge target IDs from the local crosswalk, and query Wix only
  when the write spec declares the lookup safe.
- For native Wix entities, generate and use the shared local-state runtime
  (`local-state.js`) whenever the target API does not expose a client-controlled
  source-id field. Load `state/crosswalk/crosswalk.ndjson` at startup, rebuild missing or
  corrupt index caches from it, append a `started` row to
  `state/attempts/write-attempts.ndjson` before each native write, write the confirmed
  crosswalk row after success, then mark the attempt `imported`. **Slug-based dedupe does
  NOT work** — Wix rewrites slugs; never rely on it.
- When a transform consumes a fulfilled blocked-data request, carry its exact
  `sourceEntityRef`, snapshot version, extraction timestamp, and checksum into every related
  write-attempt row as `blockedDataSnapshot`. Do not substitute whatever snapshot is newest at
  report time; the journal records the version actually used to build that payload.
- Only fetch CMS `ImportCrosswalk` rows as a pre-execution seed for existing-site,
  legacy, recovery, or delta flows, and only when valid local crosswalk state does not
  already exist. Dedupe downloaded mirror rows by `sourceStableKey` and newest valid
  `updatedAt`. Never use CMS as the ordinary resume source after local state exists.
- **Conditional-entity gating must match the verification artifact exactly.** When an
  entity's import is gated on a `setup/setup-verification.json` item (e.g. an unverified
  native path that setup must promote), the generated lookup must key on the same field
  the generated setup runner writes (requirement id vs step id — pick one and use it in
  both). A mismatched key silently reports "not verified" (fails safe into deferral, but
  would wrongly defer a passing entity).
- The optional CMS mirror collection name is **`ImportCrosswalk`**. If upstream artifacts
  still say `MigrationRefs`, normalize them to `ImportCrosswalk` in the generated code and
  note the normalization in `execution/review/import-plan.md`.
- **Attach every related entity, don't just create it.** Creating a tag/category is not the
  same as linking it. Blog posts attach tags via `tagIds` (GUIDs) and categories via
  `categoryIds` on the draft-post create — collect the resolved ids and pass them, or the
  taxonomy exists on the site but `postCount` stays 0 (a builder bug we hit before).
- **Taxonomy creates are not idempotent**: treat `409 ALREADY_EXISTS` as success
  AND resolve the existing entity's id (e.g. `listBlogTags`) so it can still be attached —
  don't drop it.
- **Blog rich text is chunked for you.** `convertHtmlToRichContent` transparently splits HTML
  over the 30k Ricos cap and merges the node arrays; pass full HTML, don't pre-truncate
  or skip large posts. This is the **blog** path only — a blog post's `richContent` really is a
  Ricos document. Stores products must NOT use it: their HTML goes in `plainDescription` and Wix
  converts it server-side (see the product-description rule above).
- Use the shared runtime for batching, retries, throttling, checkpoints, and audit/report
  emission rather than generating those mechanics ad hoc.
- Use the deterministic execution-state preparation contract before native writes. Do not
  let generated import code query CMS directly for resume; CMS mirror rows must be copied
  into local crosswalk state first.
- Do not hardcode secrets.

## Headless storefront codegen rules

When the delivery mode includes a headless storefront (i.e. a `wix-headless` Astro project
is generated alongside the import), apply these rules in addition to the general codegen
rules above.

**Cursor-paginated catalog queries (required).** Generated shop and category pages must
never call `queryProducts().limit(N).find()` once and stop. Wix Stores returns at most 100
items per page — a store with more than 100 products silently truncates the listing.
Always generate a cursor loop in the shared catalog helper and call it from every page
that lists products:

```ts
async function listAllProducts(): Promise<Product[]> {
  const all: Product[] = [];
  let result = await products.queryProducts().limit(100).find();
  all.push(...result.items);
  while (result.hasNext()) {
    result = await result.next();
    all.push(...result.items);
  }
  return all;
}
```

Apply the same pattern to category-filtered product queries (`productsInCategory`). This
is a data-correctness requirement, not a UX preference.

**Product count display (required).** Every generated shop and category page must display
the total product count (e.g. `מציג X מוצרים` for RTL Hebrew sites, or equivalent).
The count is `products.length` after the cursor loop completes and must appear above the
product grid.

**`client:load` for primary CTA islands (required).** Generated product detail pages must
mount add-to-cart and cart-view React islands with `client:load`, not `client:only`.
`client:only` omits the component from the server-rendered HTML entirely — it is
invisible to crawlers and does not render until after full React hydration.
`client:load` hydrates immediately on page load. `client:only` must never be the default
for a primary call-to-action.

**URL redirect file for WooCommerce sources (required).** When the source platform is
WooCommerce and the delivery includes a storefront, generate `frontend/public/_redirects`
mapping old WordPress URL patterns to the new Astro routes. At minimum:

```
/product/:slug         /products/:slug        301
/product-category/:slug  /category/:slug      301
/shop/                 /shop                  301
/?p=*                  /                      301
```

Also generate `frontend/src/pages/product/[slug].astro` (singular path) as a redirect
shim to `/products/[slug]` (plural path). This prevents 404s on all inbound links from
the old site. Derive the source URL pattern from the source profile captured during
discovery; `/product/` is the standard WooCommerce single-product path.

The `_redirects` file and redirect shim are required migration outputs, not optional
polish.

## When codegen must halt to LLM

Emit `execution/llm-handoff.json` with `needsLlm: true` when any of the following occur:

- a native Wix path exists but only an unverified write surface is available
- setup artifacts are insufficient to generate deterministic setup execution
- transform semantics remain unresolved
- a multi-pass relationship strategy cannot be derived deterministically
- the runtime contract required from `rp-target-wix` is missing for the mapped target

## Output

Summarize which files were generated, which entities they cover, and any remaining implementation gaps.
