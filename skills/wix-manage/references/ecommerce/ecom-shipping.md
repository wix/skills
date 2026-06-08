---
name: "Shipping & Fulfillment"
description: Shipping & fulfillment for an eCommerce store — shipping rates and rules, delivery regions/coverage, store pickup, free-shipping thresholds, rate optimization, AND order fulfillment (mark fulfilled, tracking, partial/bulk fulfillment, finding unshipped orders).
---

# Shipping & Fulfillment

Set up and tune how a store ships — what rates to charge, which regions are covered, pickup/local-delivery options, free-shipping thresholds, and diagnosing wrong or missing shipping at checkout.

**Shipping & fulfillment is NOT:**
- Tax on shipping or destination tax → see **Tax**.
- The checkout/delivery step conversion itself → see **Checkout & cart**.
- Order lifecycle (approve/cancel/refund an order) → **Orders** / **Finance & payments**.

> **Before dispatching** — confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-load-context). Skip if already loaded.
>
> **Promotion dispatch.** Score each entry below by (a) the merchant's query → `intent:*` tags, (b) MerchantContext → context tags. Load the **highest-scoring** entry with `ReadFullDocsArticle`. Ties → highest `priority`. No match → follow the base recipe at the bottom.
>
> **API reference.** All shipping endpoints (Shipping Options + Delivery Profiles) are documented inline in [Shipping API Reference](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-shipping-api) — there is no public `dev.wix.com` docs page for them, so that file is the authoritative spec. The recipes below link to it where needed.

### Actions — set up shipping

> - [Set up shipping rates / rules](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-shipping-setup-rates) — tags: `[intent:setup-rates]` · priority 0
> - [Set up delivery regions / coverage](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-shipping-setup-regions) — tags: `[intent:setup-regions]` · priority 0
> - [Set up store pickup / local delivery](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-shipping-setup-pickup) — tags: `[intent:setup-pickup]` · priority 0
> - [Add free shipping over $X](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-shipping-free-shipping) — tags: `[intent:free-shipping]` · priority 0

### Optimize & fix

> - [Optimize shipping rates (flat ↔ tiered, gaps)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-shipping-optimize-rates) — tags: `[intent:optimize-rates]` · priority 0
> - [Fix coverage gaps (regions with no shipping option)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-shipping-fix-coverage) — tags: `[intent:fix-coverage]` · priority 0

### Troubleshoot

> - [Shipping rate incorrect (customer charged wrong shipping)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-shipping-optimize-rates) — tags: `[intent:rate-incorrect]` · priority 0 · *audit rates via the Rate Pricing Sanity guardrail, then correct the rate structure*

### Fulfillment — ship orders

> - [Fulfill orders & tracking (mark fulfilled, tracking, partial, bulk)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-shipping-fulfill-orders) — tags: `[intent:fulfill-order]` · priority 0 · *Fulfillments API: mark fulfilled, add tracking, partial & bulk fulfill*
> - Find unshipped / pending-fulfillment orders — tags: `[intent:find-unshipped]` · **API doc, no skill** — `POST https://www.wixapis.com/ecom/v1/orders/search` filtering `fulfillmentStatus = NOT_FULFILLED`
> - Generate invoice / packing slip for an order — tags: `[intent:order-invoice]` · **API doc, no skill** — eCommerce Orders **Invoice** API (`wix.ecom.orders.v1.invoice`); shipping-label export is Dashboard

## Tag matching

The agent matches the merchant's natural-language query to an `intent:*` tag (cues are in each file's `description`), AND matches MerchantContext to any context tags (e.g. `country`, `region`). All of an entry's tags must be satisfied for it to be eligible; highest tag-count wins; ties → `priority`.

### Worked examples

| Merchant query | MerchantContext | Match |
|---|---|---|
| "Set up free shipping over $50" | any | `ecom-shipping-free-shipping` via `[intent:free-shipping]` |
| "How much should I charge for shipping?" | any | `ecom-shipping-setup-rates` via `[intent:setup-rates]` |
| "I want customers to pick up from my shop" | any | `ecom-shipping-setup-pickup` via `[intent:setup-pickup]` |
| "Some regions have no shipping option" | any | `ecom-shipping-fix-coverage` via `[intent:fix-coverage]` |
| "A customer was charged the wrong shipping" | any | `ecom-shipping-optimize-rates` via `[intent:rate-incorrect]` (runs rate-sanity guardrail first) |

## Base recipe (fallback)

If nothing matches, the merchant's intent is unclear. Ask **one** clarifying question:

> "Do you want to **set up** shipping (rates, regions, or pickup), **add free shipping**, **optimize** your existing rates, or **fix** a region with no shipping option?"

Map the answer to one of the `intent:*` tags above and re-dispatch. (Order-fulfillment requests — mark fulfilled, add tracking, print labels — belong to **Orders**, not this category.)
