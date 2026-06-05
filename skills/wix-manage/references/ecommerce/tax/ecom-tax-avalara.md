---
name: "Configure Tax (Avalara)"
description: Avalara setup — DASHBOARD-ONLY. The Wix Avalara credentials API (`/billing/v1/avalara-tax-credentials`) and the Avalara address-validation API (`/billing/v1/validate-taxable-address`) are NOT TPA-public, so the MCP cannot wire up Avalara directly. This skill instructs the merchant to install/configure Avalara via the Wix Dashboard, then routes the configurable parts (regions + groups) to TPA-public APIs.
---

# Configure Tax (Avalara)

**🚫 The Avalara credentials API is not TPA-public.** Wix Avalara is exposed via a Wix-internal SPI (Tax Calculation Integration Service Plugin) and a dashboard onboarding flow. The MCP **cannot** create or update Avalara credentials, validate addresses against Avalara, or directly toggle Avalara-as-the-calculator from the API. What the merchant must do via the **Wix Dashboard**:

1. **Install the Avalara app** (Wix App Market → search "Avalara").
2. **Onboard via the Avalara setup wizard** — supply account ID, license key, company code, company address. This provisions Avalara as a tax calculator on the site.
3. **Activate Avalara per region** in the dashboard's Tax settings (or use the API steps below to create regions bound to Avalara's `calculatorId` once Avalara is installed).

The merchant must complete those dashboard steps **before** this recipe's API steps work.

## What this recipe DOES via TPA-public APIs

Once Avalara is installed via the dashboard, we can use `GET /billing/v1/list-tax-calculators` to obtain Avalara's `calculatorId`, then create tax regions bound to that calculatorId. No `manual-tax-mappings` are needed for Avalara regions — Avalara handles rate lookup.

## APIs used (TPA-public only)
- `GET /billing/v1/list-tax-calculators` — discover Avalara's `calculatorId` (only present if the merchant installed Avalara via the dashboard).
- `POST /billing/v1/tax-regions` — create tax regions bound to Avalara's `calculatorId`.
- `POST /billing/v1/calculate-tax` — sanity-check a calculation.

## Step 1 — Confirm Avalara is installed

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/list-tax-calculators",
  method: "GET"
)
```

Look for an entry identifying Avalara in the response. If absent, the merchant hasn't installed Avalara via the dashboard yet — **stop** and tell the merchant: "Avalara isn't installed on this site. Install via Wix App Market → search 'Avalara' and complete onboarding. Then re-run this." Optionally re-dispatch to `ecom-tax-configure` for a Wix-Manual setup in the meantime.

If Avalara is present, capture its `calculatorId`.

## Step 2 — Create tax regions bound to Avalara

For each country the merchant ships to under Avalara:

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/tax-regions",
  method: "POST",
  body: {
    "country": "<ISO country>",
    "calculatorId": "<Avalara calculatorId from Step 1>",
    "taxIncludedInPrice": <true|false>
  }
)
```

`taxIncludedInPrice` defaults same as `ecom-tax-configure` Step 2 (US/CA exclusive; EU/UK/AU/NZ/JP inclusive). Watch for `CALCULATOR_IS_NOT_SUPPORTED_FOR_THIS_TAX_REGION` (428) — Avalara may not cover every country; for those, fall back to a Manual region.

**Do NOT create `manual-tax-mappings`** for Avalara regions — Avalara handles its own rate lookup.

## Step 3 — Sanity-check via CalculateTax

```
CallWixSiteAPI(
  url: "https://www.wixapis.com/billing/v1/calculate-tax",
  method: "POST",
  body: {
    "estimateTaxRequestDetails": {
      "lineItems": [{
        "taxGroupId": "<a default group, see ecom-tax-configure Step 3>",
        "price": { "amount": "100.00", "currency": "<siteData.currency>" },
        "addressIndex": 0
      }],
      "addresses": [{ "country": "<region from Step 2>", "subdivision": "<optional>" }]
    }
  }
)
```

The returned tax amount is what Avalara would charge. Surface it to the merchant.

## Step 4 — Confirm to merchant

> "Avalara confirmed installed · **N** regions configured to use Avalara · Live calculations route to Avalara. Existing Manual regions remain — keep them or switch them via the Switch Tax Calculator recipe."

## Guardrails (inline)

- **Dashboard prerequisite.** This recipe requires Avalara already installed via the merchant's Wix Dashboard. The Avalara credentials/onboarding API is not TPA-public; the MCP cannot create Avalara accounts or store credentials.
- **No address pre-flight from the API.** The validate-taxable-address endpoint is also not TPA-public. If a merchant's ship-from address is invalid in Avalara, calculations will fail later — there's no API-level pre-flight; the dashboard handles validation at install time.
- **Don't blanket-replace Manual regions.** Switching an existing Manual region to Avalara requires `PATCH /billing/v1/tax-regions/{id}` with the new `calculatorId` — existing `manual-tax-mappings` for that region become inert (Avalara doesn't use them). Confirm explicitly before patching live regions.
