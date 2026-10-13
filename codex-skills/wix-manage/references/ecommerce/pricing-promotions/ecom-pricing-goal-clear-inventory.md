---
name: "Goal: Clear Inventory"
description: STOCK_MOVER clearance goal — always load BEFORE recommending any clearance / overstock / slow-stock / dead-inventory action.
---
# Goal: Clear Slow-Moving Inventory

> **Routing rule (READ FIRST).** Any merchant query about clearing slow / overstocked / dead / stagnant inventory MUST load this recipe before any other clearance recipe. Do NOT route directly to [Flow: Stock Mover](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-stock-mover) from the WixREADME index — this goal owns the velocity scoring, discount tiers, **margin-floor guardrail**, and the per-recommendation presentation rules. The flow is a sub-step.
>
> ⛔ **MANDATORY — call this NOW before any API call or recommendation generation:**
> ```
> ReadFullDocsArticle("https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-stock-mover")
> ```
> The guardrail is also enforced in [Pricing: Create Discount Rule](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-discount-rule) → "Guardrails".

Automate clearance discounts for products with high stock levels and low sales velocity, converting stagnant inventory into revenue before it becomes a carrying cost liability.

---

## Business Goal

**Goal ID:** `STOCK_MOVER`

The merchant wants to reduce excess inventory for products that are not selling at an acceptable rate. This is achieved by creating targeted discounts on slow-moving products, with discount depth proportional to how overstocked the product is relative to its sales velocity.

---

## KPIs

| KPI | Definition | How to measure |
|---|---|---|
| Inventory turnover ratio | ordersCount / quantity for each product | `getProductCatalogData` — compare ordersCount to current quantity |
| Days of supply | Current stock / average daily sales rate | Estimate from ordersCount over the product's listing period |
| Clearance conversion rate | Units sold during clearance / units available at start | Track stock levels before and after campaign |
| Revenue recovered | Revenue from clearance sales that would not have occurred organically | Compare sales velocity before and during campaign |

---

## Triggers

Activate this goal when the merchant expresses any of the following intents:

- "clear inventory"
- "stock mover"
- "clearance sale"
- "old inventory"
- "overstocked"
- "slow sellers"
- "dead stock"
- "excess stock"
- "move old products"
- Any request mentioning inventory levels, stock clearance, or product velocity

---

## Recommended Actions

### Primary: Flow: Stock Mover Clearance

The sole action for this goal. Identifies slow-moving products using the velocity ratio (ordersCount / quantity) and creates targeted discounts with depth proportional to inventory urgency.

**When to use:** Whenever the merchant wants to reduce stock levels for underperforming products.

**Key mechanics:**
- Velocity analysis: products with low ordersCount relative to quantity are clearance candidates
- Discount depth scales with overstock severity (deeper discounts for more stagnant items)
- Scope is typically ITEMS (specific slow-moving products) or CATEGORY (if an entire category is underperforming)
- Margin protection is critical — clearance discounts push closer to cost, so the guardrail must verify effective margin stays above 15%

**Product selection criteria:**
- High quantity + low ordersCount = primary candidates
- Products with 0 orders in 30+ days = urgent candidates
- Products approaching seasonal irrelevance = time-sensitive candidates

---

## Presentation requirement — surface the margin guardrail

**Every clearance recommendation presented to the merchant MUST explicitly reference the margin-floor guardrail in its `reasoning` / `why` field.** Clearance discounts push closest to cost, so the merchant needs to see — per item — that the discount stays above the floor.

Acceptable phrasings:
- "Discount keeps effective margin ≥ 15% (minMarginPct floor)."
- "Stays above breakeven — current margin {X}%, post-discount {Y}%, floor 15%."
- "Margin protected: this discount does NOT push below the 15% floor on `{product}`."

If a candidate item would violate the floor at the velocity-tier discount, **either** lower the discount to stay above the floor and say so, **or** drop the item and note "skipped — would breach margin floor."

Do NOT present a clearance recommendation that omits margin language. Urgency / stock level / "why this %" are not substitutes — the guardrail line is required.

---

## Measurement Plan

### Before campaign launch

1. Record baseline stock levels for all targeted products
2. Record current sales velocity (ordersCount over last 30 days)
3. Calculate starting inventory turnover ratio per product

### During campaign (weekly check-ins)

1. Track units sold per clearance product
2. Monitor margin impact — clearance discounts erode margins faster than other campaigns
3. Check if discount depth needs adjustment:
   - Products still not moving after 7 days — consider deepening discount
   - Products clearing too fast — margin may be too generous

### After campaign (30-day assessment)

1. Calculate clearance rate: `units_sold / starting_stock * 100`
2. Compare inventory turnover ratio before and after
3. Calculate revenue recovered from products that had near-zero velocity
4. Assess carrying cost savings from reduced inventory
5. Target benchmarks:
   - Clearance rate > 50% = successful
   - Clearance rate < 20% = discount may have been too conservative or products are truly unsellable

---

## Decision Matrix

| Scenario | Approach | Rationale |
|---|---|---|
| Few specific slow products | ITEMS scope, targeted discounts | Surgical clearance avoids discounting healthy inventory |
| Entire category underperforming | CATEGORY scope | Broader clearance when the problem is category-wide |
| Products near zero velocity | Deeper discounts (up to margin floor) | Aggressive clearance justified for truly stagnant stock |
| Seasonal items approaching end of season | Time-limited clearance with urgency | Combine with end date to create customer urgency |
| Merchant specifies products or percentages | Honor merchant input | User overrides always take priority |
