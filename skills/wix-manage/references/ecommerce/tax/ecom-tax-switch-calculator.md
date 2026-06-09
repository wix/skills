---
name: "Tax: Switch Calculator"
description: Switches existing tax regions to use a different installed calculator. Updates each region's `calculatorId` via PATCH. The merchant must have already installed the target calculator (e.g. Avalara) via the Wix Dashboard before this recipe can find its `calculatorId`.
---

# Switch Tax Calculator

In Wix Tax, calculators are **per-region** (each `taxRegion` has a `calculatorId`). "Switching" really means patching each region to point at a different calculator.

**Prerequisite for switching TO Avalara:** the merchant must install + onboard Avalara via the Wix Dashboard first (the Avalara credentials API is not TPA-public). Once Avalara is installed, `list-tax-calculators` will return its `calculatorId` and this recipe can route regions to it.

## APIs used (TPA-public only)
- `GET /billing/v1/list-tax-calculators` — discover installed calculators (Manual is always present; Avalara only if the merchant installed it).
- `POST /billing/v1/tax-regions/query` — list existing regions with their current `calculatorId`.
- `PATCH /billing/v1/tax-regions/{taxRegion.id}` — update each region's `calculatorId` (requires `revision`).

## Step 1 — Read current state

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/list-tax-calculators",
  method: "GET"
)
```
Capture `calculatorId` for every installed calculator (Manual, and Avalara if installed).

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/tax-regions/query",
  method: "POST",
  body: { "query": { "paging": { "limit": 100 } } }
)
```
For each region, note `id`, `revision`, `country`, and current `calculatorId`.

## Step 2 — Confirm target with merchant

Ask: "Switch **all <N> tax regions** from <current calculator> to <target>? Or only specific countries?"

Capture the target list (could be all regions, or a subset).

If the target calculator isn't present in Step 1's response (e.g. merchant wants Avalara but it's not installed), **stop and re-dispatch** to `ecom-tax-avalara` which will direct them to the dashboard.

## Step 3 — Patch each region

For each region in the target list:

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/tax-regions/<taxRegion.id>",
  method: "PATCH",
  body: {
    "taxRegion": {
      "id": "<taxRegion.id>",
      "revision": "<taxRegion.revision>",
      "calculatorId": "<target calculatorId>"
    },
    "fieldMask": ["calculatorId"]
  }
)
```

Watch for errors:
- `CALCULATOR_ID_NOT_FOUND` (404) — target calculator vanished between Step 1 and now; re-list.
- `CALCULATOR_IS_NOT_SUPPORTED_FOR_THIS_TAX_REGION` (428) — Avalara doesn't cover that country; leave the region on Manual.

## Step 4 — What happens to existing rate data

- **Manual → Avalara:** the region's existing `manual-tax-mappings` become inert (Avalara calculates its own rates). NOT auto-deleted — sit unused. Switching back reactivates them. Don't delete unless the merchant insists.
- **Avalara → Manual:** the region needs `manual-tax-mappings` to be present (else 0% tax). If none exist for that region, surface: "Region <country> has no Manual rate mappings — tax will be 0% until you create them via the Configure Tax recipe." Then re-dispatch to `ecom-tax-configure` Steps 3-4 for that country.

## Step 5 — Sanity-check via CalculateTax

For one of the switched regions, run the `POST /billing/v1/calculate-tax` call from `ecom-tax-configure` Step 5 and surface the result to the merchant.

## Step 6 — Confirm to merchant

> "Switched **N** regions: <countries> → **<target calculator>**. Avalara handles rate updates automatically from here. Manual regions left in place: <countries> (Avalara not supported there)."

## Guardrails (inline)

- **Target must be installed.** Never patch a region to a `calculatorId` that didn't appear in Step 1's list. For Avalara: the merchant must install it via dashboard first.
- **Active orders.** Orders in-flight at the moment of the switch already snapshotted their tax at checkout time and aren't affected.
- **No bulk-delete of mappings.** Leaving Manual `manual-tax-mappings` in place when switching to Avalara is the safe default.
- **Revision required.** Each PATCH must include the latest `revision` from Step 1; stale revisions get rejected.
