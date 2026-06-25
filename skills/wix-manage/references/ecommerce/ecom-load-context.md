---
name: "eCommerce: Load Context"
description: "eCommerce L1 context loader — calls wix-profile-client/v4/profile/metasite (NOT site-properties) to load siteId, country, currency, industry, last-30-day visitors/orders/GPV. Skip if already loaded."
---

# eCommerce: Load Context

> **L1 loader pattern.** Each L1 domain (eCommerce, Stores, Get-paid, Contacts, …) owns its own context loader. This file is the **eCommerce** L1 loader. Other L1s have their own (e.g. `stores-load-context.md` will detect Catalog V1/V3 for Stores categories). The boilerplate (Step 1 + 2) is small; the **field list and runtime detections differ by L1**.

> **When to run.** Called from the dispatch block of any eCommerce category's `default.md` (Tax, Pricing & promotions, …) before tag-matching. Run **once per session**. If `siteData.country` is already in your conversation context, skip the API calls below and return immediately — every subsequent eCommerce category entry reuses the loaded data.

This is the canonical extract of Steps 1 + 3 from today's `recommend-ecommerce-strategy.md`, scoped to the fields eCommerce categories actually need.

## Step 1 — Resolve siteId

If a `siteId` is not already known, call `ListWixSites`:

```
ListWixSites()
```

- If the merchant referenced a site by name, match it.
- If exactly one site exists, auto-select it.
- Otherwise, ask the merchant which site to use.

**Do not proceed without a `siteId`.**

## Step 2 — Load business profile (the canonical endpoint)

Same call today's `recommend-ecommerce-strategy.md` Step 3 makes. The field list below is the **eCommerce** subset — orchestrator-needed metrics (visitors / orders / GPV → AOV) plus locale/currency/industry used for dispatch tags and recommendations.

```
CallWixSiteAPI(
  url: "https://www.wix.com/wix-profile-client/v4/profile/metasite",
  method: "POST",
  body: {
    "fields": [
      "language",
      "merchant_business_country",
      "suggested_main_industry",
      "suggested_sub_industry",
      "last_30_days_distinct_visitors",
      "last_30_days_orders_count",
      "online_gpv_last_30_days",
      "payment_currency"
    ]
  }
)
```

Extract each field into conversation context as `siteData`:

| Field in response | Maps to | Notes |
|---|---|---|
| `fields.language.aSingleValue.aString` | `siteData.language` | Locale code (e.g. `en-US`) |
| `fields.merchant_business_country.aSingleValue.aString` | `siteData.country` | ISO-3166-1 alpha-2 |
| `fields.suggested_main_industry.aSingleValue.aString` | `siteData.industry` | Used by Pricing orchestrator's goal classification |
| `fields.suggested_sub_industry.aSingleValue.aString` | `siteData.subIndustry` | Optional |
| `fields.last_30_days_distinct_visitors.aSingleValue.aLong` | `siteData.visitors30d` | **Returned as JSON string** — `parseInt` before arithmetic |
| `fields.last_30_days_orders_count.aSingleValue.aLong` | `siteData.orders30d` | parseInt |
| `fields.online_gpv_last_30_days.aSingleValue.aLong` | `siteData.gpv30d` | parseInt |
| `fields.payment_currency.aSingleValue.aString` | `siteData.currency` | ISO-4217 |

Missing fields ⇒ no data for that field (don't fabricate). If `merchant_business_country`, `suggested_main_industry`, or `online_gpv_last_30_days` are missing or null, surface to the merchant: "Cannot resolve required site data: <fields>." and stop.

**Derived value:** `siteData.aov = parseInt(gpv30d) / parseInt(orders30d)` — in `siteData.currency` units.

## Step 2b — Detect catalog presence and load analytics

Call `GetCatalogAnalytics` once here so all downstream pricing/promotions flows can reference `siteData.catalogAnalytics` without re-fetching.

```
CallWixSiteAPI(
  url: "https://manage.wix.com/recommendations/v1/recommendations/get-catalog-analytics-tool",
  method: "POST",
  body: {
    "aggregates": [
      {"op":"count","field":"price"},
      {"op":"min","field":"price"},
      {"op":"max","field":"price"},
      {"op":"avg","field":"profitMargin"},
      {"op":"quantiles","field":"price","q":[0.5,0.75,0.9]},
      {"op":"sum","field":"quantity"},
      {"op":"sum","field":"ordersCount"}
    ],
    "minMarginPct": 0.15
  }
)
```

Save the full `categoryGroups` array as `siteData.catalogAnalytics`. From the "All Products" group extract:
- `siteData.catalogProductCount` = `count()` value (0 if missing or call fails)
- `siteData.hasCatalog` = `siteData.catalogProductCount > 0`

If the call fails, set `siteData.hasCatalog = true` (assume catalog exists; let downstream fail naturally).

**This data is used by all pricing & promotions discount flows.** Flows that require a product catalog (Bundle & Save, Upsell Boost, Stock Mover, Seasonal) MUST check `siteData.hasCatalog` before proceeding — if `false`, stop with: "This site has no products. Set up your product catalog first before running promotions."

## Step 3 — Derive region (used by dispatch context tags)

From `siteData.country`, set `siteData.region`:
- `BR | AR | MX | CL | CO | PE` → `LATAM`
- EU member states (`DE | FR | IT | ES | NL | BE | PL | SE | IE | AT | PT | FI | DK | CZ | HU | GR | RO | BG | HR | SK | SI | LT | LV | EE | CY | MT | LU`) → `EU`
- `JP | CN | KR | SG | AU | NZ | IN | TH | ID | MY | PH | VN | HK | TW` → `APAC`
- otherwise → `null`

(UK is **not** in `region:EU`. AU/NZ are in `region:APAC` but Tax inclusive-pricing rules differ — handled inside Tax promotions.)

## Step 4 — Return

Return immediately. Subsequent eCommerce category dispatches read `siteData.*` from conversation context without re-fetching. If the agent crosses into a different L1 (e.g. Stores) within the same session, that L1's loader will see `siteData.country` already loaded, skip its Steps 1-3, and only fire its own general derivations.

## Architectural rule — general site data only

**This file must contain only general / cross-cutting site data** — fields that **every** category in this L1 needs. It must **not** include L3-category-specific runtime detection (e.g. Tax calculator, Catalog V1/V3, payment-provider state, shipping-coverage state).

Reasoning:
- Per-category detect calls accumulate cost on every session entry, even when the agent never visits that category.
- L3-specific state can use APIs that aren't TPA-public (e.g. the Wix Tax FQDNs are `exposure: INTERNAL`); if the L1 loader depends on them, the entire L1 fails to load. Keeping the loader general-only contains the blast radius.
- Per-category state can change independently of the merchant; loading it eagerly invites stale-data bugs.

**Where category-specific runtime data is detected instead:** inside the category's `default.md` (Step before dispatch) or inside the specific promotion that needs it. The L1 loader does **not** prime per-category fields; the category does its own detection lazily, only when its own intent dispatch fires.

Concretely for the categories we know about:
- **Tax** — calculator detection (Manual vs Avalara) belongs in `ecom-tax.md` (the merged category-doc + dispatcher) or in each Tax promotion when it runs. Not here.
- **Catalog V1/V3 version detection** — belongs in the Stores category loader when Stores migrates. `getCatalogAnalytics` (product count/margin/price) is already loaded here as a cross-cutting concern; V1/V3 detection is a separate, Stores-specific signal.
- **Payments & finance** (when Get-paid migrates) — payment-provider state belongs in `finance-and-payments/get-paid-finance-default.md`.

## What this file does NOT do

- **Does not detect per-category runtime state** (see architectural rule above).
- **Does not load tracking history.** But: if any recipe in this session generates a recommendation to present to the merchant — regardless of which eCommerce category — it MUST load [API: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-recommendation-tracking) and follow the lifecycle: load history before generating (Query), persist as PROPOSED via BatchCreate before presenting, and track execution via MarkExecuting / MarkDone / MarkFailed. This obligation applies to ALL eCommerce domains.
- **Does not load non-eCommerce L1 fields** (catalog V1/V3 version detection, payment provider, …). Those belong inside the owning L1's category-level files (per the architectural rule). Note: `getCatalogAnalytics` (product count, margin, price distribution) IS loaded here as a cross-cutting concern; Catalog V1/V3 version detection is separate and belongs in the Stores category's own loader.
- **Does not enforce dispatch.** The category's `default.md` is what scores tags and picks a promotion — this file only fills general site context.

## Pattern for future L1 loaders

When a new L1 domain is migrated to the routing tree, author a `<l1>-load-context.md` at its root:

- `references/stores/stores-load-context.md` — Stores L1 loader. Steps 1-3 same boilerplate, Step 4 runtime-detects Catalog version (V1/V3) and any other Stores-specific fields.
- `references/get-paid/get-paid-load-context.md` — Get-paid L1 loader. Step 4 inspects payment provider state, enabled methods.
- `references/contacts/contacts-load-context.md` — Contacts L1 loader. Possibly minimal — most CRM ops don't need runtime detection.

Each lives sibling to its L1's category-docs. Each is referenced from every category's `default.md` within its L1. Skip-if-loaded check across L1s makes cross-L1 sessions cost-free.
