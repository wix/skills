---
name: "Tax: Configure (Wix Manual)"
description: Sets up tax using Wix's Manual calculator — discovers available calculators, creates tax regions with the Manual calculatorId, defines tax groups, and creates per-(region, group) rate mappings. Default recipe for the `[intent:configure]` dispatch tag. Triggers on "set up tax", "configure sales tax", "do I need to charge tax".
---

# Configure Tax (Wix Manual)

Baseline tax setup using Wix's built-in Manual calculator. Dispatcher routes here for `[intent:configure]` when neither `calculator:AVALARA` nor `region:EU` context tags match. EU merchants go to `ecom-tax-eu-vat` instead; merchants already on Avalara go to `ecom-tax-avalara`.


## Prerequisites
- A Wix store with a payment method connected.
- MerchantContext loaded (`siteData.country`, `siteData.currency`).

## APIs used
- `GET /billing/v1/list-tax-calculators` — discover the Manual calculator's `calculatorId`.
- `POST /billing/v1/tax-regions` — create a region for the merchant's country.
- `POST /billing/v1/tax-groups` — create a tax group ("Standard").
- `POST /billing/v1/manual-tax-mappings` — assign a rate to the (region, group) pair (this is where the actual rate is stored for the Manual calculator).
- `POST /billing/v1/calculate-tax` — optional, to sanity-check rates before going live.

## Step 1 — Discover the Manual calculator's `calculatorId`

Wix returns all available calculators including the built-in Manual one. Capture the `calculatorId` for `MANUAL` (the exact identifier value comes from this response — do not hardcode).

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/list-tax-calculators",
  method: "POST",
  body: {}
)
```

From the response, locate the Manual calculator and capture its `calculatorId`. If only Avalara appears in the list with the merchant already onboarded, **stop and re-dispatch** to `ecom-tax-avalara`.

## Step 2 — Create a tax region for the merchant's country

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/tax-regions",
  method: "POST",
  body: {
    "country": "<siteData.country>",
    "calculatorId": "<manual calculatorId from Step 1>",
    "taxIncludedInPrice": <true|false>
  }
)
```

**`taxIncludedInPrice` defaults by region:**
- US / CA → `false` (tax-exclusive — added at checkout).
- AU / NZ / JP / IN / GB → `true` (tax-inclusive — already in displayed price).
- Other → ask the merchant.

The endpoint may return these errors (handle, don't retry blindly):
- `ALREADY_EXISTS` (409) — there's already a region for this country; either update it or use the existing one.
- `CALCULATOR_ID_NOT_FOUND` (404) — Step 1 returned a stale/invalid `calculatorId`; re-list.
- `INVALID_SUBDIVISION_FORMAT` / `SUBDIVISIONS_NOT_SUPPORTED_FOR_COUNTRY` (400) — subdivision string is wrong format or the country doesn't support per-state regions.
- `CALCULATOR_IS_NOT_SUPPORTED_FOR_THIS_TAX_REGION` (428) — the calculator can't be used in this country.

Capture `taxRegion.id` from the success response.

## Step 3 — Create a tax group

A Wix store also has a "system-defined" all-products tax group available via `POST /billing/v1/tax-groups/list-default-tax-groups` — but for custom rates, create your own group:

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/tax-groups",
  method: "POST",
  body: { "name": "Standard" }
)
```

Capture `taxGroup.id`. For richer taxonomies (Food, Digital, Reduced rate), create multiple groups now.

## Step 4 — Create the (region, group) → rate mapping

This is where the actual rate lives in the Manual calculator. `manualTaxMapping` ties a `taxRegionId` + `taxGroupId` + the `taxRate` (and optional jurisdiction labels for display).

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/manual-tax-mappings",
  method: "POST",
  body: {
    "taxGroupId": "<taxGroup.id from Step 3>",
    "taxRegionId": "<taxRegion.id from Step 2>",
    "taxRate": "<numeric rate>",
    "taxType": "<sales-tax | vat | gst | …>",
    "taxName": "<label shown on invoices — e.g. 'Sales Tax', 'GST'>",
    "jurisdictionName": "<optional, e.g. 'California'>",
    "jurisdictionType": "<optional>"
  }
)
```

**Country-default rates (verify with merchant — rates change):**
- US — varies by **state**; do NOT apply a flat country rate. Either (a) create per-state regions via `subdivision` in Step 2 and a `manualTaxMapping` per state, or (b) recommend the merchant switch to Avalara (`ecom-tax-switch-calculator`).
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

- **US warning.** If `siteData.country = "US"`, surface: "US sales tax requires per-state rates and nexus tracking. The Manual calculator supports it but is high-maintenance; consider Avalara via the Switch Calculator recipe."
- **No duplicate regions.** If Step 2 returns `ALREADY_EXISTS`, ask the merchant before recreating — there's already a region for that country.
- **EU sites → route away.** If `siteData.country` is EU and you somehow landed here (dispatcher should have routed to `ecom-tax-eu-vat`), surface: "EU VAT has special requirements (OSS, reverse-charge, inclusive pricing). Switching to the EU-VAT setup recipe." and re-dispatch.
- **No Avalara collision.** If Step 1 shows the merchant already has Avalara credentials, ask: "You're already on Avalara — configure there instead?" and re-dispatch.
