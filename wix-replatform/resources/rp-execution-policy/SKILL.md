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

A run that reports "15 gateways, 4 enabled, 6 credential fields present, 0 values retained" is
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
If validation fails, do not manufacture completion; route again to the module that owns the
missing or stale artifact.

## Reporting coupons, currency and plan definitions

`lib/coupon-currency-plan-report.js` `buildCouponCurrencyPlanReport` renders the section and
decides approvability the same way `payments-report.js` does: every line with its count including
zero; per area `written + excluded + skipped = discovered`; exactly one currency outcome, and a
mismatch or multi-currency history BLOCKS as a halt; the coupon-usage surface must be named. Two
phrases are refused wherever they appear — "imported N coupons" (the honest headline is the
redeemability breakdown) and "not supported" (zero plan rows is "none found", a measured fact).
