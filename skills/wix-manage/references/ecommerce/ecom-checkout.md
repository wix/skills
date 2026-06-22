---
name: "Checkout & Cart"
description: Checkout & Cart boundary owner — diagnose live checkout/delivery-step drop-off and route checkout-config questions. **Always load this dispatcher first when a question touches the live checkout experience** (drop-off, troubleshooting, policies, Dashboard-only settings).
---

# Checkout & Cart

Improve and fix the checkout/cart experience before an order is placed - reduce live checkout drop-off, diagnose why customers cannot complete checkout, configure checkout policies, and adjust the checkout settings that drive conversion.

> **Routing rule (READ FIRST).** This dispatcher owns the **live checkout** experience — drop-off diagnosis, can't-complete-checkout failures, checkout policies, and Dashboard-only checkout settings. Post-abandonment recovery work (recovery emails, recovery links) is not in this routing tree; configure abandoned-cart automation via the Wix Dashboard (Marketing → Automations → Abandoned Cart).

**Checkout & cart is NOT:**
- Shipping rates / regions / pickup setup → see **Shipping** (though delivery-step friction is the #1 abandonment cause and is handled here + there).
- Discounts / coupons applied at checkout → see **Pricing & promotions**.
- Tax shown at checkout → tax APIs / Dashboard.
- Recovery after the shopper already left checkout → configure in the Wix Dashboard (Marketing → Automations → Abandoned Cart).

> **Heads-up — much of checkout config is Dashboard-only.** The public Checkout Settings API covers only checkout-footer **policies** and payment-step **checkboxes**. Guest checkout, minimum order amount, custom checkout fields, and checkout upsell are **not exposed via a TPA-public API** — route the merchant to the Wix Dashboard for those.

> **Before dispatching** — confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context). Skip if already loaded.
>
> **Generating recommendations for the merchant?** If the merchant's intent is "give me N recommendations / concrete actions to improve checkout conversion" (rather than diagnose / fix / configure), this is cross-cutting and MUST go through [API: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-recommendation-tracking) — load it BEFORE generating, Query existing history to skip re-proposing PROPOSED/DONE items, BatchCreate the new list as PROPOSED before presenting, then MarkExecuting → MarkDone/MarkFailed as the merchant approves each. This obligation applies even when the recommendation surface is checkout-side (free-shipping threshold, rate restructure, abandoned-cart email, etc.).
>
> **Promotion dispatch.** Score each entry below by the merchant's query → `intent:*` tags. Load the highest-scoring entry. No match → base recipe.

### Reduce abandonment & troubleshoot (recipes)

> - [Troubleshoot checkout failure / delivery drop-off](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/checkout-troubleshoot-delivery-drop-off) — tags: `[intent:troubleshoot-checkout]`, `[intent:reduce-abandonment]` · priority 0
> - Recover abandoned checkouts after the shopper leaves — tags: `[intent:recover-email]`, `[intent:view-abandoned]`, `[intent:recovery-link]` · *no recipe in this routing tree; abandoned-cart recovery automation is configured via the Wix Dashboard*

### Checkout configuration

> - [Set checkout policies / payment-step checkboxes](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/checkout-settings) — tags: `[intent:checkout-policies]` · **API doc, no skill** (per §7.5 — Checkout Settings API)
> - Enable **guest checkout** — tags: `[intent:guest-checkout]` · **Wix Dashboard** (Settings → Checkout) — no TPA-public API
> - Set **minimum order amount** — tags: `[intent:min-order]` · **Wix Dashboard** — no TPA-public API
> - **Customize checkout fields** / add a field — tags: `[intent:custom-fields]` · **Wix Dashboard** (custom checkout fields) — no TPA-public API
> - **Product recommendations at checkout** — tags: `[intent:checkout-recs]` · **Wix Dashboard** / Stores upsell settings — no TPA-public API

## Base recipe (fallback)

If nothing matches, ask **one** clarifying question:

> "Do you want to (a) **reduce live checkout drop-off**, (b) **configure** checkout (guest checkout, minimum order, fields — most are in the Wix Dashboard), or (c) **recover shoppers who already abandoned checkout**?"

Map the answer to an `intent:*` tag and re-dispatch. For recovery/recapture, route the merchant to the Wix Dashboard (Marketing → Automations → Abandoned Cart). For configuration intents with no public API, give the merchant the Dashboard path directly.
