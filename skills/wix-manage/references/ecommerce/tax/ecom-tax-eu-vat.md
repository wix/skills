---
name: "Tax: Configure (EU VAT)"
description: Wix-specific bindings for EU VAT setup — per-region `taxIncludedInPrice: true`, per-country tax regions, VAT groups + manual-tax-mappings. OSS / reverse-charge / home-country flags are DASHBOARD-ONLY (no TPA-public `tax-settings` API). Used when `region:EU` is in MerchantContext and merchant is not on Avalara.
---

# Configure Tax (EU VAT)

EU VAT differs from the baseline `ecom-tax-configure` recipe in a few **Wix-specific** ways. EU VAT regulation itself (rates, OSS thresholds, B2B reverse-charge, member-state list) — apply general knowledge; the merchant must verify rates at runtime regardless because rates change.

This file documents only what isn't general knowledge: how the Wix Tax API binds those concepts.

## Wix-specific bindings (the load-bearing parts)

1. **`taxIncludedInPrice` is per-region, set at region creation.** For every EU country region, this MUST be `true` (consumer-law compliance is a region-level setting in Wix Tax, not a global one).
2. **No public bulk-create for tax regions.** The TPA-public surface has `POST /billing/v1/tax-regions` (single) only — loop per country.
3. **`POST /billing/v1/bulk/manual-tax-mappings/create`** IS available for rate mappings — use it to create per-country rates in one call.
4. **EU regions use the Manual calculator's `appId`** (Avalara has its own EU VAT flow — if Avalara is installed, configure it via the Wix Dashboard instead of this recipe). The identifier comes from `list-tax-calculators` and is the field `appId` on the API.
5. **OSS / reverse-charge / home-country flags are dashboard-only.** The `tax-settings` entity is not exposed via TPA-public API. Tell the merchant to set OSS-registered status, reverse-charge-B2B, and home country via the **Wix Dashboard → Settings → Taxes**.

## Prerequisites
- `region:EU` is in MerchantContext (from `ecom-load-context` Step 3).
- Avalara not installed (otherwise the merchant configures Avalara via the Wix Dashboard instead).

## APIs used (TPA-public only)
- `GET /billing/v1/list-tax-calculators` — discover the Manual calculator's `appId`.
- `POST /billing/v1/tax-regions` — per-country region create (loop); request wrapped in `{ taxRegion: {...} }`.
- `POST /billing/v1/tax-groups` — VAT groups; request wrapped in `{ taxGroup: {...} }`.
- `POST /billing/v1/bulk/manual-tax-mappings/create` — per-country rate mappings (bulk); request body uses `{ manualTaxMappings: [...] }`.
- `POST /billing/v1/calculate-tax` — sanity check.

## Step 1 — Capture Manual calculator's `appId`

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/list-tax-calculators",
  method: "GET"
)
```

Response: `{ "taxCalculatorDetails": [{ "appId": "...", "displayName": "Wix Manual Tax Calculator", ... }, { "appId": "...", "displayName": "Avalara Tax Calculator", ... }] }`. Find the entry whose `displayName` contains "Manual" and capture its `appId`. This is the value that goes into `tax-regions` below.

## Step 2 — Ask: which EU countries does the merchant ship to?

Direct question. **Do NOT default to all 27** — each region is a billable entity in Wix Tax and unused regions add overhead.

## Step 3 — Loop-create regions per EU country

```
For each ISO country code the merchant selected:
  CallWixSiteAPI(
    url: "https://www.wixapis.com/billing/v1/tax-regions",
    method: "POST",
    body: {
      "taxRegion": {
        "country": "<ISO>",
        "appId": "<Manual appId from Step 1>",
        "taxIncludedInPrice": true
      }
    }
  )
```

`taxIncludedInPrice: true` per region — non-negotiable for EU. If a merchant requests exclusive pricing for an EU storefront, explain that EU regulations require inclusive and stop.

Capture each returned `taxRegion.id` from `response.taxRegion.id`, keyed by country (`regionIdByCountry[DE] = "..."`). If the call returns `ALREADY_EXISTS` (409) for a country, recover via `POST /billing/v1/tax-regions/query` with `{ query: { filter: { country: "<ISO>" } } }`.

## Step 4 — Create VAT groups

Create groups once (not per-region). For most setups, create the four standard VAT groups; "Reduced" / "Zero" / "Exempt" can be mapped later as the merchant identifies relevant products.

```
For each name in ["Standard VAT", "Reduced VAT", "Zero VAT", "Exempt"]:
  CallWixSiteAPI(
    url: "https://www.wixapis.com/billing/v1/tax-groups",
    method: "POST",
    body: {
      "taxGroup": { "name": name }
    }
  )
```

Capture each `taxGroup.id` from `response.taxGroup.id`.

## Step 5 — Bulk-create per-country (region, Standard group) rate mappings

**`taxRate` is a decimal string** — 19% is `"0.19"`, 20% is `"0.20"`. Do NOT pass the percent number ("19").

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/bulk/manual-tax-mappings/create",
  method: "POST",
  body: {
    "manualTaxMappings": [
      {
        "taxGroupId": "<standardGroup.id>",
        "taxRegionId": "<regionIdByCountry.DE>",
        "taxRate": "0.19",
        "taxType": "VAT/GST",
        "taxName": "VAT",
        "jurisdiction": "Germany",
        "jurisdictionType": "COUNTRY"
      },
      ...one entry per (country, group) the merchant is mapping now
    ]
  }
)
```

**Rates: ask the merchant.** Don't hardcode — EU rates change.

## Step 6 — OSS / reverse-charge / home-country flags → dashboard

The `tax-settings` entity is not exposed via TPA-public API. Surface this to the merchant:

> "To configure One Stop Shop (OSS), B2B reverse-charge, and home country, open **Wix Dashboard → Settings → Taxes** and set them there. The API can't set those flags. Once set, VIES validation at checkout works automatically for B2B reverse-charge."

Ask the merchant whether they're OSS-registered so they know what to set in the dashboard.

## Step 7 — Sanity-check via CalculateTax

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/calculate-tax",
  method: "POST",
  body: {
    "estimateTaxRequestDetails": {
      "lineItems": [{
        "taxGroupId": "<standardGroup.id>",
        "price": { "amount": "100.00", "currency": "EUR" },
        "addressIndex": 0
      }],
      "addresses": [{ "country": "<one of the created regions>" }]
    }
  }
)
```

Surface the calculated tax to the merchant. Mismatch vs the rate they provided in Step 5 → audit the corresponding `manual-tax-mapping`.

## Step 8 — Confirm to merchant

> "EU VAT configured · **N** regions (inclusive pricing) · groups: Standard + <others if created>. **OSS / reverse-charge / home-country must still be set in the Wix Dashboard → Settings → Taxes.**"

## Guardrails (Wix-specific)

- **Non-negotiable inclusive.** If the merchant insists on exclusive for an EU region, stop — Wix enforces this at the region level.
- **UK ≠ EU.** `country:GB` lands on `ecom-tax-configure`, not here.
- **No silent over-create.** Don't create regions the merchant didn't list (Step 2). Each region is billable.
- **No bulk-create-tax-regions** — loop per country (the TPA-public surface doesn't expose bulk-create for regions).
- **OSS / reverse-charge is dashboard-only** — always end the recipe by directing the merchant to the dashboard for those flags.
