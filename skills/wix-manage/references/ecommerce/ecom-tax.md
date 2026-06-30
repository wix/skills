---
name: "Tax"
description: Tax dispatcher — routes any tax query (set up tax, EU VAT, GST/sales tax, VAT for a specific country, wrong tax on an order, Avalara setup). **Always load this dispatcher first for any tax-related question** — the leaf recipes have lean descriptions and the routing rules, country lists, trigger keywords, and boundary rules (UK ≠ EU, Avalara → dashboard) live here.
---

# Tax

Set up and manage how your store calculates and collects tax — what calculator to use, which regions to cover, how rates apply to products, and how to diagnose wrong tax on orders.

**Tax is NOT:**
- Invoicing / order tax breakdowns → see **Orders**.
- Product pricing or VAT-inclusive display in product listings → see **Catalog**.
- Country availability for shipping → see **Shipping & fulfillment**.

> **Before dispatching** — confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context). Skip if already loaded.
>
> **Promotion dispatch.** Score each entry below by (a) the merchant's query → `intent:*` tags, (b) MerchantContext → context tags. Load the **highest-scoring** entry. Ties → highest `priority`. No match → follow the base recipe at the bottom.
>
> - [Configure tax (EU VAT)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/tax-configure-eu-vat) — tags: `[intent:configure, region:EU]` · priority 1
> - [Configure tax (Wix Manual)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/tax-configure-wix-manual) — tags: `[intent:configure]` · priority 0
> - [Tax calculation wrong](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/tax-calculation-wrong) — tags: `[intent:troubleshoot]` · priority 0
>
> **Routing rule:** After identifying the matching skill above, call `ReadFullDocsArticle` on it BEFORE making any API calls or offering a diagnosis. The diagnostic steps, exact API endpoints, and guardrails live in the child skill — not in this dispatcher. Do NOT improvise from the dispatcher context alone. If the article returns a 404, try the next-best match from the list above rather than proceeding without a recipe.

## Promotion catalog (rich routing detail)

The leaf README descriptions are intentionally lean (one-liner + back-pointer here). All routing detail — country lists, trigger keywords, boundary rules — lives in this dispatcher and is the load-bearing source of truth.

### Tax: Configure (Wix Manual)
- **Slug:** `tax-configure-wix-manual`
- **Tags:** `[intent:configure]` · priority 0 (default for non-EU configure)
- **Use for:** non-EU countries. Concrete examples:
  - **AU** — GST 10%, tax-inclusive
  - **NZ** — GST 15%, tax-inclusive
  - **GB** — VAT 20%, tax-inclusive (UK is NOT EU since Brexit)
  - **US** — per-state sales tax (use `subdivision` per state; do NOT apply a flat country rate)
  - **CA** — federal GST 5% + provincial; use `subdivision` per province
  - **JP** — consumption tax 10%, tax-inclusive
  - **IN** — varies; tax-inclusive
  - Other non-EU: ask the merchant for the rate and pricing mode.
- **Trigger keywords:** "set up tax", "configure sales tax", "charge GST", "I sell in <country> — set up tax", "add VAT for my <non-EU> shop", "do I need to charge tax", "configure tax manually".
- **NOT for:** EU member states (use EU VAT). NOT for Avalara setup (dashboard-only — direct merchant to App Market install). NOT for per-order tax diagnostics (use Calculation Wrong).

### Tax: Configure (EU VAT)
- **Slug:** `tax-configure-eu-vat`
- **Tags:** `[intent:configure, region:EU]` · priority 1 (beats Wix Manual when both match)
- **Use for:** EU27 member states only. Concrete examples:
  - **DE** 19%, **FR** 20%, **IT** 22%, **ES** 21%, **NL** 21%, **BE** 21%, **AT** 20%, **SE** 25%, **DK** 25%, **FI** 24%, **GR** 24%, **PT** 23%, **IE** 23%, **PL** 23%, **CZ** 21%, **HU** 27%, **RO** 19%, **SK** 23%, **SI** 22%, **HR** 25%, **BG** 20%, **EE** 22%, **LV** 21%, **LT** 21%, **LU** 17%, **MT** 18%, **CY** 19%.
- **Trigger keywords:** "set up VAT", "configure VAT for EU customers", "I sell to Germany / France / <EU country>", "charge VAT in the EU", "EU VAT compliance", "OSS setup", "B2B reverse-charge".
- **NOT for:** **UK (GB)** — Brexit, UK is no longer EU; route to Wix Manual. NOT for non-EU countries. NOT for Avalara setup. NOT for per-order tax diagnostics.

### Tax: Calculation Wrong
- **Slug:** `tax-calculation-wrong`
- **Tags:** `[intent:troubleshoot]` · priority 0
- **Use for:** wrong / missing / unexpected tax on a **SPECIFIC** order or checkout. Per-order diagnostic only.
- **Trigger keywords:** "$0 tax on order #1234", "customer in Texas was charged the wrong tax", "no VAT on a German order", "8% tax instead of 8.25%", "tax came out wrong on this order", "why was no tax charged on this order".
- **NOT for:** General "is my tax setup correct?" without a specific order — that's a Wix Dashboard review.

## Boundary rules (load-bearing — read before re-routing)

- **UK is NOT EU.** `country:GB` → Wix Manual, never EU VAT. Brexit removed UK from the EU27. The agent must not be misled by "UK uses VAT" — VAT name overlaps but the configuration path is different (Wix Manual for GB; the EU VAT recipe will reject GB).
- **Avalara installed → dashboard-only.** If `list-tax-calculators` shows Avalara onboarded for the merchant, all configure intents redirect to the Wix Dashboard — the Avalara credentials API is not TPA-public.
- **Per-order vs site-wide.** Order ID in the merchant's question → troubleshoot. "Tax setup looks wrong" without an order → review configuration via the Wix Dashboard, not a recipe.

## Tag matching

The agent matches the merchant's natural-language query to an `intent:*` tag (per the trigger keywords in each promotion above), AND matches MerchantContext to any context tags. A promotion's tags must ALL be satisfied for it to be eligible. Among eligible promotions, the one with the highest tag-count wins; ties broken by `priority`.

### Worked examples

| Merchant query | MerchantContext | Match | Why |
|---|---|---|---|
| "Set up VAT for Germany" | `country: DE` → `region: EU` | `ecom-tax-eu-vat` | 2 tags matched (intent:configure + region:EU) |
| "Configure tax for my US store" | `country: US` | `ecom-tax-configure` | 1 tag (intent:configure); no `region:EU` |
| "I sell in the UK, set up 20% VAT" | `country: GB` | `ecom-tax-configure` | **UK ≠ EU** boundary rule overrides surface match; GB is not in EU27 |
| "Set up Avalara for my US sales tax" | `country: US`, no Avalara installed | (stop) | Avalara setup is dashboard-only; direct merchant to App Market |
| "Tax on order #1234 is wrong" | any | `ecom-tax-troubleshoot-calc-wrong` | order ID present |
| "I want to handle tax for my store" | empty / minimal | (fallback) | No country, no rate, no order — ask one clarifying question |

## Base recipe (fallback)

If no promotion matches — typically because the merchant gave no country, no rate, no order ID, and no calculator preference — the intent is unclear. **Do NOT pick a leaf at random.** Ask **one** clarifying question:

> "Do you want to **set up tax** for the first time (and which country are you selling in?), or **fix** a wrong tax amount on a specific order?"

Map the answer to one of the `intent:*` tags and re-dispatch. Make no API calls before the merchant answers.
