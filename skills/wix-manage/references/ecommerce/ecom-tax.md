---
name: "Tax"
description: Tax configuration for an eCommerce site — calculator choice (Wix Manual vs Avalara), tax regions, tax groups, inclusive/exclusive pricing, EU VAT, and tax-calculation troubleshooting.
---

# Tax

Set up and manage how your store calculates and collects tax — what calculator to use, which regions to cover, how rates apply to products, and how to diagnose wrong tax on orders.

**Tax is NOT:**
- Invoicing / order tax breakdowns → see **Orders**.
- Product pricing or VAT-inclusive display in product listings → see **Catalog**.
- Country availability for shipping → see **Shipping & fulfillment**.

> **Before dispatching** — confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-load-context). Skip if already loaded.
>
> **Promotion dispatch.** Score each entry below by (a) the merchant's query → `intent:*` tags, (b) MerchantContext → context tags. Load the **highest-scoring** entry. Ties → highest `priority`. No match → follow the base recipe at the bottom.
>
> - [Configure tax (Avalara)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-tax-avalara) — tags: `[intent:configure, calculator:AVALARA]` · priority 1
> - [Configure tax (EU VAT)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-tax-eu-vat) — tags: `[intent:configure, region:EU]` · priority 1
> - [Configure tax (Wix Manual)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-tax-configure) — tags: `[intent:configure]` · priority 0
> - [Switch tax calculator](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-tax-switch-calculator) — tags: `[intent:switch-calculator]` · priority 0
> - [Audit tax setup](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-tax-audit) — tags: `[intent:audit]` · priority 0
> - [Tax calculation wrong](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-tax-troubleshoot-calc-wrong) — tags: `[intent:troubleshoot]` · priority 0

## Tag matching

The agent matches the merchant's natural-language query to an `intent:*` tag (per the keyword cues each promotion file lists in its `description`), AND matches MerchantContext to any context tags. A promotion's tags must ALL be satisfied for it to be eligible. Among eligible promotions, the one with the highest tag-count wins; ties broken by `priority`.

### Worked examples

| Merchant query | MerchantContext | Match |
|---|---|---|
| "Set up VAT for Germany" | `country: DE` → `region: EU` | `ecom-tax-eu-vat` (2 tags matched) |
| "Configure tax for my US store" | `country: US`, `calculator: WIX_MANUAL` | `ecom-tax-configure` (1 tag) |
| "Set up Avalara" | `country: US`, `calculator: WIX_MANUAL` | `ecom-tax-avalara` (1 tag: `intent:configure`; the `calculator:AVALARA` tag is intentionally NOT matched because the merchant is ABOUT to switch — they don't have it yet. Avalara wins on intent + priority 1.) |
| "Audit my taxes" | any | `ecom-tax-audit` |
| "Tax on order #1234 is wrong" | any | `ecom-tax-troubleshoot-calc-wrong` |
| "Switch to Avalara" | any | `ecom-tax-switch-calculator` |

## Base recipe (fallback)

If no promotion matches, the merchant's intent is unclear. Ask **one** clarifying question:

> "Do you want to **set up tax** for the first time, **change** your current calculator (e.g. switch to Avalara), **review** your existing setup, or **fix** a wrong tax amount on an order?"

Map the answer to one of the four `intent:*` tags and re-dispatch.
