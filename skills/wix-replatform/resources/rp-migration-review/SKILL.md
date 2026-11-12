---
name: rp-migration-review
description: Publish and guide the local Migration review after import without implementing Move to Wix.
---

# Migration review

Use this resource only after backend completion artifacts are available. It owns the first
post-import preparation step. It does not execute source catch-up, DNS, notifications,
payments, or any Move to Wix policy.

Resolve `<project>` through the parent `wix-replatform` skill. Run the deterministic interface
from that installed skill directory:

```bash
node scripts/migration-review.js <operation> <absolute-project-path> ...
```

Never edit files in `<project>/migration-review/` directly. Mutations require a request JSON
file containing `contractVersion: "migration-review/1"`, one stable `requestId`, the bound
`migrationId`, and `expectedStateVersion`. Treat `state_conflict`, `stale_scope`,
`stale_task`, `lock_held`, and evidence-integrity failures as named recovery work: re-read,
inspect the relevant current artifacts, and retry with a new request only when the evidence
supports it. Never steal a lock based on age.

## Publish after import

1. Initialize using the existing orchestration project/source and `config/wix.env` binding;
   the interface derives the identity when only `contractVersion` is supplied. Reuse the
   returned identity for every mutation. A mismatch means the wrong project; do not reset it.
2. Reuse the actual importer execution and publishing `producerId`; register it only if
   absent, preserving its assessed record/capability scopes and `executionKind: import`.
   Do not reclassify an existing execution or label a real import as an isolated probe.
   Read its retained boundaries with
   `check-execution --execution-id <actual-execution-id>`. Missing before-write or write-outcome
   captures are named incomplete evidence, never reconstructed as earlier observations from
   post-import summaries. This read checks retained captures; it does not prove target behavior.
   Interpret `missing[]` by its named scope: a deferred scope with no target write must not
   make a resolved scope's complete boundaries appear missing. Keep the deferred scope's
   actual mapping observation, incomplete coverage and open tasks; never invent its write
   outcome or a passed check. A mixed attempt remains incomplete overall.
3. Capture all five evidence categories through `capture-evidence`: accepted source scope,
   mapping/fidelity, execution/recovery, setup/plugin capability, and explanations/checks.
   Use durable extraction, mapping, setup, attempt, crosswalk, verification and recovery
   artifacts. Source-scope captures name accepted capability scopes in `acceptedScopes`,
   separately from accepted record IDs. Existing summary files are optional evidence, never a completeness dependency.
4. For a revised `fieldContractVersion:1` mapping plan, first use the
   [exact mapping publication recipe](mapping-publication.md) under the actual importer’s
   canonical producer/execution. It consumes original committed mapping captures, publishes
   each mapping scope separately and reads report/overview back. Do not register a review-chat
   replacement owner or reconstruct missing import boundaries. All-deferred/no-importer
   attempts retain current ledger/handoff facts and explicitly report publication unavailable.
   Then publish each producer's remaining assessed scope. Omitted or unavailable evidence is explicit
   `coverage.status: incomplete` with named `unknownAreas` and an investigation task. A created
   record with changed or unsupported behavior remains a fidelity result/task.
   Every task declares `requirement: required|optional`. A verified machine task names a
   committed check capture matching its finding key and material fingerprint. Closing a
   repaired finding requires explicit evidence-backed `applicabilityChanges`; omission
   preserves it. Coverage is tracked per producer/scope and requires all five categories.
   Import coverage additionally requires genuine before-write and write-outcome captures in
   the publication for each assessed scope. Missing phases remain named investigations even
   after five-category backfill; a newer import cannot inherit its predecessor's publication.
   Registered and explicitly accepted scopes without publication remain visible investigations;
   omitting them cannot produce complete coverage. Repairs must recapture all five categories
   for each scope they publish; unrelated scope evidence is retained.
   When assessed scopes have different coverage, publish them separately using the same
   execution and canonical producer. `coverage.status` applies to every scope in one request;
   an incomplete deferred scope must not downgrade unrelated complete coverage.
   Tasks use `affectedCount: null` for unmeasured populations and a measured nonnegative
   count for known populations. An affected-ID preview may be shorter than that count.
   Do not replace an unknown count with zero or a population count with preview length.
5. Read `report` and `overview` back before saying publication succeeded. The store merges
   partial repairs and retains unrelated findings/actions; never submit an unscoped complete
   replacement.

If required capture fails during a generated import, stop further writes through the existing
recovery rules. An uncertain accepted write requires target read-back before retry. Do not
fabricate review evidence from chat memory or prose.
The importer capture queue waits at most two seconds for another local mutation, then fails
without taking over its lock. Chat publication/actions retain strict versions and no automatic
retry. Only supported destination-bound Wix dashboard/editor links should be presented.

## First chat response

Run `overview`. In the first response, identify the bound destination and evidence coverage,
then enumerate every current open/needs-review task once under **Data**, **Manual**, and
**Plugins** with its concise explanation, affected count (or Count unknown), and dependencies.
Show open, needs-review, resolved and dismissed totals and say the next overall step is
**Move to Wix — integration deferred**. Only after the complete inventory,
recommend `recommendedTaskId`. Operators may select any task; a waiting task does not block
reading or working on another task.

`Show tasks` always reruns `overview` or paged `tasks` against current state. Record pagination
may shorten affected-record details, never the task inventory or group totals.

For a selected task, run `task --task-id ...` and present one concrete issue/action, affected
scope, consequence, prerequisites, verification kind, and the exact bound destination link.
Opening/copying a link changes nothing.

## Actions and help

- **Done / Resolve:** use `record-action` with the current task material fingerprint. Manual
  work is labelled operator-confirmed. A machine-required task resolves only when its current
  evidence is verified; never downgrade a failed checker to manual success.
- **Dismiss:** state the consequence and require the task's exact current acknowledgment, then
  persist it. Dismissal changes disposition, not coverage or historical outcomes.
- **Later:** validate the current task/version without writing an event. Confirm its current disposition and show current totals
  plus how to return to the complete list.
- **Help:** this chat already runs in the Import Operator's migration environment. Inspect the
  referenced local artifacts and perform supported recovery within existing authorization.
  Do not show that operator a prompt to send to themselves. If the migration folder, source
  account, credential, or external system is unavailable, name that exact dependency and the
  access needed; do not claim the investigation ran.

After every saved action, read the task/report back before claiming success. A new chat using
the same project folder resumes from `overview`; a copied folder on another machine is not a
synchronized store.

## Handoff boundary

Run `prepare-handoff` only after rereading current state. The immutable recap preserves
identity/version, evidence scope and unknown areas, all task dispositions, unresolved work,
and accepted consequences. This operation requires a stable request ID, binding and observed
state version; it commits the recap under the same lock as other mutations. Read it back with
`handoff`. Its consumer has `status: deferred`; it contains no `readyForMove` claim and changes
no move state. Tell the operator that Move to Wix integration remains deferred.
