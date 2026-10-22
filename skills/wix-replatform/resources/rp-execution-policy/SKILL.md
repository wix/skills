---
name: rp-execution-policy
description: >-
  Applies cross-stage execution safety policy and writes the aggregate migration completion
  artifact after all delivery-specific terminal evidence validates.
---

# rp-execution-policy

Use this resource for the execution approval gate and aggregate finalization.

For `awaiting_execution_approval`, present the generated execution plan, wait for the
required user acceptance in normal mode, and persist it in `orchestration/approvals.json`.
In explicit user-requested 1-click mode (`automationMode=one_click`, `source=user`), use the
deterministic agent approval helper only after the plan and any required code-safety review
validate. Then route again. A non-user-authored `one_click` value is normal interactive mode
and must wait for user acceptance.

## Disclosing what was read from a credential-bearing source surface

If the run read payment-gateway configuration from the source, the plan presented at the
approval gate must say so: that gateway configuration was read, which gateways were found, how
many are enabled, how many credential fields are configured, and that **no credential value was
retained**. The source adapter produces that line — for WordPress, `describeGatewaySummary()` in
`rp-source-wordpress/lib/gateway-summary.mjs`.

A run that reports "N gateways, M enabled, K credential fields present, 0 values retained" is
auditable. One that read the same thing silently is not, and the user approving the plan has no
way to tell the two apart. Never put a credential value, prefix, length or hash into the plan
report itself.

## Reporting the payments section of the plan

If the run imports payment records, refunds or invoice documents, build that section of the plan
with `lib/payments-report.js` rather than by hand. It enforces three things a hand-written summary
has got wrong before, and it BLOCKS the approval gate rather than printing a caveat:

- **The payment outcomes must sum to the discovered source-order population.** A report whose
  numbers do not add up is hiding orders. The builder returns `approvable: false` with the
  shortfall named.
- **Zero is a result.** Every outcome and every count is emitted even at zero, so "0 refunds
  found" is reviewable at a glance. An implausible number is cheapest to catch here.
- **Candidate coverage is not writable coverage.** Orders carrying a reference-shaped value and
  orders whose reference can be defensibly attributed are separate lines. Collapsing them
  overstates fidelity.

The denominator must come from the run's own reconciled reads (`from: 'run-reconciled-read'`), not
from a prior survey. Where a survey counted differently, both numbers are shown and the
discrepancy must be reconciled before the pilot.

The provider inventory carries identifier, display name and enabled state only — a
credential-shaped field on a provider blocks the gate. The phrase "you will lose your history" is
prohibited: it is false for payment records, which are provider-independent.

Run:

```bash
node skills/wix-replatform/scripts/migration-completion.js <projectDir>
```

This command validates backend completion accounting and, for website delivery, the
frontend completion receipt. It writes `completion/migration-completion.json` atomically.

It also refuses, on **both** delivery modes, unless the run produced its post-execution
handoff and its execution log. A `management` run produces no website and used to require no
handoff at all, which is how a backend-only migration could finalize with no account of itself
anywhere in the project. The typed refusal reasons are:

| Reason | Meaning |
| --- | --- |
| `missing_execution_log` | no `execution-log.md`; route back to the import step that owes the chronology |
| `missing_post_execution_handoff` | no `execution/review/migration-handoff.json`; generate it from the final outcome record |
| `completion_report_missing_last_write` | the completion report records no `lastWriteAt`, so nothing can prove the handoff postdates the import |
| `post_execution_handoff_predates_last_write` | the handoff was generated before the run's last write — it describes the plan, not the run |

The last two compare against the completion report's own recorded last-write timestamp, never
a file mtime: an mtime is refreshed by a copy and proves nothing.
If validation fails, do not manufacture completion; route again to the module that owns the
missing or stale artifact.

### Entity-QA attestation gate

The same finalizer also refuses without a fresh, complete `execution/qa/entity-qa-attestation.json`
that matches the current `execution/completion-report.json` digest and covers every mapped
entity/subtype with matching counts (`rp-execute-import/SKILL.md`'s "Entity-by-entity QA"
section). The refusal carries `entityQa: { qaStatus, entities, recheck }`:

| `qaStatus` | Meaning | Action |
| --- | --- | --- |
| `missing` | no attestation file, it doesn't parse as JSON, its schema is invalid, there is no usable completion report to compare against, or the independent mapped-entity coverage source (`mapping/mapping-plan.json` or, for quick mode, `quick-mode/plan.json`) is unavailable | run the full entity-by-entity QA pass from `rp-execute-import`, then `scripts/entity-qa-attestation.js` |
| `stale` | the attestation's `completionReportDigest` does not match the report that is shipping — a later pass rewrote it | run the full entity-by-entity QA pass again, then the writer; the shipped prose treats any report change as reopening the whole review |
| `failed` | the attestation disagrees with the independent mapped-entity list or the report's own counts for one or more entities, named in `entityQa.entities` | dispatch a fresh Developer for the listed entities, then run the full QA pass and the writer |

A valid attestation proves import-row freshness and coverage only (`scope:
'import-entity-coverage'` in `migration-completion.json`) — never business setup or launch
readiness, and never proof the QA pass itself happened rather than a copy of the report's own
counts.

## Reporting coupons, currency and plan definitions

`lib/coupon-currency-plan-report.js` `buildCouponCurrencyPlanReport` renders the section and
decides approvability the same way `payments-report.js` does: every line with its count including
zero; per area `written + excluded + skipped = discovered`; exactly one currency outcome, and a
mismatch or multi-currency history BLOCKS as a halt; the coupon-usage surface must be named. Two
phrases are refused wherever they appear — "imported N coupons" (the honest headline is the
redeemability breakdown) and "not supported" (zero plan rows is "none found", a measured fact).

## Discovered-set status and safe refinalization

For every standard-mode finalization, build `execution/discovered-set-status.json` with `node scripts/discovered-set-status.js build <projectDir>` after the completion report, then regenerate the post-execution handoff, retain the current entity-QA attestation, and run `node scripts/migration-completion.js <projectDir>`. Missing or stale census approval, reconciliation or status is a hold; rebuild the owning artifact and obtain a fresh mapping review where required. The final receipt is version 2. Open discovered-set rows keep a complete backend at `complete_with_warnings`, and the handoff and receipt must agree.

On `reviewOnly: true`, refinalization uses the existing import outcomes. Make no Wix client, setup, codegen, import or website dispatch. Rebuild only the discovered-set status and post-execution handoff, then the aggregate completion; the writer archives the original version-1 receipt once. Any other route is held for the Import Operator. Manual work can be recorded only for a `manual-open` row, by the merchant or Cutover Operator through `node scripts/discovered-set-status.js resolve <projectDir> --census-id <id> --by merchant|cutover-operator --evidence <short non-record evidence>`. All other open outcomes require their existing mapping/import recovery path. Quick mode requires no discovered-set status.
