---
name: "Audit Tax Setup"
description: Read-only audit of the site's current tax configuration. Lists available calculators, all tax regions with their calculatorId + inclusive/exclusive setting, all tax groups, all Manual rate mappings, Avalara credentials (if any), and VAT settings (if any). No writes. Triggers on "audit my taxes", "review my tax setup", "show my tax config".
---

# Audit Tax Setup

Read-only diagnostic. No writes — the fix lives in the configure/switch promotions once gaps are identified.


## What to query (parallel — TPA-public reads only)

Run these in parallel; they don't depend on each other:

```
CallWixSiteAPI(GET  /billing/v1/list-tax-calculators)
CallWixSiteAPI(POST /billing/v1/tax-regions/query, { query: { paging: { limit: 100 } } })
CallWixSiteAPI(POST /billing/v1/tax-groups/query, { query: { paging: { limit: 100 } } })
CallWixSiteAPI(POST /billing/v1/tax-groups/list-default-tax-groups, {})
CallWixSiteAPI(POST /billing/v1/manual-tax-mappings/query, { query: { paging: { limit: 500 } } })
```

Notes:
- `manual-tax-mappings/query` returns Manual-calculator rate mappings only. Avalara regions don't have mappings.
- **Not in this audit (no TPA-public API):** Avalara credentials state, VAT-specific tax-settings (OSS/reverse-charge flags). The merchant has to check those in the **Wix Dashboard → Settings → Taxes**. The audit output can recommend that as a manual follow-up.

## How to interpret and format

Build a single audit table for the merchant. One row per region:

| Region | Calculator | Inclusive | Groups mapped | Rates | Issues |
|---|---|---|---|---|---|
| <country>/<subdivision> | Manual \| Avalara | yes \| no | <N> of <total> groups | <list of rates> | <flags> |

Cross-correlate:
- For each `taxRegion`, look up its `calculatorId` against the `list-tax-calculators` response to label it Manual / Avalara.
- For Manual regions, count how many `manualTaxMappings` exist for that `taxRegionId`. Show actual rates per group.
- For Avalara regions, show "Avalara — live calculation".

Flag in **Issues** column:
- **No groups mapped** — Manual region with zero `manualTaxMappings` → tax will be 0%. Recommend `ecom-tax-configure` Steps 3-4.
- **Inclusive risk** — `taxIncludedInPrice: false` for an EU region (consumer-law violation). Recommend patching the region.
- **Duplicate** — multiple active regions for the same `country` + `subdivision`. Recommend deleting the older.
- **Stale** — region's `updated_date` > 365 days ago and rates change frequently in that jurisdiction.
- **Avalara without credentials** — region has Avalara `calculatorId` but `GET /billing/v1/avalara-tax-credentials` returns 404 → calculation will fail at checkout. Critical.
- **US partial coverage** — US merchant with regions for only some states. Surface the gap.
- **EU partial coverage** — EU merchant with OSS enabled in `TaxSettings` but missing regions for countries they ship to.

End with a one-line summary:

> "Regions: **<N>** · Calculators in use: **<list>** · Groups: **<M>** · Mappings: **<K>** · Inclusive: **<by region>** · Issues: **<count>**."

If issues exist, list each with the recommended next promotion to fix:
- "Missing Manual rate for region <X>" → `ecom-tax-configure`
- "Avalara without credentials" → `ecom-tax-avalara`
- "Switch <region> from Manual → Avalara" → `ecom-tax-switch-calculator`
- "EU region without inclusive pricing" → `ecom-tax-eu-vat` (or PATCH the region directly)

## Guardrails (inline)

- **Read-only.** No POST/PATCH/DELETE in this recipe. If the merchant says "fix it", re-dispatch to the appropriate configure/switch promotion.
- **No legal advice.** This recipe reports configuration, not whether the rates are *correct for the merchant's tax obligations*. That's an accountant's job.
- **Paging.** If `tax-regions/query` returns 100+ regions or `manualTaxMappings/query` returns 500+ mappings, paginate with cursors. Don't truncate silently.
