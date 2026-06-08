---
name: "Checkout & Cart"
description: Checkout and cart experience - reducing live checkout/cart abandonment, troubleshooting checkout failures and delivery-step drop-off, checkout policies, and pointers to the Dashboard-managed checkout settings (guest checkout, minimum order, custom fields).
---

# Checkout & Cart

Improve and fix the checkout/cart experience before an order is placed - reduce live checkout drop-off, diagnose why customers cannot complete checkout, configure checkout policies, and adjust the checkout settings that drive conversion.

**Checkout & cart is NOT:**
- Shipping rates / regions / pickup setup → see **Shipping & fulfillment** (though delivery-step friction is the #1 abandonment cause and is handled here + there).
- Discounts / coupons applied at checkout → see **Pricing & promotions**.
- Tax shown at checkout → see **Tax**.
- Recovery after the shopper already left checkout → see **Abandoned Carts**.

> **Heads-up — much of checkout config is Dashboard-only.** The public Checkout Settings API covers only checkout-footer **policies** and payment-step **checkboxes**. Guest checkout, minimum order amount, custom checkout fields, and checkout upsell are **not exposed via a TPA-public API** — route the merchant to the Wix Dashboard for those.

> **Before dispatching** — confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-load-context). Skip if already loaded.
>
> **Promotion dispatch.** Score each entry below by the merchant's query → `intent:*` tags. Load the highest-scoring entry. No match → base recipe.

### Reduce abandonment & troubleshoot (recipes)

> - [Reduce checkout/cart abandonment (delivery-step friction)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-reduce-abandonment) — tags: `[intent:reduce-abandonment]` · priority 0
> - [Troubleshoot checkout failure / delivery drop-off](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-troubleshoot-dropoff) — tags: `[intent:troubleshoot-checkout]` · priority 0
> - [Agentic readiness / test agentic checkout](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-agentic-readiness) — tags: `[intent:agentic]` · priority 0 · *catalog data-quality audit + programmatic test-checkout; UCP enablement is Dashboard*
> - [Store health monitor (periodic)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-store-health) — tags: `[intent:store-health]` · priority 0 · *test checkout + config-drift + anomaly checks*
> - Recover abandoned checkouts after the shopper leaves — tags: `[intent:recover-email]`, `[intent:view-abandoned]`, `[intent:recovery-link]` · **see [Abandoned Carts](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-abandoned-carts)**

### Checkout configuration

> - [Set checkout policies / payment-step checkboxes](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/checkout-settings) — tags: `[intent:checkout-policies]` · **API doc, no skill** (per §7.5 — Checkout Settings API)
> - Enable **guest checkout** — tags: `[intent:guest-checkout]` · **Wix Dashboard** (Settings → Checkout) — no TPA-public API
> - Set **minimum order amount** — tags: `[intent:min-order]` · **Wix Dashboard** — no TPA-public API
> - **Customize checkout fields** / add a field — tags: `[intent:custom-fields]` · **Wix Dashboard** (custom checkout fields) — no TPA-public API
> - **Product recommendations at checkout** — tags: `[intent:checkout-recs]` · **Wix Dashboard** / Stores upsell settings — no TPA-public API

## Base recipe (fallback)

If nothing matches, ask **one** clarifying question:

> "Do you want to (a) **reduce live checkout drop-off**, (b) **configure** checkout (guest checkout, minimum order, fields — most are in the Wix Dashboard), or (c) **recover shoppers who already abandoned checkout**?"

Map the answer to an `intent:*` tag and re-dispatch. For recovery/recapture, route to **Abandoned Carts**. For configuration intents with no public API, give the merchant the Dashboard path directly.
