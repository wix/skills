---
name: "Goal: Increase AOV"
description: UPSELL_BOOST goal — always load BEFORE recommending AOV / upsell / "boost my sales" / shipping-threshold actions. Owns the cross-domain lever map (discount + shipping + bundle) for open-ended sales prompts.
---
# Goal: Increase Average Order Value

> **Routing rule (READ FIRST).** Any merchant query about increasing AOV, upselling, "boosting sales", or open-ended "help my business" prompts MUST load this recipe before any flow-* recipe. Do NOT route directly to [Flow: Upsell Boost](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-upsell-boost) from the WixREADME index — this goal owns the cross-domain lever map (discount + shipping + bundle), the catalog→lever-selection rules, and the per-recommendation **multi-lever mix requirement** that an open "boost sales" prompt must satisfy. The flows are sub-steps.
>
> ⛔ **MANDATORY — call these NOW before any API call or recommendation generation:**
> ```
> ReadFullDocsArticle("https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-upsell-boost")
> ```
> If the request covers bundle/cross-sell intent too:
> ```
> ReadFullDocsArticle("https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-bundle-and-save")
> ```
>
> **Shipping flows that also serve AOV goals** (load if shipping domain is active):
> - [Flow: Add Free Shipping](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-add-free-shipping) — free shipping threshold pushes carts above AOV
> - [Flow: Optimize Shipping Rates](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-optimize-rates) — rate optimization improves conversion on higher-value orders
>
> The margin/cap guardrails are enforced in [Create Discount Rule](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-discount-rule) → "Guardrails".

Incentivize customers to spend above the store's current average order value (AOV) by creating threshold-based discounts that reward higher cart totals.

---

## Business Goal

**Goal ID:** `UPSELL_BOOST`

The merchant wants to increase the average amount customers spend per order. This is achieved by setting a minimum subtotal condition above the current AOV, so customers are encouraged to add more items or upgrade to higher-priced products to unlock the discount.

---

## KPIs

| KPI | Definition | How to measure |
|---|---|---|
| Average Order Value (AOV) | Total revenue / total orders | `getSiteData` — revenue / ordersCount |
| Revenue per order | Gross revenue attributed to each completed order | Track via order data before and after campaign |
| Discount redemption rate | Orders qualifying for the discount / total orders | Count orders with the discount applied vs total |
| Cart size increase | Change in items per order after campaign | Compare items per order pre/post |

---

## Triggers

Activate this goal when the merchant expresses any of the following intents:

- "increase AOV"
- "boost order value"
- "upsell"
- "get people to spend more"
- "increase average order"
- "raise order size"
- "higher cart value"
- Any request mentioning order value, spending thresholds, or minimum purchase incentives

---

## Recommended Actions

### Primary: Flow: Upsell Boost Campaign

The primary action for this goal. Creates a percentage discount with a `minSubTotal` condition set above the current AOV. The discount percentage and threshold are tiered based on the store's average profit margin.

**When to use:** Always the first recommendation for AOV-focused goals. Works best when the store has clear AOV data and margin information.

**Key mechanics:**
- minSubTotal set to 1.15x-1.5x the effective AOV (based on margin tier)
- Discount percentage scaled to margin (10-20%)
- Scope prioritized: CATEGORY (high-margin) > ITEMS (specific upsell candidates) > SITE (fallback)

### Secondary: Flow: Bundle & Save Campaign

A complementary action that increases AOV by encouraging multi-item purchases. Instead of a subtotal threshold, it uses an item quantity threshold.

**When to use:** When the catalog has natural cross-sell opportunities (complementary products, accessories, related items). Particularly effective when the store has many lower-priced items where quantity-based incentives drive higher totals.

**Key mechanics:**
- minItemQuantity condition (typically 2-3 items)
- Targets categories with cross-sell potential
- Can run alongside an upsell boost if scoped to different categories

---

## Presentation requirement — open prompts demand a multi-lever mix

When the merchant's query is open-ended (e.g., "boost my sales", "help my business", "give me 3 to 5 actions"), the recommendation set **MUST mix at least two of the following lever types** — never propose an all-discount set:

| Lever type | Example action |
|---|---|
| Discount rule (auto-apply) | `apply_discount` with `minSubTotal` above AOV |
| Coupon | code-gated discount for subscribers / influencers |
| Free-shipping / shipping change | `create_shipping_option` with AOV-calibrated threshold |
| Bundle / `minItemQuantity` rule | multi-item discount targeting cross-sell categories |
| `minSubTotal` / AOV-threshold rule | spend-based discount above current AOV |

State the lever type per recommendation in the `reasoning` / `why` field (e.g., "Lever: free-shipping threshold — pushes carts above current AOV $X"). A recommendation set containing only `apply_discount` actions FAILS the UPSELL_BOOST goal's open-prompt intent.

If the merchant's prompt names a specific lever (e.g., "give me a coupon"), this rule does NOT apply — focus all recommendations on that lever. The multi-lever requirement is for OPEN prompts where the lever is the agent's call.

---

## Measurement Plan

### Before campaign launch

1. Record baseline AOV from `getSiteData` (revenue / ordersCount)
2. Record baseline items per order
3. Note the campaign start date

### During campaign (weekly check-ins)

1. Compare current AOV to baseline
2. Track discount redemption rate
3. Monitor margin impact (ensure effective margin stays above 15%)

### After campaign (30-day assessment)

1. Calculate AOV lift: `(new_aov - baseline_aov) / baseline_aov * 100`
2. Calculate incremental revenue attributable to higher order values
3. Assess whether the minSubTotal threshold needs adjustment:
   - If redemption rate > 80% — threshold may be too low, consider raising
   - If redemption rate < 10% — threshold may be too high, consider lowering
   - Sweet spot: 20-40% redemption rate

---

## Decision Matrix

| Scenario | Recommended Flow | Rationale |
|---|---|---|
| Clear AOV data, margin data available | Upsell Boost (primary) | Full data enables optimal threshold + discount calculation |
| Low-data store (few orders) | Upsell Boost with conservative defaults | Use price_p50 as AOV proxy, 10% discount, 1.15x threshold |
| Catalog has natural bundles | Bundle & Save (secondary) | Multi-item incentive drives AOV through quantity |
| Both AOV and cross-sell opportunity | Both flows, different scopes | Upsell Boost on high-value categories, Bundle & Save on accessories |
| Merchant specifies exact values | Honor merchant input | User overrides always take priority over calculated values |
