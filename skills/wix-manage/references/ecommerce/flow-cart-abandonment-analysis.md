---
name: "Flow: Cart Abandonment Analysis"
description: Analyzes abandoned cart performance — calculates abandonment rate, compares to industry benchmarks, diagnoses root causes (shipping cost surprises, coverage gaps, missing recovery automation, high rates, checkout friction), and generates targeted recommendations.
layer: flow
---
# Flow: Cart Abandonment Analysis

## When to use

Activate this flow for any question about abandoned cart performance, including:

**Rate and metrics**
- "What is my cart abandonment rate?"
- "How many carts are being abandoned?"
- "How much revenue am I losing to abandoned carts?"
- "What is my cart recovery rate?"
- "Am I above or below average for cart abandonment?"

**Root cause and diagnosis**
- "Why are people leaving without buying?"
- "Why aren't customers completing checkout?"
- "What's causing checkout drop-off?"
- "Why are carts not converting?"

**Recovery and automation**
- "How do I recover abandoned carts?"
- "Should I set up cart recovery emails?"
- "How much could I recover with automation?"
- "Is my cart recovery working?"

**General performance**
- Any question about checkout conversion, lost sales, unfinished purchases, or abandoned cart trends
- Proactive analysis when the ABANDONED_CART domain is active and no specific question was asked

---

## Data sources

### Profile (available now)

All base metrics come from Step 3 of the entry point (`recommend-ecommerce-strategy.md`).

| Profile field | Type | Description |
|---|---|---|
| `ecom_number_cart_that_were_abandoned_last_30_days` | LONG | Count of abandoned carts in last 30 days |
| `ecom_usd_sum_of_carts_that_were_abandoned_last_30_days` | LONG | Total USD value of abandoned carts, last 30 days |
| `activate_abandoned_cart_automation` | STRING | Non-null = recovery automation is active; null = inactive |
| `last_30_days_orders_count` | LONG | Orders placed in last 30 days (already in Step 3) |
| `online_gpv_last_30_days` | LONG | Gross payment volume last 30 days (already in Step 3) |
| `payment_currency` | STRING | Site currency (already in Step 3) |

**If Profile fields are missing or zero:** Proceed with available data. Do not fail the recommendation. Use conservative estimates where needed and note data limitations.

For industry benchmarks on abandonment rates and recovery rates, additionally call `GetAbandonedCartsBenchmarks`:

```
CallWixSiteAPI(
  url: "https://www.wix.com/_api/analytics-ng-server/v2/store-overview/get-abandoned-carts-benchmarks",
  method: "POST",
  body: {}
)
```

Response shape:

```json
{
  "data": {
    "abandoned_carts_rate": 0.72,
    "recoverable_carts_rate": 0.45,
    "cart_recovery_rate": 0.08
  }
}
```

| Field | Description |
|---|---|
| `abandoned_carts_rate` | Industry average abandoned cart rate (e.g., 0.72 = 72%) |
| `recoverable_carts_rate` | Share of abandoned carts that have a contact email (recoverable) |
| `cart_recovery_rate` | Industry average recovery rate via email automation |

If the benchmark call fails, use these fallback industry averages:

| Metric | Industry average |
|---|---|
| Cart abandonment rate | ~70% |
| Recoverable cart rate | ~40% |
| Recovery rate (with automation) | ~8-15% |

### DWH data (future — via data-to-production API)

**Not available at runtime yet.** These fields will be provided by `com.wixpress.datatoproduction.data-to-production`, which returns results equivalent to the reference queries below. When available, prefer this data over Profile estimates and benchmark fallbacks.

**Additional fields this will provide:**

| Field | Source | Replaces |
|---|---|---|
| `recovery_rate_pct` | actual recovered / total abandoned | 10% hardcoded estimate |
| `recoverable_count` | carts with buyer contact (all in practice) | 40% benchmark estimate |
| `avg_cart_value_usd` | average per-cart USD value | missing_sales / count |
| `cart_churn_pct` | % dropped before reaching checkout | no current signal |
| `checkout_churn_pct` | % dropped during checkout | root cause E signal |

**When `checkout_churn_pct > 80%`:** Strengthen root cause E diagnosis — checkout UX friction is almost certainly the primary driver.

**When `cart_churn_pct > 60%`:** The drop is happening before checkout — likely product/pricing or trust signals on the product page, not shipping or checkout UX.

```
-- DEBUG REFERENCE ONLY — for QA and future data-to-production wiring
-- Table: prod.ecom.abandoned_cart_dim (Tier 1, owner: ecom-platform-data)
-- Returns: per-site recovery metrics for last 30 days

SELECT
  msid,
  COUNT(*) AS abandoned_cart_count,
  COUNT(CASE WHEN buyer_contact_id IS NOT NULL THEN 1 END) AS recoverable_count,
  COUNT(CASE WHEN status = 'RECOVERED' THEN 1 END) AS recovered_count,
  COUNT(CASE WHEN first_email_sent_date IS NOT NULL THEN 1 END) AS email_sent_count,
  COUNT(CASE WHEN first_email_sent_date IS NOT NULL AND status = 'RECOVERED' THEN 1 END) AS email_recovered_count,
  ROUND(SUM(price_total_usd), 2) AS total_abandoned_usd,
  ROUND(AVG(price_total_usd), 2) AS avg_cart_value_usd,
  ROUND(COUNT(CASE WHEN status = 'RECOVERED' THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS recovery_rate_pct,
  ROUND(COUNT(CASE WHEN buyer_contact_id IS NOT NULL THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS recoverable_rate_pct
FROM prod.ecom.abandoned_cart_dim
WHERE msid = '<msid>'
  AND abandoned_date >= CURRENT_DATE - INTERVAL '30' DAY
  AND deleted_date IS NULL
GROUP BY msid

-- Sample output (2026-05-26, test sites):
-- msid                                  | abandoned | recoverable | recovered | email_sent | email_recovered | total_usd  | avg_usd | recovery_pct | recoverable_pct
-- 0539bfda (Fishing)                    | 815       | 815         | 129       | 803        | 129             | 181966.52  | 223.27  | 15.8%        | 100%
-- 25fd3126 (Cannabis)                   | 581       | 581         | 236       | 53         | 10              | 113238.13  | 194.90  | 40.6%        | 100%
-- 2a3e0db2 (Lighting)                   | 147       | 147         | 20        | 146        | 20              | 30741.17   | 209.12  | 13.6%        | 100%
-- c1f68cb7 (Sneakers)                   | 27        | 27          | 2         | 0          | 0               | 4373.40    | 161.98  | 7.4%         | 100%
```

```
-- DEBUG REFERENCE ONLY — for QA and future data-to-production wiring
-- Table: prod.ecom.abandoned_cart_enrichments_monthly (owner: ecom-platform-data)
-- Returns: funnel churn location — cart stage vs checkout stage

SELECT
  msid,
  COUNT(*) AS total_carts,
  COUNT(CASE WHEN churned_at_cart = true THEN 1 END) AS churned_at_cart,
  COUNT(CASE WHEN churned_at_checkout = true THEN 1 END) AS churned_at_checkout,
  COUNT(CASE WHEN is_recoverable = true THEN 1 END) AS recoverable_count,
  COUNT(CASE WHEN is_recovered = true THEN 1 END) AS recovered_count,
  COUNT(CASE WHEN is_email_sent = true THEN 1 END) AS email_sent_count,
  ROUND(COUNT(CASE WHEN churned_at_cart = true THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS cart_churn_pct,
  ROUND(COUNT(CASE WHEN churned_at_checkout = true THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS checkout_churn_pct
FROM prod.ecom.abandoned_cart_enrichments_monthly
WHERE msid = '<msid>'
  AND abandoned_date >= CURRENT_DATE - INTERVAL '30' DAY
GROUP BY msid

-- Sample output (2026-05-26, test sites):
-- msid                                  | total | cart_churn | checkout_churn | recoverable | recovered | email_sent | cart_pct | checkout_pct
-- 0539bfda (Fishing)                    | 102   | 1          | 101            | 102         | 11        | 102        | 1.0%     | 99.0%
-- 25fd3126 (Cannabis)                   | 111   | 77         | 34             | 111         | 3         | 36         | 69.4%    | 30.6%
-- 2a3e0db2 (Lighting)                   | 13    | 5          | 8              | 13          | 4         | 13         | 38.5%    | 61.5%
-- c1f68cb7 (Sneakers)                   | 22    | 1          | 21             | 22          | 0         | 0          | 4.5%     | 95.5%
```

---

## Step 1: Calculate the abandonment rate

From Profile data:

```
abandoned_carts = ecom_number_cart_that_were_abandoned_last_30_days
orders = last_30_days_orders_count
total_carts_est = abandoned_carts + orders
abandonment_rate = abandoned_carts / total_carts_est  (as percentage)
```

**Derived metrics:**

```
aov = online_gpv_last_30_days / orders  (in payment_currency)
missing_sales_usd = ecom_usd_sum_of_carts_that_were_abandoned_last_30_days
avg_abandoned_cart_value = missing_sales_usd / abandoned_carts
```

**Benchmark comparison:**

- `abandonment_rate` vs `benchmark.abandoned_carts_rate` (industry avg ~70%)
- If site rate > benchmark + 5 percentage points → above-average problem
- If site rate < benchmark - 5 percentage points → performing well on abandonment

---

## Step 2: Diagnose root causes

Run through this checklist. Root cause C uses only Profile data. Root causes A, B, and D require delivery profile and shipping configuration data — these signals are available when the SHIPPING domain is co-active in the same session (Step 6 of the entry point). If SHIPPING is not active, skip A, B, and D and rely on root cause C and E only.

### Root cause A — Shipping cost surprise (most common)

**Signals:**
- No free shipping option exists
- Free shipping threshold > 2× AOV
- All shipping rates are flat with no tiering

**Impact:** Customers see full shipping cost at checkout for the first time. Studies show 49% of cart abandonment is caused by extra costs (shipping, taxes, fees).

**Detection:** Check if `data.free_shipping_exists = false` from delivery profile analysis, or if existing free shipping threshold > `2 × aov`.

### Root cause B — Shipping coverage gap

**Signals:**
- Active regions with zero assigned shipping options
- Customer's country not covered by any region

**Impact:** Customer cannot complete checkout at all — conversion is 0% for that region.

### Root cause C — No recovery automation

**Signals:**
- `activate_abandoned_cart_automation` is null or empty in Profile

**Impact:** Recoverable carts (those with a contact email) are never followed up. Industry automation recovers 8-15% of abandoned carts.

**Estimated recoverable value:**

```
recoverable_carts_est = abandoned_carts × benchmark.recoverable_carts_rate  (use 0.40 if benchmark unavailable)
recoverable_value_usd = recoverable_carts_est × avg_abandoned_cart_value
potential_recovery_usd = recoverable_value_usd × 0.10  (conservative 10% recovery rate)
```

### Root cause D — High shipping rates

**Signals:**
- Any shipping rate > 15% of AOV
- `multiplyByQuantity: true` on any rate

**Impact:** Sticker shock — final shipping amount feels disproportionate to order value.

### Root cause E — Checkout friction (non-shipping)

**Signals:**
- High abandonment rate (> 80%) with no shipping issues detected
- `checkout_churn_pct > 80%` from DWH data (when available) — strong confirmation

**Possible causes (non-shipping, informational only):**
- Forced account creation
- Limited payment methods
- Long checkout form
- Trust/security concerns

**Note:** These are outside the scope of shipping/discount recommendations. Report the issue and suggest the merchant investigate their checkout UX.

**If `cart_churn_pct > 60%` from DWH data:** Drop is happening before checkout — likely product page trust, pricing, or unclear product descriptions. This is a different problem from checkout friction. Note it separately.

---

## Step 3: Generate recommendations

Produce up to 3 recommendations, ordered by root cause impact. Use domain `"abandoned_cart_recovery"` for all.

### Recommendation type: Activate recovery automation

**When to generate:** `activate_abandoned_cart_automation` is null/empty AND `missing_sales_usd >= 200`.

**Urgency:**

| Missing sales (USD, 30 days) | Urgency |
|---|---|
| ≥ $1,000 | HIGH |
| $200–$999 | MEDIUM |
| < $200 | Do not recommend |

**Action:** `activate_abandoned_cart_recovery`

**Required params:**

```json
{
  "automation_key": "wix_e_commerce-cart_abandonment",
  "missing_sales_usd": "<integer — round to nearest dollar>",
  "abandoned_cart_count": "<integer>",
  "recoverable_carts_est": "<integer — abandoned_carts × 0.40>",
  "potential_recovery_usd": "<integer — conservative 10% of recoverable value>",
  "window_days": 30
}
```

**Title pattern:** `"Recover $[potential_recovery_usd] in abandoned carts"`

**Reasoning MUST cite:** abandonment count, total missing sales, that automation is inactive, the estimated recoverable count, and potential recovery amount.

### Recommendation type: Fix shipping to reduce abandonment

**When to generate:** Root cause A, B, or D detected AND these are not already covered by shipping recommendations in the same session.

Delegate to the appropriate shipping flow:

- Coverage gap → `flow-fix-coverage-gaps`
- No free shipping → `flow-add-free-shipping`
- High rates → `flow-optimize-shipping-rates`

Use domain `"shipping"` for these recommendations.

### Recommendation type: Address abandonment rate insight

**When to generate:** Abandonment rate > benchmark + 5pp AND no clear root cause found from above.

**Action:** `investigate_checkout_friction`

**Params:**

```json
{
  "site_abandonment_rate_pct": "<float>",
  "industry_benchmark_pct": "<float>",
  "gap_pp": "<float>",
  "non_shipping_causes": ["forced_account_creation", "payment_methods", "checkout_ux"]
}
```

**Domain:** `"abandoned_cart_recovery"`

---

## Output for "What is my cart abandonment rate?"

When the merchant asks specifically about their rate, always include a direct answer at the top of your response before the JSON:

> "Your cart abandonment rate is approximately **[X]%** over the last 30 days — [above/below/at] the industry average of ~70%. You had **[N] abandoned carts** representing **$[missing_sales]** in missed revenue."

Then proceed with recommendations as normal.

---

## Output for "Why are people leaving without buying?"

When the merchant asks about causes, lead with the primary root cause found:

> "The main reason customers are leaving without buying is **[root cause]**. [Specific data point from the site]. Here's what I recommend:"

Then output the recommendation JSON.

---

## KPIs

| KPI | Definition | Benchmark |
|---|---|---|
| Cart abandonment rate | abandoned carts / (abandoned + orders) | Industry avg ~70% |
| Delivery step CVR | Customers completing delivery step / customers reaching it | ~65% healthy |
| Cart recovery rate | Recovered carts / total abandoned carts | ~8-15% with automation |
| Revenue from recovered carts | recovered_carts × avg_abandoned_cart_value | — |

---

## Measurement plan

### Baseline (before recommendations)

1. Record `abandonment_rate` from Step 1 calculation
2. Note whether recovery automation is active (`activate_abandoned_cart_automation`)
3. Record `missing_sales_usd` over the last 30 days

### After activation (30-day check)

1. Re-run this flow and compare new `abandonment_rate` vs baseline
2. If automation was activated: check recovered revenue vs `potential_recovery_usd` estimate
3. If shipping was fixed: compare before/after shipping root causes
4. `delivery_step_cvr >= 65%` and `abandonment_rate` trending toward benchmark = healthy

---

## Constraints

- `missing_sales_usd` and `potential_recovery_usd` must be integers (rounded)
- Always state the 30-day window in reasoning
- Do not recommend recovery automation if `missing_sales_usd < 200`
- Do not duplicate shipping recommendations already generated in Step 6
- Abandonment rate calculation is an estimate (abandoned carts / (abandoned + orders)) — note this in reasoning
