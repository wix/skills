---
name: "eCommerce — Skill Audit"
description: Per-file status for the ecommerce L1 domain. Rules and conventions are in the `wix-skills-routing-expert` Claude Code skill.
---

# eCommerce — Skill Audit

## L1 loader

| File name | Wix API Doc | TPA-public? | Claude Redundant | Beyond Wix Docs | Status |
|---|---|---|---|---|---|
| `ecom-load-context.md` | profile/metasite | Yes | No | General site context loader (siteId, country, region, industry, currency, AOV, traffic) | ✅ Active |

## Category-doc files

| File name | Wix API Doc | TPA-public? | Claude Redundant | Beyond Wix Docs | Status |
|---|---|---|---|---|---|
| `ecom-tax.md` | n/a | n/a | n/a | Category description + disambiguation labels | ✅ Active |
| `ecom-pricing.md` | n/a | n/a | n/a | Category description + disambiguation labels | ✅ Active |

## Tax — `tax/`

| File name | Wix API Doc | TPA-public? | Claude Redundant | Beyond Wix Docs | Status |
|---|---|---|---|---|---|
| `ecom-tax-default.md` | n/a (dispatcher) | n/a | n/a | Tag-match dispatch + worked examples + base recipe fallback | ✅ Active |
| `ecom-tax-configure.md` | `GET /billing/v1/list-tax-calculators` · `POST /billing/v1/tax-regions` · `POST /billing/v1/tax-groups` · `POST /billing/v1/manual-tax-mappings` · `POST /billing/v1/calculate-tax` | Yes | No | 4-step orchestration; rates-in-`manual-tax-mappings` model insight; per-country `taxIncludedInPrice` defaults; US state-level warning | ✅ Active |
| `ecom-tax-avalara.md` | `GET /billing/v1/list-tax-calculators` · `POST /billing/v1/tax-regions` · `POST /billing/v1/calculate-tax` | Partial | No | Dashboard-prerequisite pattern: merchant installs Avalara via Dashboard; recipe binds tax-regions to Avalara's `calculatorId` via TPA-public endpoints | ✅ Active |
| `ecom-tax-eu-vat.md` | `GET /billing/v1/list-tax-calculators` · `POST /billing/v1/tax-regions` (looped) · `POST /billing/v1/tax-groups` · `POST /billing/v1/bulk-create-manual-tax-mappings` · `POST /billing/v1/calculate-tax` | Yes | No | `taxIncludedInPrice` per-region; bulk mappings; don't default to all 27; OSS / reverse-charge surfaced as Dashboard-only | ✅ Active |
| `ecom-tax-switch-calculator.md` | `GET /billing/v1/list-tax-calculators` · `POST /billing/v1/tax-regions/query` · `PATCH /billing/v1/tax-regions/{id}` · `POST /billing/v1/calculate-tax` | Yes | No | Per-region calculatorId model; Manual mappings become inert under Avalara, reactivate on switch-back; revision-handling | ✅ Active |
| `ecom-tax-audit.md` | 5 parallel reads: list-calculators · tax-regions/query · tax-groups/query · list-default-tax-groups · manual-tax-mappings/query | Yes | No | Cross-correlation rules; issue-detection rules; Dashboard follow-up for OSS / Avalara state | ✅ Active |
| `ecom-tax-troubleshoot-calc-wrong.md` | `POST /billing/v1/calculate-tax` · `POST /billing/v1/tax-regions/query` · `POST /billing/v1/manual-tax-mappings/query` | Yes | No | 3-branch diagnostic tree; orders snapshot rates at checkout time; Avalara-issue branch routes merchant to Dashboard | ✅ Active |

## Pricing & promotions — `pricing-promotions/`

| File name | Wix API Doc | TPA-public? | Claude Redundant | Beyond Wix Docs | Status |
|---|---|---|---|---|---|
| `ecom-pricing-default.md` | n/a (dispatcher) | n/a | n/a | Dispatch block + cross-category routing notes | ✅ Active |
| `ecom-pricing-create-coupon.md` | Coupons V2 API | Likely Yes | TBD | Coupon-type → spec field mapping; scope targeting; usage limits; conflict-check first | ⏳ Audit pending |
| `ecom-pricing-create-discount-rule.md` | Discount Rules API | Likely Yes | TBD | Multi-step rule construction | ⏳ Audit pending |
| `ecom-pricing-run-a-sale.md` | Coupons + Discount Rules + Recommendations + Catalog Analytics | Likely Yes (tracking URL TBD) | No | Strategy orchestrator: holiday detection, AOV-band tiers, goal classification, decision-conditional support loading | ⏳ Audit pending |
| `ecom-pricing-troubleshoot-not-applying.md` | Coupons + Discount Rules query | Likely Yes | TBD | Diagnostic tree for inactive/non-applying discounts | ⏳ Audit pending |
| `ecom-pricing-goal-seasonal-revenue.md` | (support) | inherits | n/a | SEASONAL goal: KPIs, magnitude tiers, holiday-window logic | ⏳ Audit pending |
| `ecom-pricing-goal-clear-inventory.md` | (support) | inherits | n/a | STOCK_MOVER goal | ⏳ Audit pending |
| `ecom-pricing-goal-increase-aov.md` | (support) | inherits | n/a | UPSELL_BOOST goal | ⏳ Audit pending |
| `ecom-pricing-goal-drive-cross-sells.md` | (support) | inherits | n/a | BUNDLE_AND_SAVE goal | ⏳ Audit pending |
| `ecom-pricing-flow-seasonal-promotion.md` | Discount Rules API | Likely Yes | n/a | SEASONAL flow execution | ⏳ Audit pending |
| `ecom-pricing-flow-upsell-boost.md` | Discount Rules API | Likely Yes | n/a | UPSELL_BOOST flow execution | ⏳ Audit pending |
| `ecom-pricing-flow-bundle-and-save.md` | Discount Rules API | Likely Yes | n/a | Bundle/cross-sell flow | ⏳ Audit pending |
| `ecom-pricing-flow-stock-mover.md` | Discount Rules + Inventory query | Likely Yes | n/a | Stock-mover flow with inventory analysis | ⏳ Audit pending |
| `ecom-pricing-guardrail-discount-conflicts.md` | Coupons + Discount Rules query | Likely Yes | n/a | Conflict detection rules across active promos | ⏳ Audit pending |
| `ecom-pricing-guardrail-margin-protection.md` | Catalog Analytics | TBD | n/a | Margin floor enforcement (15% default) | ⏳ Audit pending |
| `ecom-pricing-tracking-api.md` | `agentic-recommendations` tracking endpoint | TBD | No | Tracking endpoint payload shapes | ⏳ Audit pending |

## Shipping & checkout — flat at `ecommerce/` root (not migrated)

| File name | Wix API Doc | TPA-public? | Claude Redundant | Beyond Wix Docs | Status |
|---|---|---|---|---|---|
| `setup-shipping-rates.md` | Shipping Rates API | Likely Yes | TBD | Legacy recipe | 📦 Legacy flat |
| `setup-shipping-regions.md` | Shipping Regions API | Likely Yes | TBD | Legacy recipe | 📦 Legacy flat |
| `setup-store-pickup-location.md` | Pickup / Delivery Profiles | Likely Yes | TBD | Legacy recipe | 📦 Legacy flat |
| `recipe-apply-shipping-recommendations.md` | Shipping + Recommendations | TBD | TBD | Applies AI-generated shipping recs | 📦 Legacy flat |
| `flow-add-free-shipping.md` | Shipping Rates API | Likely Yes | TBD | Free-shipping threshold flow | 📦 Legacy flat |
| `flow-optimize-shipping-rates.md` | Shipping + Catalog Analytics | TBD | TBD | Rate-optimization flow | 📦 Legacy flat |
| `flow-fix-coverage-gaps.md` | Shipping Regions API | Likely Yes | TBD | Coverage-gap remediation flow | 📦 Legacy flat |
| `guardrail-shipping-health.md` | Shipping query | Likely Yes | TBD | Shipping configuration health check | 📦 Legacy flat |
| `guardrail-rate-pricing-sanity.md` | Shipping + Catalog Analytics | TBD | TBD | Rate-vs-AOV sanity | 📦 Legacy flat |
| `goal-reduce-cart-abandonment.md` | (support — abandoned cart) | inherits | n/a | Will move under Checkout & cart when migrated | 📦 Legacy flat |
| `api-shipping.md` | (API reference doc) | inherits | Likely Yes | If just endpoint summaries → dissolve into API-doc URLs per §7.5 | 📦 Legacy flat |
| `troubleshoot-checkout-delivery-dropoff.md` | Checkout + Shipping query | Likely Yes | TBD | Diagnostic for delivery-step conversion < 65% | 📦 Legacy flat |

## Documentation

| File name | Wix API Doc | TPA-public? | Claude Redundant | Beyond Wix Docs | Status |
|---|---|---|---|---|---|
| `skill-graph.md` | n/a | n/a | n/a | Mermaid diagram of skill relationships | 📝 Doc |
| `skill-audit.md` (this file) | n/a | n/a | n/a | This audit | 📝 Doc |
