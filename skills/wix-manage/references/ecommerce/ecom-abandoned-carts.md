---
name: "Abandoned Carts"
description: Abandoned Carts boundary owner — post-abandonment recovery via automated emails, recovery links, and recovery rate monitoring. **Always load this dispatcher first when a question touches recovering shoppers who already left** — the rules for which side owns live checkout drop-off vs. post-abandonment recovery live in this file, not in this README line.
---

# Abandoned Carts

Recover revenue from shoppers who added items to their cart but left before completing checkout — activate abandoned cart email automation, generate recovery links, and monitor recovery rate KPIs.

> **Routing rule (READ FIRST).** Any merchant query that mentions BOTH a post-abandonment topic (recover shoppers who already left, abandoned-cart email, recovery link, recovery rate) AND a live-checkout topic (drop-off, can't-complete-checkout, checkout policies, guest checkout, minimum order) MUST be answered by loading this dispatcher first AND [Checkout & Cart](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/checkout-cart). Do NOT route mixed live-checkout + recovery questions from the WixREADME index alone; the binding decision lives here.

**Abandoned Carts is NOT:**
- Live checkout drop-off while the shopper is still on the site → see **Checkout & Cart**.
- Shipping rates / coverage gaps that block checkout → see **Shipping**.
- Discounts / coupons applied at checkout → see **Pricing & Promotions**.
- Tax shown at checkout → see **Tax**.

> **Heads-up — abandoned cart recovery runs through Wix Automations.** The primary recovery mechanism is the Wix abandoned cart automation (`automation_key: wix_e_commerce-cart_abandonment`). This automation sends recovery emails to shoppers who abandon carts. Activation and configuration is via the Wix Automations API (`wix.automations.v1.automation`) or Wix Dashboard (Automations section).

> **Before dispatching** — confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context). Skip if already loaded.
>
> **Promotion dispatch.** Score each entry below by the merchant's query → `intent:*` tags. Load the highest-scoring entry. No match → base recipe.

### Recovery actions

> - [Recovery health monitor](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/abandoned-carts-recovery-health) — tags: `[intent:recovery-health]`, `[intent:recovery-rate]`, `[intent:check-automation]` — priority 0 — *check automation status, recovery rate KPIs, missing sales estimate*
> - Activate abandoned cart automation — tags: `[intent:activate-automation]`, `[intent:recover-email]` — **Wix Dashboard / Automations API** — navigate to Dashboard → Automations → search "abandoned cart" and activate; or use Wix Automations API with `automation_key: wix_e_commerce-cart_abandonment`
> - Generate recovery link for a specific cart — tags: `[intent:recovery-link]` — **Wix Dashboard** — recovery links are generated per-cart from the Dashboard Abandoned Carts view; no TPA-public API for individual recovery-link generation
> - View abandoned carts list — tags: `[intent:view-abandoned]` — **Wix Dashboard** — the Dashboard Abandoned Carts view shows cart contents, shopper details, and recovery status

### Checkout cross-boundary

> - Live checkout drop-off / delivery-step friction — tags: `[intent:live-dropoff]`, `[intent:checkout-friction]` — **see [Checkout & Cart](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/checkout-cart)**
> - Fix shipping coverage gaps that block checkout — tags: `[intent:coverage-gap]` — **see [Shipping](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping)**

## API and Dashboard status

| Capability | Route | Status |
|---|---|---|
| Check abandoned cart automation status | Wix Automations API (`wix.automations.v1.automation`) | TPA-public (read) |
| Activate abandoned cart automation | Wix Automations API or Dashboard → Automations | Dashboard-recommended |
| View abandoned carts list | Wix Dashboard → Abandoned Carts | Dashboard-managed |
| Generate per-cart recovery link | Wix Dashboard → Abandoned Carts | Dashboard-managed |
| Recovery rate metrics | Site analytics / Automations reporting | Dashboard-managed |

## Tag matching examples

| Merchant query | Match |
|---|---|
| "Are my abandoned cart emails working?" | `ecom-abandoned-carts-recovery-health` via `intent:recovery-health` |
| "What's my cart recovery rate?" | `ecom-abandoned-carts-recovery-health` via `intent:recovery-rate` |
| "How do I set up abandoned cart emails?" | `activate-automation` route via `intent:activate-automation` |
| "Customers are dropping off at checkout" | Checkout & Cart category, not Abandoned Carts |
| "Some regions can't see shipping options" | Shipping category, not Abandoned Carts |

## Base recipe (fallback)

If nothing matches, ask **one** clarifying question:

> "Do you want to (a) **check your recovery rate / automation health**, (b) **activate the abandoned cart email automation**, or (c) **view or recover specific abandoned carts** (Dashboard)?"

Map the answer to an `intent:*` tag and re-dispatch. For live checkout drop-off (shopper still on site), route to **Checkout & Cart**.
