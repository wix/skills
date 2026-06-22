---
name: "Pricing & Promotions"
description: Pricing & Promotions boundary owner — discounts, coupons, sales, ribbons, bundles. **Always load this dispatcher first when a question touches both discount work and refunds, payments, product-price edits, or shipping rates** — the rules for which side owns each topic live in this file, not in this README line.
---

# Pricing & Promotions

Discount rules, coupon codes, sales, ribbons, bundles, tiered pricing, and the strategic side of "run a promotion to grow revenue".

> **Routing rule (READ FIRST).** Any merchant query that mentions BOTH a Pricing-side topic (discount, coupon, sale, ribbon, bundle, promotion strategy) AND a NON-pricing-side topic (refunding a past order, processing a payment, editing the product's base price, shipping rates) MUST be answered by loading this dispatcher first AND the relevant other category (refunds → Get Paid / Dashboard; price → Catalog; shipping rates → Shipping). Do NOT route mixed queries from the WixREADME index alone; the binding decision lives here.

**Pricing & promotions is NOT:**
- The product price itself or its description/image → see **Catalog** (those are product fields).
- A standing $0 shipping option/region rate → see **Shipping & fulfillment**.
- Refunding a previous discounted order → route to verified Get Paid/payment docs or Dashboard guidance.

> **Before dispatching** — confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context). Skip if already loaded.
>
> **Promotion dispatch.** Score each entry below by (a) the merchant's query → `intent:*` tags, (b) MerchantContext → context tags. Load the **highest-scoring** entry. Ties → highest `priority`. No match → follow the base recipe at the bottom.
>
> **Do not fall back to legacy `setup-*` or `flow-*` pricing slugs.** The skills below replaced earlier `…/skills/setup-coupons` and `…/skills/flow-<name>` articles during the routing-tree migration. If a slug below returns a transient 404 (rawdocs ingestion delay), **retry the same URL after a brief pause** — do NOT load any `setup-coupons` or `flow-*` legacy version even if it appears in the WixREADME index; that content is stale pre-migration material that contradicts this dispatcher.

### Actions — concrete operations

> - [Create coupon](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-coupon) — tags: `[intent:create-coupon]` · priority 0
> - [Create discount rule (auto-apply)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-discount-rule) — tags: `[intent:create-discount-rule]` · priority 0
> - [Add sale ribbon / new ribbon](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-discount-rule) — tags: `[intent:add-ribbon]` · priority 0 · *ribbons are configured via Discount Rules; same recipe*
> - [Schedule a future sale](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-discount-rule) — tags: `[intent:schedule-sale]` · priority 0 · *uses Discount Rules with `startTime` in the future*

### Business flows — the orchestrator

The single business-flow orchestrator (`recommend-ecommerce-strategy`) handles all strategic discount intents. It classifies internally (SEASONAL / UPSELL_BOOST / STOCK_MOVER / BUNDLE_AND_SAVE / ABANDONED_CART) and loads its `goal-*` / `flow-*` support files from the kept ecommerce-root siblings.

> - [Run a sale / promotion strategy](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-e-commerce-strategy) — tags: `[intent:run-a-sale]` · priority 0
> - [Boost my business / increase sales](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-e-commerce-strategy) — tags: `[intent:boost-business]` · priority 0
> - [Seasonal / holiday promotion](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-e-commerce-strategy) — tags: `[intent:seasonal-promo]` · priority 0
> - [Clearance / move slow stock](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-e-commerce-strategy) — tags: `[intent:clearance]` · priority 0
> - [Increase AOV (bundle / upsell)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-e-commerce-strategy) — tags: `[intent:increase-aov]` · priority 0
>
> **If the orchestrator above returns a 404** — do not stop. Classify the merchant intent directly and load the matching goal skill via `ReadFullDocsArticle`, then follow its routing chain into the flow skill:
> - Holiday / event / date mentioned (SEASONAL — takes priority over all other signals) → [Goal: Seasonal Revenue](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-seasonal-revenue)
> - "Boost sales", "increase AOV", "upsell", "spend more" (UPSELL_BOOST) → [Goal: Increase AOV](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-increase-aov)
> - "Clearance", "slow stock", "overstock", "move inventory" (STOCK_MOVER) → [Goal: Clear Inventory](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-clear-inventory)
> - "Bundle", "cross-sell", "buy together", "more items per order" (BUNDLE_AND_SAVE) → [Goal: Drive Cross-Sells](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-drive-cross-sells)

### Info / troubleshoot / recommendation

> - [Discount not applying — diagnose](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-discount-not-applying) — tags: `[intent:troubleshoot]` · priority 0
> - [View active discounts (Coupons API)](https://dev.wix.com/docs/api-reference/business-solutions/coupons/coupons/query-coupons) — tags: `[intent:view-active-discounts]` · priority 0 · **API doc, no skill** (per §7.5)
> - [View active discounts (Discount Rules API)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/discount-rules/query-discount-rules) — tags: `[intent:view-active-rules]` · priority 0 · **API doc, no skill**
> - [Coupon usage stats](https://dev.wix.com/docs/api-reference/business-solutions/coupons/coupons/get-coupon-usage) — tags: `[intent:coupon-usage-stats]` · priority 0 · **API doc, no skill**
> - Competitive pricing check (how do my prices compare?) — tags: `[intent:competitive-pricing]` · *no Wix API for competitor data — advise the merchant to benchmark externally (Google Shopping / market research); Wix only exposes their own catalog prices via Catalog API*

### Cross-category routes (handled in another category)

> - [Change product price](https://dev.wix.com/docs/api-reference/business-solutions/stores/products-v3/update-product) — tags: `[intent:change-price]` · *price is a product field — Catalog API*
> - [Set compare-at price](https://dev.wix.com/docs/api-reference/business-solutions/stores/products-v3/update-product) — tags: `[intent:set-compare-at]` · *Catalog*
> - [Free shipping over $X (promo rule)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-discount-rule) — tags: `[intent:free-shipping-promo]` · *belongs here as a promo rule; a $0 shipping rate is Shipping*

## Tag matching

The agent matches the merchant's natural-language query to an `intent:*` tag (cues are in each promotion file's `description`), AND matches MerchantContext to any context tags. A promotion's tags must ALL be satisfied for it to be eligible. Among eligible promotions, the one with the highest tag-count wins; ties broken by `priority`.

### Worked examples

| Merchant query | MerchantContext | Match |
|---|---|---|
| "Create a 20% off coupon" | any | `ecom-pricing-create-coupon` via `[intent:create-coupon]` |
| "Run a Black Friday sale" | any | `recommend-ecommerce-strategy` via `[intent:run-a-sale]` (orchestrator classifies as SEASONAL internally) |
| "Help me boost my sales" | any | `recommend-ecommerce-strategy` via `[intent:boost-business]` |
| "My coupon code XMAS isn't working" | any | `ecom-pricing-troubleshoot-not-applying` |
| "Show me my active discounts" | any | `query-coupons` API doc (no skill — per §7.5) |
| "Change the price of product Y" | any | Catalog cross-route (re-dispatch to Catalog when that category exists) |

## Base recipe (fallback)

If nothing matches, the merchant query is too vague. Ask **one** clarifying question:

> "Do you want to (a) **create** a specific discount/coupon now, (b) **strategize** a sale or promotion campaign, or (c) **fix** a discount that isn't applying?"

Map the answer → re-dispatch:
- (a) → `ecom-pricing-create-coupon` (default for "create a discount")
- (b) → `recommend-ecommerce-strategy`
- (c) → `ecom-pricing-troubleshoot-not-applying`
