# Project-local plugin entity plans

Use this path when a selected WordPress plugin entity has no complete supported REST
reader. A permanent plugin profile is optional. Do not install source code, edit this skill
bundle, or invent a table/relationship to make discovery pass. Use actual schema, plugin
storage documentation/source and bounded samples. Existing table restrictions, credential
selection, secret filtering, mapping approval and confidentiality rules remain binding.

## Prepare once in discovery

Prefer a complete supported REST route. An owner-provided export is still an explicit
owner action. Otherwise reuse verified profile knowledge or investigate storage once per
unfamiliar plugin; cache schemas and valid plans within the project. No model work per row.

Use `lib/plugin-entity-read-plan.js`:

1. `sourceEntityRef(pluginSlug, entityKey)` returns `plugin.<inventory-slug>.<entity-key>`.
   Persist this identity across coverage, source schema, mapping and deferred records.
2. Save schema/storage evidence and exact requests under the project's
   `data/wp-discovery/` with `writeJson(projectDir, path, value)`. It returns `{path,sha256}`.
   Paths must stay inside the project; absolute, traversal and symlink paths are refused.
3. Author the plan from evidence, using the shape below. `writePluginEntityReadPlan({
   projectDir, plan, sourceEntity, siteBaseUrl })` validates it and returns the binding.
   It sets `sourceEntity.sourceMeta.extractionPlan` and updates an existing
   `source-schema.json` (object or array entities). When canonical synthesis has not yet
   happened, carry that exact reference into it. Never infer filenames from table labels.
4. Run the bounded samples through the same declared assembly. Inspect identity,
   required relationships and fields before treating the plan as prepared. Preview
   samples do not prove complete extraction. Preserve missing coverage and target decisions.
5. If no valid recipe can be produced, call `recordPluginExtractionDeferral` with the
   canonical reference, typed code and precise reason. It works without a table or plan.
   Keep that entity in scope; an identical discovery rerun is not a remedy for missing
   producer support. Do not substitute empty output or fictitious business records.

Required plan members:

| Member | Meaning |
| --- | --- |
| `schemaVersion` | `1` |
| `sourceEntityRef` | Stable inventory-derived reference |
| `sourceIdentity` | Credential-free base URL from `sourceIdentity(siteBaseUrl)`; retain subdirectory |
| `evidenceRefs` | Nonempty array of persisted storage/schema `{path,sha256}` references |
| `components` | One root and optional direct children, with distinct token `id`, physical bare `table`, `variant`, `schema`, `readArtifacts`, `scope` |
| `components[].schema` | Actual `{table,columns,eavPair?}` schema evidence |
| `components[].readArtifacts` | `{structureRequest: reference}` or `{eavReadPlan: reference}`; EAV key-name requests are insufficient |
| `components[].scope` | `{where: [...]}`; a child adds `parent: {component: rootId, column: childForeignKey, parentColumn: rootIdColumn}` |
| `assembly` | Explicit identity and relationship/cardinality configuration below |
| `cost` | Preparation/query/page estimates, with unknown values recorded as null |

`variant` is `single-request` or `eav`. Use the shared client `discoverEavKeys` and
`buildEavReadPlan` with the same optional `scope` predicates for key discovery, counts and
value requests. Keep complete keys/identity, existing server limits and request integrity.
For a parent-scoped child, the retained sample EAV plan is the recipe evidence; full
extraction discovers/materializes keys only for the completed root's IDs in chunks of
`MAX_IN_VALUES`. It pins up to `MAX_PINNED_KEYS` per value request and pages all streams.
Zero parents means zero child calls. No unrestricted read followed by local filtering.

## Assembly

For one row per logical record use `{kind:'identity', identityColumn:'<source-id>'}`.
For a standalone EAV stream use `kind:'eav-pivot-v1'` with `identityColumn`, `keyColumn`,
`valueColumn`, and `keys: { '<verified-key>': 'scalar' | 'array' }`.

For a root plus metadata children use `kind:'eav-pivot-v1'`, the root `identityColumn`, and
`children: [{component, foreignKey, keyColumn, valueColumn, keys, required, outputField?}]`.
Name every child once. Required missing children, orphan relations, missing identity and
duplicate scalar keys defer the entity; repeated values remain arrays in retained order.
Unknown/new keys require renewed storage/schema preparation rather than omission.

Use `kind:'module'` only for another verified one-level relationship. Include
`identityColumn`, `module:{path,sha256}` under `src/extract/` or `src/lib/`, and `export`.
The exported synchronous function takes `{components:{componentId:records[]}}` and returns
logical records. Test it with invented values and source samples before full use. Its code
digest is part of readiness/freshness. Deeper graphs require explicit additional support;
do not flatten or silently omit them.

## Extract and import

`extractBoundPluginEntity({projectDir,sourceEntityRef,planRef,transport,restart?})` uses the
existing shared reader for every component. It preserves pagination, checkpoints, frozen
counts and complete-identity checks; a failed component leaves the logical entity deferred.
Only a reconciled full output and current entity/component manifests authorize import.
`sample:true` returns a preview without full-reader calls or artifact/status changes.

Generate bridge dispatch with the committed `lib/generated-plugin-handoff.js` emitter.
It owns `src/import/plugin-handoff.js` and the thin importer/extractor entrypoints. It
refuses to overwrite any existing non-template entrypoint, checking all destinations
before writing. Before deliberately replacing an existing entrypoint, adapt its implementation
into `src/project/plugin-runtime.js`, preserving its heartbeat, self-check, ledger, selectors
and target dependency order. The adapter exports:

- `describeImport()`: pure declaration from the retained importer's actual configuration,
  including its run-ID source, supported selection modes and actual ledger paths. The
  wrapper never manufactures these capabilities. Also include `entityOrder`, listing every
  planned canonical entity reference exactly once in the existing target dependency order.
  The wrapper preserves this ordering and topologically orders source prerequisites;
  missing references, cycles or a conflict with the declared target order fail before hooks/writes. This does not add the separate
  target-parent readiness gate.
- `sourceTransport({entity,projectDir,siteBaseUrl})`: same authenticated shared HTTP bridge
  transport and telemetry callback discovery used; load secrets from the configured source.
- `preview(entity)`: retained discovery samples only, or null. Never fetch full data here.
- `extractNative({entity,selection,projectDir})`: existing supported native extraction.
- `preflight({entities,selection,projectDir,runId})`: existing run-scoped authorization/setup/mute
  checks, once before the first ready write; throw on refusal. Do not replace them with a
  fixed successful response.
- `importEntity({entity,selection,projectDir,dryRun})`: existing target writer, record
  selectors, ledger, idempotency and recovery. Honour `dryRun` and every selection flag;
  the wrapper's source-readiness gate grants no target permission or omission approval.
- `finalizeImport({results,selection,projectDir,runId,deferredExtraction})`: retain existing
  per-run recovery/completion publication, merging `deferredExtraction.operatorActions`
  and `statuses` with the real journal-backed outcomes. It runs once even when all selected
  plugin entities are held. A local finalization error never rewrites target receipts as
  rejected creates.
- `afterExtraction({results,selection,projectDir,runId})`: file accumulated source-read
  telemetry once after the read pass, including deferred reads. Telemetry failure must not
  discard extraction evidence.

Full generated extraction covers mapped scopes and their source prerequisites; an excluded
discovery entity does not become an extraction task. Only mapped target scopes dispatch
for import, under existing mapping approval. One process run ID is supplied to adapter hooks. The
guard checks the selected bridge entities and transitive source prerequisites once per
entity/pass before target hooks run. Loading the adapter and calling its descriptor must
have no side effects. Its descriptor is validated both on `--describe` and normal startup. Native-only unrelated reruns gain no extraction gate.
Record filters apply after entity readiness, so missing extraction files cannot erase scope.

The external verifier checks exact emitted wiring and helper bytes before `--describe`.
Pass the same selection after `--`, for example `-- --entity <entity> --failed-only`.
Unsupported wiring returns to codegen. Missing/stale preparation becomes a typed entity
deferral. No skip flag, default query, alias probing or dynamic dispatch workaround.

## Deferred handoff and cost

Use the existing `<entity>.deferred.json`, `collectDeferredExtractions` and
`deferredExtractionReportInput` completion integration. Codes `plan-unavailable`,
`plan-invalid` and `assembly-failed` retain different producer repairs. Import readiness
preserves an open extraction task for the current plan, including its restart policy.
Otherwise missing/stale full evidence produces `full-extraction-unavailable` or
`full-extraction-stale`, with a full-extraction action and project-relative diagnostics.
Unknown tables/counts
stay unknown. **Requires Import Operator** prompts name source access, timing and complete
full-manifest resolution. Shared Cutover UI integration remains pending.

Measure preparation tokens/time separately from source requests/bytes and elapsed I/O.
Each dispatched key-discovery/value query costs at least one page; multiply value pages
by parent chunks and key batches. Reuse current plans and shared assemblers. Never claim a
synthetic transport timing measures live latency or agent storage-research cost.
