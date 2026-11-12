---
name: rp-import-codegen
description: >-
  Generates migration readers, transforms, setup plans, and thin Wix write specs from schema and mapping
  artifacts. Use when producing runnable extract/import code under the migration project.
---

# rp-import-codegen

Generate source readers, transforms, setup/import entrypoints, and thin Wix write specs from approved migration artifacts.

The mapping step owns every semantic decision. Implement the recorded operation, transform,
reference policy, custom storage and temporary handling; do not choose an alternative or
invent a missing default. Report the exact unanswered decision/output to mapping and emit
no affected write behavior. A missing helper for a complete decision is implementation work.
Validate generated output against mapper-authored examples before execution.
The field-mapping example runner returns `mappingQuestions` with the source entity and
exact missing contract elements. Return them to mapping before generating affected writes;
independent complete decisions may still be exercised. Never fill these questions in code.

Vendor `lib/operation-assessments.js`, `lib/setup-producers.js` and `lib/mapping-recovery.js`
with their shared dependencies. Preserve pinned assessment/source/membership evidence and
the mapping gap ledger. The dependency gate and immediate transport check enforce withheld
fields and measured record holds. New mapping decisions use the mapper's
`references/knowledge-and-recovery.md` contract. Reuse the normal builder-held inventory
for record holds; preserve deferred source/intended dispositions without omission waivers.

For repairs, generate code only after mapping and approval are revised. Use
`mapping-recovery.repair({projectDir,gapId,sourceId,targetId,mappingPlanDigest,outputId,
expected,readTarget,writeTarget,verify,runId,taskId,siteId})` for each affected output.
`expected` comes from the mapped pure builder. The helper obtains the last verified field
state from the source/target-bound attempt journal; before the first repair the withheld
field must still be absent or already match the expected result. Caller-supplied baselines
cannot authorize overwriting an edit.
Use the normal capability-bound, readiness-gated writer for `writeTarget` and the ordinary
read-back comparison for `verify`. This helper validates current mapping/source/crosswalk
identity, reads before update, journals before transport and records verified output evidence.
When the update supports a revision/precondition, bind it to the current read; a conflict
keeps the gap open and returns to reconciliation instead of overwriting a concurrent edit.
For a record hold, the ordinary importer handles create/reconciliation first; this helper
only verifies the existing target and never issues another create. Several correction paths
require verified evidence for every path before a record's gap closes. Rebuild completion
and handoff after repair; do not close gaps by deleting projections.

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

Copy `lib/dependency-readiness.js`, `lib/import-task-runner.js` and their shared dependencies into
the generated runtime (`src/lib`, with `src/resources` for `rp-target-wix/lib`).
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

**Dependencies with no separate producer.** Copy `lib/dependency-proofs.js` with
the readiness library. Also vendor `lib/target-import-support.js`, `lib/config-env.js`, `lib/wix-auth.js`, `lib/import-interruption.js`, `lib/egress-proxy.js` and
the selected target knowledge with their relative module layout: reconciliation and the
shared Wix client read them.
Declare `writeOperations: { "<entityRef>": "<operation>" }` on every
import task whose approved mapping row resolved an operation with a reviewed contract (product
`createStoresProduct`, member `createMember`, order `importOrder`); the contract scopes its
refs (Import Order carries no `ecom/shipping-option` or `ecom/delivery-profile` reference) and
its approved `dependencyProofs`. Do not hand-derive edges: write the tasks, call
`deriveDependencyEdges(projectDir, manifest)` and copy each task's `dependencyRefs`,
`dependencyEdges` and `dependsOn`, then validate as above. Producers may also be
`no-producer` (with each proof's `operationContractDigest`), `secondary-output` (a member
task's verified contacts satisfying a per-record contact reference when no contact import
exists), `child-output` (a product task's verified variants satisfying a per-record
`stores/product-variant` reference; it requires `writeOperations` on the product task) or
`inherited` (a transitive ref carried by an intermediate dependency, or a child ref whose parent
has no child producer; never written directly). `pending-setup` from the mapping preflight must become a real setup step here, unless an import
task in this manifest writes that entity: then the import owns it and no setup step may list it
(`setup_step_claims_import_entity`). A dependency on an entity the same task writes gets no edge.
A task is never its own producer: validation refuses `task_depends_on_self`,
`dependency_edge_self_producer` and `task_depends_on_cycle`. Regenerate the edges; never hand-edit
`dependsOn`.
- Payloads must not write a proof's guarded paths; the gate and transport refuse them
  (`dependency-proof-contradicted`).
- Order line variants (Stores Catalog V3): write `catalogReference.options.variantId` from
  `resolveReference('stores/product-variant', variantKey, 'lineItems[i].catalogReference.options.variantId')`
  beside `catalogItemId` from `resolveReference('stores/product', productKey, ...)` on the same
  line. `variantKey` is the exact `sourceKey` the product import used for that variant expectation.
  The gate reads it from the product's verified receipt and refuses a variant of another product
  (`dependency-identity-pair-mismatch`); an unready or unknown variant defers the order. A
  variation absent from the complete source variation extract requests no variant reference: keep
  the product link, SKU and description lines.
- Order buyers: build `memberCrosswalk` with `order-buyer.js` `gatedMemberCrosswalk({
  resolveReference, memberKeyPrefix, loginEmailFor })`, so `buyerInfo.memberId` resolves
  through the gate; an unready member defers the order, a corroboration mismatch drops the link.
- Member contacts: after Create Member, call `verifyMemberContactIdentity(wix, { memberId,
  contactId, siteId, outcome })` and record its `identity` in the member crosswalk row's
  `secondaryIdentities` (keep `outcome: "unknown"` unless evidence distinguishes new from matched).
- Product media from URLs: never resend the landed product. Observe with
  `observeStoresProductMediaIngest(wix, { productId, expectedItems, initialProduct })`, passing the
  sent `{ url, altText, displayName }` items: it verifies each intended item (a matching count, a
  wrong image or a duplicated media ID does not verify). Policy is pinned: one initial read plus at
  most four, 15s apart, 60s window. Start observations concurrently; do not hold a worker or request
  slot per product while it waits. Record an `unresolved`/`unverifiable` result with
  `recordWithinWriteGap({ grant, taskBinding, sourceStableKey, ref: "media/media-file", targetId,
  code, observation })`; clear it with `resolved: true` and a later `verified` observation for the
  same target and items. Only observations the writer returned are accepted as evidence, and the
  observer only judges unmodified Wix responses for that product and site: pass the create
  response (or a read) itself as `initialProduct`, never a copy or a cached object. Gap records
  are serialized per project and stay recordable with the grant that admitted the write.
- A member-produced contact and a member ID on the same order must belong to the same member;
  the gate and transport refuse a mixed pair (`dependency-identity-pair-mismatch`).
- Product media ids: the `media/media-file` edge is per-record. Resolve each
  `media.itemsInfo.items[n].id` with `resolveReference`, placing each resolved id at the next
  free index; never read media ids from the crosswalk (an id the gate did not resolve counts only
  when it is exactly one ready media record's target; otherwise the gate drops it and records it).
  A product never waits for an image: one that is not ready yet, held, or failed resolves to
  `undefined` (`dependencyFailureActions: omit`); skip it. The gate records each pair in
  `execution/dependency-readiness.json` `omittedReferences` (`pending`, `held`, or the reason it
  cannot land). Media patch pass, after the media task's last wave and again after any media
  `--failed-only`: call `omittedReady({ taskBinding })`; gate each listed product again with its
  full gallery; send `patchStoresProductMediaVerified(recordClient, { productId, items })`; when it
  returns `landed: true`, call `recordOmissionsResolved({ grant, taskBinding, sourceStableKey,
  readBack: result.product, targetId: productId })`. Rows still open for a landed product become
  `dependency-omitted-after-failure` cutover items, except where the entity declares
  `dependencyFailureCutoverItems` (the site share image): its writer already reports the gap as
  that cutover item, so no media patch pass runs for it.
- Interleave per-record producers with their dependents (media and products): vendor
  `lib/dependency-waves.js` and call `planDependencyWaves({ dependents: [{ sourceStableKey,
  needs }], producerKeys, waveSize })`. For each wave, write its `producerKeys` through the
  producer task, then its `dependentKeys` through the dependent task; media no product names
  come last. Call `finishTaskPass` for each task once, after its last wave (a full pass that
  finished in this run is final for readiness). Then resume the dependent task's deferred
  records once. Products sending URL galleries name no media (`needs: []`) and start at once.
  On a fixture of about 400 products and 1,000 media files, products finish in about half the
  time with media ids, and in about a tenth with URL galleries.

Every import task builds on the site's regional setup step: `evaluateTask` holds a money-bearing or wall-clock
task (stores, ecom, gift cards, pricing plans, bookings, events) whose currency or time zone was kept, is unknown
or spans several base currencies, as a blocked `site/locale` row. Nothing extra is needed in generated
code: skip a held task, never retry it in the same run, and let the others proceed. Never create a write client
for a held task.

Use approved excluded dependencies as disposition producers, without generating an import
task for a missing writer. Product tag edges use the declared per-record mode and exact
`tags.publicTags.tagIds[]` reference path. Preserve the approved source membership and use
`resolveReference` for populated tag references, including excluded tags: its approved omit
rule returns no ID and the payload must omit that path. Never pass an undefined array item,
invent an ID, remove the manifest edge, or turn a held tag task into a completed task. Products
whose complete source record has no tags need no tag lookup; unknown or incomplete source
evidence is not an empty tag population. Keep the exact mapping gap and missing behavior in
the existing completion and Migration review handoff after supported product writes.

### Per-record tasks: call the shared runner (required)

Generated code holds only store-specific mapping. For a task that writes one record per
request, call `lib/import-task-runner.js` `runRecordTask` and supply only:

- `build(record, resolvers)`: the reviewed pure builder. It returns the gate payload, or the
  decided hold `{ status: 'held', holds: [{ decisionId, code }] }`.
- `send(recordClient, payload, record)`: the reviewed writer call. It returns
  `{ targetId, revision?, findings?, crosswalkExtra? }`.
- `reconcile(recordClient, payload, record)` when the target can be searched: `{ targetId }` for
  exactly one match, `null` when there is none, `undefined` when it cannot tell. The runner has
  a reader for `stores/category`.

The runner never holds or refuses a record that would otherwise import. It defers only decided
builder holds. A child whose parent did not land is written without the link. An earlier create
with an unknown outcome is adopted when exactly one match is found. Otherwise it is created, and a
possible duplicate is recorded when the lookup could not rule the earlier create out. Each such
loss is a finding on the record's journal row and a `dependency-reference-gap` cutover item.

```js
// Vendored with the shared runtime, like dependency-readiness.js.
const { runRecordTask } = require('../lib/import-task-runner.js');
const taskBinding = bindTask({ runCapability, taskId: 'stores/category' });
const result = await runRecordTask({ taskBinding, wix: taskClient, sourceSystem: 'woocommerce',
  build: (record, resolvers) => buildStoresCategory(record, resolvers).category,
  send: async (recordClient, category) => ({ targetId: (await writers.createStoresCategory(recordClient, category)).id }) });
```

The runner reads the task's source binding and extract, and then for every store:

- it skips records already crosswalked;
- it evaluates and gates each batch, then binds each record client before writing a `started` row;
- it defers decided holds (the gate defers them as `builder-held` with their reasons);
- it orders a same-entity tree parents first, and fills the parent id (see "Same-entity
  hierarchies");
- it looks up an earlier attempt whose outcome is unknown before sending, and adopts a single match;
- it writes a terminal journal row for every attempted record, plus the crosswalk row;
- it calls `finishTaskPass` when the pass is not stopped.

Do not re-implement any of these in generated code. Keep a hand-written loop only for a
writer the runner does not cover: bulk writers, composite flows (orders, members, products
with variants) and quota-held secondary writes. That loop still follows the gate contract below.
A transform that must decline a record with a named reason returns
`{ deferred: true, reason }`; the gate records it in `execution/dependency-readiness.json`
`referenceGaps` (a cutover item), never in `mapping/review/mapping-gaps.json`.

Import the gate's `startImportRun`, `bindTask`, `evaluateTask`, `gateBatch` and
`finishTaskPass`. For EAV extracts, source bindings additionally name the existing project-relative `readPlanPath`; the gate reuses the shipped EAV completeness and file-digest validator rather than treating a missing snapshot total as empty. Create one import run, bind each task, and create its Wix client from the
returned capability. Immediately before every batch, including each selective/resume
path, evaluate the task and pass the source-keyed records through `gateBatch`.
Each `gateBatch` input is `{ sourceStableKey, transform: async ({ resolveReference, resolveTaskReference, resolveSetupReference }) => payload }` (or `{ sourceStableKey, payload }` when it needs no target references). Transforms receive `resolveReference(ref, sourceStableKey, path)` for per-record edges and `resolveTaskReference(ref, sourceStableKey, path)` for task-complete import edges after a complete or finished-partial current producer pass (empty producers cannot resolve a key). A finished partial producer releases unrelated records; only a record naming a parent that cannot land ends `dependency-parent-final` without a write and becomes a cutover task. A producer whose only missing keys are approved builder holds is `complete-with-holds`, and a reference to a held key follows the same per-record final/hold handling. They also receive `resolveSetupReference(ref, sourceStableKey, path)` after setup passes, and `resolveSameTaskReference(ref, sourceStableKey, path)` for a parent the same task writes (see "Same-entity hierarchies"). They do not read a crosswalk or choose target IDs themselves. Use concrete indexed paths for repeated order fields. Send only
the returned `send` payloads, with each request's `sourceStableKey` and that batch's
`readinessGrant`. Use `writers.bindRecordClient(taskClient, { readinessGrant: grant, sourceStableKey })` for existing writer composites, or `writers.withReadinessGrant(request, { readinessGrant: grant, sourceStableKey })` for individual builders. These retain trusted read/auxiliary marks. A valid grant never authorizes a raw or altered writer request; object-spreading a marked request loses its authority. Principal payloads still match every resolved reference. Closed product patch builders bind the current record’s product and compare references under each changed top-level field; omitted fields retain the existing product state. Only the closed media/payment/extended-field auxiliary builders omit those principal paths. For standard product stock, get the current product through the bound record client, call `registerImportInventoryScope(recordClient, canonicalProduct, targetProduct)`, and pass that record client to `storesInventory.reconcileInventory`. The same-record principal write or current site-bound crosswalk establishes product ownership; exact variant-choice matches, requested stock and actual location/item reads bound the composite. This preserves standard quantity/location mappings without expanding quick Shopify’s separate exception. Persist/report the returned deferrals without substituting empty IDs.
The gate appends its own deferred attempt rows; do not append a duplicate deferred outcome. The runner appends started and terminal rows for attempted sends and persists confirmed crosswalks through the shared writers. Call `finishTaskPass` with the actual selection mode only after the pass finishes. Selective
work never establishes a full/empty pass. The append-only `state/readiness/task-passes.ndjson`
is evidence; `execution/dependency-readiness.json` is a diagnostic projection, not authority. Prerequisite deferrals remain current recovery work after admission, `started`, uncertain outcomes or failed retries. Only a current-site confirmed `imported`/`skipped_already_imported` outcome for the same task/key clears that lineage; admission is not completion. The runtime updates this task-scoped recovery index from journal deltas, and completion uses the same reducer.

`--describe` must include `dependencyReadiness.tasks` with each task's ID and exact
`{ ref, mode }` edges. Run `import-contract-verify` against the manifest; it also refuses an
emitted edge mode that differs from current domain knowledge (`dependency_edge_mode_mismatch`), so
a stale manifest/descriptor pair is regenerated, never matched to itself. One exception keeps
shipped manifests valid: an emitted `task-complete` edge that target knowledge lists in
`legacyTaskCompleteEdges` (it became `per-record` later; it waits for more, never less) is
accepted and checked as it was when emitted. Generated importers
must obtain capabilities only through the dependency gate: no setup/quick/probe issuer,
caller-supplied phase, raw request escape, or direct execution-capability import. Site reconciliation uses `reconcileSiteEvidence({ taskBinding, readBack })`; reuse the existing unresolved-write reader/comparison against the recorded write. The callback returns `{ result, matchesRecordedWrite }` with the actual unchanged marked-read response from this site's registered client; a boolean or hand-built response never restamps evidence. Tasks with
no dependencies still require their task capability and batch grant. For source orders call `orderShippingReadiness` from `lib/order-reference-readiness.js` with the bundled, verified `selectOrderReferenceMapping()` conclusion and the reviewed source delivery/pickup mapping as its `{ logistics }` option. Preserve source tax amounts/breakdown separately; omission of a target tax-group ID never permits losing source tax values. A missing or inconclusive conclusion returns a deferred reference-fidelity result; preserve it through `gateBatch` so the journal and existing mapping-gap ledger expose the affected records. No stored API response or accepted source ID proves dashboard fidelity. Always carry source currency explicitly: Import Order may store an empty currency rather than applying the documented site default. Keep the existing
read-back gate below: readiness does not replace write verification or authorize resends.

### Adopt-only tasks (mapping `writeMode: "adopt-only-no-writes"`)

When the approved mapping adopts what a quick pass already created (`kind: "adopt-existing"`,
`writeMode: "adopt-only-no-writes"`, e.g. products and categories after a quick pass), emit a task
for that ref with `adoptOnly: true`. It reads and verifies; it never writes (the writer refuses
`ADOPT_ONLY_TASK_WRITE_REFUSED`), so it declares no write-only dependencies: `dependencyRefs` and
`dependencyEdges` are empty and no producer is needed for brand, product customization, tags or
media. A task depending on it names the adopted ref and stops there. The flag is honoured only
when the mapping plan marks every ref of the task adopt-only; otherwise validation reports
`dependency_adopt_only_unapproved:<task>` and the creating-task rules apply. The reverse is
refused too: a task owning a ref the plan marks adopt-only but emitted without the flag fails
with `dependency_adopt_only_unmarked:<task>`, so emit the flag for every such task. A target
whose rows mix adopt-only and creating modes fails with `dependency_adopt_only_mixed`. The mapper
preflight, `deriveDependencyEdges` and the runtime gate read the same plan rows through one
resolver, so they draw the same edges. Never set the flag to skip a dependency of a task that
creates records.

Declare its `sourceBindings` as usual with `keyPrefix` `<sourceEntity>:` and a `keyField` whose
value is the plain source id (a gid is `lib/crosswalk-adoption.js` `normalizeSourceId`'s id tail).
The importer's first step seeds the standard crosswalk from the quick crosswalk, either by
`node skills/wix-replatform/scripts/crosswalk-adopt.js --project-dir <project>` (add `--dry-run`
to only count) or by calling `adoptCrosswalk` from the vendored `lib/crosswalk-adoption.js`
with `deriveBindings(projectDir, { contract })`. It appends the missing rows, never overwrites,
and reports conflicts (a different existing target, one Wix id claimed by two source ids) without
writing them; membership and tag sections are not seeded. A seeded row is a claim, not a result:
the task then reads each adopted record by id (slug marker for products), appends the
`skipped_already_imported` attempt row for the keys that match, and leaves the rest unready and
reported. Variant ids are not in the quick crosswalk; read them from the Wix product when a
dependent task builds its payload.

## Generated read-back gate contract

**Builder-only step (before mapping approval).** When `rp-mapper` asks for it, generate only
the pure `buildWrite(record)` module (for example `src/import/build-write.<entity>.cjs`) from
the draft decisions' transforms: record in, request body out. Generate no reader, setup or
import executor, descriptor, manifest, Wix client, capability, network or file write in this
step; `read-back-gate.js inventory` refuses a builder that references them, and
`import-contract-verify` refuses a project with no generated importer. The live importer is
generated only after the named approval.
The builder, like every generated transform, never reads crosswalks, `local-state` or
`data/source-extract`; references come through gate-owned resolvers. The readiness scan skips
only the file's header comment (before any code), so put provenance notes naming the source file
there; a comment after code is scanned as text like the code around it.

The builder must honor each output's `appliesWhen` exactly. Write the output when the predicate
holds on the source record and its sources are populated. Leave it out entirely when the
predicate is false: no placeholder, empty object or default value. An empty array such as
default-variant `choices: []` counts as absent. Never infer applicability from lookup `cases`
prose. If the decided transform needs a condition that no `appliesWhen` states, return it to
`rp-mapper`. `validate` reports `Builder omits an applicable output` / `Builder emits a
non-applicable output` with the output and record count. The gate refuses such a canary before
writing (`builder-missing-intended-field` / `builder-emitted-inapplicable-field`), and refuses to
compare such a sample.

A record the decided transform cannot write is held, not written partially: return
`{ status: 'held', holds: [{ decisionId, code }], … }` with one named reason per hold (a hold
without a reason is refused, `builder_hold_invalid`; `decisionId` must be a decision of that
entity in the plan, `builder_hold_unknown_decision`). `inventory` keeps the held record in source
coverage, lists it with its reasons (`records[].held`, `heldRecords`) and leaves it out of output
applicability and the canary universe; the held set is part of the inventory digest, so approval
binds it. The read-back gate refuses a held body (`builder-held-record`). The dependency gate
defers a held payload as `builder-held` with its `decisionId:code` reasons and never sends it.
`runRecordTask` relies on that, so generated code neither catches nor re-journals holds.

For `order`, `member`, `contact` and `product`, reuse that reviewed pure `buildWrite(record)`
module unchanged (the read-back inventory pins its SHA-256; a change makes it stale) and the
entity decision's copied `readBackContract`. Generate no new omission policy or
comparison rules. Each mapping row retains its exact `sourcePaths[]`, canonical `writePath` and
`readPath` or `unverifiableReason`, with `fieldDispositions[].mappingRef` pointing to that row.
Copy the bundled read-back libraries with the shared runtime; importing a CLI must not execute
an extract or write. Other entities call `declaration(entity, { verificationKind, reason })`
from `lib/read-back-gate.js` and retain that explicit coverage declaration in their manifest.
`verificationKind` is one of `contact`, `product` or `none` (`VERIFICATION_KINDS` in
`lib/entity-verification.js`). Members, orders and other entities with their own verification
flow declare `none`. The completion report refuses any other value at the end of the import;
`import-contract-verify` refuses the same values at codegen, with the file and line. The manifest
validator and the declaration do not check the value.
Persist it with `recordDeclaration(projectDir, runId, entity, { verificationKind, reason })`
from `lib/read-back-summary.js`; the existing gate artifact then supplies completion and CLI
coverage reporting. A non-gated declaration never replaces gated-domain or earlier gate evidence.

Write every gated entity (`order`, `member`, `contact`, `product`: an entity decision with a
`readBackContract`) through `runGatedEntity` from `lib/read-back-gate.js`. Do not
construct `ReadBackGate` or call `prepare`, `executeCanaries`, `verifySample` or
`reconcileInterval` yourself; `import-contract-verify` warns (never refuses) when no generated code
calls `runGatedEntity`.

```js
const { runGatedEntity } = require(path.join(toolkitRoot, 'lib/read-back-gate.js'));
const gate = await runGatedEntity({
  projectDir, runId, siteId, wix, entity: 'product', records,      // source records, any order
  buildWrite,                       // the reviewed pure builder, unchanged
  write: async (record, expected) => …,   // one record: the confirmed write, or { deferred: true, reason }
  writeBatch: async batch => …,     // optional bulk writer: [{ sourceId, targetId, findings }]
  sourceKeyOf: id => `product:${id}`,     // the journal's sourceStableKey for a source id
  marker, variants, read, lookup, repair, sourceSiteHost,           // entity options, as before
});
// gate.status: 'passed', or the gate's stop status; gate.written: the writeBatch/write outcomes.
```

`runGatedEntity` is the shared write wrapper: while it invokes `write` or `writeBatch`, it
tracks non-read calls through the supplied `wix.send`. If a generated writer throws before any
mutating request is sent, the wrapper annotates an otherwise-unclassified error with
`requestSent: false` before the gate handles it. Throw the original coded error (for example
`REFERENCE_UNDECLARED`) and do not guess or overwrite `requestSent`; an exception after a
mutating send remains uncertain and must retain the gate's read-back protection.

It loads `execution/read-back-inventory/<entity>.json`, prepares the gate, reconciles a suspect
interval carried from an earlier run, and settles a canary an earlier run sent that the target
rejected with a readable 4xx (written again, never looked up as uncertain). It then runs the
canaries and writes the remaining records in stable source order, in batches of at most 200. It
samples every 200th and the last landed record, and a failed sample stops new batches until
`reconcileInterval` clears it. A missing inventory or a failed preparation stops the entity
before any write. The `write` callback returns the confirmed write, or exactly
`{ deferred: true, reason }` when it declines before sending anything (for example, `gateBatch`
deferred the record), with no other keys. Never return a deferral after a request may have been
sent; a deferral that carries an id or any other key is treated as a possible write. The gate
records a deferral as not sent, stops with `canary-write-deferred`, and writes the record again
on the next resume.
The inventory is built by the streaming `scripts/read-back-gate.js inventory` command using the
same builder; a missing extract means the check was not run. Validation requires the reviewed
mapping, decision, resolution and inventory bindings. Missing, stale or incomplete field
accounting holds the entity. Populated omissions require the existing identified mapping
approval user action, including all four current references; 1-click cannot approve them.
The deterministic canary schedule covers every populated intended write path, with a default
ceiling of ten records; raising it to at most thirty requires the recorded user decision.
Canaries run serially, stop at the first failed or unknown verification, and are excluded from
the later writes. A run that sends no write for a gated entity records `not-run-no-writes`; it
adds no new stop when an earlier run holds that entity's gate result.

Pass the loaded write-verification state to completion instead of carrying each writer's report:
`createCompletionReport({ …, verificationState: await require(path.join(toolkitRoot,
'lib/write-verification-state.js')).load(projectDir, siteId) })`. A `verification[entity]` the
caller passes still takes precedence.

An uncertain send is reconciled through the gate's existing identity lookup before any retry.
Every lookup page and by-ID read must use the gate's budgeted read proxy (`reads.wix`), including
product catalog sweeps and contact candidate reads; a failed or truncated lookup is unknown,
never permission to send again. A product `read` hook that joins variant stock (Get Product V3
returns none) calls `storesInventory.resolveInventoryLocation(wix)` and `readInventory(wix, …)`
with the `wix` it is given; Query Inventory Items and its location query are registered bounded
reads. Preserve the gate and write-verification evidence across
resumes. Never rewrite an imported order. Contact, product and member repairs use the gate's
single-attempt-per-contract rule, unchanged revision marker and existing update path; a member
repair writes its contact with that contact's current revision. Never overwrite a record edited
since import.

When `ensureMember` removes a phone through its approved phone-collision guard, compare against
the request actually sent and preserve the writer's `guard-dropped` paths in the gate summary.
Canaries record it automatically. For bulk writes, return each record's `findings` array from
`writeBatch` (or `write`); `runGatedEntity` passes it to the gate, which persists only the
recognized collision finding. Samples and `reconcileInterval` then exempt only that record's
guarded phone path. A missing target phone is never treated as a guard.
Do not turn that guard into `notMigrated`, an observed Wix loss or a fabricated placeholder
phone. Pending product-media processing is unknown until bounded settlement resolves; it cannot
be classified as a permanent dropped field or used to approve an omission. A media item has
landed when it carries its own id: `image.id`, or `video.id` with `mediaType: VIDEO`
(`storesProductMediaItemLanded`); a landed video is never re-sent.

**Product videos.** When `execution/product-videos.json` has `attach[]` rows, the
product task attaches them after the product's verified create, under that record's grant:
`writers.attachStoresProductVideos(wix, { productId, videos })`, with `videos` from
`lib/product-videos.js` `videosWithRecordedFiles(projectDir, row)` (Wix Media import as VIDEO, wait
for READY, then the file id after the kept images; a gallery that has not settled is `deferred`; a
re-run skips videos already on the product and never imports a recorded file twice). Record every result with `lib/product-videos.js`
`recordProductVideoOutcome(projectDir, { productSourceId, productId, result })`; the completion
report derives `product-video-not-attached` and `product-video-manual` from the plan and those
outcomes. Never author those actions yourself, and never send a video as a `{ url }` image item.

Never author `read-back-*` operator actions (a generated `recordStop` pushing
`read-back-sample-failed` into memory): `writeCompletionReport` drops every caller action whose
code starts with `read-back-` and derives them from `execution/read-back-gate.json`, which
`verifySample`/`stop()` already persist. A stopped run reaches that writer through the shared
interruption wrapper (see "Stops and interruption" below).

Completion must retain `execution/read-back-gate.json`. Call the existing completion-report
writer so its read-back producer supplies actual per-entity statuses, path counts, pending
settlements, observed losses, approved omissions and merchant acknowledgements, plus recovery
operator actions. Do not infer a pass from a successful HTTP write or emit a separate success
summary. A held, not-run or unknown gate keeps the run incomplete, and missing acknowledgement
for an approved omission remains a pre-launch task. The toolkit creates that acknowledgement
request itself; a large approved set is listed in a sha256-pinned
`execution/review/read-back-omissions-<entity>-<requestId>.json` that the bounded prompt points
to, so never shorten, rebuild or re-create the request in project code. A later run's `prepare` takes over another
run's unprepared entry (the completion `gate-not-run` placeholder); only its own verification
clears it. Held records stay in `readBack` and the `read-back-held-records` operator action.

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
- **Use the WordPress REST credential discovery used.** Pass the generated `httpClient`
  (authenticated with `WP_USERNAME`/`WP_APPLICATION_PASSWORD`) and omit `auth`; the vendored
  client calls `/query/admin-key`. If no WordPress REST credential is configured, halt to
  needs-user before opening the output file.
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
  `queryStructure({ httpClient, structureRequest, cursor, limit: 200, onSourceRead })`,
  append every returned row, and continue only while `pagingMetadata.hasNext` is true.
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
  means skip re-extraction (except under `--entity`, which always re-reads from `cursor: null`).
  A mismatch — the table's approved query changed since that
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
   - when `DRY_RUN=true`, `execution/review/code-safety-review.md`
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
   for human review rather than counted as created. Never guess combinations by hand.
   **Route selection attributes through the shipped router, never in generated code**.
   When the source adapter can say which declared attributes share price and stock, set
   canonical `selectionAttributes` (`[{ name, choices, priceStockScope, required }]`, source
   order) and put each sellable source record on `variants` in matching precedence, with
   `choices` listing only the attributes it fixes. WordPress: call `wooSelectionAttributes(parent,
   variations)` from `rp-source-wordpress/lib/woo-selection-attributes.js`; it reads "Any" and
   menu order, resolves term-slug values to the parent's display names, and tags each record
   choice with its `attributeIndex` (keep it: two attributes may share a label). Do not
   re-resolve slugs in generated code. The variation's price, sale price, SKU and stock map as
   before. Then call
   `routeSelections(product)` from `rp-target-wix/lib/selection-route.js`. It returns the
   product with `optionNames`, `variants` and `modifiers` (shared attributes: mandatory modifiers;
   others: variants within Wix limits; a stock pool is never copied), plus `operatorActions`:
   put each in `execution/completion-report.json` `operatorActions` through the existing
   completion step. A thrown `SELECTION_ROUTE_CONTRADICTION` is a `mapping-gaps.json` entry, like
   the 0170 throw, and the product is held with code `selection-route-contradiction`. Before products, run `planSelectionCustomizations(routedProducts)` once over
   the whole catalog and write each returned customization with `createStoresCustomization`
   (reused by name on rerun); the product task's `entityRefs` must include
   `stores/product-customization`, or the writes are refused as `DEPENDENCY_TASK_MISMATCH`.
   Build each product with `buildProduct(product, { connectedModifiers })`, where
   `connectedModifiers` is `connectedModifierFromCustomization(written, { mandatory })` per
   `product.modifiers[]` in order, and add `modifiers: modifierExpectation(product,
   connectedModifiers)` to the import row's `expected`. Put `selectionRoute:
   routeRecord(routed)` on every routed product's import row; `importProducts` refuses a row
   with modifiers but no route record, and persists it on the product's row in
   `state/write-verification.json` and the import report, so the cutover storefront check can
   list modifier-route products from that artifact. One source record can become several
   variants: key each variant expectation (and crosswalk row) on the routed variant's
   `variantKey`, never on the shared source record id. `variation-any-attribute-unresolved` is a
   retired hold code (target knowledge `retiredHoldCodes`): import-contract-verify refuses
   generated code that still emits one (`retired_hold_code`) and the read-back inventory refuses a
   builder that holds with one (`builder_hold_retired`, with the record ids and the route to use),
   so a hand-written variant builder that holds "Any" variations fails before import. A project that already holds such
   products releases them through the held-record resume path (regenerate the mapping, rerun the
   read-back inventory, re-approve, import, `--deferred-only`). The only `optionLoss` exception
   below applies to unrouted products; a routed product must account for every declared
   attribute. The only exception is an existing `orchestration/decisions.json` entry under
   `optionLoss:<product.sourceId>`: look it up and, if present, pass it as
   `buildProduct(product, { ..., optionLossDecision: { key, entry } })`. `buildProduct`
   accepts it only when `source` is `user`, `value.accept` is `default-variant`,
   `value.sourceProductId` is this product's `sourceId`, and `value.declaredOptionNames` equals
   `sourceDeclaredOptionNames`. Generated code never creates, infers or defaults that entry. It
   records only one user's explicit answer for that one product: never from inference, a prior
   artifact, a mapping or execution approval, 1-click approvals, or a blanket answer. Even with
   a valid decision, still write the `mapping-gaps.json` entry, marked accepted with the
   decision key, so the loss stays reported.
   **Bundles import as normal products; their parts become one operator task each.** A
   canonical product with `product.bundle` is written like any product, at its source price
   and its own stock. Never hold, defer or gap it because its parts cannot be linked, and never
   turn its components or kit groups into options, modifiers or variants (`buildProduct`
   ignores `product.bundle`). Before building a bundle product, call
   `bundleWriteDecision({ sourceProductId, price })` from
   `rp-target-wix/lib/stores-bundle-cutover.js` with the source's reported price: when `write`
   is false (no source price), do not create the product (never substitute 0), add its `gap` to
   `mapping-gaps.json`, and record the entry as `written: false` with its `reason`. While
   writing, collect one entry per bundle record:
   `{ sourceProductId, bundle, unreadableReason, written, wixProductId, reason }` (`reason` is
   the not-written reason, for example `price-missing`). After the product task, call
   `rp-target-wix/lib/stores-bundle-cutover.js` once with those entries and a crosswalk lookup
   `resolve({ sourceProductId, sourceVariantId }) → { productId, variantId } | null` keyed exactly
   as the product crosswalk keys its source ids (for Shopify, the full `gid://` ids):
   `writeBundleSetupLedger(projectDir, input)` writes `execution/stores/bundle-setup.json`;
   pass `bundleOperatorActions(input)` into the `createCompletionReport()` input's
   `operatorActions`, and publish `bundleReviewTasks(input)` with producer `stores-bundles` in
   the migration-review publication. It makes no Wix call. Never install, buy or configure an
   app.
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
   To check that a sent `displayName` landed as the Wix media name, use
   `mediaTitleLanded(name, sentItem)` from `lib/write-verification.js`: Wix stores the title
   with the original file's extension appended, and nothing else counts.
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
   execution warning before consent. Native mappings use the entity's reviewed writer, or
   guarded raw requests when it has none (see "Missing writer policy");
   `scripts/import-contract-verify.js` refuses a task whose write operation is neither
   (`MISSING_WRITER`) and generated source that calls `sendDirectRest`
   (`direct_rest_write_refused`). An entity whose knowledge names `writtenInTaskOf` (order
   payments, refunds and invoices: `ecom/order`) is written by its host's task with the
   host's grant, never by a task of its own (`PARENT_TASK_REQUIRED`).
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
   `setup/setup-verification.json` (bound to the `setup/setup-plan.json` hash and the
   configured `WIX_SITE_ID`), generated import code, and the target contract ledger
   revision. The plan is approved before setup runs, so it normally records no receipt; the
   first valid receipt that unchanged plan then produces on the approved site after approval
   keeps the plan fresh (`rp-execute-import` "freshness"). Any other receipt change, a site
   change, or a later setup re-run stays stale. If codegen follows a newly promoted write contract, regenerated code and this
   metadata must reflect that promotion.
10. Document any manual code follow-up still required.
11. Generate any post-import remediation helpers that are required to reach the accepted
   mapping fidelity when the source capture cannot express the relationship inline during
   the first create pass.

## Exact mappings, resolved scope and synthetic examples

For a revised `fieldContractVersion:1` mapping, consume its exact decisions and projections.
Never choose source precedence, dates, missing values, relationships or fallback semantics in
codegen. Proposed omission scope is conditional until its identified exact approval validates;
retain the original project context in every shared handler/descriptor guard. Incomplete/conflicting decisions return to mapper through the existing review route;
wrong implementation of a complete decision returns to the codegen Developer. Customer mode
reopens mapping as pending. An unattended one-click test makes one bounded mapping resolution
attempt, then defers unresolved entities/dependencies and continues independent work.

Vendor product-root `lib/mapping-field-contract.js` and `lib/mapping-omission-approval.js`
with their shared read-back, identity, environment and artifact-binding helpers.
Pin `digest(mappingAuthority)` in the generated import manifest/codegen evidence. Entrypoint
dispatch filters by `executionScope.resolvedEntityRefs`, while each generated entity handler
calls `assertExecutionScope(mappingAuthority, sourceEntityRef, pinnedMappingDigest, projectDir)` before
its first write, including direct invocation. Extend the existing `--describe` descriptor
with `mappingPlanDigest`, exact `resolvedEntityRefs` and
`mappingScopeAssertion:assertExecutionScope`. The existing pre-write import-contract verifier
compares these against the authority. The generated entrypoint self-check calls
`assertGeneratedImporterContract(descriptor,{mappingPlan:mappingAuthority,projectDir})` before dispatch;
QA also inspects every handler's actual shared guard. Do not compute the expected digest from the
current plan at write time. Missing/stale binding, unauthorized omissions, manual runbooks
or unresolved dependency closure must fail before any transport. Keep selected/deferred
entities visible in status and entity-completeness reports; no silent scope pruning.

The Developer invokes product-root `lib/field-mapping-examples.js`'s
`runFieldMappingExamples({projectDir,plan,mappingPlanDigest:pinnedMappingDigest,execute})` inside this existing codegen stage.
The `execute` adapter invokes actual generated transforms and shared request builders,
then sends the prepared request via the supplied isolated `wix`, tagging `operation` with
its bound write operation. Its `input` is the example merged over the entity's `exampleBase`;
run the same entity transform the importer runs. A builder refusal on a partial input means
the mapping lacks `exampleBase`: return it to mapping instead of patching the adapter. Use only supplied synthetic input, fresh in-memory crosswalk. No live project configuration, credentials, audit or
receipt sinks may be closed over or loaded. Exercise the same policy/request-building path
as the generated importer. Expected values come from approved decisions before execution.

Each pass creates an exclusive `state/attempts/field-mapping-examples/<passId>.ndjson`;
older passes remain byte-identical audit evidence. Live dry-run captures retain their
existing path and readers. Use `renderExampleResults` to write `Field mapping examples`
in `execution/review/import-plan.md`, regardless of DRY_RUN. Include a non-Order
case, IDs, operation, expected/actual values or omissions/findings, input/expectation/capture
digests, pass identity and passed/failed/not-run reasons. Missing expected outputs and fake
success responses cannot pass fidelity. Deferred/manual scopes are explicitly not-run.

After writing the plan/results, use the existing freshness command with
`--example-capture <returned captureRef>`. It binds authority/examples, entity projections,
rendered plan, generated transforms/builders/helpers, that exact capture file and existing
source/setup/target inputs. Record plan and freshness paths on the current checkpoint.
QA remains read-only: inspect freshness, independently compare recorded expectations and
prepared requests with generated implementation. QA never executes examples or writes captures.
No additional stage, verification command or live pass is introduced.

Persist the final report through shared `writeCompletionReport(projectDir, report,
{mappingPlanDigest:pinnedMappingDigest})`. That writer stamps current scope only when the
independently supplied pin matches; missing/stale binding produces a durable blocked report.
Use its returned `report` for summaries and handoff. A missing/stale report/handoff binding
returns a typed evidence blocker through the existing router, never unlimited redispatch.
After independent work and current execution QA/evidence retention, use
`deferredRunResult(mappingAuthority)` when selected work remains deferred. Persist its typed
`mapping_scope_deferred` blocker and required input in the existing run/completion artifacts,
set the existing run state to blocked and return it for the next session. A completely
resolved scope uses existing completion checks. All-deferred/no importer attempts preserve
ledger/handoff and report current-run Migration review publication unavailable; do not
create a fake importer owner or claim tasks were published. Review service integration
uses the importer-owned evidence contract when available and stays explicitly incomplete
until then. No catch-up or launch-readiness policy is changed.

## Post-codegen code-safety review checkpoint

When `DRY_RUN=true` for the active project, codegen must
produce a mandatory review artifact before the execution approval gate:

- `migrations/<project>/execution/review/code-safety-review.md`

This review is performed by the agent, not delegated to the user. It verifies the
generated code itself. It must check:

- no generated file defines a local transient/retry predicate, and none tests an error's
  `message` for a status number or a status word; generated retry paths call the shared
  `isTransientWixError`
- dry-run uses the same generated write code path as live import, with Wix calls skipped
  only at the shared `wix.send` boundary
- dry-run reporting does not label would-send placeholders as live-created/imported site
  objects

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
- post-codegen code-safety review artifacts when dry-run is enabled

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
  writes durable extracted files under the project. After each extract is complete it runs
  `node <toolkit>/scripts/extract-ledger.js record --project <dir> --entity <entity> --extract <path>`.
  It must accept `--entity <entity>` to re-extract one entity from the source, always from
  `cursor: null` and never through the reuse check below: when the ledger
  finds an extract changed after it was recorded, or missing fields an earlier version had on
  unchanged records, the read-back inventory and the import re-run it, record what happened in
  `execution/extract-integrity.json` and continue. Never edit, filter or strip an extract in
  place. A field with no target stays in the extract; the mapping keeps it (extended field or CMS). Extraction is a separate step from
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
    lib) with `progressLog: <projectDir>/execution/progress.ndjson` — the only path
    `scripts/execution-health-check.js` reads; a log written anywhere else (e.g.
    `logs/import-progress.ndjson`) leaves the health check with no progress record — and wrap the per-batch/per-record write loop with that logger's own
    `withHeartbeat(fields, fn)` (or the equivalent manual `startHeartbeat(fields)` /
    `stopHeartbeat()` pair around a longer-lived loop), carrying live counters as
    heartbeat fields: at minimum `recordsAttempted` (a running count), `currentEntity`
    (the entity/write-spec currently being processed), and `phase: 'import'`. **Mutate the
    same `fields` object's properties as the loop advances rather than passing a fresh
    object per record/batch** — `withHeartbeat`/`startHeartbeat` keep the one reference the
    ticker reads from, so a fresh object per iteration never reaches the ticker and the
    heartbeat goes stale even though the loop is progressing. This covers the write loop, not
    just process start, and must not change the progress-log format, event names, or polling
    contract in any way. Every long phase gets the heartbeat, not only the generic task
    loop: members, orders, products, the CMS archive and finalize each run inside
    `withHeartbeat`, so a long phase never looks hung.
  - read project JSON artifacts (the mapping plan, the execution manifest,
    `source-schema.json`, setup receipts) through the vendored `lib/cached-json.js`
    `readJson(absolutePath, fallback)`, never with a fresh `JSON.parse(readFileSync(...))`
    inside a per-record or per-batch path. It parses a file once and re-parses only when the
    file changes on disk. The value it returns is frozen and shared: copy it before you change
    it. A helper such as `keyField(sourceEntity)` that runs once per record must not re-read
    a file on each call; a multi-megabyte plan or a large schema parsed per record made a dry run
    many minutes slower.
  - emit `execution/live-import-summary.json` and `execution/completion-report.json`
    through the shared completion-report runtime, with entity/subtype completeness counters
    for extracted, in-scope, attempted, imported, already present by crosswalk, deferred,
    failed, and skipped-out-of-scope records.
  - stop before dependent phases when required upstream entities fail. For example, do not
    create products after product-category failures unless the execution plan explicitly
    marks category assignments as non-blocking.
- **The dry-run is the same import code path with Wix calls skipped at the shared Wix
  boundary** — not a separate driver. Generated code must construct the same Wix client,
  call the same writer helpers, and pass request metadata
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
regardless of `WIX_MUTE_NOTIFICATIONS`), and for existing sites only when the operator
answered mute (`notificationMute=on`, mirrored as `WIX_MUTE_NOTIFICATIONS=on`) — the generated import script must contain a mandatory
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
skippable option; for existing-site projects whose operator answered `off`, no preflight is emitted. The preflight logs its re-verification and outcome
into the run's execution/progress log (keyed by `runId`) — terminal reports read this
recorded state, never strategy/config inference. In dry-run mode the preflight follows
the shared dry-run contract like any other Wix call: the intent is captured and the
state read is skipped (`stateKnown: false`), not asserted as muted. The generated script
must never call `unmuteSiteNotifications` — unmute is an explicit owner request outside
the import path. A preflight mute-verification failure is recorded through the standard
`rp-telemetry` recorder as an `error` event (with `error_code`) like any other run
event — no new telemetry surface.

### Stops and interruption: one completion call on every end (required)

A run that stops still writes what it knows. An importer whose completion runs only
after its last write leaves nothing when it is stopped by SIGTERM, a crash or a
`wix_auth_expired` stop, and cutover refuses with `missing_completion_report`. Do not write
signal handlers, `try/finally` around dispatch, or a second completion path yourself:

- **Plugin entrypoints** (`src/import/run-import.js` from the committed template) already run
  through `lib/import-interruption.js` `runImportWithFinalize`. It calls the adapter's
  `finalizeImport` exactly once: with no `interruption` on a normal end, and with
  `interruption: { kind: 'signal' | 'error' | 'wix_auth_expired', signal, code, at }` on a stop.
- **Other entrypoints** wrap dispatch the same way and vendor `lib/import-interruption.js`:

  ```js
  const stops = require('./src/lib/import-interruption.js');
  try {
    await stops.runImportWithFinalize({
      projectDir, // required: the stop latch refuses new requests and new `started` rows
      dispatch: ({ stopRequested }) => runTasks(selection, { stopRequested }),
      finalize: (interruption, results) => finalizeImport({ runId, results, ...(interruption ? { interruption } : {}) }),
      onInterrupted: (interruption) => dryRun ? undefined : stops.recordInterruption(projectDir, { runId, interruption, mappingPlanDigest }),
    });
  } catch (error) { process.exitCode = await wixAuth.stopExitCode(error, projectDir); }
  ```

  `runTasks` checks `stopRequested()` before each task and each batch and returns what it has
  so far; `finalize` gets that return value as `results`.

- `finalizeImport` forwards `interruption` to `createCompletionReport`. That marks the report
  `aborted`, records the interruption, and puts an `import-interrupted` operator action first.
  It must work on partial in-memory state: counters already taken, half a pass, no
  `orderResults`. It must never throw because a stage did not run.
- `recordInterruption` stamps the report when an older `finalizeImport` ignored `interruption`,
  or rebuilds it from the attempt journal when finalize threw. It then writes
  `execution/discovered-set-status.json` and the post-execution handoff. A SIGKILL leaves no
  report. The router then routes `missing_completion_report` with `interruptedReport: "missing"`,
  and `scripts/interrupted-completion-report.js <projectDir>` writes the report from the journal.
- An aborted report is never completion. The router routes it back to `import_interrupted`
  (resume), aggregate completion refuses it, and the resumed run's report overwrites it.

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

**A request refused before sending is a known failure, not an uncertain write.** Every
pre-send refusal from `createWixClient` (readiness grant, capability, task or phase checks)
carries `error.requestSent === false`. Journal it as `failed_retryable` with top-level
`requestSent: false` and `failure.errorCode` set to `error.code`; never `succeeded_unverified`.
`appendAttempt`/`markAttempt` settle a `succeeded_unverified` row that carries
`requestSent: false` to `failed_retryable` for every entity, so the flag must be on the row.
Check `requestSent` before any status, outcome or transient-error classifier: a refusal has no
HTTP status, and "no status" otherwise reads as a transport error of unknown outcome.

**An uncertain write is not a failure.** `succeeded_unverified`, and a `started` row that never
got a terminal follow-on, are **unresolved**: the next action is to **read the target back**,
never to re-send, because re-sending an uncertain write is how a recovery pass creates a
duplicate on a live store. They select under `--unresolved-only`, count as `unresolved` in the
recovery record, and are rebuilt into `execution/unresolved-writes.ndjson`
(`rebuildUnresolvedWrites`) — a projection of the journal, so deleting it loses nothing and it
is never a source of truth. A `deferred` record, including a source-data-rule skip, is **not**
unresolved and never reaches that queue. A `needs_verification` row that names a target id (a
create that landed and did not verify) is counted unresolved in the summary and completion
report, but it is selected by `--deferred-only` or a full resume, not `--unresolved-only`, and it
is not in that queue; the completion report's recovery action names its target id. Never sum unresolved into `failed`: a recovery record
that does reconciles arithmetically and is wrong.

**Count every uncertain write in `entityCompleteness.unresolved`, and name its target id as
`targetId`.** A success, `succeeded_unverified` or `needs_verification` row carries the landed
id in top-level `targetId` (`failure.targetEntityId` is for failure rows). A counter that skips
the record (`counts.failed += 0`, or adding it to `attempted` only) leaves an unexplained
shortfall. `attachAttemptReasons` fills such a gap from the journal, but only up to
the gap, so count it yourself.

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
  },
  "migrationReview": {
    "contractVersion": "migration-review/1",
    "executionKind": "import",
    "phases": ["before-write", "write-outcome", "recovery"],
    "requiredCategories": ["source_scope", "mapping_fidelity", "execution_recovery",
                           "setup_plugin", "explanations_checks"],
    "durableBeforeNextWrite": true,
    "probeFlag": "--migration-review-probe"
  }
}
```

Vendor `lib/migration-review.js` with its `config-env.js` and `orchestration-decisions.js`
dependencies beside the generated importer and use its versioned interface. Initialize from
the existing orchestration project/source and `config/wix.env` destination through
`projectBinding`; do not invent a different identity for the publishing chat. Before the first target write, initialize the bound review store, register the
execution with its publishing `producerId` and `executionKind: import`, and capture accepted
source/scope plus mapping/setup capability evidence. Only the credential-free isolated probe
registers `executionKind: probe`; never use that classification on the real import path.
Source-scope evidence names capability scopes in `acceptedScopes`; keep accepted record IDs
in their original artifact fields. Create one `createEvidenceCaptureQueue(projectDir)` per
importer process and route every batch's capture through it. Concurrent write workers await
their queued capture before starting another target write. The queue serializes captures,
refreshes their expected version, and waits up to two seconds for a competing local mutation.
A timeout or other capture failure stops queued successors; the queue never steals a lock.
Route every target write through one `review.createWriteRecovery({ captureQueue, migrationId,
executionId, scope })` wrapper: `recovery.write({ sourceStableKey, attemptId, operation }, send,
{ unknownOutcome })`. A throw, or a result `unknownOutcome(result)` names, commits an
`execution_recovery`/`recovery` capture (`failed` only for a readable 4xx rejection other than
408; a 5xx, 408, timeout, abort or transport error is `uncertain`; no error text) before the
error returns. Pass a distinct `attemptId` per write call; one is assigned when omitted. A capture failure throws with
`writeError` retained and stops later writes. Publication
and operator actions still use an explicitly read expected version. After
every durable batch or repair checkpoint, capture write outcomes, uncertainty and recovery
evidence before the next target write. A capture failure stops further writes through the
existing recovery path; it cannot become a complete review or be reconstructed from summary
prose. Final publication is cumulative and assessed-scope based. It may report explicit
incomplete coverage, but it cannot omit a missing category or replace unrelated findings.
For import executions, publication also requires non-probe before-write and write-outcome
captures per assessed scope for complete coverage. Post-import backfill cannot substitute
for these boundaries; missing phases become named incomplete evidence and Data investigations.
Every published task declares `requirement: required|optional`. Machine-verified tasks name
a committed `explanations_checks` capture with a passed machine check matching the finding
key and material fingerprint; a readiness label alone cannot resolve a task. Repaired findings
close through evidence-backed `applicabilityChanges`, never omission.

**The importer checks itself.** `run-import.js` calls
`assertGeneratedImporterContract(descriptor)` from `lib/import-recovery.js` as the **first
statement of `main()`** — unconditionally, before argument dispatch and before the
notification-mute preflight. If a required mode is missing or a ledger path is wrong it throws
naming every problem at once and the importer refuses to run itself, exactly as the mute
preflight aborts before any write: exit non-zero, no degraded mode, no skip flag.

`rp-execute-import` step 2d runs `import-contract-verify.js` against the same descriptor from
the outside before the first write, then invokes `--migration-review-probe --project <scratch>`.
The probe calls the same capture/publication functions used by the importer, with synthetic
inputs in `MIGRATION_REVIEW_PROBE_PROJECT` and no target calls. Use migration/source identity
`probe_<MIGRATION_REVIEW_PROBE_NONCE>`, destination `probe-site`, all five categories carrying
`evidence.probeNonce`, and a published result carrying `probeNonce`; print its `executionId`.
The probe registers the same mapping scopes as the real path (`mappingScopes(plan)`, selected and
held) and calls `probeFailure()` on its `createWriteRecovery` wrapper.
The verifier checks committed evidence bytes, coverage and publication, every selected/held
mapping scope in the probe registration and the injected failure's `execution_recovery` capture,
then deletes its scratch directory. It also refuses generated `src/` that reads
`process.env.DRY_RUN` directly or registers `mappingScopes(..., resolvedEntityRefs)`. Printed readiness booleans fail the gate. The two gates are not redundant: the self-check is what an
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
Contact rows carry `{sourceKey, sourceId, sourceSystem, contact, updateMember}`. Phone-only identities and conflicting source/target identifiers
block and report; there is no automatic merge or V4 fallback. Contact custom-field setup
must already be resolved; the shared DES setup helper still supports orders only.

Product rows carry `{sourceKey, product, expected, marker, variantExpectations}`.
`expected` includes every mapped readable product field; exclude write-only inventory
fields and verify them through the inventory pass. `marker: {path, value}` is source-derived
(e.g. a unique mapped slug), not copied from a returned product. Each variant expectation
carries `{sourceKey, expected, inventory}` with an unambiguous source-fixed SKU/choice
projection. A variant `sourceKey` is the source variation's own stable key (for example
`<variationKeyPrefix><variation id>`); a product with no source variations uses
`<productSourceKey>#default` for its single variant. Never derive it from an array position: order
lines resolve variants by this key, and a catch-up pass must find the same one. Include submitted variant choices in that projection; an unverified choice
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
// `wix` is the client created from the contact task's `bindTask` capability (`taskBinding`).
// Evaluate the task immediately before the call and pass the evaluation: importContacts runs
// the rows through `gateBatch` itself and grants every bulk item its own source key. Do not
// wrap `wix` in bindRecordClient.
const contactEvaluation = await evaluateTask({ taskBinding });
const contactVerification = await importContacts(wix, {
  projectDir, siteId, rows: contactRows, evaluation: contactEvaluation, dryRun,
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
// A row that did not verify is never a deferral and never `failed += 0`: one that names a target
// id landed and is `unresolved` (read back by that id, never re-sent); one without stays deferred.
const unverified = contactVerification.rows.filter(row => !row.verified);
const rawEntityCompleteness = [{
  entity: 'contacts', verificationKind: 'contact', sourceKeys: contactRows.map(row => row.sourceKey),
  inScope: contactRows.length, imported: contactVerification.verified,
  unresolved: unverified.filter(row => row.targetId).length,
  deferred: unverified.filter(row => !row.targetId).length,
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
as a mismatched `0`. The journal side counts `attempted` as every record a write was sent for:
`imported`, `failed_*`, and unresolved (`started`, `succeeded_unverified`, or a `needs_verification`
row that names a target id -- a write that landed unverified, never a deferral). Each entity row
also carries `project`: the latest row of every record across all runs (adoption and resume passes
included), with each unresolved record's target id. It is informational, never compared, and is
the project-level view a single run's buckets cannot give. `unexpectedSkipped` is the one exception: its absence defaults to a held `0`,
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
4. Add `report.seo.stageResiduals` to the completion input's `stageResiduals`. A pass that does
   not reconcile a product (a crosswalk hit, a selective pass, a stop) still owes that product's
   open SEO residuals: build the SEO stage residuals from this pass's results plus
   `outstandingSeoResiduals(await loadSeoState(projectDir, siteId), { exclude: <this pass's
   reconciled source keys> })`, through `collectSeoStageResiduals`. Never drop a residual
   because the product was not in this pass; only a passing verification clears it.
   Owner questions and plan residuals (for example `focus_keywords_disposition_required`) are owed
   by every imported or landed product, not only by products this pass reconciled: before building
   the completion input, plan the SEO of every imported product the pass did not reconcile, from the
   same local evidence (no Wix call), add those plans' residuals to the SEO stage residuals (skip a
   product already counted through this pass's results or `outstandingSeoResiduals`), and build
   `buildSeoDispositionQuestions` from all of these plans. A pass that touches no new product must
   still report every open question.
5. If `buildSeoDispositionQuestions(plans)` returns questions, ask the owner once per question
   and record the answer with `recordSeoDisposition` (source `user`). Never answer it for them,
   in any automation mode, including one-click.

Never write product SEO through Item SEO Tags bulk set (`bulkSetItemSeoTags` refuses
`STORES_PRODUCT`), and never write canonical, robots, schema, social tags or an SEO pattern.

### Review merchant replies
- `stores/review`: after `createStoresReviews` (and moderation), call
  `setStoresReviewReply(bindRecordClient(wix, { readinessGrant, sourceStableKey }), { reviewId, message })`
  for each review whose source has a merchant reply. Never put the reply in the create payload.
  Journal `verified` / `already-present` as done, `not-sent` as failed with `requestSent: false`,
  `failed` as `failed_retryable`, `unverified` as retryable (Set Reply overwrites, so a re-send is safe).
  Replies over 1000 characters stay in the CMS shadow and the ledger.

### SEO domain writers
- `seo/item-seo-tags`: `setItemSeoTags(wix, { itemType: 'BLOG_POST', entries }, { readinessGrant, sourceStableKeys })`,
  one source key per entry. `itemId` is resolved from the `blog/post` crosswalk through the
  per-record edge. Journal an entry `imported` only for outcome `verified`; every other outcome is
  a failed row (retried with `--failed-only`). Other item types (static, dynamic CMS, taxonomy pages)
  use guarded raw requests: `sendGuardedRawRequest` with
  `PATCH /promote/seo/v1/item-seo-tags/{itemType}/{itemId}`. The raw path is refused for the item
  types the writer covers (`BLOG_POST`) and for `STORES_PRODUCT` (`preferredWrite.writerScope`). Blog posts that already carry `seoData` on create need no second pass.
- `seo/seo-pattern`: `ensureSeoPattern(wix, { pageType, tags })` once per page type.
- `seo/site-seo-tags`: `setSiteSeoTags(wix, { tags, shareImage })` once per site. Pass the source
  share image as `shareImage: { mediaId: resolveReference('media/media-file', <its media key>,
  'shareImage.mediaId'), sourceUrl }`, never as an `og:image` tag. A missing image resolves to
  `undefined` and the record is still sent; journal the record by `outcome` (the tags) and pass the
  result to `seoOperatorActions`, which turns `shareImage.outcome: not-written` into the cutover row.
- Never pass a robots tag expecting it to land (indexing is a launch decision). The writers
  strip robots and canonicals into `exclusions`.
- On every run, including one that writes no SEO, call `seoOperatorActions({ site, patterns, items })`
  (`rp-target-wix/lib/seo-tags.js`) with whatever SEO executors returned (or nothing) and append
  the rows to the completion input's `operatorActions`. The indexing decision row is always there. That is the cutover hand-off for the indexing decision, replaced or
  unwritten patterns, and tags not carried over.

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

### Same-entity hierarchies: one depth level at a time (required)

When an entity's parent is the same entity (product categories, nested blog categories), the
parent is written by the same task. No dependency edge can wait for it (a task is never its own
producer), and a depth sort is not enough on its own. A pass that builds every record before the
first write holds every child as `parent-not-imported`, so one tree level lands per run.

`runRecordTask` handles this from knowledge, with no per-entity code. The target knowledge's
`sameTaskReferenceFields` names the parent path (Stores category: `parentCategory.id`). The
accepted mapping output for that path names the source field (WooCommerce: `parent`). The
runner then:

- writes one depth level at a time, parents first;
- resolves each child's parent id with `resolveSameTaskReference`, from this task's own landed
  crosswalk row, and sets it at that path.

The builder does not set the parent path itself. A root has no parent value (missing, null, empty
or `0`). A child still imports without the parent link when:

- its parent is not in the source, failed or is held (`same-task-parent-not-written`);
- it is on a parent cycle (`same-task-parent-cycle`, written last);
- the mapping feeds the path from two source fields (`same-task-parent-field-ambiguous`).

The finding `same-task-parent-unlinked` goes on its journal row. A `dependency-reference-gap`
cutover item asks the Import Operator to set the parent once it exists. The record is never held
for its parent.

The gate refuses a parent id that came from anywhere else: `dependency-reference-unresolved` for
an id read from the crosswalk, `REFERENCE_UNDECLARED` for `resolveReference`. A hand-written loop
(see "Per-record tasks") uses `rp-target-wix/lib/same-entity-hierarchy.js` `runByDepthLevel` and
the same resolver. It follows the same never-block rule: a child whose parent did not land is
written without the link, and its `unplaceable` records are written last without the link, each
with the `same-task-parent-unlinked` finding and a gap from `recordTaskGap`. Never hold or refuse
the record for its parent.

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

**A baseline item is never adopted**. Products and categories that were on the
store before this import are listed in `setup/destination-catalog-baseline.json`. Before
building a slug or name net, split the sweep with
`require('<toolkit>/lib/catalog-baseline').protectedIds(projectDir)` and `partition(items, ids)`:
only the `open` items may be adopted. A source record matching a `held` item is neither
adopted nor created: call `recordCollision(projectDir, { entity, sourceKey, targetId, slug })`
and report it as failed with `collisionError(entity, targetId)`. The product importer and the
read-back gate already do this; generated category, tag-less or custom nets must too.

An ambiguous match is the other case that must not be adopted: if the source key is not unique
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
  derive one, which breaks URL preservation with no trace. `buildProduct` already does this for
  `product.slug`: it mints `product-<sourceId>` and pushes `product-slug-minted` into its
  `findings` option (with no source id the slug is left to Wix and the finding records
  `slug: null`); it never throws for a slug.
- **Product names over 80 characters are `buildProduct`'s job too.** Catalog V3 caps `name` at 80
  (400 MAX_LENGTH); `buildProduct` cuts on whole characters within 80 and pushes
  `product-name-truncated` with the full name into `findings`. Pass a `findings` array, carry its
  rows into the record's journal/report, and do not truncate or hold in generated code.

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
  ```

- `config/source.<platform>.env` exists after the source platform is known. For WordPress:

  ```bash
  WP_BASE_URL=
  WP_USERNAME=
  WP_APPLICATION_PASSWORD=
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

- Read these files with vendored `config-env.js`'s `readEnvFile` (no new dependency); never
  bash-`source` them. Values the toolkit writes that contain spaces or shell characters are
  single-quoted; a hand-rolled `KEY=value` splitter would keep the quotes. After a source
  request returns HTTP 401, re-check the env file with `readEnvFile` before requesting or
  refreshing credentials, and only escalate when parser-loaded credentials are absent or
  still rejected.
- Load `config/wix.env` and the selected source config before constructing source/Wix
  clients.
- Default `DRY_RUN` to disabled. Treat `true`, `1`, `yes`, and `on` as enabled and
  `false`, `0`, `no`, and `off` as disabled. `--dry-run` must override config and enable
  dry-run. `--no-dry-run` may be supported to override `DRY_RUN=true`.
- Read it only through vendored `config-env.js`'s `await resolveDryRun(projectDir)`:
  `config/wix.env`, then a non-blank process value, then the flags; unknown values throw.
  `import-contract-verify` refuses generated `src/` that reads `process.env.DRY_RUN`.
- When scaffolding a project that is in dry-run mode, generated review artifacts must say
  that leaving dry-run later requires explicit user approval for any step other than
  new-site creation, and that such overrides should be avoided when a dry-run or report
  is sufficient.
- Preserve an explicit `DRY_RUN=true` from project config when regenerating code or
  config. Do not reset it to `false` during later codegen passes.
- There is no safe mode (it was removed): never generate `SAFE_MODE` or
  `SAFE_MODE_PHONE_NUMBER`, and send contact values as mapped. A leftover `SAFE_MODE` line in
  an older `config/wix.env` is ignored.
- Real process environment variables may override file values.
- Blank values in config files must not overwrite non-empty process env values.
- If a required key is still missing after loading file + env, fail fast with the key
  name, not a downstream 401.
- In dry-run, missing or blank `WIX_AUTH_TOKEN` and `WIX_SITE_ID` are `would_block_live`
  findings, not blockers, unless a generated local artifact requires the site ID as a
  stable namespace. Do not mint a Wix CLI token solely for dry-run.
- `WIX_MUTE_NOTIFICATIONS`: `new` → always `on`; `existing` → the operator's
  `notificationMute` answer from `orchestration/decisions.json`, never a
  default. Resolve it with `lib/notification-mute.js` `readNotificationMute`; an unanswered
  existing site or a value that disagrees with the answer halts codegen and routes back to
  intake. **`WIX_MUTE_NOTIFICATIONS=off` together with
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
  key, and do not read the token once into a string for a long run: build every live Wix
  client with a token source (below), never `authToken: env.WIX_AUTH_TOKEN`.
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
runs `npx --no-install wix token --site "$WIX_SITE_ID"`, captures the token (shape:
`OauthNG.JWS.<base64>.<base64>.<sig>` — single line, no JSON wrapper), and writes it
directly to `config/wix.env` as `WIX_AUTH_TOKEN` without printing the value. Run via Bash:

```bash
bash migrations/<project>/scripts/mint-token.sh
```

**Do NOT** run `npx --no-install wix token` raw in a Bash tool call — it prints the
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

**Token renewal and the `wix_auth_expired` stop — emit this, do not hand-roll it.** Vendor
`lib/wix-auth.js` beside `lib/config-env.js` and `lib/local-state.js` (same relative layout).
A full import runs for hours; the token does not.

```js
const wixAuth = require('./src/lib/wix-auth.js');
// One token source per run; every task's client shares it.
const tokenSource = wixAuth.createWixTokenSource({ projectDir, siteId: env.WIX_SITE_ID });
const wix = writers.createWixClient({ capability: taskBinding, tokenSource }); // live runs
```

- The source renews through `scripts/mint-token.sh` for the same site only, before a request
  when the token is under 30 minutes from `exp` or about 3.5 hours old, and once on a refusal;
  the client resends the refused request once. If the renewed token is refused again, the client
  throws the shared `wix_auth_expired` interruption; it is not a record outcome and must not be
  normalized as `failed_retryable` or `failed_terminal`.
  No generated retry, re-mint loop or per-request env read.
- In every per-record `catch`, and before any duplicate or fallback classification, rethrow first
  for a true mint interruption: `if (wixAuth.isRunInterruption(error)) throw error;`. The shared
  attempt journal refuses failed or unresolved rows while the project is interrupted, so the
  in-flight row remains `started` for read-back on resume.
- The entrypoint's top-level catch sets the exit code from
  `await wixAuth.stopExitCode(error, projectDir)`: an interruption records the
  pending `manual_action` and exits 75 (`wixAuth.WIX_AUTH_EXIT_CODE`); anything else exits 1.
  The plugin entrypoint template already does this. Before it exits, the stop also writes an
  `aborted` completion report through `runImportWithFinalize` (see "Stops and interruption").
- Dry-run keeps `authToken` (or none): it never mints.

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

- **Keeps `contact.company` / `jobTitle` off Create Member and writes them afterwards.** Create
  Member refuses `contact.company` (live 400 "Unexpected value for StringValue", though the docs
  type it as a string); `ensureMember` sends the create without them and then writes
  `company { name, jobTitle }` to the member's own contact through Contacts V5
  (`member-company-written-after-create`, or `member-company-not-written` without failing the
  member). Map company/jobTitle into `contact` as usual; never send them on a create yourself.
- **Checks the login email before sending.** An email Wix refuses (for example a local part
  starting with `.`) is not sent: `ensureMember` returns the deferred no-usable-email outcome with
  `member-login-email-invalid`, never a terminal 400. Generated builders need no hold for it.
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
  `sourceStableKey` means zero journal rows and zero Wix calls; the refusal is projected into the
  report (`incomplete_with_mismatches`) and one `pipeline_defect` event. Never deduplicate or skip
  records to get past it -- fix the mapping. A pass writes `execution/member-population.json`
  (keys only) when it is absent, so `--missing-only` works with no full pass before it; subset
  passes select within it, add any supplied key it lacks, and never shrink the report's
  denominator.
- **The report reads only the journal.** `projectMemberPass` folds the latest member row per
  key into the `members` completeness row (with the `unresolved` counter), `unresolved[]`,
  `droppedFields[]`, one operator action for ambiguous matches, and `memberOutcomes`. Declare no
  separate members row. Uncertain writes (409 already-exists, 5xx/transport/no-id creates, a
  dangling start) are **unresolved**: recover with `--unresolved-only`, which reads the member
  back by login email before any create. A create the client refused before sending
  (`requestSent: false`, e.g. `DEPENDENCY_READINESS_REQUIRED`) is `failed_retryable`, never
  unresolved: nothing reached Wix. If `ensure` itself refuses a record (no readiness grant),
  throw an error with `requestSent: false`; the pass records it as not sent and goes on. Emit the returned telemetry events once, after the pass;
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
  // BEGIN order-attempt-row
  // The journal row is the library's decision, never the runner's: status, targetId, findings and
  // failure come from orderHistoryAttempt. Spread them onto the attempt row unchanged.
  const attempt = H.orderHistoryAttempt(result, { sourceStableKey: source.sourceStableKey });
  const attemptFields = { status: attempt.status, findings: attempt.findings,
    ...(attempt.targetId ? { targetId: attempt.targetId } : {}), ...(attempt.failure ? { failure: attempt.failure } : {}) };
  // END order-attempt-row
  // result.findings also carries the contact-field codes: order-contact-email-dropped,
  // order-contact-phone-dropped (removed after Import Order named the field), order-contact-email-suspect,
  // order-contact-phone-suspect (warnings; value kept and sent) and buyer-email-unusable.
  // It also carries the invoice writer's codes: invoice-link-over-length and
  // invoice-number-over-length (left unset, never truncated) and invoice-field-dropped (a key
  // the order PATCH response did not carry back).
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
// Cart-offer plugins (profiles with `appliedOffers`): the offers seen on these same extracted
// orders become one cutover row per plugin. Replaced by `code` on every run, never appended twice.
const { appliedOfferOperatorActions } =
  require(require('node:path').join(toolkitRoot, 'resources/rp-source-wordpress/lib/applied-offer-summary.js'));
const cartOfferActions = appliedOfferOperatorActions({ orders });
const completion = createCompletionReport({
  ...completionInput,
  operatorActions: [
    ...(completionInput.operatorActions || []).filter((row) => row.code !== 'cart-offer-recreate-in-wix'),
    ...cartOfferActions,
  ],
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

**The attempt row comes from `H.orderHistoryAttempt(result, { sourceStableKey })`** (the
`order-attempt-row` block above). Do not map `result.outcomes.order` to a status yourself, and
never journal `deriveImportedOrderId(...)` as `targetId`: the derived id is where the order WOULD
be, not proof that it is. The helper's rule (`lib/multi-step-attempt.js`, shared by every writer
that creates a base record and then runs further steps on it):

- Order on the target (`result.orderId`): `imported`, `targetId` = that id, and each failed
  payment, refund, invoice or crosswalk stage as a `sub-step-failed` finding with
  `retryable: true`. Never `failed_terminal`: the next full pass reconciles the order by id and
  retries only those stages; the completion report lists them as stage residuals.
- Order not created: no `targetId`; `failure.intendedTargetId` carries the derived id, and the
  kept error decides the status -- refused before the network (`requestSent: false`) or a target
  read that could not decide: `failed_retryable`; reply lost (`outcomeKnown: false`):
  `succeeded_unverified`; a 4xx other than 408/429: `failed_terminal`; anything else:
  `failed_retryable`. The failure message is the target's, not a fixed sentence.

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
- **Imports a source order that has no line items.** Import Order requires at least one line;
  `importOrderHistory` adds ONE custom line "Items not recorded in source" at the order total
  (order currency, no tax fields) — a human-approved policy — emits
  `order-line-items-not-recorded` and files a Cutover Operator item
  (`execution/dependency-readiness.json` `referenceGaps`, listed by the completion report). Map
  the order with whatever lines the source has, even none; never hold, skip or invent lines in
  generated code. Read-back verifies the placeholder against a mapped body with no lines.
- **Never holds an order for a contact value.** A phone or email that is not E.164 / not a sendable
  address is sent as mapped with an `order-contact-*-suspect` warning, never held, never
  rewritten by generated code. The paths are `contactFields[]` in
  `rp-target-wix/domains/ecom/entities/order.json` (`buyerInfo.email`,
  `billingInfo.contactDetails.phone`, the shipping destination and `recipientInfo` contact
  phones); put contact values at exactly those paths so the rejection handling below applies.
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
  `contactFields[]` path, and no other violation); the order is then sent once more under
  the same id, and each removal is an `order-contact-*-dropped` finding naming the field, never the
  value. A second refusal is `order-import-failed`. Before the first send the composite checks the source values and emits `order-contact-*-suspect` warnings without
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
   take the target site currency from the regional gate's live read of the site (never from an order or a cached value); call the WooCommerce adapter's `lib/currency-gate.js` `evaluateCurrencyGate`. `halt: true`
   stops the run at the approval gate with the named finding. `currency-validated` is a line too.
2. **Coupons.** `sweepCoupons(page => wc/v3/coupons?per_page=100&page=N)` to exhaustion; the
   `posts` count by `post_status` through the plugin bridge for reconciliation;
   `summarizeCoupons` for the counts; per coupon `mapCouponToWix(coupon, { resolveProduct,
   resolveCategory })` with resolvers taken from the readiness gate (below), then write them in BATCHES with
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
   options for the read-back-verified PATCH. `utcOffsetMinutes` is the SHOP's UTC offset in
   minutes when it is known, else `null`: a coupon plugin's date-only start date is the shop's
   midnight, so without the offset it is read as UTC midnight and reported as
   `coupon-plugin-start-date-timezone-assumed`.

   ```js
   // BEGIN verified-coupon-import
   const couponPath = require('node:path');
   const { sweepCoupons, mapCouponToWix, summarizeCoupons, couponOperatorActions } = require(couponPath.join(toolkitRoot, 'resources/rp-source-wordpress/lib/coupon-discovery.js'));
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
     const mapping = mapCouponToWix(coupon, { resolveProduct, resolveCategory, utcOffsetMinutes });
     mappings.push(mapping);
     if (!mapping.specification) { notWritten.push({ code: coupon.code, outcome: mapping.outcome, reason: mapping.reason }); continue; }
     let specification = mapping.specification;
     if (isBearerVoucher(coupon)) {
       const verdict = classifyPreWriteDrift({ snapshotCoupon: coupon, freshCoupon: await readFreshCoupon(coupon.id), hold: mapping.hold || null });
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
   // Merge by `code` into the createCompletionReport() input's operatorActions.
   const couponActions = couponOperatorActions({ mappings });
   // END verified-coupon-import
   ```

   **Scope IDs come from the gate.** `stores/coupon` declares per-record edges to
   `stores/product` and `stores/category` at `scope.group.entityId`, so the manifest already
   orders coupons after their producers; do not reorder by hand. Call `mapCouponToWix` inside each
   coupon's `gateBatch` transform with `resolveProduct: id => resolveReference('stores/product',
   productKey(id), 'scope.group.entityId')` and the `stores/category` equivalent, never a
   crosswalk lookup, and write only the batch's `send` payloads. A coupon scoped to a product the
   owner held, or one not imported yet, is deferred by the gate (`dependency-held` /
   `dependency-not-ready`) and reaches cutover with that cause; it is not a
   `coupon-scope-unmappable` refusal. Discount-rule product scopes
   (`discounts.values[].specificItemsInfo.scopes[].catalogItemFilter.catalogItemIds[]`, the
   buy-X-get-Y and trigger scopes) resolve the same way through `resolveReference('stores/product', ...)`.

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
   | A coupon plugin's rule Wix cannot hold (gift, shipping/payment/role/location limit, auto-apply; from the profiles' `couponRules[]`) → written `active: false`, tagged `Rule_Not_Carried`, `result.hold` set, one `coupon-plugin-rule-held` cutover task | Writes it live without the rule — a gift silently lost, a limit silently widened |
   | A plugin start date (`meaning: start-date`) → `startTime` | Lets the code work before the merchant's start date |

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
   | `hold` passed in | always pass `hold: mapping.hold`: a held coupon comes back `writeActive: false` with the hold's tag kept, whatever the fresh read says |

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

## Delivery regions: reuse what the site already covers

Write each source shipping zone's region **only** through `rp-target-wix/lib/wix-writers.js`
`ensureDeliveryRegion(wix, deliveryRegion)` (input from `shipping-build.js`
`buildDeliveryRegionInput`), never a bare `addDeliveryRegion`. A new site's default profile already
covers its own country, so a plain add for the home zone fails with `DESTINATIONS_COLLISION`.

- Use `result.deliveryRegionId` as the zone's target id and as `regionIdByZone[zoneId]` for
  `runShippingOptionStage`. Two zones may resolve to the same region.
- Put `result.findings` on the zone's attempt row (`findings`) for the record. The shipping stage
  reads the regions live, deletes Wix's placeholder "Free shipping" on a new site once imported
  rates replace it, and writes the `shipping-region-*` and `shipping-placeholder-option-deleted`
  operator actions. Do not build those rows or send that delete yourself.
- `action: 'collision-unresolved'` (no region id) is a `failed_terminal` row with
  `failure.errorCode: 'DESTINATIONS_COLLISION'`, and the import continues. Leave that zone out of
  `regionIdByZone`: its options get retryable `DELIVERY_REGION_MISSING` rows. Never abort the run
  over one zone.

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
  Keep `src/resources/**` byte-identical to the toolkit: the readiness scan skips a file there
  only while it matches the toolkit file at the same path, and scans an edited copy as generated
  code. Never mirror `lib/` + `resources/` under another folder (`src/lib/<x>/`,
  `src/import/vendor/`): it loads a second `local-state.js` whose crosswalk listeners the
  importer's `src/lib/local-state.js` never sees.
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
  `--sample` (extract a small slice only; the sample-preview gate runs it) and `--entity <entity>`
  (re-extract one entity; the extract ledger runs it to repair a changed or stripped extract).
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
- `migrations/<project>/execution/review/code-safety-review.md` when `DRY_RUN=true`
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

The transform layer should output Wix-shaped objects only. Request-envelope building and
retry/reporting logic belong in the shared runtime.

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

Blocked-data requests (`state/blocked-data-requests/*.json`) are joined by
`writeCompletionReport` itself: a declined, missing or offered request becomes a
`blockedDataRequests` row and a handoff open blocker, with each dependent field's outcome filled
from the attempt journal. Do not pass a second copy. A request you do pass is kept as you wrote it.

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
| Unresolved rows are backed by rows | `attachAttemptReasons` also joins each row's unresolved records (latest run row `started`, `succeeded_unverified`, or `needs_verification` with a target id) and the records with a `started` row. `createCompletionReport` lists them in `unresolved[]` (`orphaned_target` with the target id, else `unmapped_source`) unless the caller already listed that entity, and warns when `attempted` is lower than the records the journal shows sent |
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
write it with **guarded raw requests** (see "Missing writer policy"). Never use
`sendDirectRest`: it builds an unmarked request, and the import client refuses every
unmarked write (`DEPENDENCY_READINESS_REQUIRED`). Do **not** route to CMS merely because
the writer is missing either.

- Adding a writer is a reviewed toolkit change in `resources/rp-target-wix/lib/wix-writers.js`
  (a marked builder in the closed registry plus an executor), not code generated inside a
  run. Cover it in `tests/target-wix/` and with an import-task client test so drift stays
  visible.
- **Confirm the shape with a real call, not a doc example** — public examples have been
  wrong (e.g. lowercase Ricos plugin enums that 400).
- `sendDirectRest` is for dev-probe capabilities only.

## Runtime policy

Verify each Wix endpoint and field at codegen time. The `// UNVERIFIED:` marker is a
fallback only for environments where no direct verification aid is available, not a way
to ship unchecked calls that fail later on the user's live site. Anything unverified must
be surfaced explicitly in downstream artifacts before execution.

## Gift cards: one product, cards by code

Import the gift card product before the cards, each in its own task, through the
`rp-target-wix` writers. Never send `notificationInfo`; the writer drops it anyway.

- **Product** (`gift-cards/gift-card-product`): one call, `ensureGiftCardProduct(wix, product)`,
  with the source products already merged into one by the mapping (the merge's lost designs are
  its fidelity-loss rows). A site holds one product and the Gift Cards app seeds a default one, so
  the writer queries first and updates the one that is there. It is safe to re-run after any
  unknown outcome.
  - `created` / `adopted` → an `imported` journal row with the product id.
  - `updated-existing-product` → an `imported` row, plus one operator action
    `{ code: 'gift-card-product-replaced', severity: 'info', role: 'cutover-operator', actionId,
    entity: 'gift-cards/gift-card-product', affectedIds: [id], artifactRefs: [<file with
    result.previous>] }`. Write `result.previous` (the replaced name, amounts, image) to that
    project file first; it is the only copy.
  - `failed` → a `failed_terminal` row; `failure.errorCode` is `result.error.applicationErrorCode`.
- **Cards** (`gift-cards/gift-card`): `createGiftCard(wix, { giftCard, idempotencyKey })` per
  card, from `gift-card-build.js`'s payload (its nested `idempotencyKey` is lifted for you). The
  code is unique on the site, so a retry or unknown outcome is reconciled by code inside the writer.
  - `created` / `adopted` → `imported`, crosswalk `sourceStableKey` → `result.id`. Keep
    `result.code` (the code you sent) in the crosswalk row; reads may mask it.
  - `conflict` → `failed_terminal`, `failure.errorCode: 'gift-card-code-conflict'`,
    `failure.targetEntityId: result.id` (another card already holds that code with other values).
  - `failed` → `failed_terminal`, or `failed_retryable` when `result.error.outcomeKnown === false`.
- Cards whose code Wix cannot take stay the builder's gaps (`code-length-out-of-range`,
  `code-contains-disallowed-characters`); they are never sent.

## Wix Events: categories, events, ticket types and RSVPs

Writers: `createEventCategory`, `createEvent`, `assignEventToCategories`,
`createTicketDefinition`, `createRsvp` (`rp-target-wix/lib/wix-writers.js`). Order: categories →
events (then each event's category assignment) → ticket definitions → RSVPs, after `crm/contact`.

- **Event status.** `draft` mirrors the source status. A source draft that has RSVPs is
  created with `draft: false`, because RSVPs need a published event; record it in the ledger.
  `registration.initialType` is `RSVP` for an attendee list and `TICKETING` for ticket types.
- **Category assignment.** `createEvent` must not carry `categories` (Wix drops them). In the
  event task, gate the create with the event payload, then gate a second batch for the same key
  whose transform resolves `categoryId[i]` with `resolveTaskReference('events/category', …)`, and
  send `assignEventToCategories(record, { eventId, categoryIds })` with that grant. The client
  refuses any other event or category. Read back with `listEventCategories`.
- **Ticket fee and tax.** Use the fee mode and tax from the source; otherwise the value the
  approved mapping review chose. The builder refuses a paid ticket with no `feeType`.
- **RSVPs.** Dedupe guests by email per event before writing (Wix accepts a repeat). Build
  `form.inputValues` from the event's form; set `options.ignoreFormValidation` only for lossy
  source data, and ledger it.
- **Lost response (`outcomeKnown: false`).** Category: `findEventCategoriesByName` — one → adopt,
  none → resend, several → hold. Published event: `adoptPublishedEvent(record, { title, startDate })`
  (`adopted` → use `event.id`, also for the category assignment; `none` → resend; `ambiguous` →
  hold). It reads the one match by id on the record's own client, which is what lets the
  assignment name an adopted event. Draft event: hold as `failed_ambiguous` (drafts cannot be queried). Ticket:
  `findTicketDefinitionsByName`. RSVP: `findRsvpsByEmail` — one → adopt, none → resend.
- **Cutover.** Collect draft event ids, published-for-RSVP event ids, review-chosen ticket ids
  and events whose RSVPs used the overrides, and pass
  `eventsOperatorActions(...)` (`rp-target-wix/lib/events-cutover.js`) into the
  `createCompletionReport()` input's `operatorActions`, merging by `code`.

## Bookings: services, then add-ons, then bookings

Three tasks in that order, each through its `rp-target-wix` writer, one record per call. Record
every result with `bookingsJournalRow(entity, result, { sourceId })` and, at completion, merge
`bookingsOperatorActions(entity, results)` into the `createCompletionReport()` operator actions
(both from `rp-target-wix/lib/bookings-outcomes.js`). Never map a result to a status yourself.

- **Add-ons** (`bookings/service-add-on`): `importBookingsAddOn(record, { addOn, serviceIds })`.
  It looks for an exact match before every create, then appends the add-on to the one import
  group of each service. Run records in source order (that is the display order). A service
  whose group already holds 7 comes back in `ungroupedServiceIds`; the add-on is still
  `imported`, and the operator action `add-on-ungrouped` lists it.
- **Bookings** (`bookings/booking`): `importBooking(record, { booking, paymentStatus, canceled })`.
  Do not map `status` or `externalUserId`; the writer owns both. Past dates are fine.
- Status by outcome: `written` / `reconciled-existing` → `imported` (crosswalk the returned id);
  `unknown-outcome` → `succeeded_unverified` (read back, never re-send);
  `partially-written` / `target-read-failed` → `failed_retryable` (a re-run resumes);
  `reconciliation-ambiguous` / `target-drift` / `read-back-mismatch` → `needs_verification`
  plus the `bookings-record-unconfirmed` action; `class-session-missing` → `failed_terminal`
  plus the `class-session-booking-not-imported` action; `failed` → `failed_terminal`.

## Wix Forms: forms, then entries with the form's automations paused

Writers: `createForm`, `updateFormSchema`, `importFormEntries` (which runs `pauseFormAutomations`,
`createFormSubmission`, `restoreFormAutomations`), in `rp-target-wix/lib/wix-writers.js`. Forms
are always recreated when they are mapped, whatever the entries' target. Order: `forms/form` →
contacts/media the entries reference → `forms/form-submission`.

- **Form** (`forms/form` task). `createForm(record, { form, sourceFieldTargets, sourceFormId })`
  with the mapped schema (namespace `wix.form_app.form`, every field with `identifier`, a lowercase
  GUID id and a layout slot, every step id a lowercase GUID). Always pass `sourceFormId`: it seeds
  the hidden field's id, so two source forms with one name never share it. The writer adds the hidden "Original submission date" field. Crosswalk
  `result.id`, `result.name` (a collision renames it), `result.fieldTargets` and
  `result.originalDateTarget`. `created` / `adopted` → `imported`; `failed` → `failed_terminal`,
  except `failed` with `result.error.status === 429` (a rate-limit refusal: Wix applied nothing,
  even when its body was an unreadable HTML page) → `failed_retryable`.
  A lost create is adopted only when a form carries the hidden field's id, never by name (the
  site's own "Contact" form is the merchant's). A lost create not found that way is `failed` with
  `readBack: 'not-found'` → `failed_retryable`; its re-run passes `{ readBackFirst: true }` as the
  third argument, so a create that landed late is adopted, not made twice.
- **Existing form repair** (same `forms/form` task and grant), on every run, before its entries:
  for each form whose crosswalk row is `imported`, and for an `adopted` result, call
  `updateFormSchema(record, { formId, form, sourceFieldTargets, sourceFormId })` with the same
  mapped schema. It reads the form and sends Update Form at the current revision only when the
  live `formFields` lack a planned input target (a form an earlier builder created with inputs only
  in the legacy `fields[]`; every entry for it is refused). A repair never lowers a row that is
  already `imported`: the row stays `imported` and its entries proceed whatever the result.
  `updated` → update the crosswalk `fieldTargets` from the result; `unchanged` → nothing; `failed`
  (`reason: 'form-not-created-by-import'`: the form lacks the hidden field id, so it is never
  written) or a throw (including a refused or failed Get Form) → record a finding
  `form-schema-repair-not-applied` with the form id and reason in the run's findings, no ledger
  status change. Ledger statuses `failed_terminal` / `failed_retryable` / `succeeded_unverified`
  come only from this run's `createForm` result above.
- **Entries** (`forms/form-submission` task), one form at a time:
  `importFormEntries({ projectDir, formId, entries: [{ wix: record, payload }], writeOptions })`,
  where each `record` is that entry's `bindRecordClient` and `payload` is
  `{ submission: { formId, submissions, contactId? }, originalDate, originalDateTimeZone }`, with
  `originalDateTimeZone` the IANA zone in `discovery/source-locale.json` when the source date has
  no offset (the writer never uses the importer machine's zone; without it a zone-less date is UTC).
  The writer maps field targets to Wix-valid names on the form and on every entry. It pauses the form's
  submission automations and lowers its spam filter to NONE (the form is on no page during the
  import; under ADVANCED the spam pass removed a genuine entry), recording both in the ledger
  `execution/forms/automation-pause.json` before each update. It then SENDS every entry of the
  form in order, READS BACK every sent entry with a pool of 4 (each on its own record client,
  sleeping only while an entry is younger than the 2 s poll interval), and only then restores
  both, also after a run stop. Do not wrap it in your own per-entry loop or poll: one call per form.
  Wix adds a new form's own automation about 2 s after Create Form returns; entries never wait for
  it. While the pause has not seen it, the pause query runs again after each send for up to 10 s
  (finding `form-automation-paused-after-entries`, with `entriesBefore`: those entries may have
  run it once), and after the entries an automation that was still active is recorded as
  `form-automations-not-paused`. All four steps are **best-effort**: one bounded attempt each
  (read, update, read-back), no retry or poll. A failure never holds or delays an entry; the
  entries are written right away. A pause ledger that cannot be read or written is a finding
  (`form-pause-ledger-unreadable`): nothing is paused or lowered that could not be recorded first,
  and the restore uses the run's in-memory rows. `importFormEntries` always returns its results;
  only a run stop rethrows, after the restore attempt. Record `result.findings`
  (`form-automations-not-paused`, `form-automations-not-restored`, `form-spam-filter-not-lowered`,
  `form-spam-filter-not-restored`, `form-pause-ledger-unreadable`) in the run report as for any writer's findings, and pass
  `automationsNotPaused` / `automationsNotRestored` / `spamFilterNotRestored` to the cutover items
  below. The automation and spam-filter updates are `auxiliary` `forms/form-submission` writes:
  the client admits them only under the entries task and only with a readiness grant for one of
  its records (`DEPENDENCY_READINESS_REQUIRED` otherwise). Never send one from another task or as
  a raw request.
- **Resume.** For a form with entries left, `importFormEntries` resumes from the ledger without
  pausing or lowering twice. For a form whose entries are all written, still call
  `importFormEntries({ projectDir, formId, entries: [], wix })` on every start of the entries
  task: `wix` is a record client bound to a grant for any one of that form's entry keys (gate the
  already-written key again; `gateBatch` grants it), and it restores what an earlier stopped run
  left changed. Without `wix` it changes nothing and returns those rows as
  `automationsNotRestored` / `spamFilterNotRestored`, so the cutover items are never lost.
- **Entry outcomes.** `created` → `imported`. `in-spam` → `failed_terminal`,
  `failure.errorCode: 'form-entry-in-spam'` (keep `spamReportId`; the cutover item lists it);
  `deleted` → `failed_terminal`, `failure.errorCode: 'form-entry-deleted-by-spam-filter'`. Never
  re-send either, and never call Report Not Spam (it runs the automations). `pending` and
  `unknown` → `succeeded_unverified`: read back before any re-send (`pending` by its id;
  `unknown` has none, so `findFormSubmission(record, { formId, submissions })` matches every
  value sent, the hidden original date included). The send already read a lost create back once:
  a found entry comes back `adopted: true` with its id, and `unknown` with `readBack: 'not-found'`
  was neither on the form nor in spam at that moment. `failed` →
  `failed_terminal`, except `failed` with `result.error.status === 429` → `failed_retryable`. `not-sent` (the client refused it before sending) → `failed_retryable` with
  `requestSent: false`. For a single entry outside `importFormEntries`, `createFormSubmission` is
  still send + verify (`sendFormSubmission` then `verifyFormSubmission`).
- **Source spam.** Entries the source flagged spam (Forminator `is_spam = "1"`) are excluded with
  an `exclusions[]` row before any write, not skipped silently.
- **CMS archive.** When the operator chose CMS for the entries (the mapping's override decision),
  the entries task writes `cms/data-item` rows with `insertDataItem` into the private collection
  instead; there is no pause and no spam check.
- **Cutover.** Pass `formsOperatorActions({...})` (`rp-target-wix/lib/forms-cutover.js`) into the
  `createCompletionReport()` input's `operatorActions` (merge by `code`), and publish
  `formsReviewTasks({...})` with producer `forms` in the migration-review publication. Inputs: form
  ids whose source had emails / conditional logic, every recreated form id, CMS-archived form ids,
  in-spam and deleted entry ids, source-spam excluded ids, `automationsNotPaused`, the
  `pendingFormAutomationRestores` and `pendingFormSpamFilterRestores` left at the end (as
  `automationsNotRestored` / `spamFilterNotRestored`), each form's `pauseLedgerUnreadable`, and the form ids with native entries.

## Pricing-plan orders: one order per subscription

Import plan orders (`pricing-plans/plan-order`) after plans and members, in their own task, per
record through a record client, with `ensurePlanOrder(record, { planId, memberId, startDate, paid,
paused, knownOrderId })`. Orders cannot be deleted; the writer reconciles before it creates and
never resends after an unknown outcome, so never wrap it in a retry.

- **Which source subscriptions.** Active → `startDate` = the source start (past or now); pending
  → its future start; paused → `paused: true`. Canceled or expired → never call the writer: land
  the record in the CMS history path and call `recordPlanOrderHistoryOnly(projectDir, {
  sourceStableKey, sourceStatus: 'canceled' | 'expired' })`.
- **Record every result.** After each call, `recordPlanOrderOutcome(projectDir, { sourceStableKey,
  result })` from `lib/plan-order-outcome-registry.js`. It returns the row; write the attempt
  journal row with its `journalStatus` (a `failed_*` or `succeeded_unverified` row carries
  `failure`). Any `result.orderId` goes to the crosswalk, whatever the outcome.
- **Cutover items are not yours to write.** `writeCompletionReport` joins the registry's rows
  (billing restarts, history only, not live, pause failed, unknown outcome, needs review, shared
  order). Never add `plan-order-*` operator actions by hand.

## CMS item quota and the source archive

Every item in the site's own CMS collections (a source archive, source pages, a crosswalk mirror)
counts against one plan-wide item quota. Use `resources/rp-target-wix/lib/cms-item-quota.js`;
never write your own quota codes, hold file or probe.

- **Archive only what the import writes.** A record gets archive rows only when its entity is in
  `executionScope.resolvedEntityRefs` and the record passes the same record-selection predicate as
  the entity's own pass (`archiveScope({ resolvedEntityRefs, inScope })`). Out-of-scope users,
  unreferenced library media and excluded rows are never archived. Archive only `cms`-disposition
  locations (`archivedLocations(row)`): a field with a native or extended-field home is not
  archived again. Prefer the mapper's extended-field disposition for short scalars.
- **One item per parent.** Build archive entries `{ parentKey, childKey?, sourceEntity, payload }`
  and write `packArchiveItems(entries)`: a parent and its same-parent sub-records (an order and its
  notes) share one item, with `childKeys` (an array field) so a child is still found by its own key.
  Items over ~400 KB split into `<parentKey>#2`… with the same `parentKey`. Two source entities
  for the same thing (a WordPress user and the WooCommerce customer with that id) use one
  `parentKey` and each its own `sourceKey`: the item stores the second as an alias with only its
  differing fields.
- **Before consent.** Compute the rows with `expectedArchiveRows(entries, { otherRows })` (other
  custom-collection rows such as source pages), then run
  `node skills/wix-replatform/scripts/cms-item-quota.js plan --project-dir <dir> --expected-rows <n>`.
  Show its `summary` in the import plan. It never blocks consent; `exceeds` means the last rows
  wait in the hold and the cutover action below is created.
- **The hold is the client's.** The Wix client refuses CMS item creates before sending while
  `state/holds/cms-item-quota.json` is held, and opens it on the first WDE0195. For any send error,
  `quotaDeferral(error)` returns the journal row: `deferred`, reason `cms-item-quota-exhausted`
  (check it before any `requestSent === false` → failed branch). Keep going: the hold refuses only
  CMS item creates, so every other entity and task continues. Never retry such a row in the loop.
- **Resume.** The client re-checks the quota every few minutes and at the first CMS write of every
  run, and releases the hold when there is room. When the archive pass ends with deferred
  quota rows and the hold has been released, run those rows once more in the same run (the
  `--deferred-only` selection). Add `cutoverAction(projectDir)` (non-null while held) to the
  completion report's operator actions; it is the Cutover Operator's task.
- **Re-saving an archived row.** A row already in the archive (crosswalk `imported`) whose payload
  must change is sent with `updateDataItem` (Update Data Item, `PUT /wix-data/v2/items/{id}`) on its
  crosswalked item id: it fails rather than creates, spends no quota and is not refused by the hold.
  Never re-send it through insert or `save`. A failed re-save (5xx, or the item was deleted) is
  journaled like any other failed write (`failed_retryable`), so the next pass retries it.
- **Explicit skip.** The operator may decide the waiting archive data is not needed
  (`scripts/cms-item-quota.js skip --collection <archive id> --decided-by <name> --reason <why>`).
  From then on the client refuses items of those collections with `archiveSkipped` (other
  collections keep the hold); `quotaDeferral(error)` returns a
  `skipped_out_of_scope` row with reason `cms-archive-skipped-by-operator` and the decision. Never
  skip on your own; `unskip` restores the hold.

## Missing writer policy

CMS fallback is for source concepts that do **not** have a suitable native Wix entity, or
for native entities explicitly rejected because they cannot preserve fidelity or would
cause unsafe side effects. CMS is **not** a fallback for a missing writer, and it is not a
special default for coupons just because coupon scoping/restrictions need mapping.

When the mapping targets a native (or native-plus-cms) Wix entity and no dedicated
`rp-target-wix` writer exists, import it with guarded raw requests. A reviewed writer always wins:
an entity that has one cannot use this path.

1. Generate a normal import task. Its write operation is `sendGuardedRawRequest`. You pick
   the method and URL from the entity's knowledge and the Wix docs, including follow-up
   steps (confirm, pause, add to a group). Build each request with
   `buildGuardedRawRequest({ entityRef, method, path, body })` and send it
   on the record client from `bindRecordClient`, as for a reviewed writer.
2. The client refuses (`RAW_REQUEST_REFUSED:<reason>`) `DELETE` and delete paths sent as
   POST, a host other than `www.wixapis.com`, an encoded or irregular path, a URL any
   toolkit builder or another entity's reviewed writer sends, toolkit-only services, and a
   request for another task's entity. Write plain lower-case paths. Do not work around a
   refusal; record it as a gap.
3. **First record.** Write one record (all its steps), then read it back with
   `buildGuardedRawReadRequest({ entityRef, path })` on the same client and call
   `verifyGuardedRawCanary(client, { entityRef, sourceStableKey, body: request.body,
   sentPath, readBack, ignorePaths })`. Each `ignorePaths` row names one leaf of the sent
   body and a `reason` (a write-only field, a value Wix normalizes); at least one leaf must
   still be compared. Until it passes, other records are refused
   (`RAW_REQUEST_CANARY_PENDING`). A mismatch holds the entity for this run
   (`RAW_REQUEST_ENTITY_HELD`); the other tasks continue. Never ask mid-run.
4. **Unknown outcome.** A call with no outcome is never retried
   (`RAW_REQUEST_OUTCOME_UNKNOWN`). It stays a recovery item until the operator checks the
   site and `resolveRawRequestOutcome(projectDir, { callId, resolution, evidence })` records it.
5. Name each raw-request entity in `execution/review/import-plan.md` and the execution-plan
   report as "raw request, no reviewed writer" before consent;
   `scripts/import-contract-verify.js` lists them in `rawRequestTargets`.
6. Pass `rawRequestSummary(projectDir)` rows to the completion report: a held entity is an
   `exclusions[]` row with `reasonCode: raw-request-mismatch`, each unknown outcome an
   unresolved row with the Business Manager check as its next action. Cutover reads them
   from there.
7. A write operation that is neither the entity's own writer nor the raw path is still a
   missing-writer gap: the mapper records it (`reasonCode: missing-writer`) and the pre-write
   gate refuses the task (`MISSING_WRITER`).

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
            resolveFromCrosswalk: lookupReadyBlogMedia, wix }) // wix: a never-imported inline image is imported, not held forever
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

List each item that stops codegen in `execution/llm-handoff.json` `blockers[]` (`{ code, detail }`);
`stage end codegen --outcome passed` is refused while `blockers` is non-empty or `needsLlm` is true.
Emit `execution/llm-handoff.json` with `needsLlm: true` when any of the following occur:

- a native Wix path exists but only an unverified write surface is available
- setup artifacts are insufficient to generate deterministic setup execution
- transform semantics remain unresolved
- a multi-pass relationship strategy cannot be derived deterministically (a same-entity parent is
  not this case: use `runByDepthLevel`)
- the runtime contract required from `rp-target-wix` is missing for the mapped target

## Output

Summarize which files were generated, which entities they cover, and any remaining implementation gaps.


### Exact field mapping evidence in generated importers

For a revised `fieldContractVersion:1` plan, vendor `lib/migration-review-mapping.js`
and `lib/mapping-field-contract.js` beside the existing Migration review runtime. Legacy
plans require explicit mapper reconciliation; do not silently fabricate exact decisions.
Reuse the initialized project/site binding and actual importer producer/execution.
Before registration, add `mappingScopes(plan)` to the execution’s existing assessed scopes.
Manual-mapping runbooks keep their existing manual path and add no invented mapping write
scopes. Initial mixed runs register selected resolved and deferred automatic mapping scopes with
`mappingScopes(plan)` — never `mappingScopes(plan, resolvedEntityRefs)`; repair executions
register only the scopes actually assessed in that repair and pass `repairOf` naming the earlier
import execution that registered them. The adapter refuses any other subset. No registration fact can change
on resume; a later newly resolved scope needs a new execution.

Read back the stored execution: real imports are `executionKind:import`, and only isolated
scratch probes are `probe`. The adapter refuses an unclassified/wrong-owner execution.
All capture producers share the importer’s one `createEvidenceCaptureQueue(projectDir)`.

```javascript
const { mappingScopes, createMappingReviewAdapter } = require('./lib/migration-review-mapping.js');
// In the existing registerExecution request:
// assessedScope: [...new Set([...existingScopes, ...mappingScopes(plan, assessedSourceEntities)])]
// Initial run: assessedSourceEntities = plan.executionScope.selectedEntityRefs (resolved + held).
const mappingReview = await createMappingReviewAdapter({
  projectDir, producerId, executionId, migrationId,
  mappingPlanDigest: PINNED_MAPPING_PLAN_DIGEST, captureQueue: enqueueCapture,
  assessedSourceEntityRefs: assessedSourceEntities, // omit for initial; explicit repair subset
  repairOf: repairedExecutionId, // repair only: earlier import execution that registered the subset
  // Supply probeNonce only inside the existing credential-free isolated probe path.
});
await mappingReview.captureBeforeWrite(); // await before ANY dependent target write
```

This startup call records the current plan/ledger revisions for registered resolved and
deferred scopes. Deferred entities get genuine mapping-state observations and open tasks,
not target-write outcomes. Direct entity handlers still assert the pinned resolved scope.
Capture failure stops subsequent writes through the existing recovery path.

After an assessed entity’s last durable batch checkpoint and final `entityCompleteness`
row, before the single `createCompletionReport` call, persist one bounded outcome artifact
using the importer’s existing atomic/fsynced artifact writer:
`{ sourceEntity, entityCompleteness: finalRow, outcomeCounters: { attempted, succeeded,
failed, deferred, unresolved } }`. Use actual final accounting; `succeeded` names the
row’s imported/confirmed outcomes. Unknown outcomes remain `unresolved`, not failed.
All five counts must be measured nonnegative integers; do not turn missing counts into zero.
The artifact has no generated timestamp; the capture envelope supplies observation time.

```javascript
await mappingReview.captureWriteOutcome(sourceEntity, {
  outcomeArtifact: projectRelativeFinalOutcomeArtifact,
  unknownAreas: actualUnknownAreas,
  sequence: durableCheckpointOrdinal,
});
```

The adapter reads/hashes that bounded durable artifact, pins it to the same execution and
mapping revisions, and captures `mapping_fidelity/write-outcome`. It never captures a
write outcome for deferred work. Repairs recapture both boundaries and all assessed
categories; old execution captures cannot supply current coverage. An identical replay
uses the same immutable IDs; changed evidence uses new IDs with a new durable checkpoint ordinal. Publication checks the final outcome
artifact against its retained capture. Do not rewrite an already
captured outcome path on resume without completing the corresponding new capture.

After the importer exits, use the [mapping publication recipe](../rp-migration-review/mapping-publication.md)
from the existing Migration review step. Capture startup and outcome evidence during the
actual import; do not reconstruct it later from completion prose. No new stage or CLI is
introduced. All-deferred/no-importer attempts keep current ledger/handoff facts and return
`publication unavailable`; do not initialize a fake execution just to publish tasks.

## Discovered sub-part outcome accounting

For every planned registry sub-part, generated importers emit its own `entityCompleteness` row using the registry subtype and back every count with journal rows, as for whole entities. Keep the whole-entity row separate. Attribute dropped sub-part fields with `droppedFields[].subtype` so a missing shipping line, for example, makes that sub-part partial without misreporting the parent row. When an exclusion corresponds to a discovered scope decision, include its `censusId`; `writeCompletionReport` derives `operatorGateRecorded` from the exact approved reconciliation, never from the importer's claim. Record-level filters without a census decision keep their existing exclusion behavior.

## Public multilingual adapter

When proven public additional locales exist, vendor the shared multilingual core and target
modules and emit one bounded target adapter for the documented locale, translation schema/content,
and Wix Data routes. The adapter supplies the methods consumed by the inventory, setup, executor,
and restore scripts; it uses the same destination credentials and capability boundary as the
normal importer. Its patch/create methods accept one planned field and must omit every unrelated
field. It must implement paginated `queryRecoveryRows(cursor)` even when the recovery collection
is absent (return an empty page); omitting the method blocks inventory with
`LANG_RECOVERY_JOURNAL_NOT_READY` rather than silently losing cross-machine authorship. Do not
generate guessed route or app identifiers: the route map and Wix Multilingual app
identity come from recorded versioned contract evidence. The normal writer's verified read-back
must feed source/Wix object bindings to `multilingual-object-pairing.js` and, for repeated members,
member bindings to `multilingual-member-pairing.js`; source IDs, display text, and position are not
Wix identities. With no additional locales, generate no adapter, object/member pairing receipt, or
sidecar call.
