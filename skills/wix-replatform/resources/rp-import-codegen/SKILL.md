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

## Dependency readiness contract

Copy `lib/dependency-readiness.js` and its shared dependencies into the generated runtime.
Bind the execution manifest to the approved mapping plan with `mappingPlanDigest`.
Each import task declares canonical `entityRefs`, the domain knowledge's `dependencyRefs`,
and matching `dependencyEdges`. Every edge has exactly one producer: an import task,
all bound setup step IDs, or an approved census disposition. Run `validateManifestForProject(projectDir)` after writing the candidate manifest; it loads the real census adapter and calls `bindDependencyProducers`. Validate the complete graph;
missing, unreviewed, multiply bound or cyclic dependencies stop codegen.

Declare `sourceBindings: [{ ref, sourceEntity, keyField, keyPrefix, manifestPath, extractPath }]`
on tasks so the runtime can bind source keys to the complete extract and its manifest. Bind every contributing source separately, including multiple census/source populations targeting one ref; the pass records each manifest, extract and declared read plan without overwriting another source. Stamp attempts with the owning task ID and crosswalks with that binding’s source entity and raw source ID. Use the canonical target `domain/entity` on attempt/crosswalk rows; the gate also recognizes the existing singular, dotted and hyphenated forms for the same ref. A key outside that ref’s current source population, a key from another entity in a combined task, or mismatched evidence identity cannot resolve.
Use `dependencySourceBindings` for excluded source-key associations. Preserve the reviewed
mapping's census links rather than guessing associations from names. Setup-produced edges
always use `task-complete`; use `per-record` only where target knowledge explicitly permits
it for an import or excluded import dependency.

Import the gate's `startImportRun`, `bindTask`, `evaluateTask`, `gateBatch` and
`finishTaskPass`. For EAV extracts, source bindings additionally name the existing project-relative `readPlanPath`; the gate reuses the shipped EAV completeness and file-digest validator rather than treating a missing snapshot total as empty. Create one import run, bind each task, and create its Wix client from the
returned capability. Immediately before every batch, including each selective/resume
path, evaluate the task and pass the source-keyed records through `gateBatch`.
Each `gateBatch` input is `{ sourceStableKey, transform: async ({ resolveReference, resolveTaskReference, resolveSetupReference }) => payload }` (or `{ sourceStableKey, payload }` when it needs no target references). Transforms receive `resolveReference(ref, sourceStableKey, path)` for per-record edges and `resolveTaskReference(ref, sourceStableKey, path)` for task-complete import edges only after a complete current producer pass (empty producers cannot resolve a key). This separate resolver preserves whole-task blocking on any partial producer. They also receive `resolveSetupReference(ref, sourceStableKey, path)` after setup passes. They do not read a crosswalk or choose target IDs themselves. Use concrete indexed paths for repeated order fields. Send only
the returned `send` payloads, with each request's `sourceStableKey` and that batch's
`readinessGrant`. Use `writers.bindRecordClient(taskClient, { readinessGrant: grant, sourceStableKey })` for existing writer composites, or `writers.withReadinessGrant(request, { readinessGrant: grant, sourceStableKey })` for individual builders. These retain trusted read/auxiliary marks. A valid grant never authorizes a raw or altered writer request; object-spreading a marked request loses its authority. Principal payloads still match every resolved reference. Closed product patch builders bind the current record’s product and compare references under each changed top-level field; omitted fields retain the existing product state. Only the closed media/payment/extended-field auxiliary builders omit those principal paths. For standard product stock, get the current product through the bound record client, call `registerImportInventoryScope(recordClient, canonicalProduct, targetProduct)`, and pass that record client to `storesInventory.reconcileInventory`. The same-record principal write or current site-bound crosswalk establishes product ownership; exact variant-choice matches, requested stock and actual location/item reads bound the composite. This preserves standard quantity/location mappings without expanding quick Shopify’s separate exception. Persist/report the returned deferrals without substituting empty IDs.
The gate appends its own deferred attempt rows; do not append a duplicate deferred outcome. The runner appends started and terminal rows for attempted sends and persists confirmed crosswalks through the shared writers. Call `finishTaskPass` with the actual selection mode only after the pass finishes. Selective
work never establishes a full/empty pass. The append-only `state/readiness/task-passes.ndjson`
is evidence; `execution/dependency-readiness.json` is a diagnostic projection, not authority. Prerequisite deferrals remain current recovery work after admission, `started`, uncertain outcomes or failed retries. Only a current-site confirmed `imported`/`skipped_already_imported` outcome for the same task/key clears that lineage; admission is not completion. The runtime updates this task-scoped recovery index from journal deltas, and completion uses the same reducer.

`--describe` must include `dependencyReadiness.tasks` with each task's ID and exact
`{ ref, mode }` edges. Run `import-contract-verify` against the manifest. Generated importers
must obtain capabilities only through the dependency gate: no setup/quick/probe issuer,
caller-supplied phase, raw request escape, or direct execution-capability import. Site reconciliation uses `reconcileSiteEvidence({ taskBinding, readBack })`; reuse the existing unresolved-write reader/comparison against the recorded write. The callback returns `{ result, matchesRecordedWrite }` with the actual unchanged marked-read response from this site's registered client; a boolean or hand-built response never restamps evidence. Tasks with
no dependencies still require their task capability and batch grant. For source orders call `orderShippingReadiness` from `lib/order-reference-readiness.js` with the bundled, verified `selectOrderReferenceMapping()` conclusion and the reviewed source delivery/pickup mapping as its `{ logistics }` option. Preserve source tax amounts/breakdown separately; omission of a target tax-group ID never permits losing source tax values. A missing or inconclusive conclusion returns a deferred reference-fidelity result; preserve it through `gateBatch` so the journal and existing mapping-gap ledger expose the affected records. No stored API response or accepted source ID proves dashboard fidelity. Always carry source currency explicitly: Import Order may store an empty currency rather than applying the documented site default. Keep the existing
read-back gate below: readiness does not replace write verification or authorize resends.

## Generated read-back gate contract

For `order`, `member`, `contact` and `product`, reuse the reviewed pure `buildWrite(record)`
module and the entity decision's copied `readBackContract`. Generate no new omission policy or
comparison rules. Each mapping row retains its exact `sourcePaths[]`, canonical `writePath` and
`readPath` or `unverifiableReason`, with `fieldDispositions[].mappingRef` pointing to that row.
Copy the bundled read-back libraries with the shared runtime; importing a CLI must not execute
an extract or write. Other entities call `declaration(entity, { verificationKind, reason })`
from `lib/read-back-gate.js` and retain that explicit coverage declaration in their manifest.
Persist it with `recordDeclaration(projectDir, runId, entity, { verificationKind, reason })`
from `lib/read-back-summary.js`; the existing gate artifact then supplies completion and CLI
coverage reporting. A non-gated declaration never replaces gated-domain or earlier gate evidence.

Before the first target write and every resume, load the existing
`execution/read-back-inventory/<entity>.json` and call `ReadBackGate.prepare(inventory)`.
The inventory is built by the streaming `scripts/read-back-gate.js inventory` command using the
same builder; a missing extract means the check was not run. Validation requires the reviewed
mapping, decision, resolution and inventory bindings. Missing, stale or incomplete field
accounting holds the entity. Populated omissions require the existing identified mapping
approval user action, including all four current references; 1-click cannot approve them.

Wire `executeCanaries(getRecord)` before the entity's bulk import. The deterministic schedule
covers every populated intended write path, with a default ceiling of ten records; raising it
to at most thirty requires the recorded user decision. Canaries run serially, stop at the first
failed or unknown verification, and are excluded from subsequent create calls. Keep normal bulk
batching and concurrency after they pass. Call `verifySample({ record, sourceId, targetId,
index, isLast })` after every 200th record and the final record, using one-based stable source
order and a confirmed target ID. Synchronize at those sample boundaries; a failed sample stops
new batches and requires `reconcileInterval(getRecord, targetIdFor)` before continuation.
A partial final batch still performs its last-record check.

An uncertain send is reconciled through the gate's existing identity lookup before any retry.
Every lookup page and by-ID read must use the gate's budgeted read proxy (`reads.wix`), including
product catalog sweeps and contact candidate reads; a failed or truncated lookup is unknown,
never permission to send again. Preserve the gate and write-verification evidence across
resumes. Never rewrite an imported order. Contact, product and member repairs use the gate's
single-attempt-per-contract rule, unchanged revision marker and existing update path; a member
repair writes its contact with that contact's current revision. Never overwrite a record edited
since import.

When `ensureMember` removes a phone through its approved phone-collision guard, compare against
the request actually sent and preserve the writer's `guard-dropped` paths in the gate summary.
Canaries record it automatically. For bulk writes, pass each returned `findings` array to
`gate.recordGuard(sourceId, findings)` (it persists only the recognized collision finding), or
as `verifySample({ ..., findings })` on a sampled record; samples and `reconcileInterval` then
exempt only that record's guarded phone path. A missing target phone is never treated as a guard.
Do not turn that guard into `notMigrated`, an observed Wix loss or a fabricated placeholder
phone. Pending product-media processing is unknown until bounded settlement resolves; it cannot
be classified as a permanent dropped field or used to approve an omission.

Completion must retain `execution/read-back-gate.json`. Call the existing completion-report
writer so its read-back producer supplies actual per-entity statuses, path counts, pending
settlements, observed losses, approved omissions and merchant acknowledgements, plus recovery
operator actions. Do not infer a pass from a successful HTTP write or emit a separate success
summary. A held, not-run or unknown gate keeps the run incomplete, and missing acknowledgement
for an approved omission remains a pre-launch task.

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
  collection; it is a declared non-GET method with a JSON body template. The
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

### `structure-bridge-plugin` entities (`channel: "db-only"`)

**New bound entities use the project-local plan contract in
`rp-source-wordpress/PLUGIN-READ-PLANS.md`.** Carry `sourceMeta.extractionPlan` literally
from canonical discovery through mapping. A profile is optional; absent/invalid plans
remain typed deferrals. Never suffix physical table names or guess artifact filenames.
Use `lib/generated-plugin-handoff.js`'s `emitPluginHandoff(projectDir)` to emit the small
checked dispatch and importer/extractor entrypoints; preserve existing native readers,
target handlers, selectors, ledger/idempotency and authorization/mute/setup preflight in
the adapter described there. The emitter refuses existing non-template entrypoints before
writing any destination. Deliberately adapt their implementation before replacing them;
preserve heartbeat, self-check and dependency ordering as well as target writes. The
adapter's pure `describeImport()` supplies its actual ledger/selector configuration and
`entityOrder`; the wrapper checks that descriptor instead of asserting invented capabilities.
Preflight runs once per import run before its first ready write.
Run the committed `import-contract-verify.js` with the intended selection before any
source/target I/O. The wrappers enforce preparation/full readiness and selected source
prerequisites; discovery samples are preview only. Keep unrelated native reruns available.
Include plan/evidence/assembly/extractor/helper inputs in existing freshness metadata.

**Legacy caller compatibility follows below.** New discovery emits bindings for profiled
entities too; it does not add a wrapping pass for old sidecars. Existing legacy readers
retain their signature, pagination and complete-identity behavior. Do not use the legacy
filename convention below as a fallback for a new selected entity with a missing binding.

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
- **Vendor `rp-source-wordpress/lib/structure-bridge-reader.js` beside it and call
  `extractStructureBridgeEntity({ dataDir, entity, table, transport, expectEav })` once per
  entity. Do not hand-write the page loop, checkpoint, reconciliation or manifest.** It
  implements every rule below for both variants (single request and EAV read plan) and is
  covered by `tests/source-wordpress/structure-bridge-plugin-generated-reader-test.js`.
  `transport` is `{ httpClient, siteBaseUrl, auth, onSourceRead }` built from the credential
  rule below; set `expectEav: true` when the entity's discovery markdown reports an `eavPair`.
  It returns rather than throws: `status` is `promoted`, `reused` or `deferred` (with `code`
  and `reasons`), plus `bestEffort` and `redactions`. Continue with the other entities after
  a `deferred` one. Each deferral is also written to
  `data/source-extract/<entity>.deferred.json` (reason, affected rows, resumable files,
  prerequisites, resolution check and a **Copy prompt for Import Operator**); a later
  promotion marks it `resolved`. At completion, spread
  `deferredExtractionReportInput(await collectDeferredExtractions(dataDir))` into the
  `createCompletionReport()` input (merge its `operatorActions` and `statuses` with the
  importer's own), so the deferral reaches the handoff as a **Requires Import Operator**
  action. Pass `restart: true` only when the record says `restartRequired`. It never promotes an EAV read whose
  plan has `droppedIdentityColumns`, and never sets `acknowledgedDroppedColumns` (complete
  identity). The rest of this section is the contract that file implements.
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
- **Pass `onSourceRead` on every `queryStructure` call, and file the totals once at the end**:

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
  snapshot — unlike an ordinary REST reader's
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
  or deleted mid-read can still shift a page's contents (an accepted residual gap), but the counts themselves must always be checked before anything
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

### Shopify sources (`platform: "shopify"`)

When `source-schema.json.platform === "shopify"`, read `rp-source-shopify` → "Read contract"
instead of generating a reader. The differences that matter:

- **Every read goes through the adapter's CLI wrapper** (`rp-source-shopify/lib/shopify-cli.js`),
  never a direct HTTP call and never a stored token: the store session lives in the operator's
  Shopify CLI. Vendor the wrapper; do not re-emit it.
- **The full-store extract is the adapter's bulk extractor**, not a generated per-record
  GraphQL pager: the extract step is `rp-source-shopify/scripts/shopify-extract.js` (resumable,
  one bulk dataset at a time, writing `data/source-extract/<entity>.ndjson` and
  `extract-manifest.json`; a source catch-up rerun passes `--catch-up`). Generate the importer
  to read those files only once the manifest says `complete`. If this bundle does not ship the
  extractor, stop codegen and report it; do not improvise one.
- **A gap found during the extract** (a read short of Shopify's count, a withheld field) is
  recorded through `rp-source-shopify/lib/import-findings.js` `stopWithFinding`, which adds the
  coverage row and stops the extract with the finding's code. Never drop or zero-fill it.

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
   a `V3_CATALOG` site (guaranteed at provisioning), so generated code may
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
   **Never let lost product options become a silent default variant.** When the source
   declares variation attributes for a product, set canonical `sourceDeclaredOptionNames` to
   those names in source order, even when no variant choices can be resolved from them (the
   WooCommerce all-"Any" shape: the parent declares attributes, every variation's `attributes`
   is `[]`). Leave it unset when the source declares none. `buildProduct` then throws for a
   product that declared options but built zero. Catch that throw in the existing per-record
   error handling: do not create the product, and write a `mapping-gaps.json` entry naming the
   product (`sourceId`, name) and its declared-but-unresolved option names, so it is reported
   for human review rather than counted as created. Do not guess combinations or map them to
   modifiers. The only exception is an existing `orchestration/decisions.json` entry under
   `optionLoss:<product.sourceId>`: look it up and, if present, pass it as
   `buildProduct(product, { ..., optionLossDecision: { key, entry } })`. `buildProduct`
   accepts it only when `source` is `user`, `value.accept` is `default-variant`,
   `value.sourceProductId` is this product's `sourceId`, and `value.declaredOptionNames` equals
   `sourceDeclaredOptionNames`. Generated code never creates, infers or defaults that entry. It
   records only one user's explicit answer for that one product: never from inference, a prior
   artifact, a mapping or execution approval, 1-click approvals, or a blanket answer. Even with
   a valid decision, still write the `mapping-gaps.json` entry, marked accepted with the
   decision key, so the loss stays reported.
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
   image at all** — no error, and the previous image already discarded. Items can
   remain un-ingested well after an accepted write. Generated media code
   must therefore read the entity back and re-send whatever did not land, and must feed BOTH
   failure kinds — the write that was refused (429) and the write that was accepted but never
   ingested — into the same retry list. Call `patchStoresProductMediaVerified` rather than
   `patchStoresProductMedia`; emitting the unverified writer for a media-bearing import is a
   codegen defect. Whatever never lands is reported per entity, by name — never summarised
   into a count.

   **WordPress-family product media is fail-closed before any Stores request.**
   This applies only when `orchestration/decisions.json` → `sourcePlatform.value` is exactly
   `woocommerce` or `wordpress`; do not read the wrapper object or the nullable
   `orchestration/run.json` field. Quick mode remains unchanged. Vendor the shared root
   `lib/confirmed-pictures.js` and `lib/product-media-deferral.js` while preserving the normal
   toolkit layout, and emit this sequence in the generated importer:

   1. Load the target writer module first and use its exported `confirmedPictures` object for
      every declaration, source-media read and confirmation; never require another toolkit-root
      or vendored copy of `confirmed-pictures.js`. At process start, read
      `decisions.sourcePlatform.value` and call
      `writers.confirmedPictures.declareMediaSource(sourcePlatformValue)` once. The first
      declaration is final. Do this for every source; the target guard activates only for the
      two identities above. Under either guarded identity call
      `writers.assertProductMediaGuardActive()` before the first product write. A failed
      assertion is a startup error: do not continue with an unguarded writer.
   2. For the products selected in this pass (failed-only means only those products), resolve
      each complete ordered gallery with `resolveImageUrls`, collect its positive `sourceId`
      values, and call
      `readSourceMediaRecords({ ids, source: { baseUrl, request: authenticatedWpRequest } })`
      once before the first product media write. `authenticatedWpRequest` must delegate to the
      shared `fetchJson` while adding the run's existing WordPress auth headers. The helper
      de-duplicates/sorts ids and performs
      sequential authenticated `wp/v2/media` reads in chunks of 100 with one 60-second total
      deadline per chunk. Do not persist the read or source picture data.
   3. Call `confirmPictures({ pictures, read })` for each whole gallery. Use only its frozen
      `pictures` list. Do not clone, rebuild, subset, extend, reorder, or hand-author that list;
      the shared Stores boundary rejects any URL gallery without that provenance before a
      request. `buildStoresProductMedia` is the one enforcement point used by create, bulk
      create, general product patch, media patch, and verified media patch. Wix media-id-only
      lists and non-WordPress sources keep their existing behavior.
   4. If confirmation fails, omit media from the product create/update so other fields still
      write and an existing target gallery stays untouched. After the target id is known, call
      `buildProductMediaFailureRow({ confirmation, attemptId, sourceStableKey, sourceId,
      targetId, runId, phase })` from `lib/product-media-deferral.js` and append its result to
      the ordinary attempt journal. The helper owns the `stores-product-media-guard` row shape,
      source/target ids, bounded message and three-value `failure.reason` contract. Append
      exactly one such row for the product, **after** the product write's own terminal
      `markAttempt` row. The guard failure must be the last row appended for that source stable
      key in every pass that leaves media deferred; no ordinary product success, skip or other
      terminal row may follow it. Never send a partial gallery.
   5. Treat a latest `stores-product-media-guard` failure as an ordering constraint in every
      later pass, including full, failed-only and unresolved-only passes. Before appending any
      later terminal row for that product key, repeat the source read and confirmation. If it
      still fails, finish the ordinary product attempt first and append a fresh guard failure
      last. Only a confirmed full-gallery write may be followed by a success row that clears
      the guard failure. On `--failed-only`, use the existing crosswalk target id, call
      `patchStoresProductMediaVerified` with the identical complete ordered confirmed gallery,
      and append an `imported` success row under the same source stable key. Do not create the
      product again. Every verified PATCH round re-sends that same full list; read-back results
      decide only whether another round is needed.

   After the products phase, load the whole real attempt journal once and pass all its rows to
   `withProductPicturesDeferredAction(completionInput, rows)` from
   `lib/product-media-deferral.js`. The helper folds the whole journal before filtering and
   returns the shared completion input with zero or one `product-pictures-deferred` action next
   to its existing actions. A later success row clears the action only after the source re-check
   and confirmed full-gallery write above; an older untouched failure stays; a manual destination
   edit appends no row and therefore does not clear it. This adds no
   recurring model tokens. Runtime adds
   `ceil(distinct selected picture ids / 100)` sequential source reads, each bounded by 60
   seconds including pacing/retries; surface that estimate in the import plan.
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

- no generated file defines a local transient/retry predicate, and none tests an error's
  `message` for a status number or a status word; generated retry paths call the shared
  `isTransientWixError`
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
    `--source-type <subtype>`, `--missing-only`, `--failed-only`, `--deferred-only`, and
    `--unresolved-only`. These are a **requirement on the generated importer**, not an operator
    convenience, and they are verified before the first write — see "The per-record ledger" and
    "Declaring the entry contract" below.
  - support `--describe` and call `assertGeneratedImporterContract` as the **first statement of
    `main()`** — see "Declaring the entry contract (required)" below.
    `--missing-only`, `--failed-only`, and `--deferred-only` are mutually exclusive. These
    flags must drive the same import path as a full run after selecting a stable record
    set; do not generate one-off recovery drivers.
  - support a `--rerun` catch-up mode built on `lib/import-recovery.js`'s
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
  - construct its progress logger via `parseProgressArgs`/`createProgressLogger`
    (`lib/progress-log.js`, already shipped — vendor it the same way as any other shared
    lib) and wrap the per-batch/per-record write loop with that logger's own
    `withHeartbeat(fields, fn)` (or the equivalent manual `startHeartbeat(fields)` /
    `stopHeartbeat()` pair around a longer-lived loop), carrying live counters as
    heartbeat fields: at minimum `recordsAttempted` (a running count), `currentEntity`
    (the entity/write-spec currently being processed), and `phase: 'import'`. **Mutate the
    same `fields` object's properties as the loop advances rather than passing a fresh
    object per record/batch** — `withHeartbeat`/`startHeartbeat` keep the one reference the
    ticker reads from, so a fresh object per iteration never reaches the ticker and the
    heartbeat goes stale even though the loop is progressing. This covers the write loop, not
    just process start, and must not change the progress-log format, event names, or polling
    contract in any way.
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
- wrap the extraction loop with the same `lib/progress-log.js` heartbeat helper
  (`withHeartbeat`/`startHeartbeat`+`stopHeartbeat`) `run-import.js` uses above, carrying
  `recordsAttempted`, `currentEntity`, and `phase: 'extract'` as heartbeat fields, mutated
  in place as the read loop advances — a paginated source read can run long enough that the
  same silent-heartbeat gap applies to `run-extract.js`, not only to the write phase

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

### The per-record ledger (required)

`state/attempts/write-attempts.ndjson` is **the** per-record log of what a generated importer
wrote to a merchant's store. A generated importer must **not** open a second, private results
log of its own, and must not write per-entity failure files beside it: failures live in the
journal with a terminal status, and the operator-facing views are the derived queue and the
recovery record described below.

**It is only ever appended to.** `appendAttempt` (which appends through `fs.appendFile`) is the
only writer. No flag, no environment variable and no mode may open it in a way that can shorten
it, and rotation, compaction and in-place folding are not permitted. This is not a style rule:
an importer once opened its results log in overwrite mode whenever a record limit was set, and
the next thirty-record sampling pass replaced several hundred rows with thirty.

**A validation pass writes somewhere else entirely.** `--dry-run` / `--sample` write to
`state/sample/attempts/write-attempts.ndjson` and `state/sample/…` generally; the real journal
is not opened at all. Pass `{ sample: true }` to `appendAttempt` / `markAttempt` /
`loadAttemptJournal`.

⚠️ **A limited pass that writes for real is not a sample.** The discriminator is whether live
writes occur, never whether a record limit is set — keying the sample path off the limit flag
reproduces the original defect with the file moved. A limited live pass writes to the **real**
journal and carries `selection: { offset, limit, filters }` so its scope is legible.

**Every row says which pass wrote it.** `validateAttemptRow` requires `attemptId`,
`sourceStableKey`, `writeSpecId`, `operation`, `targetEntityType`, `status`, `runId`, `phase`
(and whatever that validator requires next) — `runId` is the id the importer mints at process
start and already stamps on audit events, request captures and dry-run crosswalk rows, and
`phase` uses the same vocabulary as `wix.send` request metadata, not a second one. Build the
row with the validator, not from this list.

With both present, per-pass accounting falls out of the file: **group by `runId`** for a pass's
counts, **fold by `sourceStableKey`** (latest row wins, `foldAttemptsBySourceKey`) for record
counts. Without them every per-row count silently reads as a per-record count — a run
can hold several rows per order, and readers will mistake rows for records.

A follow-on row appended by `markAttempt` carries the `runId` and `phase` of the run appending
it, which may differ from the row it supersedes. That is deliberate: it is how a later pass's
confirmation of an earlier pass's write stays legible.

**A failure keeps its identifying facts as fields.** When `status` is `failed_retryable`,
`failed_terminal` or `succeeded_unverified`, the row carries a `failure` object:

| Field | Shape |
| --- | --- |
| `failure.sourceId` | string — redundant with `sourceStableKey` by design, so the row reads on its own |
| `failure.targetEntityId` | string \| null — the target-side id the request named |
| `failure.operation` | string |
| `failure.httpStatus` | integer \| null |
| `failure.errorCode` | string \| null — the server's own code (`applicationErrorCode`), never parsed out of prose |
| `failure.reason` | optional `no-source-id` · `no-source-record` · `source-unreadable` for `stores-product-media-guard` |
| `failure.scopeGroupName` | string \| null — the named grouping the server rejected |
| `failure.outcome` | `failed_terminal` · `failed_retryable` · `unresolved` |
| `failure.message` | string — free text, **may** be truncated |

⚠️ **No identifier may exist only inside `failure.message`.** Extract the identifying fields
from the error **before** shortening the message, never after. A coupon importer kept the first
three hundred characters of each error and in every one of eleven scope failures the identifier
of the thing that failed sat past the cut; recovering it now means running against a live store
again. The validator rejects a row carrying a GUID that appears in no other field.

`appendAttempt` / `markAttempt` redact-and-retry once around exactly that rejection — they strip
a GUID-shaped token from `failure.message` (never a structured field) and re-validate, so a genuine
Wix error whose message text happens to echo an id no caller extracted does not crash the run. That
is a safety net for the identifier the code failed to anticipate, not a substitute for populating
`failure.targetEntityId` correctly: **when an entity's target-side id is deterministic and
derivable *before* a write is even attempted** — a stable hash/derivation of the source id, the way
`order-history.js`'s `deriveImportedOrderId` works for orders — populate `failure.targetEntityId`
with that derived id on **every** attempt row, success or failure, rather than defaulting it to
`null` on failure. A hardcoded `null` here is exactly what turns a target-side id embedded in an
error message into an unstructured identifier, which is what trips the guard above in the first
place.

**An uncertain write is not a failure.** `succeeded_unverified`, and a `started` row that never
got a terminal follow-on, are **unresolved**: the next action is to **read the target back**,
never to re-send, because re-sending an uncertain write is how a recovery pass creates a
duplicate on a live store. They select under `--unresolved-only`, count as `unresolved` in the
recovery record, and are rebuilt into `execution/unresolved-writes.ndjson`
(`rebuildUnresolvedWrites`) — a projection of the journal, so deleting it loses nothing and it
is never a source of truth. A `deferred` record, including a source-data-rule skip, is **not**
unresolved and never reaches that queue. Never sum unresolved into `failed`: a recovery record
that does reconciles arithmetically and is wrong.

### Declaring the entry contract (required)

The flags above were asked for by this document for a long time and verified nowhere, so an
importer shipped that parsed no command-line arguments at all and still passed the import gate.
A boundary nothing crosses and nothing checks is not a boundary, so the generated importer now
declares its own capabilities and both sides check the declaration.

**`--describe`** prints exactly one JSON object to stdout and exits 0 without touching the
target:

```json
{
  "contractVersion": 1,
  "runIdSource": "process-start",
  "selectionModes": ["entity", "source-type", "missing-only", "failed-only",
                     "deferred-only", "unresolved-only", "rerun"],
  "ledger": {
    "attempts": "state/attempts/write-attempts.ndjson",
    "sampleAttempts": "state/sample/attempts/write-attempts.ndjson",
    "unresolved": "execution/unresolved-writes.ndjson",
    "recoveryLog": "execution/recovery-log.json",
    "appendOnly": true
  }
}
```

**The importer checks itself.** `run-import.js` calls
`assertGeneratedImporterContract(descriptor)` from `lib/import-recovery.js` as the **first
statement of `main()`** — unconditionally, before argument dispatch and before the
notification-mute preflight. If a required mode is missing or a ledger path is wrong it throws
naming every problem at once and the importer refuses to run itself, exactly as the mute
preflight aborts before any write: exit non-zero, no degraded mode, no skip flag.

`rp-execute-import` step 2d runs `import-contract-verify.js` against the same descriptor from
the outside before the first write. The two are not redundant: the self-check is what an
operator cannot skip, and the external gate is what catches an importer that never emitted the
self-check at all — such an importer also cannot answer `--describe`.

⚠️ The vendoring escape hatch ("use `import-recovery.js` where available, or vendor equivalent
helpers") survives for the helper **implementations**. It does **not** survive for the entry
contract: vendoring is not an excuse for a missing mode.

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

Use this caller shape; `toolkitRoot` is the installed or vendored wix-replatform root,
`dryRun` is the shared runtime's resolved dry-run flag, and `runId` is the shared runtime's run
id for the current pass — it stamps every execution-log entry, so a later recovery pass's
entries stay distinguishable from this one's. The post-execution handoff is not generated here:
that is the completion step's job, after the last write of the whole run.

```js
// BEGIN verified-contact-import
const { importContacts } = require(require('node:path').join(toolkitRoot, 'resources/rp-target-wix/lib/contact-import.js'));
const { createCompletionReport, writeCompletionReport, attachAttemptReasons } = require(require('node:path').join(toolkitRoot, 'lib/completion-report.js'));
const { loadAttemptJournal } = require(require('node:path').join(toolkitRoot, 'lib/local-state.js'));
const { writeLiveImportSummary } = require(require('node:path').join(toolkitRoot, 'lib/import-recovery.js'));
const contactVerification = await importContacts(wix, {
  projectDir, siteId, rows: contactRows, dryRun,
});
// Opt-in: flush BEFORE building the completion input, not after, so the run's
// own `coverageCheck` (computed by this very flush) is available to pass through below. This is
// the only correctly-wired caller shape this repo tests -- see "Coverage check" below.
let coverageCheck = null;
if (!dryRun) {
  // Flush the run's OWN held counters after every batch, not once at the end: an importer that
  // holds them loses them to any interruption, and a long run redirected to a temp file loses
  // them to the shell. If a mid-run fix must refresh a count from the real attempt ledger, first
  // select the report's scope -- target entity type, run/phase when run-scoped -- then fold ALL
  // rows in that scope with `foldAttemptsBySourceKey` (see "The per-record ledger" above), and
  // only then classify the latest rows by counted status. The fold keeps the latest row per
  // sourceStableKey of whatever it is given; it does not narrow scope. Never filter by status
  // before folding: a record whose later row superseded a `succeeded` one would count again.
  // Never count raw rows: retried batches and recovery re-entries leave several rows per record,
  // which is how a run's counts inflate well past the number of records. Dry-run rows
  // live in the separate state/sample/ journal; never mix that into a live report.
  ({ coverageCheck } = await writeLiveImportSummary(projectDir, {
    runId, imported: { contacts: contactVerification.verified },
  }, { runId, phase: 'import', detail: 'contact batch flushed', entityTypes: { contacts: 'contact' } }));
}
// `sourceKeys` is required on every row: it is the only way a deferred or failed
// count can later be joined back to the journal row that names its reason.
const rawEntityCompleteness = [{
  entity: 'contacts', verificationKind: 'contact', sourceKeys: contactRows.map(row => row.sourceKey),
  inScope: contactRows.length, imported: contactVerification.verified,
  deferred: contactRows.length - contactVerification.verified,
}];
// Load the journal ONCE per report and join it in before building the report
// -- never once per entity, and never read a second time by a later step of the same report.
const journal = dryRun ? null : await loadAttemptJournal(projectDir);
const completion = dryRun ? { status: 'simulated', verification: { contacts: contactVerification } } : createCompletionReport({
  siteId, runId, lastWriteAt: new Date().toISOString(),
  entityCompleteness: attachAttemptReasons(rawEntityCompleteness, journal.rows, { runIds: [runId] }),
  verification: { contacts: contactVerification },
  // This run called `writeLiveImportSummary` with a `runId` above, so it has opted into the
  // coverage check -- pass the run-matched block straight through so a wrong or
  // unconfirmed count escalates the completion status instead of looking clean by omission.
  coverageCheck,
  coverageCheckExpected: true,
});
if (!dryRun) {
  // Persist the final outcome and render the user-facing summary from the same object. One
  // shared writer: there is nothing here for a generated importer to reinvent, which is why
  // none of them ever did.
  await writeCompletionReport(projectDir, completion, { runId });
}
// END verified-contact-import
```

**Coverage check.** `writeLiveImportSummary` compares its held counters against the
live attempt journal for the same run (the `runId` passed in `options`, or `summary.runId`) and
adds the comparison as `coverageCheck` on the written summary and on this call's return value — it
never changes the held counters. This flush deliberately names only `imported`; the `deferred`
figure above is computed in the same pass for `entityCompleteness` but never carried into this
`writeLiveImportSummary` call, and that is fine — an ordinary bucket (`imported`, `deferred`,
`failed`, `attempted`) a flush does not name is simply not compared for that entity, never treated
as a mismatched `0`. `unexpectedSkipped` is the one exception: its absence defaults to a held `0`,
so always name it explicitly, even as `0`, once a flush's journal rows can produce a
`skipped_unexpected` row for that entity. The flush above passes
`options.entityTypes: { contacts: 'contact' }` because `contact-import.js`'s own verified writes
publish to the crosswalk under `targetEntityType: 'contact'` (singular) while this summary's key is
`contacts` (plural, matching the wrapper's own naming) — a generated importer's ledger-writing code
(the per-record `appendAttempt` calls the "per-record ledger" section above requires, alongside
this wrapper call, not shown again here) must stamp the same `targetEntityType` its `entityTypes`
option names, or pass a matching key directly. Both directions of the match are checked, so a
target type with real journal rows and no summary key naming it (directly or via `entityTypes`) is
still reported, never silently agreed with. Flush after the batch's journal rows are appended, not
before: this writer reads what has already landed in `state/attempts/write-attempts.ndjson`, and a
flush that races ahead of its own journal rows under-reports what the journal actually has so far.
A disagreement is reported whatever its cause, so this genuinely
produces `agrees: false` / `coverage_mismatch` for that flush, not merely a stale snapshot that
quietly resolves itself — order the write after the append so this does not happen.

The example above reads the run's own `coverageCheck` straight off this flush's return value
because this is the run's only flush; a multi-batch importer instead reads it back from
`execution/live-import-summary.json` at the end of the run and matches it to `input.runId`, never
assuming "the last block in the file" is this run's, since that file is shared by every run.
Either way, pass `coverageCheckExpected: true` into `createCompletionReport` whenever this run
called `writeLiveImportSummary` with a `runId` at least once (`rp-execute-import/SKILL.md`'s
end-of-run instruction owns this for the generated script as a whole) — omitting it is what keeps
an existing, not-yet-wired importer's behavior unchanged.

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

### Product SEO: proven per-field overrides only

For a source with an SEO evidence contract (Yoast on WooCommerce), put the per-field
`seoEvidence` on the canonical product (see rp-source-wordpress "Yoast product SEO evidence")
and never fill `seoTitle`/`seoDescription` from rendered output. Then, per product:

1. `plan = planProductSeo({ productId, seoEvidence, decisions })` from
   `rp-target-wix/lib/product-seo.js`, with `decisions` read from `orchestration/decisions.json`.
2. `buildProduct(canonical, { seoPlan: plan })`; pass the row to `importProducts` with
   `seo: plan` and **without** `seoData` in `expected`. The SEO stage verifies it per field
   (product read-back plus `resolvedTags`), reconciles a create that dropped `seoData` with a
   revision-protected PATCH, applies reruns as partial updates, and returns `report.seo`.
   The stage already bounds its own concurrency, pacing and settle waits; do not wrap it in
   a per-product loop or add sleeps around it.
3. Include `plan.projection` (never the receipt) in the product's `sourceHash`.
4. Add `report.seo.stageResiduals` to the completion input's `stageResiduals`.
5. If `buildSeoDispositionQuestions(plans)` returns questions, ask the owner once per question
   and record the answer with `recordSeoDisposition` (source `user`). Never answer it for them,
   in any automation mode, including one-click.

Never write product SEO through Item SEO Tags bulk set (`bulkSetItemSeoTags` refuses
`STORES_PRODUCT`), and never write canonical, robots, schema, social tags or an SEO pattern.

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

### Product category attachment: attach, then verify (required)

**Never call `bulkAddItemToCategories` inline and treat its resolved promise as proof the
product is in its categories.** It is an ADD against a bulk endpoint that takes exactly one
object argument, `{ productId, categoryIds }` -- not positional arguments. A generated
importer can call it as `bulkAddItemToCategories(wix, row.categoryIds, [r.targetId])`: three
positional arguments to a two-argument function. JS silently drops the third, so the function
received the bare `categoryIds` array as its whole `payload`; destructuring `{ productId,
categoryIds }` off an array yields `undefined` for both fields, on every call, forever. The
wrapping `catch {}` swallowed every resulting failure, and nothing downstream tracked this step
at all, so every product silently kept zero of its imported categories with a
clean completion report. Vendor `rp-target-wix/lib/stores-category-attach.js` with
`wix-writers.js` and route every category link through it instead.

**This example assumes composition.** A generated importer runs this stage alongside
others -- order-history, member-pass -- that also extend `completionInput`, and `AGENTS.md`'s
single-write rule still holds: only ONE block in the whole generated file, whichever genuinely
writes last, ever calls `createCompletionReport`/`writeCompletionReport`. `writeCompletionReport`
always overwrites the one `execution/completion-report.json` file (`writeFileAtomic`, no merge),
so a second call anywhere in the same run silently discards whatever the first call alone
recorded. This section therefore never builds or writes a completion report itself -- it only
extends the SAME shared `completionInput` the order-history/member-pass sections already extend,
exactly the way member-pass does above
(`completionInput = MC.mergeMemberCompletion(completionInput, ...)`): a non-terminal stage folds
its residuals into the held accumulator and stops there.

```js
const { reconcileCategoryAttachment, persistCategoryAttachReport, collectCategoryAttachStageResiduals } =
  require('../resources/rp-target-wix/lib/stores-category-attach.js');
// categoryAttachRows: [{ productId, categoryIds, sourceKey }] -- one row per product that has at
// least one category to attach. A product with none is simply never given a row.
const categoryAttachReport = await reconcileCategoryAttachment(wix, categoryAttachRows);
await persistCategoryAttachReport(categoryAttachReportPath, categoryAttachReport);
// Extend the SAME shared completionInput every other stage in this file extends -- never build
// or write a completion report here. Whichever stage genuinely runs last in this generated
// project (order-history-completion, when this project also imports orders; this stage's own
// trailing completion block, only on a project where category-attach really is the terminal
// write of the whole run) owns the single createCompletionReport/writeCompletionReport call and
// reads this same completionInput. Never stop at persisting the sidecar report alone: an
// unfolded categoryAttachReport is invisible to completeness accounting, which is the exact
// silent-failure shape this file exists to close.
completionInput = {
  ...completionInput,
  stageResiduals: [
    ...(completionInput.stageResiduals || []).filter((row) => !(row.entity === 'product' && row.stage === 'category-attach')),
    ...collectCategoryAttachStageResiduals(categoryAttachReport),
  ],
};
```

`reconcileCategoryAttachment` calls the writer with the exact shape it declares --
`bulkAddItemToCategories(wix, { productId, categoryIds })` -- for every row, never swallows a
write error (each is caught per-row and recorded with its message), and then reads every written
product back before marking it attached. `bulkAddItemToCategories` is an ADD, not a replace: the
read-back only ever confirms every expected categoryId is present in the product's actual set,
never exact set equality, so a product's other, unrelated category memberships are never
disturbed or required. A row can resolve to `category-attach-written` (confirmed by read-back),
`category-attach-reconciled-existing` (already carried every expected id, no write needed),
`category-attach-unverified` (write attempted, read-back never confirmed within the retry
budget -- not the same as failure, and must never be reported as one), or
`category-attach-failed` (the write call itself threw). `collectCategoryAttachStageResiduals`
must be called and its output folded into the shared `completionInput.stageResiduals` as shown
above, on every run that calls `reconcileCategoryAttachment` -- persisting `categoryAttachReport`
alone and stopping there reproduces the exact silent-failure shape this file exists to stop: a
`category-attach-failed` or `category-attach-unverified` row that never reaches the final
completion report, so the import reports `complete` while categories are missing. On a project
where category-attach really is the only/last stage, extend `completionInput` here exactly as
shown, then run the ordinary completion block (as the verified-contact-import or
order-history-completion examples do) once, after this point -- do not special-case this
section into writing early just because, on that particular project, it happens to run last.

Track source-side gaps too, the same way `stores-inventory.js` already asks its own caller to:
"Keep source gaps and failed product-to-variant mappings in `inventoryGaps` so every intended
source variant is counted" is a caller responsibility, not something the shared helper derives on
its own, because it can only account for rows it is actually given. The code that resolves source
categories into `categoryAttachRows` has the same obligation for category attachment: track any
source category that fails to resolve to a target category id (a `categoryAttachGaps`-style list)
so every intended source-to-category link is counted, not only the ones that made it into a row.

### Blog post author attribution (required)

**Never hardcode a single `WIX_BLOG_AUTHOR_MEMBER_ID` and attribute every imported post to the
site owner.** `draftPost.memberId` is required by the Blog API and Wix Blog has no "unauthored"
option, but that does not make owner-attribution an acceptable default for every post. A
generated importer that did exactly this carried the same owner memberId on every imported post,
while the WordPress source named distinct authors (`_embedded.author`) that the
transform/import layers silently discarded. The fix is not "use the
owner" — it is to resolve a real Wix member per distinct source author, per Wix's own "How to
Create Blog Posts" skill doc (dev.wix.com/docs/api-reference/business-solutions/blog/skills/
how-to-create-blog-posts, "Part 0: Get an Author/Member ID"): when there is no existing member to
reuse for an author, **create one** — its `profile.nickname` (derived from `contact.firstName`)
is the name the blog displays, so pass the real author's name when the source names one. Create
Member sends no email and fires no signup-automation trigger (documented at `wix-writers.js`'s
members section) — this is silent, not a notification risk.

**No source-reader change is needed.** WordPress's `/wp/v2/posts?_embed` (already how this
project's source reader populates `data/source-extract/post.ndjson`, per
`rp-source-wordpress/SKILL.md`'s "Embedded relations" guidance) inlines `_embedded.author[0].id`
and `_embedded.author[0].name` on every post whose author resolved. The bug was purely that the
blog transform discarded these fields rather than carrying them through to the import stage.

```js
const { resolveBlogAuthorMemberId } =
  require('../resources/rp-target-wix/lib/blog-author-attribution.js');
const memberCrosswalk = require('./src/lib/member-crosswalk.js').createProjectMemberCrosswalk({
  projectDir: ROOT, sourceEntityType: 'blog-author',
});
// post.sourceAuthorId / post.sourceAuthorName: carried through from the post transform's
// `_embedded.author[0].id` / `.name` (undefined/null when the source gave no author at all).
const authorResolution = await resolveBlogAuthorMemberId(wix, {
  sourceAuthorId: post.sourceAuthorId,
  sourceAuthorName: post.sourceAuthorName,
  crosswalk: memberCrosswalk,
  siteId,
  ownerMemberId, // the existing single-owner fallback, resolved once via listMembers as today
});
if (authorResolution.created) {
  // Caller records the crosswalk row -- resolveBlogAuthorMemberId only resolves/creates, it never
  // persists, mirroring the member-pass's own ensure/persistCrosswalk split above.
  await memberCrosswalk.put(post.sourceAuthorId, {
    memberId: authorResolution.memberId, loginEmail: authorResolution.loginEmail,
  });
}
draftPost.memberId = authorResolution.memberId;
```

- **One member per distinct source author, never per post.** `resolveBlogAuthorMemberId` looks
  up the crosswalk by `sourceAuthorId` first and reuses whatever member id it already holds —
  the same WordPress author across many posts, or a resumed/re-run import, must never create a
  second member for the author it already provisioned. Never call `createMember` directly for a
  blog author from generated code.
- **Fall back to single-owner attribution only when the post has no source author at all.** Not
  every migration source populates author info on every record; pass `ownerMemberId` (the
  existing fallback, resolved the same way it is today) and let the helper return
  `blog-author-owner-fallback` rather than making author resolution a hard requirement that
  blocks import when the data simply is not there.
- **The placeholder email is deterministic, non-deliverable, and collision-free, never the real
  author's email.** `blog-author-{hash(sourceAuthorId)}@{hash(siteId)}.invalid` — an `.invalid`
  TLD (RFC 2606) guarantees it never resolves or delivers. Each component is a hash of the RAW
  value (not a human-readable sanitization of it): two different raw `sourceAuthorId` values can
  never collide onto the same token, which a lossy sanitization (stripping/collapsing characters)
  could not guarantee (`'1-2'` and `'1@2'` would collide under a sanitized-token scheme). The token is opaque and carries no part of the real name; the
  real name goes ONLY into `profile.nickname`/`contact.firstName`, which is the whole point of
  the fix.
- **Respects the documented Create Member rate-limit floor** (`MEMBER_WRITE_MIN_INTERVAL_MS`,
  the same constant `ensureMember`'s own pacer uses) — do not add a second hand-rolled wait loop
  around the generated call site.

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

In the second form, reading `.categories` off an array yields `undefined`,
which the usual `|| []` turns into an empty array. It silently disables a category dedupe
index, silently disables a product name-match safety net, and makes a setup verification
report **0 categories on a site that has some** — all without one error line.

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
- **`toWixSlug` throws when a value sanitizes to empty** (all-illegal-punctuation/whitespace
  input, for example — an all-non-Latin title does NOT throw: `toWixSlug`'s sanitizer keeps
  Unicode letters, marks and decimal digits, so an all-Hebrew or all-Chinese title survives as a
  transliterated slug instead of collapsing to empty). A genuinely empty result is a signal to
  supply a deterministic fallback — the record's source id — not to omit the slug and let Wix
  derive one, which breaks URL preservation with no trace.

**WordPress source: decode before sanitizing (required).** WordPress's REST API
(`wp/v2`/`wc/v3`) returns a post/product's `slug`/`post_name` percent-encoded whenever the
original text has non-Latin characters (Hebrew, etc.) — see `rp-source-wordpress/SKILL.md`.
Sanitizing that raw value strips the `%` characters and ships a garbled hex-with-dashes slug
instead of the real one. Decode it with `decodeURIComponent` first (wrapped in try/catch: a
slug that was never percent-encoded, or that isn't a valid escape sequence, must pass through
unchanged rather than throw) and only then hand the result to `toWixSlug`/`coerce: 'slug'`.
This is documented as domain knowledge on `rp-target-wix`'s `stores/entities/product.json` and
`blog/entities/post.json` pitfalls.

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

## Members: full-fidelity create/reconcile, so orders can link to a buyer

`resolveOrderBuyer` (below) links an order to a member only when the member crosswalk row for that
source customer carries a `loginEmail` — nothing produces that row unless the member pass runs
FIRST, in its own loop, before order history. Generate the call, not a hand-rolled `createMember`.

```js
const CM = require('./src/resources/rp-target-wix/lib/customer-member.js');
const MC = require('./src/lib/member-completion.js');
const localState = require('./src/lib/local-state.js');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const memberCrosswalk = require('./src/lib/member-crosswalk.js').createProjectMemberCrosswalk({ projectDir: ROOT });

// BEGIN member-pass
// registeredCustomers: EVERY customer supplied to this pass (registered only -- guest buyers are
// out of scope here), each carrying the mapping's sourceStableKey. Pass the full list on subset passes too:
// the pass selects within it.
const memberPass = await MC.runMemberPass({
  projectDir: ROOT, records: registeredCustomers, runId, phase: 'import', writeSpecId: 'members',
  mode: selectionMode,                  // 'full' | 'failed-only' | 'deferred-only' | 'unresolved-only' | 'missing-only'
  sample: dryRun || sampleMode,         // sample journal path, and no population snapshot write
  sourceFile: customersExtractPath, sourceChecksum: customersExtractSha256,
  ensure: async (customer) => {
    const { contact, findings } = CM.buildMemberContact({
      firstName: customer.first_name, lastName: customer.last_name,
      phone: customer.billing && customer.billing.phone, countryCode: customer.billing && customer.billing.country,
      address: customer.billing && { addressLine: customer.billing.address_1, addressLine2: customer.billing.address_2, city: customer.billing.city, subdivision: customer.billing.state, postalCode: customer.billing.postcode, country: customer.billing.country },
    });
    const known = await memberCrosswalk.get(customer.id);
    const knownMemberId = known && known.memberId;
    const result = await w.ensureMember(wix, { loginEmail: customer.email, contact, knownMemberId });
    return { result, builderFindings: findings, knownMemberId };
  },
  persistCrosswalk: (customer, result) => memberCrosswalk.put(customer.id, { memberId: result.memberId, loginEmail: customer.email, contactId: result.contactId }),
});
// Load the journal ONCE here and thread the same rows into both this projection
// and the `attachAttemptReasons` join at the final `createCompletionReport` call below --
// `projectMemberPass`'s own `journalRows` option exists exactly so a report with a member
// breakdown never reads the journal twice.
const journal = await localState.loadAttemptJournal(ROOT, { sample: dryRun || sampleMode });
const memberProjection = await MC.projectMemberPass(ROOT, { runId, pass: memberPass, journalRows: journal.rows });
completionInput = MC.mergeMemberCompletion(completionInput, memberProjection.completion);
await MC.emitMemberTelemetry(memberProjection.telemetryEvents, (event) => execFileSync('node',
  [path.join(toolkitRoot, 'resources/rp-telemetry/scripts/rp-telemetry.js'), 'record', JSON.stringify(event), '--project', ROOT]));
if (!memberPass.ok) console.error('member pass refused: source keys missing, duplicated or unknown; no member was written');
// END member-pass
```

`selectionMode` comes from the importer's own `--failed-only` / `--deferred-only` /
`--unresolved-only` / `--missing-only` flags (`'full'` when none); `completionInput` is the run's
`let`-declared held completion input that the order-history block below also extends;
`customersExtractPath`/`customersExtractSha256` name the extraction file the customers came from.

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
- **Every customer's outcome is durable and reported.** `runMemberPass` writes a
  `started` row before `ensureMember` and a terminal row with the same `attemptId` after it (the
  crosswalk row first when a member id came back), in `state/attempts/write-attempts.ndjson`.
  Never add a private member results log, a hand-rolled `report(result)`, or a second tally.
- **The whole pass stops before any write when source keys are bad.** A missing or duplicate
  `sourceStableKey`, or (on a subset pass) a key the full pass never saw, means zero journal rows
  and zero Wix calls; the refusal is projected into the report (`incomplete_with_mismatches`)
  and one `pipeline_defect` event. Never deduplicate or skip records to get past it -- fix the
  mapping. A full pass writes `execution/member-population.json` (keys only); subset passes
  select within it, never shrink the report's denominator, and refuse when it is absent.
- **The report reads only the journal.** `projectMemberPass` folds the latest member row per
  key into the `members` completeness row (with the `unresolved` counter), `unresolved[]`,
  `droppedFields[]`, one operator action for ambiguous matches, and `memberOutcomes`. Declare no
  separate members row. Uncertain writes (409 already-exists, 5xx/transport/no-id creates, a
  dangling start) are **unresolved**: recover with `--unresolved-only`, which reads the member
  back by login email before any create. Emit the returned telemetry events once, after the pass;
  a telemetry failure never aborts the run.

## Order history: payments, refunds and preserved invoice documents

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
const orderResults = []; // compact final stage outcomes, no payment payloads

for (const source of orders) {
  const result = await H.importOrderHistory(wix, {
    order: toWixOrder(source),         // the mapped Import Order body — never set `id`; buyerInfo.email = source.billing.email
    sourceId: source.id,
    sourceSiteHost,                    // new URL(WP_SITE_URL).host
    evidence: {                        // FACTS from the source, nothing else
      amount: source.total,
      paidDate: source.date_paid_gmt, paidDateZone: 'utc',
      altPaidDate: source.date_paid,  altPaidDateZone: 'site-local',
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
    // this project, never pass a variable that is not actually declared (it throws ReferenceError:
    // contactCrosswalk is not defined the moment this line runs, not at require() time).
    buyer: await resolveOrderBuyer({ sourceCustomerId: source.customer_id, billingEmail: source.billing.email, memberCrosswalk }),
  });
  // BEGIN order-stage-result
  orderResults.push({ sourceKey: source.sourceStableKey, outcomes: result.outcomes });
  // END order-stage-result
  // result.findings also carries the contact-field codes: order-contact-email-dropped,
  // order-contact-phone-dropped (removed after Import Order named the field), order-contact-email-suspect,
  // order-contact-phone-suspect (warnings; value kept and sent) and buyer-email-unusable.
  report(result); // result.outcomes.{order, payment, refunds[], invoice, buyer}, result.findings, result.errors
}

// BEGIN order-history-completion
const { collectOrderStageResiduals, createCompletionReport, writeCompletionReport, attachAttemptReasons } =
  require(require('node:path').join(toolkitRoot, 'lib/completion-report.js'));
// Reuse the SAME journal rows the member pass above already loaded (when
// this run has one -- `typeof journal === 'undefined'` means it does not) rather than reading
// the journal again here; join them in before building the report.
const orderHistoryJournal = typeof journal === 'undefined'
  ? await require(require('node:path').join(toolkitRoot, 'lib/local-state.js')).loadAttemptJournal(ROOT)
  : journal;
const completion = createCompletionReport({
  ...completionInput,
  entityCompleteness: attachAttemptReasons(completionInput.entityCompleteness, orderHistoryJournal.rows, { runIds: [runId] }),
  orderHistoryInScope: true,
  stageResiduals: [
    ...(completionInput.stageResiduals || []).filter((row) => row.entity !== orderEntity),
    ...collectOrderStageResiduals(orderResults, { entity: orderEntity }),
  ],
});
await writeCompletionReport(ROOT, completion, { runId });
// END order-history-completion
```

A run with no member pass still loads the journal once, right before this call:
`const journal = await localState.loadAttemptJournal(ROOT, { sample: dryRun || sampleMode });` --
never once per entity, and never a second time for a report the member pass already loaded it for.

Before the loop, mapping supplies each order's `sourceStableKey` and `orderEntity` (the
same entity name used by the completeness counters). `completionInput` contains the final
held counters for the run. Collect the latest outcomes for every in-scope order, including
orders adopted from the crosswalk; persist the compact outcomes with batch accounting and
restore them on resume. Run the completion block once after the last write, including recovery,
and only for a live run. Dry runs retain the existing simulated-report path. Do not substitute
an empty residual list or derive it by counting retry attempts.

What the composite does, so the generated code must not:

- **Derives the order id** from `sourceSiteHost` and `sourceId` (Import Order accepts a
  caller-supplied GUID — verified live 2026-09-05), writes the crosswalk row before any further
  write, and on a crosswalk miss asks the target by that id. A lost crosswalk is a read, not a
  duplicated store. An order that already exists is reconciled, never re-sent: a re-send silently
  replaces the whole body.
- **Runs the payment gate from `evidence`.** A key the contract does not read (`sourceAmount`,
  `total`, `transaction_id`, …) throws, naming the key it should have been. It does not read as
  "never paid".
- **Derives each paid stamp under the clock YOU declare for it**, which is why the two paid-date
  lines above are paired with a zone. The source records one payment twice: the `_gmt` sibling is
  universal by that key's definition in the source schema, so it never takes a shop offset, and the
  plain field is the shop's wall clock with the zone stripped off, so it takes the shop's offset
  when one is known and carries `paid-date-timezone-assumed` when one is not. Which field is which
  is a fixed fact about the source platform, known before any shop is examined — state it here
  rather than leaving it to be inferred from a value that no longer carries the distinction.
  Supply `utcOffsetMinutes` as before when the shop's offset is known; it stays a fact about the
  SHOP, and "already universal" is `paidDateZone: 'utc'`, never `utcOffsetMinutes: 0`. Supplying
  the offset beside a present stamp whose clock you have not stated is REFUSED, naming the stamp:
  that is exactly the case where guessing the clock moves the payment by hours.
- **Reads the order's payments once** and reconciles both the payment and every refund against
  that read. Occurrence numbers for equal refunds are assigned from the refunds' source ids — pass
  ALL of an order's refunds in the one call.
- **Returns every outcome**, including the payment's when a refund exists, and a named
  partial-failure outcome (`payment-failed`, `refund-failed`, `invoice-failed`, with the cause in
  `errors`) instead of throwing, so a resume retries only what failed.
- **Sanitises the mapped body's contact fields before the request is built**.
  `sanitizeOrderContactFields` walks `safeModeContactFields[]` from
  `rp-target-wix/domains/ecom/entities/order.json` — the same six paths safe mode replaces — and
  either rewrites a phone into E.164 under the explicit country rule or removes the field and
  emits `order-contact-email-dropped` / `order-contact-phone-dropped` carrying the field and a
  stable reason, never the value. A removed buyer email also produces `buyer-email-unusable`,
  because "we had a customer and lost them" must be countable apart from a real guest.
  **Do not re-implement this in the generated runner and do not sanitise the body yourself**: a
  second pass would double-count the findings, and one placed after the composite would run
  after safe mode has already replaced every one of those paths with an always-valid mock. One
  bad email or phone fails the entire Import Order, so this is a local refusal before the
  network, never a send-then-retry loop.
- **Sets `buyerInfo.memberId` only from `resolveOrderBuyer`** (`rp-target-wix/lib/order-buyer.js`):
  a member crosswalk row whose `loginEmail` equals the order's billing email. Persist `loginEmail`
  on the member crosswalk row when creating members, or nothing can be linked. Never put a
  `memberId` on the order body yourself; the composite refuses it.
- **Binds the body's `buyerInfo.email` to the buyer it was resolved for.** The mapped body must carry
  the order's billing email (the same value passed as `billingEmail`); a linked buyer beside a body
  carrying another email, or none, is refused — a resolution for one order must not attribute
  another order to that member.
- **Handles contact fields Import Order refuses.** A contact
  field is removed only when Import Order's 400 names it in `fieldViolations[]` (exactly a
  `safeModeContactFields[]` path, and no other violation); the order is then sent once more under
  the same id, and each removal is an `order-contact-*-dropped` finding naming the field, never the
  value. A second refusal is `order-import-failed`. Before the first send, and so before safe mode,
  the composite checks the source values and emits `order-contact-*-suspect` warnings without
  changing them. Phones are never rewritten. On a `buyer-member-linked` order the retry keeps
  `buyerInfo.memberId` and `contactId`. The generated runner must not remove, rewrite or pre-check
  contact fields itself, and must not add its own retry around the composite.
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
   `resolveOrderCurrency(order, storeCurrency)` (an order field can be an encoded currency symbol such as `&#8362;`);
   read the target site currency; call `currency-gate.js` `evaluateCurrencyGate`. `halt: true`
   stops the run at the approval gate with the named finding. `currency-validated` is a line too.
2. **Coupons.** `sweepCoupons(page => wc/v3/coupons?per_page=100&page=N)` to exhaustion; the
   `posts` count by `post_status` through the plugin bridge for reconciliation;
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
   ⚠️ **When most or all of the batch needs a tag (e.g. the `Imported` /
   `Already_Used` / `Partially_Used`), the untagged-batch-then-tag path loses its throughput
   advantage entirely.** `updateCouponFields`'s field-level PATCH is read-back VERIFIED
   (its own TRAP 3) with a mandatory settle-and-verify wait, so once close to 100% of coupons
   need that follow-up call, every coupon pays the wait regardless of the batch step ahead of
   it, which makes the run slow end-to-end. Prefer per-coupon
   `createCoupon(wix, specification)` instead, with `tags` already in the specification: the
   normal-case response is the documented `{ id }`, trusted immediately with no settle wait,
   which is far faster. A small tagged
   minority still nets out better as bulk-untagged + per-item `updateCouponFields`, since only
   that minority pays the wait; this is specifically for the near-all-tagged case. Note that
   plain `createCoupon` does not reconcile a `code already exists` rejection the way
   `ensureCoupon` does — it is for writing coupons not yet attempted, not for idempotent replay
   over a batch that was already partly written; a resumed or repaired pass still needs a
   query-by-code reconciliation step for any coupon a prior attempt may have already created.
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

   **Emit this call; do not describe it.** `toolkitRoot` is the installed or vendored
   wix-replatform root. `fetchCouponPage(page)` returns `{ items, total }` from
   `wc/v3/coupons?per_page=100&page=N` with `X-WP-Total` as `total`; `readFreshCoupon(id)` returns
   `wc/v3/coupons/{id}` re-read NOW, or `null` if that read failed; `recordCouponCrosswalk(code,
   couponId)` is the run's crosswalk writer; `couponUpdateOptions` is the shared runtime's settle
   options for the read-back-verified PATCH.

   ```js
   // BEGIN verified-coupon-import
   const couponPath = require('node:path');
   const { sweepCoupons, mapCouponToWix, summarizeCoupons } = require(couponPath.join(toolkitRoot, 'resources/rp-source-wordpress/lib/coupon-discovery.js'));
   const { classifySnapshot, isBearerVoucher, classifyPreWriteDrift } = require(couponPath.join(toolkitRoot, 'resources/rp-target-wix/lib/coupon-redemption-drift.js'));
   const { bulkCreateCoupons, updateCouponFields } = require(couponPath.join(toolkitRoot, 'resources/rp-target-wix/lib/wix-writers.js'));

   // Gate the WHOLE pass: a snapshot that cannot be dated is refused exactly like a stale one.
   const snapshot = classifySnapshot({ capturedAt, now: Date.now(), maxAgeMs });
   if (!snapshot.fresh) throw new Error(`coupon pass halted: ${snapshot.verdict} -- ${snapshot.reason}`);

   const { coupons: restCoupons } = await sweepCoupons(fetchCouponPage);
   const mappings = [];
   const toWrite = [];
   const notWritten = [];
   const writeOutcomes = [];
   for (const coupon of restCoupons) {
     // The mapper decides redeemability from the source usage count and REFUSES what it cannot
     // express. A project-local toSpecification is not an acceptable substitute -- see the table.
     const mapping = mapCouponToWix(coupon, { resolveProduct, resolveCategory });
     mappings.push(mapping);
     if (!mapping.specification) { notWritten.push({ code: coupon.code, outcome: mapping.outcome, reason: mapping.reason }); continue; }
     let specification = mapping.specification;
     if (isBearerVoucher(coupon)) {
       const verdict = classifyPreWriteDrift({ snapshotCoupon: coupon, freshCoupon: await readFreshCoupon(coupon.id) });
       if (!verdict.write) { notWritten.push({ code: coupon.code, outcome: verdict.outcome, reason: verdict.reason }); continue; }
       // The verdict IS the final state. Rebuild from it; never send the mapper's snapshot.
       specification = { ...specification, active: verdict.writeActive, tags: verdict.setTags };
       if (verdict.usageUnlimited) { delete specification.usageLimit; specification.usageUnlimited = true; }
       else if (verdict.writeUsageLimit != null) specification.usageLimit = verdict.writeUsageLimit;
     }
     toWrite.push({ code: specification.code, specification });
   }
   // 100 per call. The batch silently discards `tags` and still answers 200, so it goes out
   // untagged and each written coupon is tagged afterwards with the minimal-specification PATCH.
   for (let i = 0; i < toWrite.length; i += 100) {
     const batch = toWrite.slice(i, i + 100);
     const outcomes = await bulkCreateCoupons(wix, batch.map(({ specification }) => { const { tags, ...untagged } = specification; return untagged; }));
     for (let j = 0; j < outcomes.length; j += 1) {
       writeOutcomes.push(outcomes[j].outcome);
       if (!outcomes[j].couponId) continue;
       await recordCouponCrosswalk(batch[j].code, outcomes[j].couponId);
       const tags = batch[j].specification.tags;
       if (tags && tags.length) await updateCouponFields(wix, outcomes[j].couponId, { tags }, couponUpdateOptions);
     }
   }
   const couponCounts = summarizeCoupons({ restCoupons, postsByStatus, mappings, writeOutcomes });
   // END verified-coupon-import
   ```

   ⚠️ **A project-local `toSpecification` is not an acceptable substitute for `mapCouponToWix`.**
   It is not a style preference. The mapper performs a list of refusals that do not survive being
   re-written by hand, and each one exists because the alternative writes something the merchant
   never published:

   | Refusal the mapper performs | What a hand-rolled transform does instead |
   | --- | --- |
   | Exhausted at source → `active: false`, tagged `Already_Used` | Writes it live |
   | Partly used → the uses **left**, tagged `Partially_Used` | Writes the source's original allowance |
   | Unreadable usage fields → `coupon-usage-limit-unresolved`, no write | Writes an undecidable money instrument live |
   | Unmappable discount type → `coupon-type-unmappable`, no write | Guesses a type, or drops a free gift silently |
   | Scope the target cannot hold → `coupon-scope-unmappable`, no write | Widens it to the whole store |
   | More than two decimal places → `coupon-amount-precision-unsupported`, no write | Rounds, so the target amount differs while every check reports a match |
   | Free shipping beside an amount → keeps free shipping, reports the dropped amount | Sends both and loses one silently |

   ⚠️ The writer now REFUSES a specification that never decided redeemability: `active` must be
   present and boolean, and `usageLimit` must be a positive integer unless `usageUnlimited: true`
   is present. The refusal fires in `ensureCoupon`, `bulkCreateCoupons` and
   `normalizeCouponSpecification`, before any network call, and it names the coupon code and the
   missing field. It is a CREATE-path guard only — `updateCouponFields` must keep carrying only
   the fields being changed.

2a. **Decide a coupon's final shape from the FRESH read, not from the mapped snapshot**
   (`rp-target-wix/lib/coupon-redemption-drift.js`). Gate the whole coupon pass on
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
   redeemable-again defect, reintroduced one layer down.

   **Why it cannot be skipped:** the target starts its own usage count at zero and nothing seeds a
   prior redemption, so a coupon used up between the read and the write lands fully redeemable and
   stays that way until somebody notices.

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
   spending vouchers after the import finishes. When the source carried at least one
   usage-limited coupon, generated code **MUST** emit the reconciliation entrypoint — a separate,
   re-runnable entrypoint the operator invokes at `rp-execute-import` workflow step 6b, not a
   branch of the coupon pass. Emitting it is a requirement, not a choice; an entrypoint that is
   never emitted is a step that is never skipped and never noticed.
   `classifyPostImportDrift` + `buildVoucherDriftPlan` take the receipts, a fresh source read and
   a target read-back and produce a read-only remedy plan (face value and affected orders per
   code). The entrypoint BUILDS and reports that plan and **must not act on it** — closing a
   voucher needs an explicit owner decision per code, including in one-click mode. The plan stays
   `readOnly: true`; do not add an apply path.
   ⚠️ `classifyPostImportDrift` returns exactly five post-import outcomes
   (`voucher-drift-reconciled`, `voucher-drift-remedy-pending`, `voucher-source-row-missing`,
   `voucher-target-row-missing`, `voucher-target-state-unreadable`). Unsupported face-value
   precision is the boolean `verdict.facePrecisionUnsupported` on whichever of those applies —
   wire the check on that flag, never as a `switch (verdict.outcome)` branch on
   `voucher-face-value-precision-unsupported`, which is a PRE-WRITE outcome and would produce a
   branch nothing reaches. Feeding a pre-write outcome to `buildVoucherDriftPlan` throws.
   The remedy is `buildRemedyRequest`: a `PATCH` carrying ONLY
   `{active: false, tags: [...]}` plus `fieldMask: {paths: ['active','tags']}`, which keeps the
   coupon id, code, dates and amount. **Never build that body from the coupon you just read** —
   the full specification alongside a narrow mask returns 200 and writes nothing, so counting 2xx
   responses produces a false pass on money. `verifyRemedyApplied` decides the outcome from a
   post-settle read-back, never from the status code. The entrypoint reports its result as the
   completion report's `voucherReconciliation` value (`not-applicable | reconciled |
   plan-pending-owner | remedied`); a run where it never executed records `not-run`.
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

## Shipping options: delivery estimate, verified write, recovery

The shipping stage runs after the source extract. After it has created the delivery regions, it
creates shipping options **only** through
`rp-target-wix/lib/shipping-option-stage.js` `runShippingOptionStage(wix, { projectDir,
regionIdByZone, sourceSystem, runId, phase, passMode })`. Do not hand-write this loop:

- It refuses to run without the final `data/source-extract/shipping-zone.ndjson` and its
  `shipping-zone.manifest.json`; a `.tmp` extract is still in progress.
- It writes `execution/shipping-estimates.json` (the per-option estimate resolution) **before**
  any write. Every payload carries only `estimatedDeliveryTime` (never `estimateDeliveryTime`),
  resolved as merchant decision (`source: "user"` only) > source text > the reviewed default in
  the **destination** site's language > none. It never writes English on a non-English site.
- It uses `createShippingOptionVerified` (create, read back, one estimate-only PATCH when the
  stored estimate is blank) and `recoverShippingOption` (read back, never re-send). It appends
  exactly what `shippingOptionWriteRecord` returns. Hand-built shipping accounting is not allowed.
- Crosswalked options always take the read-only path, in every pass mode, and are never POSTed.
  A 404 target raises `shipping-option-target-missing` and is never recreated automatically.
- It creates nothing in a region whose snapshot scan was incomplete (`SNAPSHOT_INCOMPLETE`) or
  after an unknown outcome there (`REGION_SNAPSHOT_UNPROVABLE`). The next run rescans the region.

The stage returns `fragment`. Fold it into the completion input with
`shipping-build.js` `mergeShippingEstimateCompletion(completionInput, fragment)` before
`createCompletionReport`. That replaces the previous run's shipping `operatorActions`, so a
resolved item drops out on the next run. Pass `passMode` from the run's recovery flag
(`unfiltered`, `missing-only`, `unresolved-only`, `failed-only`).

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
- `migrations/<project>/src/lib/` — the source adapter's transport module, plus the project's
  own local-state/runtime files
- `migrations/<project>/src/resources/rp-target-wix/lib/` — **`wix-build.js` and its siblings
  are NOT copied flat into `src/lib/`: `ndjson.js`, `wix-writers.js`, `wix-target-spec.js` and
  `wix-build.js` all vendor NESTED here.** Vendor `rp-target-wix/lib/` here preserving its own relative path (mirroring this
  skill's own `resources/rp-target-wix/lib/` layout exactly), so the project runs standalone
  with no external deps and every relative `require` between these files — and every relative
  `require` FROM a `src/lib/` file back into this directory (e.g. `write-verification.js`'s own
  `../resources/rp-target-wix/lib/wix-build.js`) — resolves unchanged from how it resolves
  in-repo. Do not flatten this vendoring; a flattened copy breaks any relative require that
  assumes the nested layout.
- `migrations/<project>/src/extract/readers/`
- `migrations/<project>/src/import/transforms/` — **thin glue only.** Vendor and call
  `wix-build.js`; do **not** re-derive the canonical→Wix payload layer here. Money objects, slug
  sanitization, the empty `physicalProperties` trap, choice-by-name variant references, the
  compare-at-must-exceed-price rule and the regular/sale price resolution are all settled in
  `wix-target-spec.js` + `wix-build.js` and regression-locked by
  `tests/mapping/wix-build-oracle-test.js` against payloads recorded from live-verified imports.
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
- `migrations/<project>/state/url-preservation/app-page-routes.json` — configured or
  unresolved per-family route results; saved-state read-back is distinct from served proof
- `migrations/<project>/state/url-preservation/link-audit.json` — atomic local census,
  pending/unresolved destination queues, writer integration and post-frontend evidence
- `migrations/<project>/logs/` — audit/error logs emitted by the shared runtime
- `migrations/<project>/execution/review/import-plan.md`
- `migrations/<project>/execution/review/code-safety-review.md` when `SAFE_MODE=true` or
  `DRY_RUN=true`
- `migrations/<project>/execution/recovery-log.json` — append-only standard recovery
  actions emitted by every resumed, partial, missing-only, failed-only, or deferred-only
  run

For app routing and internal-link reconciliation, generate `internal-link-audit.js plan` input from the
captured inventory and **confirmed** source-to-target crosswalk, not guessed slugs.
Supply declared exact source/destination hosts, containing source pages and their target
record type, target record ID, content field and planned `targetContentRevision`, the current
route read-back revision, target record IDs, page families, expected paths computed from
read-back patterns and slugs, explicit `supportedQueryKeys` when the target adapter has
verified query behavior, and per-family samples. Missing target identity goes to the
unresolved queue without an expected path. Generate a route transport only for a family
listed with exact request/read-back evidence in `rp-target-wix` capability knowledge;
other families stay unverified. The adapter for the later `verify` step must expose the current complete active-writer
inventory and order, `readRecord(id)` returning `{revision, fields}`,
`writeRecord(id, changedFields, baseRevision)`, read-only destination/sample checks,
and `checkRenderedLink(occurrence, {repairedPath, deploymentId, signal})` that confirms the
stored path is rendered. For fields owned by the shared non-blog reconciler, declare
`writer: "internal-link-reconciler"`, `compatible: true` and
`runsAfter: "post-frontend-verification"` in `getActiveWriters()`; include every other active
writer and its fields in that complete inventory. Supply `checkFragment` where anchor checks are supported. The
shared verifier groups links by containing logical record and field, applies
`lib/structured-link-patch.js`, journals before writing, checks revisions and reads back;
do not expose a per-occurrence `repair` callback. Unknown content revisions stay pending.
An interrupted response after a write resumes from journaled read-back without another
mutation. Unsupported rich-content nodes remain pending rather than replacing an entire
description with a path. Do not generate a blog-post link writer here: blog-link repairs
belong to the dedicated blog-post writer and its checkpointed post-frontend update,
publish and read-back lifecycle. The adapter must expose `inspectDestination()` and return `isLive: false` from a
current destination check before any route or content write; unknown/live state fails
closed. An
unknown or incompatible source-origin or content writer keeps affected fields pending before any
mutation. These are generated contracts, not evidence that a backend-only run has served
routes or repaired content. If the audit is at `budget-hold`, a same-run re-plan retains
the hold, calibration and elapsed time. Resume only with `budgetDecision: {decisionRef,
maxLiveMs, maxExceptionTokens}` from an explicit recorded owner decision; then run `verify` again.

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
- `dependencyRefs`: derive from each in-scope entity's domain-knowledge `dependsOn`,
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

Generated import runners must also produce `stageResiduals[]` rows — a per-stage failure
against records the entity row already counts as `imported`:

```
{ entity, stage, outcome, count, sourceKeys[] }
```

The runner calls `collectOrderStageResiduals` on the final order outcomes as shown above.
It counts failed payment/refund/invoice stages (including target-read failures and ambiguous
payment reconciliation) against
orders whose own outcome is `order-imported` or `order-already-imported`. `outcome` must be a
member of the payments outcome registry; anything else throws. Any row with `count > 0` forces
the completion status to no better than `incomplete_with_failures` and names the affected
source keys as recovery work. An order report with omitted `stageResiduals` is refused; pass
the collected array even when it is empty. For source-specific entity names, retain
`targetEntityType: 'ecom/order'` in the completeness input or set `orderHistoryInScope: true`.

This is an **orthogonal axis** and is never folded into `failed`: the order did import, and the
`imported + alreadyPresentByCrosswalk + deferred + failed == inScope` identity below exists to
protect that partition. Without these rows a shop with live unpaid orders on it reconciles
perfectly and reports clean.

**This requirement is not order-specific.** Any post-create sub-step whose failure must not be
hidden behind the parent entity's own `imported`/`alreadyPresentByCrosswalk` count needs its own
tracked residual -- the order payment/refund/invoice sub-stages above are the first instance of
this, not the only one it applies to. Product category attachment
(`stores-category-attach.js`, see "Product category attachment: attach, then verify" above) is
the second: `collectCategoryAttachStageResiduals(categoryAttachReport)` produces
`{ entity: 'product', stage: 'category-attach', outcome, count, sourceKeys }` rows the same way
`collectOrderStageResiduals` does for orders, and they fold into the same shared
`completionInput.stageResiduals[]` accumulator, read by whichever stage owns the single final
`createCompletionReport` call. This is not hypothetical: a completion report can show `product: reconciled, mismatch:
false` and `product-category: reconciled, mismatch: false` while no products actually carry
their categories live, because nothing tracked the link step itself. A new entity gaining a
post-create write that can fail independently of the parent create should be assumed to need the
same treatment until shown otherwise.

For each mapped entity class and meaningful subtype, the runner must produce an
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
- `sourceKeys` -- every in-scope record's source key, required on every row. It is
  the only way `attachAttemptReasons` can join this row's deferred/failed counts back to the
  journal rows that name their reasons; a row with no `sourceKeys` can never carry a structured
  (counted) reason, only free-text notes, and is rejected by `normalizeCompletenessRow` if it
  tries to.

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

**A record removed by an accepted out-of-scope rule is counted in `skippedOutOfScope` and
never in `inScope`**: `skippedOutOfScope` is never added to `reconciled` and never
subtracted from `expectedReconciled`, so `inScope + skippedOutOfScope <= extracted` must hold
for every row. For example, a source with 2 shipping zones where one is an empty catch-all
excluded by an accepted rule is `extracted 2, inScope 1, skippedOutOfScope 1, imported 1`, and
it reconciles. Counting the excluded zone inside `inScope` as well (`extracted 2, inScope 2,
skippedOutOfScope 1, imported 1`) breaks that identity and reports as a mismatch naming the
counting error, not a lost record — it is not a correct way to represent an exclusion.

### Every in-scope record leaves a durable row

No generated importer may end a source record's life without a row in
`state/attempts/write-attempts.ndjson`, written through `localState.appendAttempt` (so it passes
the current `validateAttemptRow`, including `runId` and `phase`). A count with no rows behind it
is a defect, not a summary.

| Rule | |
| --- | --- |
| Terminal row per in-scope record | Every in-scope record ends with at least one terminal row. A record the runner never attempts gets a `deferred` or `skipped_unexpected` row at the point of the decision, before the loop continues |
| Accepted skip | Excluded by an accepted source-data rule: `status: 'deferred'` |
| Unexpected skip | Skipped without an accepted rule: `status: 'skipped_unexpected'`, never `deferred`, so it is not counted, reported or recovered as an accepted deferral |
| Named reason | Both carry `reason`, a stable kebab-case code naming the rule or runner branch, never prose built from the record |
| Findings ride along | A row for an attempted write carries the write's `findings[]`, suspects and drops alike |
| Counts are backed by rows | Per `entityCompleteness` row, take each in-scope record's latest row in the current `runId` for that entity and subtype: `deferred` equals the number whose status is `deferred`, `unexpectedSkipped` the number whose status is `skipped_unexpected` |
| Reasons are backed by rows | A `deferred` or `failed` count with no stated reason is not an accounted-for shortfall. Call `attachAttemptReasons(entityCompleteness, journal.rows, { runIds: [runId] })` once per report, after folding in any member fragment and before `createCompletionReport`, so every row's `reasons` carries a per-code tally (`reason` for `deferred`, `failure.errorCode` for `failed_retryable`/`failed_terminal`) joined by that row's own `sourceKeys` -- never guessed, never renamed, never read from the journal more than once per report |
| No values | A row never carries a contact value: `sourceStableKey`, `field`, `reason` |

`skipped_unexpected` stays outside the reconciliation identity, so a non-zero count still makes
the entity row mismatch; recovery treats it as missing (never sent), not as uncertain. Reporting
which registered customers never received a login is the member-side instance of this rule; do not
build it twice.

`writeLiveImportSummary`'s coverage check compares `entityCompleteness`'s neighbor,
`execution/live-import-summary.json`, against these same journal rows. Omitting one of `imported`,
`deferred`, `failed`, or `attempted` from a single flush is fine — that bucket is simply not
compared for that entity, never treated as a mismatched `0`. `unexpectedSkipped` is the opposite:
always name it explicitly, even as `0`, once this entity can produce a `skipped_unexpected` row —
its absence defaults to a held `0` instead of "not compared", precisely so a silently-skipped
record cannot agree by omission. See "Use this caller shape" above for the exact flush.

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

- **Call a `rp-target-wix` writer with the exact parameter shape it declares -- usually one
  options object -- never extra positional arguments.** JS silently drops them, and a wrapping
  `catch` then hides the resulting undefined-field write failure. Not hypothetical: a generated
  call site once passed `bulkAddItemToCategories(wix, categoryIds, [productId])` against a
  `(wix, payload)` signature, and every category-attach write on that site silently failed.
- **Generated code must not define its own test for whether an error is transient.** Call
  `isTransientWixError` from the shared `rp-target-wix` writer module. A project-local test
  written against the error's message text cannot work: the shared writer truncates its message
  at 400 characters by design, and its format (`\`${method} ${url} → ${status}: …\``) is not
  the WordPress reader's `HTTP <status>` format — so a regex written from memory of the source
  client matches nothing a destination write ever produces, and the project ships looking
  retry-protected while retrying nothing. Four generated importers each carried such a copy and
  not one of them could ever fire.
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
- For a source with an imported redirect collection, adapt only captured redirect rules
  into `kind: imported_redirect` records through `url-redirects.js sources`, then run
  `url-redirects.js import-targets` if source domains were declared after capture. The
  planner uses stable source-system rule IDs, original source and scalar destination,
  status, match type, scope, source context, explicit website identities, capture revision
  and rule-specific capability evidence. Never derive a rule
  ID from array position or target, infer website membership from a host suffix, or feed
  content/menu/message fields into this planner. A partial capture must set
  `fullCapture: false`; it cannot retire absent rules. Preserve external targets in the
  captured source records and audit; only cutover may execute after its compatible consumer
  and verification checks exist. A pending or refused rule must not be treated as imported.
- Imports stay plan-only for redirects: never generate code that calls the SEO Redirects
  API. Record source-authored redirect definitions through
  `skills/wix-replatform/scripts/url-redirects.js sources` (bridge reads of the redirect
  plugins' tables by bare name, or an operator export) and finish with the offline
  `url-redirects.js report`; application and public verification are post-build helper
  operations scheduled by cutover.
- URL ledger resume must replay the latest valid `url-ledger.ndjson` row by
  `sourceStableKey + sourceRelativeUrl`, derive expected rows from extracted source
  records and `urlPolicy`, merge target IDs from the local crosswalk, and query Wix only
  when the write spec declares the lookup safe.
- **For EVERY native Wix entity, generate and use the shared local-state runtime
  (`local-state.js`) — there is no exception, and generated code must not create any other
  durable per-entity `sourceId -> targetId` store.** Not a per-entity JSON map, not a
  `<entity>-crosswalk.json`, not an in-project index of its own: one shared ledger at
  `state/crosswalk/crosswalk.ndjson`, written through the shared write primitives, for products
  and coupons and contacts and members exactly as for orders. A private per-entity file is
  invisible to resume, to recovery, and to the rerun/catch-up selection, all of which read the
  shared ledger and nothing else — so an entity remembered only in a private file is classified
  on the next run as never imported, and gets created a second time on a site the merchant is
  trading on. A run that keeps orders in the shared ledger and other entity types in private per-entity
  files leaves the ledger unusable for catch-up.
  Where the target *does* expose a client-controlled source-id field, write that field **in
  addition to** the ledger row, never instead of it.
  Load `state/crosswalk/crosswalk.ndjson` at startup, rebuild missing or
  corrupt index caches from it, append a `started` row to
  `state/attempts/write-attempts.ndjson` before each native write, write the confirmed
  crosswalk row after success, then mark the attempt `imported`. **Slug-based dedupe does
  NOT work** — Wix rewrites slugs; never rely on it.
- **Every confirmed crosswalk row carries the version pair from the write that confirmed it.**
  Populate `sourceVersionField` + `sourceVersion` (from the source record's own modification
  field) and `targetRevision` (exactly as the Wix response returned it — never incremented
  locally) through `nextCrosswalkBaseline`, on every confirmed write. These fields are optional
  in the schema only so rows written before they existed still load; absence is read as
  `unknown`, never as "unchanged". A generated importer that omits them produces a ledger that
  is complete for resume and useless for catch-up: a later rerun of a fully-imported project
  degrades to asking a human about records nothing actually changed.
- **The CMS mirror is a post-execution snapshot pass, generated only when a mirror was
  requested.** Gate it on `task.state.cmsMirror.mode` (`execution-state.js` →
  `hasUploadMirror`): `upload` and `download-and-upload` get exactly one pass; `none` and
  `download` get **nothing at all** — no collection reads, no writes, and no empty pass
  reported as a success. Generate it as a distinct step that runs **after the last entity
  write task**, reading the finished ledger:
  1. `loadCrosswalk(projectDir)` for the settled rows.
  2. `crosswalkRowsToMirrorItemInputs(rows)` from `local-state.js` — the one shared projection.
     A ledger row is **not** a mirror-item input: the ledger says `sourceEntityType` /
     `targetEntityType`, `buildImportCrosswalkItem` wants `entityType` / `targetType` and
     throws without the first. Never re-derive this mapping in the generated project.
  3. `syncImportCrosswalk(wix, inputs, { collectionId })` from
     `rp-target-wix/lib/wix-writers.js`, which builds each item through
     `buildImportCrosswalkItem` and batches at 1000 through `bulkSaveDataItems`.
  **Never compose a mirror item id in generated code.** The id is the row's own
  `sourceStableKey`; adding a project or source-instance prefix is specifically forbidden (see
  the KNOWN, UNRESOLVED LIMITATION comment on `buildImportCrosswalkItem` — the cross-project
  collision it describes is real and stays open, and closing it needs an approved
  identity/schema decision, not a prefix invented in a writer).
  **Never write the mirror inline per entity or per batch checkpoint.** Riding a mirror write
  alongside each record multiplies the calls the site absorbs during the run and turns a slow
  or failing collection into a drag on the import it only describes; a compact post-run
  reference copy means one snapshot of a settled ledger.
  **Never let the mirror fail the import.** `syncImportCrosswalk` returns
  `{ totalSuccesses, totalFailures, errors }` and does not throw on per-item failure. Record all
  three in the execution artifacts; a non-zero `totalFailures` or a thrown transport error marks
  the **mirror step** failed and is reported as a shortfall, while every imported record stays
  imported and the run is not failed. Never make native-entity import correctness depend on the
  mirror succeeding.
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
  taxonomy exists on the site but `postCount` stays 0.
- **Taxonomy creates are not idempotent**: treat `409 ALREADY_EXISTS` as success
  AND resolve the existing entity's id (e.g. `listBlogTags`) so it can still be attached —
  don't drop it.
- **Blog rich text is chunked for you.** `convertHtmlToRichContent` transparently splits HTML
  over the 30k Ricos cap and merges the node arrays; pass full HTML, don't pre-truncate
  or skip large posts. This is the **blog** path only — a blog post's `richContent` really is a
  Ricos document. Stores products must NOT use it: their HTML goes in `plainDescription` and Wix
  converts it server-side (see the product-description rule above).
- **Blog post media: cover and inline images go through `blog-post-media.js`.** A non-zero
  WordPress `featured_media` is the post's cover; every `imageData.image.src.url` in the
  converted Ricos document is an inline image. Do not re-implement this, and do not parse
  raw HTML for images. **Failure policy (human-approved):** a post whose cover or any inline
  image does not reach `READY` is written nowhere — no draft, no publish, no crosswalk row —
  and stays pending and recoverable; the other posts continue. Never import the text with a
  missing cover or an inline image still pointing at the source site. The blog post build
  runner owns draft creation, finalization, publication, read-back and recovery. Do not
  emit an independent `createDraftPost`/`publishDraftPost` pair for blog posts. Prepare
  the inputs and call it once after all post bodies and media decisions are known:

  ```js
  // BEGIN blog-post-media
  const blogMedia = require(require('node:path').join(toolkitRoot, 'resources/rp-target-wix/lib/blog-post-media.js'));
  const blogStage = require(require('node:path').join(toolkitRoot, 'resources/rp-target-wix/lib/blog-post-build-stage.js'));
  const { createBlogBuildClient } = require(require('node:path').join(toolkitRoot, 'resources/rp-target-wix/lib/blog-post-build-client.js'));
  const { toDraftPostBody } = require(require('node:path').join(toolkitRoot, 'resources/rp-target-wix/lib/wix-writers.js'));
  const pendingMedia = blogMedia.createPendingBlogMediaState({ projectDir });
  const preparedPosts = [];
  // fetchFeaturedMedia(id): GET wp/v2/media/{id} through the source client; return the record.
  for (const post of posts) {
    const key = blogMedia.postStableKey(post);
    const existing = await crosswalkLookup(key); // a hit still needs ledger/Wix reconciliation
    const richContent = await convertHtmlToRichContent(wix, post.contentHtml); // no mediaBySourceUrl
    let media;
    try {
      media = existing
        ? await blogMedia.existingPostMedia({ post, richContent, state: pendingMedia,
            resolveFromCrosswalk: lookupReadyBlogMedia })
        : await blogMedia.importAndConfirmPostMedia(wix, { post, richContent, state: pendingMedia, fetchFeaturedMedia });
    } catch (error) {
      if (error.code !== 'BLOG_LEGACY_MEDIA_UNRESOLVED') throw error;
      media = { allReady: false, resumed: false, reason: error.message };
    }
    if (media.allReady) blogMedia.applyPostMedia(richContent, media); // rewrites the SAME document
    const postFields = buildBlogPostFields(post); // mapped author/date, excerpt, taxonomy and SEO fields
    const desiredPost = media.allReady
      ? toDraftPostBody({ ...postFields, richContent, heroImageId: media.heroImageId }) : null;
    preparedPosts.push({
      sourceStableKey: key, id: post.id, date: postFields.firstPublishedDate || post.date,
      slug: postFields.slug, hasPostLinks: hasBlogPostLinks(post, richContent),
      forceSlugUpdate: Boolean(desiredPost && postFields.slug && !desiredPost.seoSlug),
      mediaReady: media.allReady, mediaPendingReason: media.reason || null,
      mediaResumed: media.resumed, existingCrosswalk: Boolean(existing),
      desiredPost,
    });
  }
  const { report: blogReport, pending: blogPending } = await blogStage.runBlogBuildStage({
    projectDir, sourcePosts: posts, preparedPosts,
    client: createBlogBuildClient(wix, { fetchPage, fetchImage }), pendingMedia, runId,
    crosswalk: { get: async (key) => crosswalkLookup(key), idOwners: (id) => crosswalkOwners(id),
      set: async (key, id) => updateBlogCrosswalkTarget(key, id),
      recordVerified: async (sourcePost, id) => writeBlogCrosswalk(sourcePost, id) },
    checks: registeredBlogChecks, transforms: registeredBlogTransforms });
  // END blog-post-media
  ```

  Bind `lookupReadyBlogMedia` to the local media crosswalk (return a `ready` row with
  `fileId` and non-zero `sizeInBytes` for a cover), plus `crosswalkOwners`,
  `writeBlogCrosswalk`, `updateBlogCrosswalkTarget`, `buildBlogPostFields`, `hasBlogPostLinks`,
  `fetchPage`, `fetchImage`, and the
  registered checks/transforms to the generated importer's actual helpers. Never leave the
  illustrative helper names undefined in generated code. `fetchPage` must return status
  and HTML, and registered page checks must stay within the fixed sample budget.
  `hasBlogPostLinks` reads the source/converted post for links to another source blog post;
  it must return a boolean for every post so preflight can count the possible link update.
  Feed `blogReport.operatorActions` into the existing `createCompletionReport` input's
  `operatorActions`, merging by `code` so the spot-check appears once. The normalizer
  keeps its schema fields. Keep affected addresses and prompts in
  `state/crosswalk/blog-import-report.json`; the completion row points there. A later
  standalone ledger action calls `refreshBlogHandoff` to update the spot-check row.
  `state/crosswalk/pending-blog-media.ndjson` owns per-medium outcomes; the blog build ledger
  owns lifecycle holds, including legacy crosswalk hits without local READY evidence.
  Use the stage's merged `blogPending` result for completion counts and operator rows;
  never maintain a second pending list. A pending entry with
  `awaitingWrite: true` has every image `READY` but no recorded post write; it is still pending.
  `markResolved` and `closeIfCrosswalked` own the recovery-log entry and repair a missed one on
  the next run, so always call `closeIfCrosswalked` on the crosswalk-hit path. Put
  `blogPending.pendingMedia` in `execution/live-import-summary.json` beside imported and
  already-present blog posts, and list `blogPending.pending` (post and per-medium reason) in
  the operator report. A blog step with pending posts is not complete: count them as
  deferred in the completion report. This is separate from the "Localhost media sources"
  skip/defer mode, which is an operator choice, not a media failure.
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

## Discovered sub-part outcome accounting

For every planned registry sub-part, generated importers emit its own `entityCompleteness` row using the registry subtype and back every count with journal rows, as for whole entities. Keep the whole-entity row separate. Attribute dropped sub-part fields with `droppedFields[].subtype` so a missing shipping line, for example, makes that sub-part partial without misreporting the parent row. When an exclusion corresponds to a discovered scope decision, include its `censusId`; `writeCompletionReport` derives `operatorGateRecorded` from the exact approved reconciliation, never from the importer's claim. Record-level filters without a census decision keep their existing exclusion behavior.
