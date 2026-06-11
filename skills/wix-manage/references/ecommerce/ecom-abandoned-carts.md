---
name: "Abandoned Carts"
description: Abandoned checkout recovery and recapture for an eCommerce store - view abandoned checkouts, recover them with Dashboard automation or API-generated recovery links, troubleshoot recovery flows, and monitor recovery health.
---

# Abandoned Carts

Recover shoppers who already left checkout. Merchants often say "abandoned carts"; the Wix API surface calls these **Abandoned Checkouts**. Use this category for abandoned-checkout recovery emails, recovery links, recovery troubleshooting, and recovery performance monitoring.

For information and reporting queries, prefer **Analytics APIs**. Use the Abandoned Checkout API only when the agent needs to inspect or act on specific abandoned checkout records.

**Abandoned carts is NOT:**
- Reducing live checkout drop-off before the shopper leaves -> see **Checkout & Cart**.
- Shipping cost or delivery-step friction -> see **Shipping**.
- Discounts and incentives used in recovery emails -> see **Pricing & Promotions**.

> **Before dispatching** - confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context). Skip if already loaded.
>
> **Promotion dispatch.** Score each entry below by the merchant's query -> `intent:*` tags. Load the highest-scoring entry. No match -> base recipe.
>
> **Hard guardrail — the recurring abandoned-cart recovery email is Dashboard-only.** Configuring the recurring recovery automation is **NOT** TPA-public via the Automations V2 API. Do NOT call `https://www.wixapis.com/automations-service/v2/automations/{id}` (POST or PATCH) to create or update the recovery automation — those calls reject built-in templates with `INVALID_ORIGIN_TYPE` (HTTP 400). If a sub-recipe slug below returns a transient 404 (rawdocs ingestion delay), do NOT improvise via the Automations API — instead route the merchant to **Wix Dashboard → Marketing → Automations → "Recover abandoned carts"** and retry the sub-recipe slug once. The only TPA-public Abandoned-Checkout APIs are: `POST /ecom/v1/abandoned-checkout/query` (read-only) and `GET /ecom/v1/abandoned-checkout/{id}/redirect-to-checkout` (one-off custom recovery links).

### Recovery actions

> - [Recover abandoned carts via email](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/abandoned-carts-recover-via-email) — tags: `[intent:recover-email]` · priority 0 · *Dashboard-configured automation; Abandoned Checkout API can verify eligibility/activity but does not configure recurring sends*
> - [Generate a recovery link / resume checkout](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/abandoned-carts-recovery-link) — tags: `[intent:recovery-link]` · priority 0 · *Abandoned Checkout API: find checkout, confirm target, redirect to checkout*

### Diagnose and monitor

> - [Troubleshoot abandoned-cart recovery](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/abandoned-carts-troubleshoot-recovery) — tags: `[intent:troubleshoot-recovery]` · priority 0
> - [Recovery health monitor](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/abandoned-carts-recovery-health) — tags: `[intent:recovery-health]` · priority 0

### Info

> - [Abandoned-cart analytics and reports](https://dev.wix.com/docs/api-reference/business-management/analytics/semantic-models/query-semantic-model-data) — tags: `[intent:view-abandoned]`, `[intent:information]`, `[intent:reporting]` · priority 0 · **Analytics API route, no dedicated skill**. Use Analytics Data API or Semantic Model API for counts, trends, conversion/recovery performance, and reporting. Use Abandoned Checkout API only for drilling into specific records after the analytics question is scoped.

### API boundary

| Merchant need | Preferred surface |
|---|---|
| "How many abandoned carts did I have?" | Analytics APIs |
| "Did abandonment/recovery trend change?" | Analytics APIs |
| "Show abandoned-cart report by date or channel" | Semantic Model API, after discovering available fields |
| "Find this shopper's abandoned checkout" | Abandoned Checkout API query/search |
| "Generate a link to resume checkout" | Abandoned Checkout API redirect endpoint |

## Tag matching examples

| Merchant query | Match |
|---|---|
| "Show me abandoned carts from this week" | Analytics API route: `intent:view-abandoned` |
| "Create an automated abandoned cart email" | `ecom-abandoned-carts-recover-email` via `intent:recover-email` |
| "Send this customer a link to finish checkout" | `ecom-abandoned-carts-recovery-link` via `intent:recovery-link` |
| "My abandoned cart emails are not sending" | `ecom-abandoned-carts-troubleshoot-recovery` via `intent:troubleshoot-recovery` |
| "Did abandoned checkout recovery get worse this month?" | `ecom-abandoned-carts-recovery-health` via `intent:recovery-health` |

## Base recipe

If nothing matches, ask **one** clarifying question:

> "Do you want to **view abandoned checkouts**, **recover them with emails or links**, or **troubleshoot/monitor** recovery performance?"

Map the answer to an `intent:*` tag and re-dispatch. If the merchant is asking how to stop customers from leaving checkout in the first place, route to **Checkout & Cart** instead.
