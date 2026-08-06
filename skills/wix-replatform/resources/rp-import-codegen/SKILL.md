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
   a `V3_CATALOG` site (guaranteed at provisioning and gated before any write — see
   `replatform` → "Headless site creation" and `rp-execute-setup`), so generated code may
   assume V3 unconditionally: no version detection, no branch, no V1 shape, no V1 fallback
   for a failing V3 write. A V1 site is a **blocker the run halts on**, never a case codegen
   handles. Concretely: never emit Catalog V1-style top-level `price`, `sku`, or variant
   inventory fields. For simple products, emit one variant under
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
   `skills/replatform/scripts/execution-state-prepare.js` before the generated import
   entrypoint.
8. Generate the runnable setup/extraction/import entrypoints (see below) — the artifacts
   `rp-execute-setup` and `rp-execute-import` actually run. This is required, not optional.
   Then run the **sample-preview gate** (see below) before the execution-plan approval.
9. Generate `execution/review/import-plan.md` plus
   `execution/review/import-plan.freshness.json` using
   `skills/replatform/scripts/artifact-freshness.js write ...`. The freshness metadata
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

### Notification-mute preflight (spec 0012, required)

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
record the crosswalk per successful item, not per batch, so an interrupted run resumes
correctly.

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
- `WIX_MUTE_NOTIFICATIONS` (spec 0012) resolves by strategy when blank: `new` → `on`,
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
- For RePlatform `new site` + `headless`, that unblock message must point back to the **Wix
  CLI headless scaffold** in `replatform` → "Headless site creation"
  (`npm create @wix/new@latest headless`). The account-level Projects API is deprecated for
  this workflow.
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
cp skills/replatform/resources/rp-execute-setup/scripts/mint-token.sh \
   migrations/<project>/scripts/mint-token.sh
```

The preferred
pre-import flow is:

1. verify `wix whoami`,
2. run `bash scripts/mint-token.sh` (writes `WIX_AUTH_TOKEN` silently),
3. run the import — the generated client reads `WIX_AUTH_TOKEN` and sends it as
   `Authorization: Bearer <token>` with `wix-site-id`.

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
  journal for resume/reconciliation
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
- `dependencyRefs`
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

The generated runner must call or vendor `skills/replatform/lib/completion-report.js` and
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
