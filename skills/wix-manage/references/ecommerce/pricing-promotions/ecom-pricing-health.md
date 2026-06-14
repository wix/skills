---
name: "Pricing & Discount Health"
description: Periodic review of a store's pricing and promotions — finds discount conflicts/stacking, stale sales with no end date, and margin-erosion risk across all active discounts and coupons. Triggers on "pricing health", "review my discounts", "discount conflicts check", "are my sales still running".
---

# Pricing & Discount Health

A periodic audit of all active discounts and coupons — surfaces problems before they cost margin or confuse customers. Run proactively (digest) and report only findings.

## Step 1: Gather active promotions

- Discount rules: `POST https://www.wixapis.com/ecom/v1/discount-rules/query` with `filter: { "active": true }`.
- Coupons: `POST https://www.wixapis.com/stores/v2/coupons/query`.

## Step 2: Checks (reuse the create-time guardrails, applied across the whole set)

| Check | How | Flag |
|---|---|---|
| **Stacking conflicts** | scope/time overlap between active rules (and rule↔coupon cross-stacking) | overlapping scope on same products → combined discount deeper than intended |
| **Stale sales** | rules `active: true` with no `activeTimeInfo.end` (or an end far in the past/none) | "running indefinitely with no end date" |
| **Margin erosion** | any active discount > 25% cap, or combined stacked discount pushing effective margin < 15% | cap/floor breach |
| **Orphaned / ineffective** | rules that never apply (scope matches no products, or eligibility never met) | dead rule — recommend deactivating |

These are the same rules enforced at creation in [Create Discount Rule](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-discount-rule) → "Guardrails" — this skill applies them as a periodic sweep over everything already live.

## Step 3: Report

Severity-ranked: **stacking/margin breaches** (costing money now) first, then **stale sales**, then **cleanup** (orphaned rules). For each, name the rule(s) and the concrete fix (deactivate, add an end date, lower the discount). To fix a discount that *should* apply but isn't, see [Troubleshoot: Discount Not Applying](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-discount-not-applying).
