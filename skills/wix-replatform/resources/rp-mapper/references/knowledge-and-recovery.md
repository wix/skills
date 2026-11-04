# Knowledge, temporary deferral and repair

When setup produces a reference absent from bundled knowledge, map its read-back as well.
The setup step's `referenceKeys[]` names the `ref`, `sourceStableKey`, and emitted `paths`.
Add `readBack: {identityPath, values, evidence}`: exact paths in the actual read response,
a `values` map from each emitted path to its response path, and pinned authoritative schema
evidence with a revision. The operation assessment must cover those emitted paths. Setup
captures one unambiguous identity from its own real read response; missing, stale or conflicting
evidence keeps setup pending. Codegen implements this mapper-authored binding.
For a reference with an existing reviewed setup read-back binding, retain that binding;
do not add a local replacement.

Apply shared mapping rules whose source/schema/semantic applicability matches this run.
For uncovered cases, inspect the source values locally and authoritative target definitions;
decide the exact operation, paths, transform, absence handling and reference policy. Record
the evidence and mapper-authored examples in the existing mapping authority. This includes
custom fields. Never infer that a missing knowledge entry means the API cannot do it.
A missing writer is a separate implementation requirement; choose its semantics here before
codegen implements a supported writer. Known constraints remain binding.

For a missing operation contract, add `operationAssessments[]` to `mapping/mapping-plan.json`.
Each entry contains `targetRef`, `operation`,
`coverage: {sourceScopes:[{sourceEntityRef,sourceSnapshotDigest,inventoryDigest}], complete:true, referencePaths:[...]}`
with exactly one current scope for every source entity mapping to that target, and `contract` in the existing operation-contract shape,
optional `dependencyModes`, `evidence`, and nonempty `examples: [{id,input,expected}]`.
Use each row's canonical source entity reference; multiple collections targeting the same
entity share one operation assessment with separate source scopes. Legacy top-level digest
pairs remain accepted only for a single source. Existing bundled dependency entries are
closed: local assessments cannot add flags or change any of their keys.
Each evidence entry is `{artifact,sha256,kind,revision}`: a project-relative pinned local
file, its SHA-256, evidence kind and revision. At least one must be `authoritative-schema`.
Declare every examined reference; retain guarded paths even when planning not to write them.
Record the explicit investigation boundary in coverage. Check examples independently against
the schema. Do not use examples authored by codegen as the mapping decision.

`lib/operation-assessments.js` supplies the same effective contract to preflight, census,
codegen and execution. It rejects stale evidence and conflicts with bundled constraints.
It does not edit shared knowledge. Compute proof digests with the project-aware
`dependency-preflight.js --project-dir <dir> --contract-digest <ref> <operation>` command
after saving the assessment. Keep normal capability, ownership, approval and verification gates.

A setup producer can also be evidenced by `setupRequirements` without a bundled flag.
Name its `id`, produced `entityRefs` and pinned `evidence`. For `create-cms-collections`,
include concrete `collections` with fields and permissions. A generic registered setup
writer additionally needs `intent.writerId` and `intent.readWriterId`. Unsupported assertions
do not count as producers. `pending-setup` still requires the actual step and a verified
receipt before execution; an import and setup cannot both own the same target.

When a field's meaning remains uncertain, use `disposition: deferred-field` only if omission
is valid for the selected create operation, does not change material behavior, original
values and full membership can be retained, and a supported mutable correction exists.
Do not emit outputs or `omittedOutputs` for this decision. Keep its source paths, reason,
evidence and complete measured `affectedScope` with string source IDs. Record `nextAction`
with `role: Import Operator`, `cta`, `requiresImportOperator: true` and an executable `prompt`.

The decision's `recovery` contains:

- `scope: field`, `source`, `membership`, `sourceIdPath`, `sourceSnapshotDigest`, `inventoryDigest`, `evidence`.
- `source` pins the retained NDJSON; `membership` pins a JSON array of
  `{sourceId,sourceStableKey}`. Full identity and original values must survive; a count alone
  does not authorize continuation. Values remain local, outside reports and telemetry.
- `createWithoutField: {optional:true,noMaterialBehaviorChange:true,reason,targetRef,operation,writeInput,paths}`
  names the exact withheld create fields and checked eligibility.
- `correction: {mutable:true,targetRef,operation,writeInput,paths}` names the supported later
  update fields. Pin authoritative schema evidence for both operations.

Required/immutable fields, unsafe financial/consent/notification behavior or an unavailable
correction path hold the affected records. For measured record holds use `unresolved` with
`recovery.scope: record`, the same source/membership/identity/evidence bindings and actionable
handoff. Do not claim optionality. Unknown membership holds the entity until investigated.
Set `recoveryPolicyVersion: 1` on a newly reviewed plan to retain independent resolved scope
and admit measured record holds; existing approval requirements still apply. Generate held
builder results for those exact records. Required dependent records wait through the normal
dependency gate; never fabricate a required field to make them writable.

Persist through `writeMappingAuthority` before transport. It creates the existing stable
`gapKind: unresolved` entries in `mapping/review/mapping-gaps.json`; this is no new queue.
Deferred fields remain deferred in source and intended-field accounting. Normal read-back
checks written fields; deferred fields are not exclusions, verified values, or accepted loss.
Never delete pinned source/membership/evidence while their gaps remain open. If retention
policy prohibits a value, retain only the permitted diagnostic and hold the work.

A later explanation returns here: revise the exact decision, preserve/supersede stable IDs,
and refresh approval bindings before codegen builds repair code. Mapping revision alone
cannot close a gap. The existing journal/crosswalk supplies identity; uncertain writes need
reconciliation. The original importer creates never-created records once. Field repair updates
the existing parent, compares current target values with the last verified state and verifies
read-back. Conflicting user edits require a new decision. Close only verified membership;
storage success cannot resolve a separate missing-behavior consequence.
Verified repairs bind the specific decision and source scope, so unrelated mapping edits
do not reopen them. Changed semantics or source scope require fresh verification.

Completion and the migration handoff retain actionable pending items with **Requires Import
Operator**, prerequisites and a prompt usable from the original migration environment.
Landed, not-yet-imported and uncertain records are distinguished; several field gaps count
the same record once. Pending work cannot make completion or launch readiness green.
When no importer can publish a Data task, preserve the existing structured fallback and
report publication unavailable; do not fabricate an execution owner.

Record successful novel mappings and unresolved findings through the telemetry recorder's
bounded `knowledge_observation` payload. Shared knowledge is improved through later review,
never automatically from an observation. Telemetry failure does not block an import or erase
its local gap. Never transmit values, custom keys, customer IDs or evidence file contents.
For a newly investigated exact field decision, set `knowledgeFinding: missing-knowledge`
(or the applicable controlled finding class). The authority writer records resolved outcomes
for those decisions as well as operation assessments; unchanged decisions are not re-emitted.
