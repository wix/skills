---
name: "Abandoned Carts: Recovery Health"
description: Monitors abandoned cart recovery health — checks whether the Wix abandoned cart automation is active, measures recovery rate KPIs, estimates missing sales, and recommends activating or improving the automation.
---

# Abandoned Carts: Recovery Health

Assess the health of a site's abandoned cart recovery setup and surface actionable improvements. The primary signal is whether the Wix abandoned cart automation is active and whether the recovery rate is within the expected benchmark range.

## KPIs

| KPI | Definition | Benchmark |
|---|---|---|
| Recovery rate | Recovered orders / total abandoned carts | ~5–15% |
| Missing sales (30d) | `abandoned_cart_count × AOV` (when automation is inactive) | Should be < $200 before recommending activation |
| Automation status | Whether `wix_e_commerce-cart_abandonment` automation is active | Must be active |

---

## Step 1: Check automation status

Query whether the Wix abandoned cart recovery automation is currently active on the site.

**Automation key**: `wix_e_commerce-cart_abandonment`

**How to check**: Use the Wix Automations API (`wix.automations.v1.automation`) to query automations by key and inspect the `status` field.

If the automation is **not active**, skip to Step 3 (estimate missing sales and recommend activation). If it is **active**, proceed to Step 2 (evaluate recovery rate).

---

## Step 2: Evaluate recovery rate

If the automation is active, measure the current recovery rate over the last 30 days.

**Recovery rate** = `recovered_orders_count / abandoned_cart_count`

| Recovery rate | Assessment | Action |
|---|---|---|
| ≥ 15% | Excellent — top-quartile performance | No changes needed; monitor quarterly |
| 5–15% | Healthy — within benchmark | Healthy; consider A/B testing subject lines or send timing |
| 2–5% | Below benchmark | Review email content, send timing, and number of follow-up emails |
| < 2% | Poor — likely a configuration issue | Audit automation: is the send delay too long? Is the email deliverable? |

Factors that commonly suppress recovery rate:
- Send delay > 2 hours after abandonment (optimal: 1 hour)
- Single-email sequence instead of 2–3 follow-ups
- Email subject line does not reference the specific cart items
- Recovery link expired or broken
- Low email open rate (check domain reputation)

---

## Step 3: Estimate missing sales (when automation is inactive)

When the automation is not active, calculate the potential revenue being lost.

**Formula**: `missing_sales_usd = abandoned_cart_count × AOV`

**Eligibility gate for recommending activation (BOTH required):**
1. Automation is NOT active
2. `missing_sales_usd >= $200` over the last 30 days

If both conditions are met, generate a recommendation using the [Recommend: eCommerce Strategy](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-ecommerce-strategy) framework with:
- `domain`: `"abandoned_cart_recovery"`
- `action_type`: `"activate_abandoned_cart_recovery"`
- `automation_key`: `"wix_e_commerce-cart_abandonment"`
- `missing_sales_usd`: integer, rounded
- `abandoned_cart_count`: integer
- `window_days`: `30`

**Urgency thresholds:**

| Missing sales (30d) | Urgency |
|---|---|
| ≥ $1,000 | HIGH |
| $200–$999 | MEDIUM |
| < $200 | Do not recommend |

**Title pattern**: `"Recover $[missing_sales_usd] in abandoned carts"`

**Reasoning must cite**: automation is inactive, exact cart count, exact missing sales USD, 30-day window, and why the urgency level was chosen.

---

## Step 4: Report to merchant

Summarize findings with a clear status:

**When automation is inactive:**
> "Your abandoned cart automation is not active. Over the last 30 days, approximately [abandoned_cart_count] carts were abandoned, representing an estimated $[missing_sales_usd] in potential revenue. Activating the Wix abandoned cart email (automation key: `wix_e_commerce-cart_abandonment`) can recover approximately 5–15% of these carts."

**When automation is active and healthy:**
> "Your abandoned cart automation is active and recovering approximately [recovery_rate]% of abandoned carts — within the [5–15%] industry benchmark. No changes needed."

**When automation is active but underperforming:**
> "Your abandoned cart automation is active but recovering only [recovery_rate]% of carts (benchmark: 5–15%). Consider [specific improvement from Step 2 assessment]."

---

## Guardrails

- Do NOT recommend activation if `missing_sales_usd < $200` (too small to justify merchant friction).
- Do NOT flag as underperforming if recovery rate is within the 5–15% benchmark.
- Do NOT use `abandoned_cart_count` as a vanity metric — always pair with estimated revenue impact.
- This skill is read-only diagnostic + recommendation generation — it does NOT activate the automation itself. Activation is a Dashboard action or Automations API write.

## References

- [Recommend: eCommerce Strategy](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-ecommerce-strategy) — domain: `abandoned_cart_recovery`
- Automation key: `wix_e_commerce-cart_abandonment`
