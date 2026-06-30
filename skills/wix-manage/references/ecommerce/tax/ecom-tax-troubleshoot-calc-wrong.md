---
name: "Tax: Calculation Wrong"
description: Diagnose wrong / missing tax on a specific order or checkout (per-order, NOT a site-wide audit). Loaded by the [Tax dispatcher](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/tax) — see the dispatcher for trigger keywords and the per-order vs site-wide boundary rule.
---

# Tax Calculation Wrong

> **Routing rule (READ FIRST).** Any merchant query about wrong / missing / unexpected tax on a SPECIFIC order or checkout (e.g. "$0 tax on a Texas order", "customer was charged 8% instead of 8.25%", "no VAT on a German order") MUST load this recipe before answering. Do NOT improvise from the dispatcher, training knowledge, or raw API calls. Do NOT recommend a fix before completing the 3-branch diagnostic below.

Diagnostic tree. No writes — once the cause is identified, the fix lives in the `ecom-tax-configure` recipe (for missing regions/groups/mappings) or in the Wix Dashboard (for Avalara-related issues).


## Step 1 — Get the order details from the merchant

Ask for the order ID. If they don't have one, ask date + customer email and use the Orders API to find it (this is cross-category — `wix.ecommerce.v1.order` query endpoint, outside this recipe's scope).

Capture from the order:
- `shippingAddress.country` (and `subdivision` if US/CA/etc.)
- For each line item: its `taxGroupId` and net price
- The order's recorded tax breakdown

## Step 2 — Re-run CalculateTax with the order's address + line items

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/calculate-tax",
  method: "POST",
  body: {
    "estimateTaxRequestDetails": {
      "lineItems": [
        {
          "taxGroupId": "<from line item>",
          "price": { "amount": "<net amount>", "currency": "<order currency>" },
          "addressIndex": 0
        }
      ],
      "addresses": [
        { "country": "<shippingAddress.country>", "subdivision": "<shippingAddress.subdivision>" }
      ]
    }
  }
)
```

Compare the estimated tax against what the order actually recorded.

If CalculateTax errors, you've found the cause already:
- `MISSING_TAXABLE_ADDRESS` — the order had no shipping address (digital order? guest checkout misconfigured?).
- `MISSING_COUNTRY_IN_ADDRESS` — country missing from order's address — investigate checkout config.
- `MISSING_SUBDIVISION_IN_ADDRESS` — country requires subdivision (e.g. US states) but order had only country.
- `INVALID_LINE_ITEM_ADDRESS_INDEX` / `INVALID_LINE_ITEM_EXEMPTION_INDEX` — internal index mismatch; probably a Wix bug, escalate.

## Step 3 — Walk the diagnostic tree by symptom

### Branch A — No tax applied (merchant expected tax)

Query the tax region for the buyer's country:

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/tax-regions/query",
  method: "POST",
  body: { "query": { "filter": { "country": { "$eq": "<country>" } } } }
)
```

- **No region** → gap. Recommend `ecom-tax-configure` (or `ecom-tax-eu-vat` if EU) to add it.
- **Region exists with Manual calculatorId** → check `manualTaxMappings`:
  ```
  CallWixSiteAPI(
    url: "https://www.wixapis.com/billing/v1/manual-tax-mappings/query",
    method: "POST",
    body: { "query": { "filter": { "tax_region_id": { "$eq": "<region.id>" }, "tax_group_id": { "$eq": "<line item's taxGroupId>" } } } }
  )
  ```
  - Empty → no rate mapped for this group in this region → tax was 0. Fix: re-dispatch to `ecom-tax-configure` Step 4.
  - Mapping exists with `taxRate = 0` → intentional zero rate (e.g. Zero VAT group). Confirm with merchant.
- **Region with Avalara calculatorId** but no tax returned → likely Avalara integration issue. The Avalara credentials state API is **not TPA-public**, so the API can't directly check it. Surface to merchant: "This region uses Avalara. Verify Avalara is installed and healthy in **Wix Dashboard → Settings → Taxes → Avalara**. Common causes: missing/expired credentials, ship-from address invalid in Avalara, or the buyer's address falls in a non-taxable Avalara jurisdiction."
- **B2B reverse-charge** (EU) + buyer has valid VAT number → 0% tax is **correct**. Confirm with merchant — they can check the OSS/reverse-charge setting in **Wix Dashboard → Settings → Taxes** (also not API-accessible).

### Branch B — Tax amount looks wrong

1. Compare order's recorded rate against the current `manualTaxMapping.taxRate`. **Orders snapshot the rate at checkout time** — if the rate has changed since, past orders keep the old rate.
   - Surface: "Current rate is **<X>%** but this order was placed when it was **<Y>%**. To 'fix' a past order, the merchant must issue a refund/credit-note manually — past orders are not retroactively recalculated."
2. Check `taxIncludedInPrice` on the region: if the merchant flipped inclusive ↔ exclusive between order placement and now, line subtotals differ.

### Branch C — Tax applied but merchant expected none

1. Buyer in same country as merchant + OSS-**disabled** → home-country VAT applies (correct).
2. Customer exemption flag not set on the customer profile → tax was charged because the customer isn't marked exempt.

## Step 4 — Report

Single line: "Cause: **<X>**. Fix: **<recommended next action — usually a re-dispatch to `ecom-tax-configure` or a Wix Dashboard step for Avalara>**."

## Guardrails (inline)

- **Past orders are not retroactively recalculated** when configuration changes. Fix for a past order is a manual refund/credit-note, not a re-charge.
- **No writes from this recipe.** Only `GET` / `query` / `calculate-tax` calls. If a fix needs writes, re-dispatch to `ecom-tax-configure` (for Wix Manual rates/regions/groups) or direct the merchant to the Wix Dashboard (for Avalara).
- **Don't propose Avalara migration from a single wrong order.** That's a setup-review decision, not a per-order fix — the merchant should review their full tax configuration before switching calculators.
