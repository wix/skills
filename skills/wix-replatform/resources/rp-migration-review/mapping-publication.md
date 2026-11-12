# Publish exact mapping findings

Use this recipe inside the existing post-import Migration review publication step when
`mapping/mapping-plan.json` declares `fieldContractVersion:1`. Reuse the actual importer’s
canonical producer, execution, project/site binding and pinned mapping plan digest; a
review chat does not register a replacement execution. Read actual boundaries before
post-import enrichment and interpret missing boundaries by scope. No chat publication
runs during the import. Post-import publication is allowed.

```javascript
const { publishMappingReview } = require('./lib/migration-review-mapping.js');
const published = await publishMappingReview({
  projectDir, producerId, executionId, migrationId,
  mappingPlanDigest: importerPinnedMappingPlanDigest,
  assessedSourceEntityRefs: importerAssessedSourceEntities,
  repairOf: importerRepairOf, // repair executions only
}, { captureIds: actualCommittedCaptureIds, completionReportDigest });
```

Use committed captures from that exact execution, including the importer’s original
mapping before-write and outcome boundaries. Post-import setup/check observations get
their real phase/time; they cannot replace a missing boundary. The adapter checks stored
`executionKind:import`, owner and current authority/ledger binding, publishes each scope
separately and reads report/overview back. Deferred scopes stay incomplete with explicit
missing categories/boundaries and open Data tasks; complete resolved scopes retain their
own coverage. Supply all five observed categories for complete assessed scope; never
manufacture an observation or passed check.

Storage/setup facets remain machine-required. Only a current committed
`explanations_checks` proof matching finding key, material fingerprint, scope, check ID
and observation time can verify one. Include that existing check’s artifact digests in
its capture. The existing check producer owns those artifact references and digests;
this adapter matches committed check metadata and does not independently read/hash check
artifacts. A proof without artifact digests does not satisfy the producer contract even
if its check metadata matches. Storage verification leaves the manual native-behavior facet open. A passed check cannot
decide an unresolved mapping or approve an omission; decision tasks require an explicit
mapper resolution and matching disposition under the existing approval policy. Omission
never closes a task: recovery publishes explicit matching committed dispositions;
supersession additionally names a published successor and ledger supersession link.
Changed affected scope invalidates the prior action even when preview IDs are unchanged.

After the mapper resolves a pending decision, the **Import Operator** owns closing its
historical task. Reopen/remap through the existing flow, verify the current authoritative
decision and its required source evidence/approval, then use the canonical importer's
explicit repair execution and shared capture queue to commit an `explanations_checks`
capture with `phase:recovery`. Put the historical task's exact `findingKey` and
`materialFingerprint`, `status:not_applicable`, and the evidence-backed `reason` in
`evidence.dispositions[]`; include the current mapping/ledger/source-scope bindings and
reference the resolved decision and its evidence. Read the task from the retained report,
not an inferred new fingerprint. Publish that capture under the same scope and read back
the reconciled task. A measured-zero result alone does not close the previous decision
facet. Native replacements and supersession still require their own matching evidence;
no disposition substitutes for a populated omission's human authorization.

For all-deferred/no-importer attempts pass no execution ID. The adapter returns
`status:unavailable`, reason `no-importer-execution`, and the current ledger/authority
artifact names. `writeMappingAuthority` persists a structured `reviewPublication` block
in the existing `mapping/review/mapping-summary.md` and `mapping-plan.md`; the fallback
publication call refreshes those same reports from validated current authority/ledger.
It binds both digests, deferred entities and a **Requires Import Operator** recovery CTA.
`website-handoff.js` projects the same facts into `mappingSummary.reviewPublication` in
the existing website and post-execution handoffs and renders the unavailable notice. No
completion report, counters or importer execution are fabricated. A remap with resolved
automatic scope removes this unavailable block; actual publication then requires its real
execution owner. Show those current facts and explicitly say current-run publication is unavailable;
neither an earlier review report nor an empty task list is current success.

Missing/stale authority, ledger, binding, execution or capture raises a named recovery
error. A ledger change after import requires an explicit repair execution and current
captures; creating a fresh adapter does not erase that mismatch. Any outcome evidence
change at the same checkpoint ordinal is rejected before capture; re-capture with a new
ordinal. A missing/unreadable outcome artifact raises `mapping_outcome_required` with the
underlying error retained as its cause. Preserve existing reports/ledgers; investigate through the Import Operator’s existing
mapping/recovery flow. Do not claim publication success or reopen target writes from a
failed publication. Legacy plans stay under their existing review path until explicitly
remapped.
