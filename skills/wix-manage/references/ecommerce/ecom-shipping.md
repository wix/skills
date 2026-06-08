---
name: "Shipping"
description: Shipping setup for an eCommerce store - shipping rates and rules, delivery regions/coverage, store pickup, free-shipping thresholds, rate optimization, and wrong-rate troubleshooting.
---

# Shipping

Set up and tune how a store ships — what rates to charge, which regions are covered, pickup/local-delivery options, free-shipping thresholds, and diagnosing wrong or missing shipping at checkout.

**Shipping & fulfillment is NOT:**
- Tax on shipping or destination tax → see **Tax**.
- The checkout/delivery step conversion itself → see **Checkout & cart**.
- Marking orders fulfilled, updating tracking, bulk fulfillment, invoices, or shipping labels → see **Fulfillment**.
- Order lifecycle (approve/cancel/search an order) → **Orders** when available; refunds/payments → existing Get Paid/payment docs or Dashboard guidance.

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

### Fulfillment handoff

> - Mark orders fulfilled, update tracking, partial/bulk fulfill, find unshipped orders, print invoices, or export shipping labels — tags: `[intent:fulfill-order]`, `[intent:update-tracking]`, `[intent:find-unshipped]`, `[intent:shipping-labels]` · **see [Fulfillment](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-fulfillment)**

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

Map the answer to one of the `intent:*` tags above and re-dispatch. Order-fulfillment requests belong to **Fulfillment**.
