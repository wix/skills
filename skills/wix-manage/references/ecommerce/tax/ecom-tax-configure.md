---
name: "Tax: Configure (Wix Manual)"
description: Sets up tax using Wix's Manual calculator — discovers available calculators, creates tax regions with the Manual calculatorId, defines tax groups, and creates per-(region, group) rate mappings. Default recipe for the `[intent:configure]` dispatch tag. Triggers on "set up tax", "configure sales tax", "do I need to charge tax".
---

# Configure Tax (Wix Manual)

Baseline tax setup using Wix's built-in Manual calculator. Dispatcher routes here for `[intent:configure]` when neither `calculator:AVALARA` nor `region:EU` context tags match. EU merchants go to `ecom-tax-eu-vat` instead; merchants already on Avalara configure it via the Wix Dashboard (the Avalara onboarding flow is not exposed via TPA-public API).


## Prerequisites
- A Wix store with a payment method connected.
- MerchantContext loaded (`siteData.country`, `siteData.currency`).

## APIs used
- `GET /billing/v1/list-tax-calculators` — discover the Manual calculator's `appId`.
- `POST /billing/v1/tax-regions` — create a region for the merchant's country (request wrapped in `{ taxRegion: {...} }`).
- `POST /billing/v1/tax-regions/query` — find an existing region (used if Step 2 returns `ALREADY_EXISTS`).
- `POST /billing/v1/tax-groups` — create a tax group ("Standard"); request wrapped in `{ taxGroup: {...} }`.
- `POST /billing/v1/manual-tax-mappings` — assign a rate to the (region, group) pair; request wrapped in `{ manualTaxMapping: {...} }`. This is where the actual rate is stored for the Manual calculator.
- `POST /billing/v1/calculate-tax` — optional, to sanity-check rates before going live.

## Step 1 — Discover the Manual calculator's `appId`

Wix returns all available calculators (Avalara + Wix Manual). The calculator is identified by its `appId` — this is the value that goes into `tax-regions` later. Do not hardcode it.

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/list-tax-calculators",
  method: "GET"
)
```

Response shape:
```
{
  "taxCalculatorDetails": [
    { "appId": "...", "displayName": "Avalara Tax Calculator", "unsupportedCountries": [...] },
    { "appId": "57d13128-4a4c-494b-80b3-a6fb2e28018d", "displayName": "Wix Manual Tax Calculator", "unsupportedCountries": [] }
  ]
}
```

Locate the entry whose `displayName` contains "Manual" and capture its `appId`. If only Avalara appears with the merchant already onboarded, **stop** and tell the merchant they're already on Avalara — Avalara setup is managed via the Wix Dashboard, not via this recipe.

## Step 2 — Create a tax region for the merchant's country

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/tax-regions",
  method: "POST",
  body: {
    "taxRegion": {
      "country": "<siteData.country>",
      "appId": "<Manual appId from Step 1>",
      "taxIncludedInPrice": <true|false>
    }
  }
)
```

**`taxIncludedInPrice` defaults by region:**
- US / CA → `false` (tax-exclusive — added at checkout).
- AU / NZ / JP / IN / GB → `true` (tax-inclusive — already in displayed price).
- Other → ask the merchant.

The endpoint may return these errors (handle, don't retry blindly):
- `ALREADY_EXISTS` (409) — there's already a region for this country. Recover by querying `POST /billing/v1/tax-regions/query` with `{ query: { filter: { country: "<X>" } } }` to find the existing `taxRegion.id`, then continue at Step 3.
- `CALCULATOR_NOT_FOUND` (404) — Step 1 returned a stale/invalid `appId`; re-list.
- `INVALID_SUBDIVISION_FORMAT` / `SUBDIVISIONS_NOT_SUPPORTED_FOR_COUNTRY` (400) — subdivision string is wrong format or the country doesn't support per-state regions.
- `CALCULATOR_IS_NOT_SUPPORTED_FOR_THIS_TAX_REGION` (428) — the calculator can't be used in this country.

Capture `taxRegion.id` from the success response.

## Step 3 — Create a tax group

A Wix store also has a "system-defined" all-products tax group available via `POST /billing/v1/tax-groups/list-default-tax-groups` — but for custom rates, create your own group:

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/tax-groups",
  method: "POST",
  body: {
    "taxGroup": { "name": "Standard" }
  }
)
```

Capture `taxGroup.id` from `response.taxGroup.id`. For richer taxonomies (Food, Digital, Reduced rate), create multiple groups now.

## Step 4 — Create the (region, group) → rate mapping

This is where the actual rate lives in the Manual calculator. `manualTaxMapping` ties a `taxRegionId` + `taxGroupId` + the `taxRate` (and optional jurisdiction labels for display).

**`taxRate` is a decimal string** — 10% is `"0.1"`, 20% is `"0.2"`, 8.25% is `"0.0825"`. Do NOT pass the percent number ("10") — that becomes 1000%.

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/manual-tax-mappings",
  method: "POST",
  body: {
    "manualTaxMapping": {
      "taxGroupId": "<taxGroup.id from Step 3>",
      "taxRegionId": "<taxRegion.id from Step 2>",
      "taxRate": "<decimal rate, e.g. '0.1' for 10%>",
      "taxType": "<VAT/GST | SALES_TAX | …>",
      "taxName": "<label shown on invoices — e.g. 'Sales Tax', 'GST', 'VAT'>",
      "jurisdiction": "<optional, e.g. 'Australia' or 'California'>",
      "jurisdictionType": "<optional, e.g. 'COUNTRY' or 'STATE'>"
    }
  }
)
```

**Country-default rates (verify with merchant — rates change):**
- US — varies by **state**; do NOT apply a flat country rate. Either (a) create per-state regions via `subdivision` in Step 2 and a `manualTaxMapping` per state, or (b) recommend the merchant install Avalara via the Wix Dashboard for automated rate management.
- GB — 20% VAT. DE/FR/IT/ES — 19/20/22/21% (but EU merchants should be on `ecom-tax-eu-vat`).
- AU — 10% GST. NZ — 15% GST. JP — 10% consumption tax.
- CA — 5% federal GST + provincial. Use `subdivision` regions per province.

## Step 5 — Sanity-check via CalculateTax

Optional but recommended. Make a fake calculation against the new setup to confirm rate applies:

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/calculate-tax",
  method: "POST",
  body: {
    "estimateTaxRequestDetails": {
      "lineItems": [
        {
          "taxGroupId": "<taxGroup.id>",
          "price": { "amount": "100.00", "currency": "<siteData.currency>" },
          "addressIndex": 0
        }
      ],
      "addresses": [
        { "country": "<siteData.country>", "subdivision": "<optional>" }
      ]
    }
  }
)
```

Errors to watch:
- `MISSING_TAXABLE_ADDRESS` / `MISSING_COUNTRY_IN_ADDRESS` (428) — fill the address.
- `MISSING_SUBDIVISION_IN_ADDRESS` (428) — the country requires a subdivision (e.g. US state).
- `INVALID_LINE_ITEM_ADDRESS_INDEX` / `INVALID_LINE_ITEM_EXEMPTION_INDEX` (428) — index mismatch.

Surface the calculated tax amount to the merchant for sanity check.

## Step 6 — Confirm to merchant

> "Tax configured: **<country>** region with **<group name>** at **<rate>%**, prices are **<inclusive|exclusive>**. Add more groups (e.g. Food, Digital) by repeating Steps 3-4, or add more countries by repeating Steps 2-4."

## Guardrails (inline)

- **US warning.** If `siteData.country = "US"`, surface: "US sales tax requires per-state rates and nexus tracking. The Manual calculator supports it but is high-maintenance; consider installing Avalara via the Wix Dashboard for automated rate management."
- **No duplicate regions.** If Step 2 returns `ALREADY_EXISTS`, recover via the `/tax-regions/query` lookup (see Step 2 errors) rather than abandoning — don't recreate.
- **EU sites → route away.** If `siteData.country` is EU and you somehow landed here (dispatcher should have routed to `ecom-tax-eu-vat`), surface: "EU VAT has special requirements (OSS, reverse-charge, inclusive pricing). Switching to the EU-VAT setup recipe." and re-dispatch.
- **No Avalara collision.** If Step 1 shows the merchant already has Avalara credentials, stop and tell them: "You're already on Avalara — configure it via the Wix Dashboard rather than setting up Wix Manual tax."
