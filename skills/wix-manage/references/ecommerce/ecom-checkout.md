---
name: "Checkout & Cart"
description: Checkout and cart experience — reducing checkout/cart abandonment, troubleshooting checkout failures and delivery-step drop-off, checkout policies, and pointers to the Dashboard-managed checkout settings (guest checkout, minimum order, custom fields).
---

# Checkout & Cart

Improve and fix the checkout/cart experience — reduce abandonment, diagnose why customers can't complete checkout, configure checkout policies, and adjust the checkout settings that drive conversion.

**Checkout & cart is NOT:**
- Shipping rates / regions / pickup setup → see **Shipping & fulfillment** (though delivery-step friction is the #1 abandonment cause and is handled here + there).
- Discounts / coupons applied at checkout → see **Pricing & promotions**.
- Tax shown at checkout → see **Tax**.

> **Heads-up — much of checkout config is Dashboard-only.** The public Checkout Settings API covers only checkout-footer **policies** and payment-step **checkboxes**. Guest checkout, minimum order amount, custom checkout fields, and checkout upsell are **not exposed via a TPA-public API** — route the merchant to the Wix Dashboard for those.

> **Before dispatching** — confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-load-context). Skip if already loaded.
>
> **Promotion dispatch.** Score each entry below by the merchant's query → `intent:*` tags. Load the highest-scoring entry. No match → base recipe.

### Reduce abandonment & troubleshoot (recipes)

> - [Reduce checkout/cart abandonment (delivery-step friction)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-reduce-abandonment) — tags: `[intent:reduce-abandonment]` · priority 0
> - [Recover abandoned carts via email (automation)](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-recover-email) — tags: `[intent:recover-email]` · priority 0 · *Dashboard-configured automation; recipe guides timing/content/eligibility*
> - [Troubleshoot checkout failure / delivery drop-off](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-troubleshoot-dropoff) — tags: `[intent:troubleshoot-checkout]` · priority 0

### Checkout configuration

> - [Set checkout policies / payment-step checkboxes](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/checkout-settings) — tags: `[intent:checkout-policies]` · **API doc, no skill** (per §7.5 — Checkout Settings API)
> - Enable **guest checkout** — tags: `[intent:guest-checkout]` · **Wix Dashboard** (Settings → Checkout) — no TPA-public API
> - Set **minimum order amount** — tags: `[intent:min-order]` · **Wix Dashboard** — no TPA-public API
> - **Customize checkout fields** / add a field — tags: `[intent:custom-fields]` · **Wix Dashboard** (custom checkout fields) — no TPA-public API
> - **Product recommendations at checkout** — tags: `[intent:checkout-recs]` · **Wix Dashboard** / Stores upsell settings — no TPA-public API

### Info

> - View **abandoned checkouts** — tags: `[intent:view-abandoned]` · **API doc, no skill** — `POST https://www.wixapis.com/ecom/v1/abandoned-checkout/query` (Abandoned Checkout API, TPA-public/GA; `/search` for richer filters)

### Not yet covered (gaps — pending authoring / research)

> - **Test agentic checkout / agentic readiness (UCP)** — tags: `[intent:agentic]` · 🚧 **gap** — UCP / agentic-commerce; needs research (likely Dashboard + platform feature)
> - **Store health monitor (periodic checkout testing)** — tags: `[intent:store-health]` · 🚧 **gap** — periodic orchestrator, not yet authored

## Base recipe (fallback)

If nothing matches, ask **one** clarifying question:

> "Do you want to (a) **reduce abandonment** / fix checkout drop-off, (b) **configure** checkout (guest checkout, minimum order, fields — most are in the Wix Dashboard), or (c) **see** your abandoned checkouts?"

Map the answer to an `intent:*` tag and re-dispatch. For configuration intents with no public API, give the merchant the Dashboard path directly.
</content>
