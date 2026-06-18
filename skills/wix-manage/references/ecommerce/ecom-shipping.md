---
name: "Shipping"
description: Shipping boundary owner for eCommerce — delivery profiles, shipping options, rates, regions, free shipping, pickup, and local delivery. **Always load this dispatcher first whenever a question touches shipping setup** — the rules for which side owns rate-setup, coverage gaps, free shipping, pickup vs. mark-shipped, tracking, and labels live in this file, not in this README line.
---

# Shipping

Configure what customers see at the checkout delivery step: delivery profiles, shipping options, rate structures, coverage regions, free shipping thresholds, and pickup/local-delivery setup.

> **Routing rule (READ FIRST).** Any merchant query that mentions BOTH a shipping-setup topic (rates, regions, pickup, free shipping, wrong-rate, coverage gap) AND a post-purchase / order-execution topic (mark shipped, update tracking, partial/bulk fulfill, shipping labels, "find unshipped orders") MUST be answered by loading this dispatcher first AND [Fulfillment](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/fulfillment) — even if the WixREADME index already describes both. Do NOT route mixed shipping+fulfillment questions from the README index alone; the binding decision lives here.

**Shipping is NOT:**
- Mark shipped, update tracking, create/bulk fulfillments → see **Fulfillment**.
- Checkout drop-off before an order is placed → see **Checkout & Cart**.
- Discounts/coupons applied at checkout → see **Pricing & Promotions**.
- Tax shown at checkout → see **Tax**.
- Abandoned cart recovery after the shopper left → see **Abandoned Carts**.

> **Before dispatching** — confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context). Skip if already loaded.
>
> **Promotion dispatch.** Score each entry below by the merchant's query → `intent:*` tags. Load the highest-scoring entry. No match → base recipe.

### Shipping setup actions

> - [Fix coverage gaps](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-fix-coverage-gaps) — tags: `[intent:fix-coverage]`, `[intent:coverage-gap]`, `[intent:region-missing]` — priority 0 — *detect regions with zero shipping options and create standard shipping for them*
> - [Add free shipping](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-add-free-shipping) — tags: `[intent:free-shipping]`, `[intent:add-free-shipping]`, `[intent:free-shipping-threshold]` — priority 0 — *AOV-calibrated free shipping threshold*
> - [Optimize shipping rates](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-optimize-rates) — tags: `[intent:optimize-rates]`, `[intent:flat-to-tiered]`, `[intent:per-item-penalty]`, `[intent:rate-structure]` — priority 0 — *flat-to-tiered conversion, tier gap detection, per-item penalty removal*
> - [Set up pickup & local delivery](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-set-up-pickup-local-delivery) — tags: `[intent:pickup]`, `[intent:local-delivery]`, `[intent:store-pickup]` — priority 0 — *Delivery Profiles API: discover Pickup carrier, add region, attach carrier with backup rate*

### Lookup and reference routes

> - Apply previously generated shipping recommendations — tags: `[intent:apply-recommendations]` — **recipe route** — use [Recipe: Apply Shipping Recommendations](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recipe-apply-shipping-recommendations)
> - Check carrier rates via API — tags: `[intent:carrier-discovery]` — **API reference** — use [API: Shipping Delivery](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-shipping)

## API and Dashboard status

| Capability | Route | Status |
|---|---|---|
| Query delivery profiles | `POST /ecom/v1/delivery-profiles/query` | TPA-public |
| Add delivery region to profile | `POST /ecom/v1/delivery-profiles/{id}/delivery-region` | TPA-public |
| List installed delivery carriers | `GET /ecom/v1/delivery-profiles/installed-carriers` | TPA-public |
| Add delivery carrier to region | `POST /ecom/v1/delivery-profiles/add-delivery-carrier` | TPA-public |
| Query shipping options | `POST /ecom/v1/shipping-options/query` | TPA-public |
| Create shipping option | `POST /ecom/v1/shipping-options` | TPA-public |
| Update shipping option | `PATCH /ecom/v1/shipping-options/{id}` | TPA-public |
| Delete shipping option | `DELETE /ecom/v1/shipping-options/{id}` | TPA-public |
| Buy / export shipping labels | Wix Dashboard | Dashboard-managed in this repo |
| Third-party carrier integration (Shippo, etc.) | Wix Dashboard | Dashboard-managed in this repo |

## Tag matching examples

| Merchant query | Match |
|---|---|
| "Some customers can't see any shipping options" | `ecom-shipping-fix-coverage-gaps` via `intent:coverage-gap` |
| "Add free shipping over $75" | `ecom-shipping-add-free-shipping` via `intent:free-shipping` |
| "My shipping rates are too high" | `ecom-shipping-optimize-rates` via `intent:optimize-rates` |
| "Set up in-store pickup" | `ecom-shipping-set-up-pickup-local-delivery` via `intent:pickup` |
| "I shipped order #1052" | Fulfillment category, not Shipping |
| "Add tracking to order #1052" | Fulfillment category, not Shipping |

## Base recipe

If nothing matches, ask **one** clarifying question:

> "Do you want to **fix regions where customers can't checkout** (coverage gaps), **add or adjust free shipping**, **optimize your rate structure**, or **set up pickup/local delivery**?"

Route post-purchase operations (mark shipped, tracking, labels) to **Fulfillment**.

## Audit note

This file is not redundant with Wix API docs because it owns the routing boundary between shipping setup, fulfillment, checkout, and Dashboard-only label work. The child shipping skills carry the mutation guardrails and step-by-step API procedures; this file keeps the intent-based dispatch decision and boundary definitions.
