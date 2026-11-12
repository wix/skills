---
name: rp-mapper
description: >-
  Maps discovered source entities and fields to Wix targets and documents lossiness. Use
  when creating machine-readable mapping artifacts and review markdown after discovery.
---

# rp-mapper

Mapping owns semantic decisions, including uncovered relationships and custom fields. Apply
applicable shared rules; when knowledge is absent, investigate source meaning and authoritative
target schemas here. Missing knowledge alone is not a reason to block. Follow
[`references/knowledge-and-recovery.md`](references/knowledge-and-recovery.md) for run-local
operation assessments, eligible temporary field deferral, record holds and later repair.
Codegen implements these decisions and returns unanswered mapping questions to this step.

Create a mapping plan from the discovered source schema into Wix entities and Wix data structures.

## Purpose

This skill translates source entities and fields into Wix targets. It should define what each source record becomes in Wix, how fields transform, and where custom schemas or extended fields are required.

## Required inputs

- `migrations/<project>/source-schema.json`
- `migrations/<project>/source-profile.md` when available
- `migrations/<project>/orchestration/checkpoints.json`
- `migrations/<project>/orchestration/decisions.json`
- `migrations/<project>/discovery/source-coverage.json` (capabilities discovery could not capture)
- any existing Wix target-model constraints supplied by the user

Read **only** these canonical artifacts by default. Do not ingest the raw discovery dump
(`migrations/<project>/data/...`) wholesale — it is platform-specific and large. Instead, when an
entity's mapping is ambiguous, follow that entity's `rawFile` pointer in `source-schema.json` to open
just that one raw file for verification. Skip entities whose `inUse` is `false` (advertised by the
source but holding no records).

### Adapter-supplied hints in `sourceMeta`

A source adapter may pre-fill part of the mapping when it recognizes the source format. Two
`sourceMeta` keys carry that, and both are optional — a schema without them maps exactly as
before:

- **`sourceMeta.mappingHints[]`** (`{ column, wixTarget, matchedAlias }`) — an **advisory**
  pre-fill, e.g. from a recognized vendor's CSV profile. Seed the corresponding
  `fieldMappings[]` entries from it so the user reviews and corrects instead of authoring from
  scratch, and record `decisionProvenance: source_platform_rule`. It is never authoritative:
  the source's own field list still governs, and every hint still passes through the mapping
  review checkpoint.
- **`sourceMeta.drift.unmappedColumns[]`** — real source columns the adapter's profile did not
  recognize. Each one must be explicitly mapped or explicitly recorded as skipped; leaving
  them unaddressed is how a stale profile turns into silently dropped data.

In addition to the project artifacts above, consult the relevant bundled adapter resource
when the mapping depends on platform behavior that should not be guessed:

- source-side read/entity semantics from `wix-replatform/resources/rp-source-<platform>/SKILL.md`
- Wix target constraints and domain behavior from `wix-replatform/resources/rp-target-wix/SKILL.md`
- Wix target entity suitability from
  `wix-replatform/resources/rp-target-wix/scripts/domain-knowledge.js`

Treat those adapter resources as the authoritative home for platform knowledge. Do not
copy source/Wix behavioral rules into the mapping plan as if they originated there; cite
and apply them there.

## Read-back field contract before mapping approval

For the gated Wix targets `order`, `member`, `contact` and `product`, every field-mapping row
must declare the exact `sourcePaths[]` it reads, canonical `writePath`, and `readPath` or a
specific `unverifiableReason`. Write array positions as `[]`. A populated `false` or `0` is
real data. In `mapping/entity-decisions/<entity>.json`, account for every populated source leaf
and intended target path with `fieldDispositions[]`: `{ kind: source | intended, path,
status: mapped | notMigrated, mappingRef }`. A mapped disposition names the actual mapping-row
ID or index; it cannot claim a path that row does not read or write. For an exact field plan,
keep the canonical `fieldDispositions[].mappingRefs[]` produced by the authority. Each reference
is `decisionId:outputId`; put `readPath` or `unverifiableReason` in that precise output’s `verification` metadata.
The authority projects these bindings to `verificationMappings[]`.

**When an output is written (`appliesWhen`).** If a decision legitimately writes nothing at an
output for some records, declare that on the output as a predicate, not as prose in lookup
`cases` or helper arguments. Example: `taxable` keeps the Wix site default tax group, so
`taxGroupId` gets `{"op":"notEquals","location":"tax_status","value":"taxable"}`. Variant
`choices` (empty on a simple product's default variant) get `{"op":"equals","location":"type","value":"variable"}`.
Compare-at price, where a `0` sale price means no sale, gets
`{"op":"all","of":[{"op":"populated","location":"sale_price"},{"op":"notEquals","location":"sale_price","value":"0"}]}`. Tracked
`quantity` and untracked `inStock` get `equals` / `notEquals` on `manage_stock` `true`.
Operators: `equals`, `notEquals` (`value`: string, number or boolean), `in` (`values[]`),
`populated`, `notPopulated`, and `all` / `any` (`of[]`). Each node has exactly these keys. Each
`location` must be one of the decision's own canonical source locations (`lib/source-location.js`
form, selector-qualified when the decision uses selectors). Over an array location `equals`, `in`
and `populated` hold when any value does; strict equality, no coercion. The predicate is
evaluated on the source record. Without `appliesWhen` the output always applies when its
sources are populated (a builder that omits it is refused). With it, an applicable output must be
written and a non-applicable one must be absent. `inventory` counts both per output, and
`validate` reports a builder that disagrees. Changing a predicate changes the plan and its
approval bindings and makes the inventory stale. Where the condition depends on data outside
the record (for example per-variation stock on a variable product), do not approximate it;
model that output separately or leave the record held. A held record is the builder's
`{ status: 'held', holds: [{ decisionId, code }] }` result: it keeps source coverage, is counted
as held with its reasons, and is outside applicability and canaries; validate judges only the
records eligible to write. `inventory` writes the held counts per `decisionId:code` into the
mapping review (`Held records: <entity>`); present them with the approval request.
The gate derives its write path from `writeInput.targetPath`; do not create a second flat mapping
or edit an entity projection independently. Copy the domain contract before final mapping approval.
For deliberately proposed populated omissions in an exact plan, first record the exact
`excluded` decisions, rationale and affected scope. If an intended target field is also lost,
declare it explicitly in that decision's `omittedOutputs[]` with `writeOperation`, `writeInput`
and `targetPath`; it is coverage of a proposed loss, never a writer output. Prepare the final
review before requesting approval:

```sh
node scripts/read-back-gate.js contract <projectDir> --entity <entity> --omissions review
```

This command requires interactive mode and a reopened mapping checkpoint. It projects
`notMigrated` dispositions and the proposed scope before hashing the approval inputs.
`omissionReviewRequested` and `executionScope.omissionApprovalRequiredEntityRefs` identify
conditional scope: neither grants permission to execute. Missing/stale identified approval
holds the mapper route, importer descriptor, direct handlers and read-back gate. Present the
exact source/intended omissions, operations, counts or unknown scope with the current four
references. The shared approval effect captures the authenticated operator, project/site,
interactive-mode context and `fieldDispositionDigests` in the existing approval and answered
request. Do not edit the plan to release scope after approval; that invalidates its bindings.
The authority API requires its complete explicit `omissionReviewEntityRefs` selection on every
preparation; it never inherits proposal markers. The per-entity `contract` CLI constructs this
selection from the current authority, preserving proposals on other entities. Its review form
adds or retains only the selected entity. To withdraw that entity after rejection, run the
plain `contract --entity <entity>` form. Only its proposal is removed; its excluded fields
remain visible as mapping gaps. A dependent with a retained whole-task prerequisite may also
remain deferred, while a declared per-record reference stays executable and defers only records
that name the unavailable parent. Review the revised mapping again.
One-click mode cannot prepare or authorize these omissions, regardless of recorded provenance. Ordinary unresolved choices and
the affected entity remains deferred; per-record dependents continue through their record-level
readiness gate. No proposal authorizes a particular customer's loss.

Order, before the named mapping approval: (1) draft decisions; (2) `contract`, which writes
the authority, its projections and `mapping/mapping-resolution.json`; (3) a pure
project-local module exporting `buildWrite(record)` from the draft decisions' transforms,
produced by `rp-import-codegen`'s builder-only step (no executor, descriptor, manifest,
Wix client or capability — `inventory` refuses a builder that references them); (4)
`inventory`; (5) `validate` until its only failure is the missing approval
(`status: awaiting-approval`); (6) the normal named approval; (7) `validate` again. The live
importer is generated only after approval and reuses that builder unchanged; the inventory
pins the builder's SHA-256, so editing it makes the inventory stale.
Use an existing complete extract, or obtain it through the source adapter's read-only extraction
path before the review. These commands run from the installed skill directory. If preparing
a proposed omission, replace the plain `contract` command below with the review form above;
running the plain form afterwards withdraws only that entity's proposal:

```sh
node scripts/read-back-gate.js contract <projectDir> --entity <entity>
node scripts/read-back-gate.js inventory <projectDir> --entity <entity> --extract <extractPath> --builder <builderModule> --source-key id
node scripts/read-back-gate.js draft-stubs <projectDir> --entity <entity>   # optional, read-only
node scripts/read-back-gate.js validate <projectDir> --entity <entity>
```

`contract` merges the checked-in intended fields, projection and domain digest into the same
entity decision's `readBackContract`; do not invent or relax that contract. `inventory` streams
NDJSON or a JSON array once and stores only source IDs, exact locations (selector-qualified
for declared dynamic arrays), counts and per-location membership digests in
`execution/read-back-inventory/<entity>.json` (schema 2; an older inventory is reported stale,
rerun it). A dotted source key is supported. `draft-stubs` is read-only. Missing extracts
report `not-run`, never a pass. Exit `2` requires correction; before approval the only permissible
unresolved validation item is the missing identified approval for an explicitly reviewed
`notMigrated` path. All other contract, mapping, history and inventory failures must be fixed.

Before any Wix write, request mapping approval with the exact current SHA-256 references from
`lib/read-back-contract.js` `bindings(projectDir, entity)` for **all four** artifacts:
`mapping/mapping-plan.json`, `mapping/entity-decisions/<entity>.json`,
`mapping/mapping-resolution.json` and `execution/read-back-inventory/<entity>.json`.
`mapping/mapping-resolution.json` is produced by `writeMappingAuthority` for every source
(`lib/mapping-resolution.js`): a deterministic projection of the reviewed decisions and
coverage, retaining any CSV resolver output as its seed. Never author, empty or delete it.
The review shows left-out locations (selector keys spelled out), each location's own record
count and each decision's union count, never source values. Record approval
through the existing mapping user action so both answer entrypoints use the shared identified
approval writer. Populated omissions require a named signed-in human; explicit 1-click mode
cannot approve them automatically. After approval, rerun validation; it must pass before writes
and on every resume. Changes to any pinned artifact require fresh review. A previously attempted
unresolved path or observed loss cannot become an approved omission. Approved omissions produce
a separate merchant-acknowledgement action that must be completed before launch.

For every other target entity, declare `verificationKind` (`contact`, `product` or `none`;
members and orders use `none`) and a concrete `reason` through
`lib/read-back-gate.js`'s `declaration`; it is outside these four field gates and must never
be described as having passed them.

## Deterministic first — resolve before you reason

**Do not author field mappings by hand when a vendor overlay already knows them.** Run the
deterministic resolver first and let it do the mechanical join; your judgement is needed only for
what it cannot decide.

```
node scripts/resolve-mapping.js --fileset <migrations-root>/<project>/data/csv-discovery/fileset.json \
  --out <migrations-root>/<project>/mapping
```

It joins three inputs that are all already data — the header set discovery actually observed, the
vendor overlay's `columnMap`, and `rp-target-wix`'s `lib/wix-target-spec.js` — and writes
`mapping/mapping-resolution.json` plus `mapping/mapping-residue.json`. Exit code `2` means blocked:
a required Wix input is unfilled, or an overlay names a canonical field that does not exist.
The next `writeMappingAuthority` keeps these resolver keys and adds the authority projection;
re-running the resolver afterwards requires re-running `contract`.

What it decides, so you don't:

- **which column feeds which canonical field**, and via which alias (recorded for review)
- **which columns nothing claims** → `residue.unmappedColumns`
- **which mapped columns have no Wix home**, with the declared reason → `residue.unsupportedTargets`
- **which required Wix inputs nothing feeds** → `residue.unfilledRequired` (a blocker)
- **which overlay entries reference an absent column** → `overlayDrift` (the profile is stale)
- **which entities arrive by derivation** rather than by a column → `derivedEntities`, including
  `requiresFaithfulnessLedgerEntry` when the source taxonomy is hierarchical

**Your job is `residue`, and only `residue`.** Each entry needs an explicit decision — map it to a
canonical field, or record it as intentionally skipped with a reason. Leaving an entry undecided is
how a stale overlay turns into silently dropped data.

Two rules keep this honest:

- **The header row read at discovery time is authoritative, not the overlay.** An overlay can only
  claim columns that actually exist; a column it does not know is surfaced, never dropped.
- **When you resolve a residue entry that the overlay *should* have known, fix the overlay** —
  `rp-source-csv/vendors/<vendor>.json` plus a header fixture in `tests/fixtures/csv/headers/`. That
  is a data edit with no skill-logic change, and it means the next run resolves it deterministically
  instead of asking a model again. A mapping decision made twice is a missing overlay entry.

### Do not regenerate the payload builder

`rp-target-wix/lib/wix-build.js` turns a canonical record into a Wix Stores V3 create body
deterministically, and `lib/wix-target-spec.js` declares every field, constant and trap it relies
on. This layer is **vendor-independent** — Shopify, WooCommerce, Magento and BigCommerce all
converge on it — so codegen must **vendor and call it**, exactly as the reader vendors `csv-parse.js`.
Do not emit a per-project `to-wix.js` re-deriving money objects, slug sanitization, choice-by-name
variant references, or the empty `physicalProperties` trap. Those are settled, tested, and
regression-locked against 220 payloads from two live-verified imports
(`tests/mapping/wix-build-oracle-test.js`).

The spec also settles the one price decision that recurs on every vendor: see
`STORES_V3_TARGET.priceResolution`. A (regular, sale) pair is **resolved** into Wix's
`actualPrice`/`compareAtPrice`, not mapped field-for-field — getting it backwards silently
overcharges every discounted product.

## Exact field decisions and existing mapping QA

New or explicitly revised plans declare `fieldContractVersion: 1`. Do not silently upgrade
or approve legacy plans. The source inventory and semantics govern; resolver/hint outputs
seed decisions and retain their provenance, residue, drift diagnostics and canonical concepts.
Expand those seeds into exact decisions before review. Preserve entity selection, retention,
relationships, setup requirements, manual runbooks and writer metadata.

Source fields a source adapter turns into a structural canonical field that a manual-mapping
target hands to the operator (today: bundle contents → `product.bundle`, carried by
`stores/product-bundle`) take `disposition: "excluded"` with `policyRef: "carried-to-cutover"`,
`canonicalField` and `carriedBy`. That exclusion is not an omission: it does not hold the record.
Any other exclusion of those fields stays pending. A product bundle maps through the normal
product route; never map its parts onto options, modifiers or variants.

Use `lib/mapping-field-contract.js` from the product root. `writeMappingAuthority(projectDir,
plan, options)` commits authority first, then deterministically projects entity files,
marked field sections in the existing review documents and `mapping/review/mapping-gaps.json`.
Re-running the same authority repairs an interrupted projection. No separate field table
is authored. Reopen the existing mapping approval before amendments. Check every returned
`telemetryFailures` entry through existing telemetry recovery; the durable gaps remain even
when delivery fails. A native or native-plus-cms target with no reviewed `rp-target-wix` writer is mapped
natively with write operation `sendGuardedRawRequest` (`choosePreservation`
returns `writer: 'raw-request'`). Only a write operation that is neither the entity's
writer nor the raw path is a missing-writer gap (`reasonCode: missing-writer`). Never plan
`sendDirectRest`.
Import safety comes from the entity's knowledge file, not from your candidate: a native target
with `preferredWrite.importSafe: false` is an `import-unsafe` gap carrying `importSafeReason`,
whichever writer (reviewed or raw) it would use.

Each entity declares `requiredSourceEntityRefs` (including an explicit empty array), and
`discoveryCoverage: { paths, sourceSnapshotDigest, inventoryDigest, uninspectedAreas, evidence }`.
Use existing discovery/schema artifacts; no exhaustive scan is added. Paths are exact leaf
locations in the shared grammar of `lib/source-location.js`: identifier keys joined by `.`
(`a.b`), `[]` for every array element, and any other key quoted as `["<JSON string>"]` —
`yoast_head_json.schema["@graph"][]["@type"]`, `twitter_misc["זמן קריאה מוערך"]`, `[""]`.
A literal key `["part.name"]` is never the nested `part.name`. Existing identifier paths keep
their meaning. Never drop or rename an awkward key to fit the grammar. An observed dynamic
leaf has `{path, dynamic:true, selector: {keyPath}, observedKeys}`; its decisions claim
keys through `selectors: [{path, keyPath, keys}]`, which stands for one selector-qualified
location per key, `meta_data[key="_yoast_wpseo_title"].value`; such locations may also be
written directly. Each location is its own coverage row with its own count. Descendants of
a selected value (`meta_data[key="tm_meta"].value.tmfbuilder.x`) are listed exactly too;
there is no subtree claim. `read-back-gate.js draft-stubs` prints the unclaimed ones from
the inventory as **unresolved** stubs for you to decide — never paste them as exclusions
without review. Elements whose key is not a string/number stay at the unselected base path
(`meta_data[].value`) and need their own decision. When an excluded decision spans several
locations with different memberships, give `affectedScopes: { <location>: <scope> }`
beside its decision-level `affectedScope` (the union). A measurement that is unknown stays
unknown; it never replaces another decision's known scope for the same location.
Disclose uninspected keys/boundaries instead of claiming full coverage.
The shared helper admits only its existing mandatory credential exclusion, `policyRef:
mandatory-no-credentials`, scoped to recognized credential paths whose discovered leaves
are explicitly `retentionClass:credential`. Cite the existing source/member credential rule;
record paths and evidence, never values. An arbitrary policy reference, ordinary business
path or unclassified subtree does not authorize omission and remains pending/blocking.
A zero-count exclusion is decided only with a complete measured empty population:
`countStatus:known`, `count:0`, `sourceIdsComplete:true`, `sourceIds:[]`,
`sourceIdsDigest:digest([])` from the shared contract, and explicit snapshot/inventory
digests matching this entity's `discoveryCoverage`. Missing, stale or truncated measurement
is pending even if the mapper declares zero; a reported zero never substitutes for evidence.

Every `fieldMappings[]` row has stable `id`, exact `sourcePaths`, `disposition`, `reason`,
`evidence`, and, when written, exact `outputs[]`, `transform`, `valuePolicy` and `examples`.
Outputs have stable `id`, actual consumed `sourcePaths`, `targetRef`, `writeOperation`,
`writeInput` and `targetPath`. Custom storage also names its concrete definition, field,
collection, permissions and parent linkage in `storage`. Bind constants/defaults too.
Transforms are `identity`, a decided `expression`, a complete `lookup`, or a named `helper`
with bound arguments and revision. Decide precedence/timezone/units/rounding and every
missing/null/empty/zero/invalid/unknown case; no grouped chronology or "see schema" instruction
can delegate meaning to codegen. Relationships state crosswalk inputs, destination, cardinality,
ordering and missing/ambiguous/orphan outcomes in `referencePolicy`.

Examples are synthetic `{id, input, expected:[{outputId, writeOperation, value|values|omitted|noWrite,
findingCodes?}]}` records authored from semantics before generated code runs. They include
ordinary and relevant edge inputs. `noWrite: true` names the `findingCodes` that explain it.
When the writer checks the whole request (`importOrder` needs status and buyer details;
`createForm`/`createFormSubmission` need their form), give the entity one synthetic
`exampleBase` record with only what the writer requires; each example's `input` is merged
over it and wins. Keep base values out of the paths the examples assert. Review them independently; generated output cannot author
its own expected value. A changed ID on a matching remap requires explicit prior decision/gap
`supersedes` refs; output-ID changes require matching output supersession. Keep gap history.

Use selectively loaded target `mappingRules` via `lib/mapping-target-rules.js`; all declared
source/schema/semantic predicates must match. Conflicting matches return to mapping. Review
operation field contracts and authoritative wire schemas before deciding suitability. The
same helper enforces native → admitted extended fields → precisely bound CMS candidates.
Extended fields admit only Orders/Products/Contacts, string/TEXT, root entity storage,
`_user_fields`, `migration-internal` permissions and supported limits; contacts-v5 is default,
v4 requires explicit choice. Unsupported types/entities/subrecords use compatible CMS.
Existing definitions require type/permission/reference compatibility, never an ID-only skip.
CMS setup uses the existing automated `create-cms-collections` requirement and executor.
Do not label it manual unless an actual prerequisite lacks a supported automated path.
Source absence creates no value or business record. Runtime never edits shipped target knowledge.

**The source archive is per field, not per record.** All source data is kept: native field,
else an admitted extended field, else a CMS archive location. Decide every leaf through that
order (`choosePreservation`); a short scalar on an order, product or contact is an extended field
before it is CMS. Never route a whole record to the archive because one of its leaves is
unclaimed: only the `cms`-disposition leaves are archived, and a record with none gets no archive
item. Every archive item counts against the site's plan-wide CMS item quota, so:
- archive only records the import writes (the entity's own record selection; an out-of-scope
  WordPress user or unreferenced library media file is not archived);
- give two source entities for the same thing one identity (a WordPress user and the WooCommerce
  customer with the same id share `parentKey` `person:<id>`), so it is archived once;
- put same-parent sub-records (order notes, refunds) under their parent's `parentKey`.
Report the expected archive item count (`expectedArchiveRows` in
`resources/rp-target-wix/lib/cms-item-quota.js`) in the mapping review next to the quota.

Existing mapper QA compares inventory coverage, individual output bindings against schema,
precedence/absence/reference semantics, canonical/projection equality, stable IDs, all gaps
and preservation-versus-native-behavior claims. Review manual-step coverage as before.
For each gap record affected snapshot/inventory digests and measured IDs/count, or explicit
null/unknown coverage; a sampled ID list is not the complete affected population.

Resolve defaults and suitable preservation first. In customer mode an undecided mapping
keeps the checkpoint pending; only an explicit human provisional subset can continue.
For a proposed populated omission, prepare the exact entity contract with the existing
`read-back-gate.js contract --entity <entity> --omissions review` command and present the
affected fields, records/counts, missing behavior and consequences in the normal mapping
review. One authenticated mapping approval may cover all of the exact shown omissions;
the proposal itself authorizes no writes. In one-click only `--omissions review` is refused;
the plain form clears any leftover proposals, and those entities defer. A cited retention
policy or a general instruction to continue is not consent to new loss. Keep the approved omission in completion and Cutover;
approval permits importing supported data, not claiming missing behavior was migrated.
The authority writer derives unattended mode from the existing recorded user-authored
one-click decision; a caller's mode string cannot authorize it. For those tests, retain
selected scope, defer undecided entities, and defer dependents only when their retained writes
need a whole-task prerequisite. Declared per-record references are left executable and their
record-level holds remain visible in the dependency ledger. Record assumptions. Finish
independent work without questions; never repeatedly redispatch an unchanged choice. Return
codegen semantic defects here for one bounded evidence/rule resolution attempt; still-undecided
work stays deferred. Do not turn deferral into an exclusion or a passed import. Persist the
deferred entity as a Cutover gap after independent work and evidence retention finish; only an
all-deferred plan remains blocked because no importer can start.

## Workflow

1. Read the source discovery artifacts.
2. **Run the deterministic resolver** (above) and read its residue.
3. Identify the target Wix entities for each source entity using the domain knowledge
   reader first. Start from `sourceMeta.candidateTargetRefs[]` when discovery supplied it;
   otherwise run `domain-knowledge.js resolve-source`; use semantic reasoning only when no
   candidate exists and record `unverified` confidence.
4. Decide the resolver residue only, then define any remaining transformations and defaults.
5. Mark gaps where native Wix entities are insufficient — the resolver's `unsupportedTargets`
   already names them with reasons; carry those into the faithfulness ledger rather than restating.
6. Identify requirements for custom collections, extended fields, references, media handling, and rich content normalization.
   Every `extendedFields` write needs a matching `kind: "extendedFieldSchema"` setup requirement
   with compact field intents (`key`, `fieldType`, `maxLength`, `permissionsPreset:
   "migration-internal"`), never hand-written JSON Schema. Migration-owned fields use
   `_user_fields`. Admitted targets: orders, products, and contacts (default `contacts-v5`; legacy
   `contacts-v4` only by explicit choice). Other objects and nested subrecords go to CMS. Provisioning
   a field does not decide whether a source field may be kept; that is a separate retention decision.
7. Save the mapping plan, including the reviewed dependency associations below.
8. Detect authored `blockedSourceDependencies` on the selected target entities, aggregate them
   by `sourceEntityRef`, and write the blocked-data request state and review artifact below.
9. Write a concise user-review summary after the plan is complete.
10. Pause for a mapping review checkpoint before downstream setup/codegen work begins.

## Artifacts to create or update

- `migrations/<project>/mapping/run.json`
- `migrations/<project>/mapping/mapping-plan.json`
- `migrations/<project>/mapping/entity-decisions/<entity>.json`
- `migrations/<project>/mapping/llm-handoff.json`
- `migrations/<project>/mapping/review/mapping-gaps.json`
- `migrations/<project>/mapping/review/mapping-plan.md`
- `migrations/<project>/mapping/review/mapping-summary.md`
- `migrations/<project>/mapping/review/blocked-data-requests.md`
- `migrations/<project>/state/blocked-data-requests/<sourceEntityRef-slug>.json`
- `migrations/<project>/orchestration/checkpoints.json`
- `migrations/<project>/orchestration/approvals.json`

## Target dependency associations

For every target dependency consumed by an import, emit
`dependencyBindings: [{ ref, censusIds: string[] }]` in `mapping/mapping-plan.json`.
Use canonical `domain/entity` refs and every contributing decision row in the current
discovered census, including excluded rows. Entity decisions retain their explicit
`targetRef` and `censusIds`, or the census's implicit `entity:<sourceEntity>` link (a plugin
row's canonical `plugin.<plugin>.<entity>` ref resolves to the one census entity that records
it). A row with no census entity of its own, such as mapper-read variations, names its
sub-part explicitly (for example `censusIds: ["entity:product/variants"]`).
Show these associations in the mapping review. Missing, ambiguous, duplicate or incomplete
associations return to mapping; never infer a target from a plugin name or a comment.

An excluded dependency is not ready merely because its entity was omitted from the plan.
Readiness uses the existing census reconciliation and its current identified human approval.
Every contributing row must be excluded and owner-approved for a whole target ref to be
`excluded-approved`. Mixed planned/excluded contributions remain mixed. Agent/provisional
acceptance and finalized-run review do not authorize new writes.

When a specific dependent field may be omitted or must defer for an excluded contribution,
put `dependencyFieldRules: [{ dependentRef, dependencyRef, path, action: "omit" | "defer" }]`
on that contribution's existing census-linked mapping gap. Render the exact rules in the
existing review and bind them to its existing hash-based approval. Entity exclusion alone
never authorizes dropping a field; absent or stale approval defers the affected record.

### Dependencies that need no separate producer

A dependency may need no import, setup step or exclusion: the data is absent, the selected
write creates or resolves it itself, or the approved mapping writes none of its references.
Never record those as an exclusion. Propose one entry per dependent operation in
`dependencyProofs` in `mapping/mapping-plan.json`:

```json
{ "id": "product-media", "dependentRef": "stores/product", "operation": "createStoresProduct",
  "ref": "media/media-file", "reason": "within-write", "explanation": "…", "evidenceRefs": ["…"],
  "operationContractDigest": "<sha256>", "guardedPaths": ["…"], "creatingPaths": ["…"] }
```

- `operation` is the dependent row's one resolved write operation: `preferredWrite.writerId`,
  plus only the `auxiliaryOperations` its reviewed contract names. A single-create preference
  beside bulk-create outputs is `dependency_operation_mixed`; fix the mapping first.
- Copy `guardedPaths`, `creatingPaths` and `operationContractDigest` from the reviewed
  `operationContracts` entry in target knowledge (`node scripts/dependency-preflight.js
  --project-dir <dir> --contract-digest <entityRef> <operation>`). No contract entry, or no
  guarded paths, means the mapper must investigate the semantics and persist an evidence-bound
  local operation assessment before computing this digest. Never infer absence of references
  from absence of a shared entry. Only unresolved uncertainty holds the affected work.
- `within-write`: the contract has `withinWrite` for that ref, the mapping writes its creating
  inputs (for example media URLs, `brand.name`) and none of its guarded paths, and maps one
  of the contract's `recovery.reconciliationKeys` (for example product `slug`). Asynchronous
  work (product media) is verified later by observation, never assumed complete.
  Product images: map one row per item field inside `media.itemsInfo.items[]` — `url`
  (required), plus `altText` and `displayName` when the source has them — all under one
  `mapped` disposition for the intended item list. Never map the whole item or `items[].id`,
  and label every output with the entity its write operation creates; a different label is
  refused as `dependency_proof_operation_mislabelled`.
- `no-data`: only for a ref the contract marks `conditional`, with `absence` measured as one of:
  `{ kind: "zero-row", censusIds }` (every row measured `recordCount: 0`, state `no-data`);
  `{ kind: "zero-match", censusId, manifestPath, extractPath, extractSha256, predicate }` over the
  complete populated extract (`predicate`: `{ path, op: equals|in|present|startsWith, value(s) }`
  or `{ any: [...] }`; a populated product collection with zero gift-card products is zero-match,
  never an empty collection); or `{ kind: "capability-absent", capability, evidencePath,
  evidenceSha256 }` whose evidence states `status: "absent"` with `scope` and `observedAt`. A
  missing or failed discovery response is not absence.
- `not-referenced`: only for a `conditional` ref; no approved target path for that operation
  equals, contains or sits under a guarded path (writing whole `lineItems[]` is not proof of no
  tax group), and the row's `fieldMappingStatus` is resolved. The preflight hands such a proof
  over ready to copy in `suggestedProof`: on `dependency_proof_expected` when the ref is pending
  setup with no planned step (an order or an add-on with no tax group), and on a blocking
  `dependency_unbound` when nothing can produce the ref (a share image with no media row). A
  recorded proof wins over a setup step another dependent needs, so mapping and codegen bind it
  whether or not the plan makes that ref.

Before requesting mapping approval run `node scripts/dependency-preflight.js --project-dir
<dir>`. It resolves every dependent edge from the mapping rows, census and source evidence
(no setup plan or manifest), including transitive refs (an order inherits product media
through the product's own proof, but a direct reference still needs its own), member-produced
contact identities, and setup-producible refs as `pending setup`. It writes
`mapping/review/dependency-preflight.json`; show its diagnostics in the mapping review. Mapping
approval refuses `dependency_preflight_blocking` until the mapping is structurally ready.
Run the plugin full read first: a planned plugin entity left pending fails the preflight as
`plugin_full_read_missing` (never read in full) or `plugin_inventory_unmapped` (read, not yet
mapped). `waiting[]` lists dependents whose producer's mapping is still pending (its edge
producer is `deferred-mapping`), for example products waiting for add-on groups; show it
as the reason those dependents cannot run yet. When only some of a target's rows are pending, a
dependent is listed only for the pending rows its `requiredSourceEntityRefs` names
(`producerPartlyPending: true`). It is not a structural error.
Pending setup never means execution-ready: codegen still needs a real setup step. A
setup-producible ref that no mapping row or planned setup requirement makes, and that the
dependent writes none of (an order with no `lineItems[].taxInfo.taxGroupId` needs no tax group),
fails as `dependency_proof_expected`; add its `suggestedProof` to `dependencyProofs` as given.

`requiredSourceEntityRefs` describes the prerequisites of the **retained writes**, not every
relationship discovered on the source. When the reviewed mapping omits all uses of a
relationship, remove that source prerequisite from the dependent entity's retained-write
list. Keep its census binding, explicit exclusion, exact `omittedOutputs` and dependent-field
rule in the same mapping review; never remove the domain dependency from the manifest.
For example, an unavailable tag writer becomes a disclosed tag omission proposal, not a
prerequisite requiring all products to wait for a nonexistent writer. Record the affected
product membership from the complete extract (unknown stays unknown), plus
`nativeBehaviorMissing` and a Fix/Dismiss action for the missing tag behavior. If the customer
does not accept that exact loss, retain the unresolved decision and its dependent scope.
An empty tag list must be observed in the source; never infer it from missing extraction.
A listed prerequisite absent from the mapped scope holds the dependent entity; its deferral
reason names the ref as possibly stale. Fix the list and re-run `contract`; never auto-remove it.

Shipping/tax setup prerequisites remain whole-task prerequisites. Map a single source
shipping line's title, cost and available delivery details. More than one line defers the
order with `order-multiple-shipping-lines` and a blocker gap. Select reference omission or
verified setup references only from the bundled field-level verification conclusions;
unverified shipping/tax fidelity keeps the affected order deferred. Never invent target
IDs, combine source lines without an approved disposition, or backfill existing orders.

## Blocked source dependencies

Read only authored `blockedSourceDependencies[]` from selected target entity knowledge; never
infer a request from `db-only`, `admin-page-only`, or another channel by itself. Use the shared
`lib/blocked-data-requests.js` builder to aggregate one request per `sourceEntityRef`, appending
all dependent target entity/field rows. Resolve each source entity's `blocked[].fulfillment`
through `rp-source-wordpress/lib/blocked-data-handlers.js`; offer it only when its fixture
self-test passes. `structure-bridge-plugin` (wix-wp-plugin-v2) has no
manifest or readiness flag to check beyond that -- authorization is live (denylist +
`DESCRIBE`) at request time, not a build-time gate. This readiness check is the only
thing this stage does with a `structure-bridge-plugin` fulfillment: unlike `csv-upload`,
its actual data is never resolved through this file's `attemptFulfillment()`/snapshot
mechanism (that path is for a small, static, one-shot document) -- `rp-import-codegen`
generates a normal incremental reader for it instead, reusing the same `table`/
`sampleStructureRequest` metadata. See `rp-import-codegen`'s "`structure-bridge-plugin`
entities" section. That reader authenticates with the same WordPress Application Password
as every other private read — `rp-source-wordpress/plugins/README.md`'s "Resolving a db-only
capability" section.

**Plan structure-bridge-plugin entities with `lib/structure-bridge-planning.js`** before building blocked-data requests. Pass the canonical source entities as
`sourceEntities` as well as profiles to `planStructureBridgeEntities({ plugins, sourceEntities,
dataDir })`. Bound entities do not need a profile. Preserve their canonical reference and
`sourceMeta.extractionPlan` unchanged; do not reconstruct bindings from legacy sidecars.
For object-shaped source entities retain each object's key/reference while making the array.
`planStructureBridgeEntities({ plugins, sourceEntities, dataDir })`
turns each such entity that has `candidateTargetRefs[]` into an entity decision (target,
readiness, read variant, discovery artifacts). An entity without a candidate target is
returned in `blockedFieldSources` and stays on the blocked-data path above. Pass the selected
target entities through `partitionBlockedSourceDependencies(targets, decisions)` and give its
`targetEntities` to the blocked-data builder, so a planned entity is never also requested as
a blocked field. Then `writeStructureBridgePlanning(projectDir, decisions)` writes
`mapping/entity-decisions/<entity>.json` and the `mapping/mapping-plan.json` row. It refuses
after the mapping review is approved. A rerun refreshes only the fields planning owns and
keeps field mappings, transformations, relationships and other edits already on the row. An
EAV read plan that fails its integrity check is a pending reason. A `pending` decision goes to
the review gate like any other pending row.

Persist the request under `state/` as the authority and render
`mapping/review/blocked-data-requests.md` as a passive review section. This adds no new blocking
prompt. At an interactive mapping pause, set `askedInteractively: true` only if the request is
actually shown and a human can decline it. In 1-click mode set it to `false`; an unanswered
request remains `missing`, never `declined`, because the run did not pause to ask.

## Minimum contents of the mapping plan

Include for each source entity:

- source semantics in this project, especially when the entity name is generic
  (`comment`, `item`, `entry`, `record`, `media`, `user`, etc.). State what the entity
  actually contains here, based on the discovered data, not just the route name.
- target Wix entity or collection
- selected `targetRef`, `targetDomain`, `targetEntity`, `targetClassification`,
  `importReliability`, `preferredWrite`, and `knowledgeEvidence` when the decision uses a
  bundled domain entity record
- when `targetClassification` is `manual-mapping`: the entity's `manualSteps`
  verbatim (prerequisite, actor-tagged steps, mechanism, evidence) instead of field
  mappings/transformation/validation rules below — there is no transform to author, only a
  runbook to carry over unchanged
- primary key and deduplication strategy
- field mapping table
- transformation rules
- validation rules
- URL preservation policy for public routed entities
- unresolved questions
- setup implications for Wix-side configuration
- media policy when the entity carries media: whether only referenced media is in scope,
  whether the target accepts external URLs directly, and whether media must exist in Wix
  before create/update

When a source entity is generic or overloaded, the mapping plan must name the concrete
subtypes or usage contexts it observed. Examples:

- `comment`: blog post comments, product reviews, page comments
- `item`: order line items, catalog items, CMS rows
- `media`: blog hero images, product gallery assets, downloadable files

Do not leave a generic entity label unexplained if the discovered data shows multiple
real-world meanings.

## Variant inventory is part of the catalog plan

For each source variant, plan either explicit stock (`inventoryTracked`, `inventoryQuantity`,
`inStock` canonical fields) or a named inventory gap. Use the source adapter's stock mapper;
stock flags, quantities, and backorders are different policies. Count every intended variant
before filtering gaps or failed product mappings. Carry that denominator into inventory
verification as `expectedCount`. A product count never stands in for inventory coverage.
Default-location stock is supported; any shared pool, multi-location allocation, preorder,
or fallback availability needs an explicit mapping decision. The target builder has no
implicit in-stock default. A legacy explicit `inStock` fallback must not override known
variant stock. Inventory verification remains required for deliberately excluded stock:
record the expected destination state and the gap rather than exempting the catalog audit.

## Shipping delivery estimate from the merchant

When the merchant states a delivery time for a shipping zone in their own words, record it:

```bash
node skills/wix-replatform/scripts/orchestration-state.js decide --project-dir <projectDir> --key shipping-delivery-estimate:<zoneId> --value "<text>" --source user
```

Record it only from the merchant's own words. Never infer it, and never record it with
`deterministic_inference` or `prior_artifact`: the shipping stage ignores those and lists them,
so an inferred value can never become a checkout promise.

## Identity and deduplication rules

Be explicit about the difference between a **source ID** and a **Wix target ID**.

- Preserve the **source ID** in the migration artifacts, generated code, local crosswalk
  state, and any optional CMS mirror collections needed for site-local traceability.
- Do **not** assume native Wix entity IDs can be client-assigned or preserved. For most
  Wix APIs, the target ID is server-assigned.
- When a target is a native Wix entity whose ID cannot be controlled by the client,
  the mapping plan must define a **local crosswalk strategy**:
  `crosswalkAuthority: "local"`, a per-entity `crosswalkStrategy`, and a
  `reconciliationStrategy` used for dedupe, resume, and relationship resolution.
- CMS `ImportCrosswalk` is optional. Use `cmsMirror: "none" | "download" | "upload" |
  "download-and-upload"` to request it explicitly. It is a copy/seed adapter for
  existing-site or handoff reference flows, not the required resume authority.
- Only say an ID is "preserved" when the destination actually has a client-controlled
  field that stores the source ID. Otherwise say the source ID is **tracked** or
  **crosswalked**.

### When the destination already exists, map against its LIVE schema

`WIX_SITE_STRATEGY=existing` means the target is not an empty site provisioned to this
mapping's shape — it is a site in use, with its own collections, fields and records. Map
against what is actually there:

- **Read the destination's current schema before proposing a target shape.** A collection
  the site already has, with fields the owner added, is the target — not a new collection
  that happens to fit the source better. Two collections holding the same entity is the
  failure mode here, and it is one the owner has to untangle by hand.
- **A field that exists but does not match is a GAP, not a migration.** Record it in the
  faithfulness ledger and surface it in the mapping summary; do not plan a schema change
  to a live site, and never plan to drop or retype an existing field.
- **Every entity needs a natural key, not just a crosswalk entry.** The local crosswalk is
  empty on the first import into a site that already has data, so dedupe has to fall back
  to something the site itself carries — SKU, handle, slug, email. State that key per
  entity in the mapping plan; without it the import cannot tell "already there" from "new"
  and will duplicate the owner's catalog.
- **Ask whether to set `cmsMirror: "download-and-upload"`; do not set it unconditionally.**
  CMS `ImportCrosswalk` stays optional even on an existing destination — it
  requires the user to opt into site-local reference data, because Wix CMS quotas are
  plan-based and shared across every custom collection on the site, and a mirror the size of
  a large migration's crosswalk can consume a meaningful share of a lower-tier plan's quota.
  When the user does opt in, note that the on-site `ImportCrosswalk` becomes the only record
  of prior imports visible to a run that does not share this project's local state — that is
  the reason to offer it, not a reason to default to it.
- **Say so in the mapping summary.** The user reviewing the plan must see that it targets a
  site they already own, and which of their existing entities it expects to match.

## URL preservation policy

For every in-scope source entity that appears on the public website, include an explicit
`urlPolicy` in `mapping/mapping-plan.json` and the relevant
`mapping/entity-decisions/<entity>.json` artifact.

Minimum `urlPolicy` fields:

- `public`: `true` for public routed entities; `false` for entities intentionally outside
  URL preservation.
- `sourceBasePath`: the observed source base path, such as `/shop/products`; use `null`
  only when the source URL cannot be derived and record that risk.
- `sourceSlugField`: source field holding the slug, when present.
- `sourceUrlField`: source field holding the full/permalink URL, when present.
- `targetBasePath`: known Wix destination base path, or `null` when website-builder route
  selection is deferred.
- `targetSlugField`: planned target slug field, when applicable.
- `preserveBasePath`: whether the future website-builder phase should try to preserve the
  source base path.
- `preserveSlug`: whether generated code should preserve the source slug unless target
  validation or collision handling forces a change.
- `redirectMode`: `record-if-different`, `manual-review`, or `none`.

When recording a base-path `manual_review` outcome, persist its concrete `reasonCodes`
and evidence in the existing base-path state, not only the status or an unexplained note.
If the sole issue is waiting for a destination route, use `target_route_unknown` (or the
existing `target_url_missing`, `pending_target_route`, `final_route_missing` reason).
The redirect planner can settle that uncertainty per exact source entity/final route.
Keep privacy, explicit operator restrictions and other causes distinct; a final destination
does not clear those. Include every applicable reason. Do not reclassify an unexplained
historical hold as routing-only merely because a convenient target exists; establish the
original reason from evidence or report the missing explanation for review.

If the same source entity type has multiple public route shapes, record each observed
route class separately instead of guessing one base path. Slugs are identity and SEO data,
but slug preservation alone is not URL preservation; route/base-path intent must be
captured as data for the future website-builder phase.

Mapping review artifacts must include a short `URL preservation` section listing:

- public entity types with source base paths
- whether base paths should be preserved
- entities whose target route is deferred to the website-builder phase
- known slug normalization, collision, route, or redirect risks
- detected redirect providers (Redirection, Rank Math, Yoast Premium, server/CDN rules) with
  their coverage status from `state/url-preservation/source-redirect-coverage.json`; an
  `unreadable` or `unsupported` provider is an extraction gap the operator must see, never
  an empty map

Source-authored redirect rules are URL obligations in their own right: an old address can
still receive traffic without being the address of any current page. Do not drop them
because they have no current entity, and do not reactivate disabled ones.

## Product SEO

Map WooCommerce/Yoast product SEO to `product.seoEvidence` (per-field `override` / `inherit` /
`unknown`), never to `product.seoTitle`/`seoDescription`. Rendered `yoast_head_json`, `og_*`
and excerpts are not evidence and are never a fallback. Title and description are decided
separately. Unknown evidence is held for an explicit owner choice (acquire evidence, omit, or
materialize); the mapping never picks one. Canonical, robots, schema, social tags and focus
keyphrases are not written; list them in the mapping review as not migrated. SEO patterns are
never inferred from repeated rendered output.

## Wix Events

Map source event categories to `events/category` (flat; ledger a flattened
hierarchy), events to `events/event`, ticket types to `events/ticket-definition` and attendees to
`events/rsvp`. The event's `draft` follows the source status; a source draft with RSVPs is
published (ledger it). For paid ticket types, copy the fee mode (`FEE_INCLUDED` /
`FEE_ADDED_AT_CHECKOUT`) and ticket tax from the source. When the source has neither, add one
owner choice to the mapping review before consent ("Ticket fee and tax"), with `FEE_INCLUDED`
and no tax setting pre-selected; the approved choice is the value every such ticket uses. One-click
runs use the pre-selected value without asking, and the importer lists those tickets for cutover
(`events_ticket_fee_confirm`). Ticket names over 30 characters are truncated here and ledgered.

## Verifying Wix APIs

Confirm exact Wix entity/collection/field names before mapping a source field onto
them — never invent a Wix API or field name.

When the mapping depends on Wix runtime behavior rather than just field names, verify and
follow the relevant `rp-target-wix` contract as well. Examples include create ordering,
native tag handling, category assignment requirements, member prerequisites, and whether a
product/media field should be sent as an external URL for Wix-side ingestion.

For entity suitability, do not grep or paste whole domain files into the plan. Use:

```bash
node skills/wix-replatform/resources/rp-target-wix/scripts/domain-knowledge.js summarize-entities --refs <domain/entity,...>
```

Load full entity records only for selected candidates that materially affect the current
project.

- Verify enum **values**, not just names: every `Field.type` you assign must be a real
  member of the Create Data Collection `Type` enum. Never assign a guessed enum value and
  flag it `unverified`; resolve it or omit it. (`SLUG` **does** exist in that enum — it is
  documented for dynamic page URLs. Prefer `TEXT` when the field carries a *preserved source*
  slug as identity/SEO data, and `SLUG` only when the target itself generates the dynamic-page
  URL from it; both are real choices, so do not record `SLUG` as unavailable.)
- If a Wix tool surface such as Wix MCP is available in the runtime, use it as a fast
  verification aid for entity, field, enum, app, and setup names.
- If no Wix tool surface is available, rely on `rp-target-wix`'s verified contracts plus
  published Wix REST/SDK documentation and conservative, known-good names. Mark anything
  you could not verify directly as `unverified` in the mapping plan so it is surfaced
  before execution.

## Runtime policy

Resolve ambiguous mappings using the documented default, record the decision and rationale
under the machine mapping artifacts and render them into `mapping/review/mapping-plan.md`,
and keep going. Known fidelity forks
(e.g. comments anonymize vs. skip) should already be answered by the submission intake;
apply those answers rather than re-asking. If a required input is truly missing, surface it
as a blocker rather than silently guessing.

If the source entity name is generic but the observed data disambiguates it, record that
disambiguation explicitly in the machine mapping artifacts and review plan. Do not force later stages to infer what
"comments", "items", or similarly broad labels meant in this specific migration.

## Faithfulness ledger (detect lossiness here, early)

The mapping stage is where lossiness and coverage gaps are *discovered*, so it is where
they must be *recorded* — not at execute time, which is too late to do anything but
report. Maintain a **faithfulness ledger** in `mapping/review/mapping-gaps.json` and render it
into `mapping/review/mapping-plan.md`, listing everything that
will not migrate cleanly, including:

- fields/relationships flattened or dropped (e.g. hierarchy → flat),
- entities skipped (e.g. gated PII),
- **targets with no Wix writer** — if Wix has a native entity but `rp-target-wix` has no
  writer for it (`preferredWrite.writerId: null`), map it natively with write operation
  `sendGuardedRawRequest` and show it as "raw request, no reviewed writer" with the record
  count. Never plan `sendDirectRest`. Use CMS only when no suitable native Wix entity
  exists, or when the native entity is rejected for fidelity/side-effect reasons.

**Mandatory trigger — plugin coverage.** Every row in `discovery/plugin-coverage.json` whose
status is not `migration-planned` must produce a `mapping/review/mapping-gaps.json` entry
carrying the capability, the status, and the row's user-facing impact line — and so must a
`migration-planned` row that is lossy or carries `blocked[]` entries. This is what makes
plugin loss visible: a capability the pipeline discovered but could not deliver has to reach
the execution-plan report, and the ledger is the only path there.

Each such entry must also carry a `severity`, because a plugin-heavy site produces far more
rows than it has real problems — on a 55-plugin store, 26 rows were "we don't recognise this
plugin", which would bury the entries that matter if they all read alike. Use the same
vocabulary as profile pitfalls:

| `severity` | Means | Typical rows |
| --- | --- | --- |
| `blocker` | data the user would care about is not coming across | `requires-development`; a `blocked[]` entry still unresolved or declined |
| `warning` | it migrates lossily, or we are not sure yet | `pending` (including `cannot-tell`); `migration-planned · via cms` where the source is semantically richer |
| `info` | accounted for, nothing lost that we know of | `no-need-to-migrate` with `basis: proposed`; `migration-planned · proposed` with no known loss |

The execution-plan report leads with `blocker` and `warning` and summarizes `info` as a count
with a pointer. Severity is a **rendering** aid, not permission to omit: every row still gets
an entry, so the audit trail stays complete and a mis-severitied row can be found later.

**Mandatory trigger — source coverage.** Every row in `discovery/source-coverage.json` needs
**exactly one** disposition, and `scripts/coverage-reconcile.js check <project>` exits 2 until it
has one (the router holds the run at mapping meanwhile):

- a `mapping/review/mapping-gaps.json` entry carrying the row's `coverageId` (the usual case:
  severity `blocker` for an in-scope capability, with `recommendedHandling`); or
- a `sourceCoverage:<coverageId>` decision — `provided` when discovery was re-run and the entity
  now exists in `source-schema.json`, `declined` when the user skipped it. Record it only with
  `scripts/coverage-reconcile.js decide <project> --coverage-id <id> --value provided|declined`,
  which also removes that row's gap entry in the same write; or
- for a quick adapter only, its own declared exclusion (already on the row).

Two dispositions for one row (two gap entries, a gap plus a decision, a declared exclusion plus
anything) fail as `disposition_conflict`; there is no precedence rule. A `provided` decision whose
entity is not in `source-schema.json` fails as `disposition_stale`. A gap may cite an existing
human gate, never create one: `gate: "exclusion"` with `gateEvidence: { register:
"no-migration-needed", capability }` only on an `adapter-excluded` row whose signed register entry
names that row's own capability, or `gate: "loss-accepted"` with `gateEvidence` naming a signed
register entry (`register`, `capability`) or the approved mapping review (`approval: "mapping"`).
Any other pairing fails as `gate_reason_mismatch`; a cited gate that does not exist fails as
`gate_missing`. Every outcome reaches the completion report; see `rp-execute-import`.

Additional plugin rules:

- Resolve targets from `sourceMeta.candidateTargetRefs[]` first, then
  `domain-knowledge.js resolve-source`, then the target knowledge base's capability index
  keyed on `sourceMeta.capability`.
- **Derived entities (`sourceMeta.recognized: false`) may only be mapped to a native Wix
  entity when the domain knowledge confirms the capability.** Otherwise map them to CMS. The
  proposed capability from discovery is recorded with `confidence: proposed`, never a
  target decision — treating a guess as native is how a silent, lossy write happens.
- **Every capability, recognized or derived, needs its pairing written down: plugin details
  against Wix details.** In `mapping/review/mapping-plan.md`, per capability: the source
  entity and the fields it actually carries, the target entity and the fields it expects,
  which source field lands in which target field, and which carry nowhere. In
  `mapping/review/mapping-summary.md`, one line naming the source, the target, and the single
  consequence that matters. For a derived capability, say in both that the mapping is
  **proposed** rather than confirmed — a reviewer must be able to tell a guess from an
  authored match. Without the pairing the user is approving a target name, not a mapping.
- A `no-need-to-migrate` row with `basis: proposed` (the agent's own reading, not a list
  entry) is also listed in `mapping-summary.md` — automation deciding there is nothing to
  move is a decision worth seeing.
- Carry each plugin entity's profile `pitfalls[]` into the plan, and surface `blocker`
  severities in `mapping/review/mapping-summary.md`.
- **A capability read through a plugin-specific credential is disclosed up front.** When a
  profile declares `credentials[]` (a plugin's own API key or secret, beyond the platform
  admin credential — e.g. Subscriptions For WooCommerce's plugin-generated
  `consumer_secret`), the capability's row in `mapping/review/mapping-plan.md` states the
  credential prerequisite (what key, where the user finds or enables it in the source
  admin), and `mapping-summary.md` carries one line listing every capability that will ask
  for such a key. The user learns this at the mapping review, not first as a surprise
  `blocked: credential` ask mid-run; the run-time collection still goes through the
  standard batched blocked-and-recoverable ask.
- Any capability landing in CMS adds two setup implications to the summary: the **Wix Data app
  install**, and **creating each compatible collection** through the existing automated `create-cms-collections` setup step. A CMS
  row presented without them reads as more automatic than it is.
- `requires-development` and `pending` rows belong in the summary's gaps section in plain
  language, even though there is no mapping to make for them.
- A `targetClassification: "manual-mapping"` entity becomes a checklist item in
  `mapping-summary.md`'s `Manual steps you need to complete` section (see "The manual-steps
  section"), not a section of its own — one consolidated list is what makes the handover
  readable, and a per-entity section splits it. Carry over its `manualSteps.steps[]` as a
  numbered list under that item, not a one-line summary; the point is to hand over a runbook,
  not to compress it. **Do not** put these rows in the pending/gaps section: unlike `pending`,
  a manual-mapping row is a complete, decided mapping the moment it is authored with real
  evidence — there is nothing left for a human to decide, only steps for the merchant to
  execute. It needs no verdict at the review gate below.
- A `cutover-task:<slug>` plugin-coverage row (`cutoverTask` present: no data, a named task from
  `cutover-task-only.json`) is closed the same way: a gap with its `censusId` and
  `disposition: "manual"`, and its `manualSteps.steps[]` listed under its `cutoverTask.task` title
  in the manual-steps section. Never close it as `no-data`: that drops the task from the handoff.
  A `core-covered:<slug>` row (basis `core-reader`, WooCommerce) needs no gap; its core entities
  are mapped and censused as entities.

**Mandatory step — pending rows are decided at the review gate.** The mapping review is the
single human gate and **the only exit from Pending**: every `pending` row is put to the user
for a decision, none may survive the gate undecided. Four verdicts, each with a producer:

- **"We can migrate it"** — record the chosen target and move the row to *Migration planned*
  in the plan (its `confidence` stays `proposed` until a profile is authored) — when the
  capability has no REST route, follow `rp-source-wordpress/plugins/README.md`'s "Resolving
  a db-only capability" order (try wix-wp-plugin-v2's structure-bridge-plugin before
  defaulting to a `user-file`/csv-upload ask) before authoring the profile.
- **"Nothing to move"** — the row becomes *No need to migrate* with `basis: decision` and the
  user's stated reason as its `rationale`.
- **"Wix has no surface — build it first"** — the row becomes *Requires development*: write it
  to `mapping/review/mapping-gaps.json` with severity `blocker`, emit an `api_gap` telemetry
  event, and record the verdict in the human-signed register
  (`plugins/requires-development.json`, `decidedBy` = the user) citing the recorded search.
- **"The surface exists, we did not know it"** — telemetry only (`source_plugin_coverage`
  carries the decision); the profile or domain entity is authored between runs, never during
  this one.

Record each decision in `orchestration/decisions.json`; blocked-row asks batched at discovery
use the key `pluginBlocker:<capability>:<kind>` with value `provided` or `declined`.

**Mandatory step — the CMS-fallback ask (recognized capabilities).** A profile never names a
CMS target. CMS is reachable for a recognized capability only when a human signed it as an
*eligible* fallback (`plugins/cms-fallback-eligible.json`) **and** this migration's merchant
approves it. Such a row arrives `pending` with `cmsFallback.eligible: true` and one of these
reasons; each is one more closed question on that pending row at the same review:

- `cms-fallback-awaiting-approval` / `cms-fallback-decision-stale` — ask: *approve archiving
  these records in Wix CMS*, or *decline*. Show the row's record counts, the proposed
  collection(s) (`cmsFallback.proposedTargetRefsByEntity`) and the `cmsFallback.featureLoss`
  sentence **verbatim**. Never present CMS archival as restoring the plugin's feature. A stale
  row's earlier answer (`cmsFallback.staleDecision`, or `invalidDecision` for a hand-edited or
  malformed entry) no longer applies; ask again.
- `cms-fallback-declined` — already answered; nothing goes to CMS. It stays `pending`: offer
  the ordinary pending verdicts above if the merchant wants to settle it another way.
  Declining CMS is never recorded as accepted data loss, `no-need-to-migrate` or
  `requires-development`.
- `cms-fallback-target-knowledge-unavailable` — not askable: Wix target knowledge failed to
  load, so "nothing native fits" is unproven. Report it; rerun once it loads.

Record the answer only with the dedicated writer (the generic `decide` rejects the key):

```bash
node skills/wix-replatform/scripts/orchestration-state.js decide-cms-fallback \
  --project-dir <project> --capability <capability> --value approved|declined \
  --approved-by "<the name or role the person gave>"
```

It writes `pluginCmsFallback:<capability>` bound to the proposal on the coverage row
(`proposalDigest`), resets the mapping approval to pending, and the router then reclassifies
coverage and sends you back here to regenerate the plan. **One-click and unattended runs never
record this answer**: an agent-accepted mapping checkpoint leaves these rows pending, nothing is
written to CMS for them, and completion reports them. The writer itself refuses (exits
non-zero) whenever `automationMode` is `one_click`; do not work around it. A row that is `migration-planned · via cms`
with `cmsFallback.functionalityRestored: false` is CMS-by-approval; map it to exactly
`targetRefs` (the register's refs), and add the CMS setup implications below plus one
`mapping-summary.md` line with the `featureLoss` sentence.

**The operator's CMS override (natively routed capabilities).** Native stays the default. Every
recognized row routed to a native target (`migration-planned · via api`, or `manual-mapping`)
carries `mappingTargetOverride` — the offer to keep these records in a private Wix CMS collection
instead (`proposedTargetRefsByEntity`, `featureLoss`, `nativeTargetRefs`). Mention it at the
mapping review as an option, not a question to press; show `featureLoss` verbatim. A row may also
carry `notices[]` (for example native Wix Forms entries: the owner may get one email per old entry
if the toolkit cannot pause the form's automations). Show each notice verbatim. Only when the
operator answers that they want CMS, record it with the dedicated writer (the generic `decide`
rejects the key):

```bash
node skills/wix-replatform/scripts/orchestration-state.js decide-mapping-target-override \
  --project-dir <project> --capability <capability> --value cms \
  --approved-by "<the name or role the person gave>"
```

It writes `mappingTargetOverride:<capability>` bound to the row's offer, resets the mapping
approval to pending, and reclassification then turns the row into `migration-planned · via cms`
with `cmsFallback.override: true`. Map it exactly like an approved CMS fallback (its `targetRefs`,
the CMS setup implications, one `mapping-summary.md` line with `featureLoss`). Never suggest or
record an override yourself, and never in one-click/unattended runs (the writer refuses). A row
`pending` with reason `mapping-target-override-stale` means the offer changed since the answer:
ask again (keep native, or CMS); nothing is written meanwhile.

`mapping-gaps.json` severities for these rows: every pending CMS-fallback row (awaiting, stale,
declined, target knowledge unavailable) is `warning`; an approved row is also `warning` (lossy by
definition) and carries the `featureLoss` sentence. Each `plugin-coverage.json`
`cmsFallbackDecisionIssues[]` entry (a malformed answer for a capability with no row) is one
`info` item. A row carrying `cmsFallbackDecisionIgnored` (a native target now resolves, or the
eligibility was removed) is reported with that reason so the earlier answer is visibly retired.
An override row (`cmsFallback.override: true`) is `warning` with its `featureLoss`; a
`mapping-target-override-stale` row is `warning`; each native row's `notices[]` entry is one
`warning` item with the notice text verbatim.

**Mandatory step — bind the plan to the coverage it was built from.** After writing
`mapping/mapping-plan.json`, stamp it (a no-op when the project has no plugin coverage):

```bash
node skills/wix-replatform/scripts/cms-fallback.js stamp-plan --project-dir <project> --plan mapping
```

This copies `discovery/plugin-coverage.json` `inputs.cmsFallbackDigest` into
`mapping-plan.json` `inputs.cmsFallbackDigest`. The router treats a plan without it, or with a
different one, as stale (`mapping_plan_stale_cms_fallback`) and routes back here, including on
one-click runs.

**Mandatory trigger — hierarchical source taxonomy → flat Wix target.** When a source
entity carries `"hierarchical": true` (or any `parent` self-relation) in
`source-schema.json` and maps to a flat Wix target such as Blog categories, you **must**
write a faithfulness-ledger entry recording that the parent/child hierarchy is dropped on
import (the Wix Blog category target is flat — it has no parent/child relationship). This
is not optional discipline: the flag exists precisely so
the warning is data-driven. Do not map such a taxonomy without the ledger entry. (If
hierarchy must be preserved, the alternative is a CMS-collection taxonomy with a `parent`
reference field — note that trade-off in the ledger instead.)

This ledger is the source the execution-plan report draws from to surface "what we won't
do" to the user **before** consent (`rp-execute-import`). If it isn't recorded here, the
user can't be warned there.

An entity whose knowledge names `writtenInTaskOf` (an order's `ecom/order-payment`,
`ecom/order-refund` and `ecom/order-invoice-document` name `ecom/order`) is never its own
row: map its fields as outputs of the host's row, and the host's import task writes it.
Census reconciliation refuses any other row that targets it (`target_written_in_parent_task`,
with the host in `parentRef`), and `import-contract-verify` refuses a task that has it without
its host (`PARENT_TASK_REQUIRED`).

Every selected entity whose domain knowledge includes `IMPORT_UNRELIABLE` must create a
`mapping/review/mapping-gaps.json` entry with the same fixed flag string, the selected
`targetRef`, a project-specific summary, and the chosen fallback or review action
(`gapType` or `code` `IMPORT_UNRELIABLE`, nonempty `summary`, and a nonempty string in
`fallback`, `action`, or `reviewAction`). Either a top-level array or `{ "gaps": [...] }`
is accepted. A flag and target alone are not an acknowledgement. Census reconciliation refuses an executable row
without it (`import_unreliable_unacknowledged`).
Explicitly unselected, excluded and genuinely deferred rows do not write; a checkpoint-only
placeholder still needs to pass this check before approval. Support rules are bound into
reconciliation; changes require rebuilding and reapproval.
Declare helper writes as field outputs with their own `targetRef` and `writeOperation`
(for blog author provisioning: `members/member` and `resolveBlogAuthorMemberId`). Member
writer aliases resolve to `createMember`. An undeclared helper create is still refused by the
shared Wix client before HTTP, including in setup and quick mode; prose is not a write permit.

**Mandatory check — every in-scope entity's dependencies are also in scope.** Run it directly, do
not re-derive it by reading prose:

```bash
node skills/wix-replatform/resources/rp-target-wix/scripts/domain-knowledge-validate.js \
  --check-scope <comma-separated domain/entity refs in the mapping plan>
```

Pass only the plan's own selected refs — `checkScope` walks the `dependsOn` transitive closure
itself starting from that list, so do not pre-expand it by hand. It fails closed on three distinct,
named problems, any one of which is a gap the user must resolve at the gate before proceeding:

- **Unknown ref** — something in your selected list doesn't resolve to a real `domain/entity`
  file (typo, stale ref). Fix the ref.
- **Missing dependency** — a reachable `dependsOn` has no selected producer. Resolve it
  through an import task, bound setup steps, or the reviewed census exclusion path above. The structural scope checker must receive the full canonical dependency inventory, including refs assigned to setup or exclusion; including a ref in that inventory does not select an import entity or approve a disposition. Producer binding and current owner approval are checked separately before codegen/run.
  Record the association and exact field rule where needed; a prose best-effort exception
  cannot make an unresolved reference writable.
- **Unreviewed** — an entity reachable from your selection has never had `dependsOn` authored at
  all (distinct from "reviewed, no dependencies"). `--list-missing-deps` shows the same backlog
  outside the context of any one plan.

A clean `--check-scope` result means only this plan's own reachable set is fully reviewed and
in scope — it says nothing about entities outside that reachable set. `checkScope` walks from
your selected refs, not from the whole domain tree, so an unrelated entity with no `dependsOn`
authored at all stays invisible to this gate until some plan actually reaches it. Run
`--list-missing-deps` (unscoped, whole-repo) separately to see the standing backlog.

**As of this pass, only 19 of 62 entities in this repo have `dependsOn` authored** — expect to hit
**Unreviewed** on most real plans today, not just as an edge case. That is not this gate failing;
it is the gate doing its job on a knowledge base that is still mid-backfill. When it happens:
author `dependsOn` on the reachable entity now, as part of the mapping work you are already
doing — deciding a mapping plan already means knowing what that entity depends on, so this is
recording that decision, not new research — then re-run `--check-scope`. Do not treat Unreviewed as
a reason to skip the gate or fall back to reading prose by hand for that entity.

Do not expand the selection to the full transitively-reachable set by hand before calling
`--check-scope`. `checkScope` performs the walk itself; pass it your plan's actual selection and
nothing more.

## Default media scope

Default to importing only media referenced by in-scope entities such as posts, products,
collections, categories, or CMS rows that are actually being migrated. Unattached
source-library media is out of scope by default unless the user explicitly asks for a
library/archive migration.

When an entity carries media, consult `rp-target-wix` for the target behavior:

- if the target accepts external URLs and ingests them in the background, prefer that
  path
- otherwise require media import to Wix first, then attach the resulting Wix media id

## Mapping summary for user review

After `mapping/mapping-plan.json` is written, create
`migrations/<project>/mapping/review/mapping-summary.md` as a
short review artifact for the user. Its purpose is to make the mapping decision easy to
review without forcing the user through the full plan.

The summary should:

- explicitly say that full details live in `mapping/review/mapping-plan.md`
- **carry a `Manual steps you need to complete` section — required, always present, placed
  immediately after the opening and ahead of the entity mappings.** See "The manual-steps
  section" below; it is the one place the user learns what stays their job
- list each in-scope source entity and its planned Wix target
- call out the main gaps, lossy transformations, skipped entities, and `unverified`
  target paths from the faithfulness ledger
- summarize public URL preservation: source base paths, deferred target routes, and slug
  or redirect risks that affect approval
- mention the biggest setup implications the user should know now (for example: required
  Wix apps, required CMS collections, optional CMS crosswalk mirror, media reachability
  caveat)
- surface unresolved questions only when they materially affect whether the user should
  approve the mapping

Keep it concise. The user should be able to decide "yes, this is the right migration
shape" from this file alone, then consult `mapping/review/mapping-plan.md` only when they want detail.

Recommended structure:

- one-sentence purpose / pointer to `mapping/review/mapping-plan.md`
- **`Manual steps you need to complete`** — required, in this position, never further down
- `Source -> Wix targets`
- `Plugin coverage` (when the source reported plugins): one line per capability that is not
  `migration-planned · confirmed`, in the user's terms, plus anything they must supply or
  accept losing
- `URL preservation`
- `Main gaps / lossiness`
- `Important setup implications`
- `Questions or risks to confirm`

Do not restate full field tables or detailed transformation rules here unless a specific
field-level issue is central to the approval decision.

## The manual-steps section

The user can otherwise approve a migration without understanding what they still have to do
themselves. Payment setup, a domain/DNS cutover, add-on work, app installs and permissions
are scattered across setup notes, gaps and per-entity runbooks — or missing altogether. This
section is the single consolidated list, and it is **not** optional.

Write it as a **numbered checklist**, each item carrying:

- a clear **action title** and short instructions — what to do and where to do it
- **who must act**, when that is someone other than the user
- any **prerequisite**
- **what stays unavailable until it is done**
- **when it is needed**, which is also the sort order: before import → before launch →
  optional follow-up

Mark an item optional only when skipping it genuinely is acceptable. Necessary redirect work
is not optional by default.

**Where the items come from.** Gather from the plan and the mapping inputs already in hand —
`manualSteps` on target entities, `setupRequirements`, `reconfigure-in-wix` hints in
`no-migration-needed.json`, actionable rows in the faithfulness ledger, and known
domain/launch requirements. Notification, consent and redirect follow-up belong here when it
is known at mapping time and needs the user to act.

**Coverage prompts, not a checklist to copy.** Include only work actually still needed for
this source, destination and plan:

| Manual action | What the user needs to know |
| --- | --- |
| Set up payments | Connect and activate the payment provider in Wix before taking payments. Payment setup is currently manual. |
| Connect the domain / change DNS | Follow the destination's domain-connection instructions at the domain provider when ready to switch the live site. Say that this changes where visitors go — never present it as an immediate pre-import task. |
| Finish product add-ons | Name the actual add-on behaviour that stays manual, the affected products or groups, and the agreed work to make it available. "Configure the add-on plugin" alone is not an instruction. |
| Complete other required setup | Applicable app installs, permission scopes, plans, CMS collections, sales-channel connections and other reconfiguration found during mapping. |

Where an action's details are not yet known, say what must be confirmed. Never invent a
setting, a screen or a step.

**Keep every step of an existing runbook.** A `manual-mapping` entity's `manualSteps.steps[]`
is carried in full under its checklist item — `prerequisite` as its own "before you start"
line, `mechanism` as "how it behaves once connected". A compressed runbook is not actionable.
List a shared setup action **once**, naming every capability it covers.

**Manual actions are not unresolved gaps.** A known manual procedure belongs here. An
unsupported feature, or an approach nobody has agreed yet, stays in the gaps/questions
section until there is an agreed action — detecting a plugin does not prove its behaviour can
be recreated by hand in Wix. If it needs development, say so in the gaps section; list a
manual workaround only once it is agreed. A gap that does have an actionable workaround may
link to its checklist item.

**Check the list before the summary goes to the user.** Reconcile it against the mapping plan,
the manual runbooks, `setupRequirements`, the actionable gaps and the known launch
requirements. Work the agent will perform automatically is **not** a user task and must not
appear. Refresh the section whenever the mapping changes.

**An empty list still gets the heading**, followed by exactly: `No manual steps identified for
this mapping.` A summary that omits the section, or leaves a known manual action only in
scattered setup or gap notes, fails review.

## Mapping review checkpoint

Once both mapping artifacts exist, reset `orchestration/approvals.json` so
`mapping.status=pending`, then stop and ask the user to review
`migrations/<project>/mapping/review/mapping-summary.md`. The checkpoint should make clear:

- this is a semantic review of what will be migrated where
- the full technical detail remains in `mapping/review/mapping-plan.md`
- **what the user will still have to do by hand**, pointing at the summary's
  `Manual steps you need to complete` section
- downstream setup discovery and code generation will wait for acceptance

**Before presenting the checkpoint, run `scripts/coverage-reconcile.js check <project>`** and
resolve every failure it names; do not ask for approval of a plan it rejects.

**Before presenting the checkpoint, run the manual-steps coverage check** described in "The
manual-steps section": the section exists, every applicable manual action from the plan, the
runbooks, `setupRequirements` and the actionable gaps appears in it, nothing the agent
automates appears in it, and an empty set carries the explicit empty statement. A summary
presented for approval without that section is not ready for review, and this applies in
`1-click mode` too — the checkpoint is recorded as agent-accepted there, but the section is
still written.

Do not proceed to `rp-setup-discovery` or `rp-import-codegen` until the user accepts this
mapping review checkpoint, unless the user explicitly asks to continue provisionally. In
explicit user-requested `1-click mode` (`automationMode=one_click`, `source=user`), still
write the same review artifacts, but record the checkpoint as accepted by the agent and
continue immediately. A missing mode or a non-user-authored `one_click` value is normal
interactive mode and must pause here; file upload does not imply one-click.

## Guardrails

- Do not collapse multiple source concepts into one Wix field without documenting lossiness.
- Call out data that cannot be migrated faithfully — record it in the faithfulness ledger above.
- Do not describe a source entity only by a generic label when the observed data is more
  specific; name the concrete subtype(s) present in the project.
- Keep business rules explicit so `rp-import-codegen` can implement them deterministically.
- Do not guess Wix field, enum, or app names when you cannot verify them. Mark them
  `unverified` and surface the risk before execution.

When structure-bridge planning discovers a new native/plugin entity in a revised plan,
its fields remain `fieldMappingStatus:pending`, with empty inspected paths/decisions and
explicit uninspected inventory evidence. It produces an open field-inventory gap and defers
that entity/dependents. Mapper sets `fieldMappingStatus:resolved` only after replacing that
unknown inventory with exact inspected decisions; it never relabels native work as manual.
A bounded sample is not a reason to leave it pending: before the checkpoint, run the full
read (`rp-source-wordpress/PLUGIN-READ-PLANS.md`, "Read in full before the mapping
checkpoint") whatever the entity's size, then map from the complete output. It stays pending
only when that read failed, and then its gap cites the typed extraction code. Never add
"Requires Import Operator" to a gap yourself; that handoff comes only from the extraction
deferral record.
Re-running the authority regenerates this pending projection without inventing coverage.

Source and intended disposition rows retain the affected scope of their contributing
field decisions, including measured counts, bounded/complete IDs and all binding digests.
Every decision sharing a source or intended path declares its own scope: an absent scope
is unknown and cannot inherit a measured scope from another contributor.
Never substitute entity-level counts. Multiple decisions contributing to one coverage row
must agree after scope normalization; conflicting scopes return to mapper for explicit
reconciliation before authority persistence. Unknown decision coverage remains unknown.

Existing mapper QA calls `compareMappingProjections(projectDir, plan)` from the shared contract helper and rejects missing/conflicting entity or disposition projections. This is a check inside that QA pass, with no additional stage or CLI.

## Discovered-set review and legacy approvals

Before presenting a standard-mode mapping review, run `node scripts/discovered-census.js build <projectDir>` and `node scripts/census-reconciliation.js build <projectDir>`. Fix structural errors only for the named census IDs. Each discovered entity, registered sub-part, capability and unlinked plugin needs exactly one assignment: plan `censusIds[]` or a gap `censusId` plus `disposition`. A parent entity never silently covers its sub-parts. An excluded gap's `count` must equal the census's measured `recordCount` (`excluded_count_mismatch`), or be `null`; where the census has no measurement, a stated count is shown as unmeasured. Show the generated **Discovered set** section, including its unknown counts, exclusions and pending questions. Ask the owner each pending question; record answers as closed states, rebuild, and present that rebuilt review. Approving this review approves the listed exclusions; provisional and explicit 1-click agent approvals do not establish owner approval of exclusions.

The mapping approval user action must reference `{ "kind": "census-reconciliation", "path": "mapping/review/census-reconciliation.json", "sha256": "<current file SHA-256>" }` along with the summary. Let the approval scripts bind and persist the reference; never write a digest or approval directly. A stale answer must produce a fresh request. In explicit 1-click mode use `auto-approve`, leave cannot-tell rows pending, and report them as not decided after import. A run that started in user-chosen 1-click never asks pending questions mid-run, even after the mode changes or an owner joins to approve: record the approval with those rows still pending (the binder allows it), and the discovered-set status lists each as a not-decided cutover task.

For `mapping_approval_missing_census` or `mapping_approval_stale_census`, reset with `node scripts/orchestration-state.js approve --project-dir <projectDir> --type mapping --status pending`, rebuild from the existing discovery files, and present again. Explain once that this fresh review accounts for the complete discovered set; do not rerun discovery or imported records.

**When the router returns `reviewOnly: true`, the site must not change.** Keep the plan, gap list and `decisions.json` frozen, including on rejection; never run `coverage-reconcile.js decide`. Write assignments only in `mapping/review/finalized-census-assignments.json` (`planLinks` names existing plan rows; `gaps` names new decisions), then rebuild the census/reconciliation and approve through the normal scripts. A request to import newly discovered scope is `pending` with `reasonCode: import-after-finalization`; it stays open for a separate human decision and performs no import. Do not create a new plan version. Any `review_only_*` or `finalized_receipt_unverified` hold requires the Import Operator to inspect the named input; never route around it.

When a human explicitly selects a provisional subset, pass that selection to
`writeMappingAuthority` as `provisionalEntityRefs`; the authority retains it in
`executionScope.provisionalEntityRefs`. Contract preparation may reuse that recorded selection.
Calculated `resolvedEntityRefs` are never evidence that a human chose a subset. Older plans
without the selection record require a fresh explicit choice to retain provisional execution;
keep ordinary interactive checkpoint deferrals while waiting for that choice.

## Public multilingual sidecar

Keep additional-locale values out of default mapping and writer payloads. Capture the default
request/order/verification artifact digests with `scripts/multilingual-default-invariance.js`,
then verify those same files after building the sidecar. After the normal import has produced
stable target identities, run `scripts/multilingual-public-plan.js`. It joins public content,
writer-produced object and member pairings, the exhaustive Wix capability manifest, live
translation state, and prior verified destination recovery rows into
`mapping/multilingual-public-plan.ndjson`. Every field, including a field directly on an object,
needs a verified source-to-Wix object receipt; nested fields additionally need the member receipt.
Display text, source IDs, and array position are never substitute target identities. Every source
row becomes a writable plan row or a named gap; frontend and private-source fields remain explicit
deferred rows.
