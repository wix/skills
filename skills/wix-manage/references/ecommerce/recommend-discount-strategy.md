---
name: "Recommend: Discount Strategy"
description: Proactive discount recommendation skill — gathers site data, classifies merchant intent into 4 business goals, analyzes catalog, and generates up to 3 actionable discount recommendations across different strategies.
layer: R
references:
  - name: "API: Discount Recommendations"
    path: ecommerce/api-discount-recommendations.md
    load: true
  - name: "Guardrail: Discount Conflicts"
    path: ecommerce/guardrail-discount-conflicts.md
    load: false
---
# Recommend: Discount Strategy

## EXECUTION RULES — READ BEFORE ANYTHING ELSE

**You are an operator, not a consultant.** When this recipe is activated:

1. **Do NOT produce recommendations before calling the mandatory APIs.** If you skip the API calls and generate advice from assumptions, your output is wrong — even if it sounds reasonable.
2. **Execute every step in order.** Do not skip steps. Do not merge steps. Do not answer "in the meantime."
3. **Use ONLY data returned by API calls.** Never substitute reasoning, general knowledge, or doc summaries for live data.
4. **If a call fails or is blocked, report the exact blocker.** Do not work around it with assumptions.
5. **All API calls use `CallWixSiteAPI`.** The internal tool names (getSiteData, getCatalogAnalytics, etc.) are NOT directly callable. You must use `CallWixSiteAPI` with the correct URL, method, and body as shown in each step.

---

## Step 0: Resolve the target site

**MANDATORY — do this first.**

If you don't already have a `siteId`, call `ListWixSites` to find it.

If the merchant mentioned a site name, match it. If only one site exists, auto-select it. Store the `siteId` — every subsequent API call requires it.

**Do not proceed without a siteId.**

---

## Step 1: Validate the request

Check if the merchant's request is within scope. **Reject** these:

| Unsupported request | Suggest instead |
|---|---|
| Free shipping | "Flow: Add Free Shipping" skill |
| Buy one get one (BOGO) | Explain: not supported by Discount Rules API |
| Fixed-price bundles ("3 for $100") | Explain: requires custom pricing logic |
| Unrelated to discounts | Decline politely |

If valid, continue.

---

## Step 2: Gather site data

**MANDATORY API CALL — do not skip.**

Call `CallWixSiteAPI` with:

```
url: https://manage.wix.com/recommendations/v1/recommendations/get-site-data-tool
method: POST
siteId: <siteId from Step 0>
body: {
  "fields": ["country", "businessType", "industry", "visitors", "revenue", "ordersCount", "currency", "language"],
  "include": ["currentDiscounts", "AOV", "discountMargin"]
}
```

**You need these values from the response:**

| Value | What it's used for |
|---|---|
| `aov` | Setting minSubTotal thresholds |
| `discountMargin` | Max allowed discount (decimal, e.g., 0.25 = 25%) |
| `currentDiscounts` | Conflict detection |
| `country` | Holiday detection |
| `currency` | Price formatting |
| `language` | Translating recommendation names |

**STOP if `country`, `industry`, or `revenue` are missing or null.** Report: "Cannot generate recommendations — missing required site data: {fields}."

---

## Step 3: Classify the merchant's intent

Determine the business goal:

| Goal | Trigger phrases |
|---|---|
| **UPSELL_BOOST** | "increase AOV", "spend more", "upsell", "order value" |
| **BUNDLE_AND_SAVE** | "bundle", "cross-sell", "buy together", "multi-buy" |
| **STOCK_MOVER** | "clear inventory", "overstock", "dead stock", "clearance" |
| **SEASONAL** | Holiday names, dates, "seasonal", "sale event" |

If ambiguous, default to `UPSELL_BOOST`.

Extract from input: **keywords** (product/brand names), **category suggestions** (only if merchant says "category"), **date range** (map holidays to dates).

---

## Step 4: Determine mechanism — Automatic Discount or Coupon

| Merchant says | Mechanism |
|---|---|
| "sale", "promotion", "discount for everyone" | **Automatic** |
| "coupon", "code", "promo code", "voucher" | **Coupon** |
| "discount for subscribers", "influencer code" | **Coupon** |
| Unclear | **Ask the merchant** |

**If unclear, ask:** "Would you like this to apply automatically to everyone, or as a coupon code?"

---

## Step 5: Analyze the catalog

**MANDATORY API CALLS — do not skip. Call both concurrently.**

### Call 1: GetCatalogAnalytics

Call `CallWixSiteAPI` with:

```
url: https://manage.wix.com/recommendations/v1/recommendations/get-catalog-analytics-tool
method: POST
siteId: <siteId>
body: {
  "aggregates": <see table below>,
  "minMarginPct": 0.15
}
```

**Aggregates by goal:**

| Goal | `aggregates` array |
|---|---|
| UPSELL_BOOST | `[{"op":"count","field":"price"}, {"op":"quantiles","field":"price","q":[0.5,0.75,0.9]}, {"op":"avg","field":"profitMargin"}]` |
| BUNDLE_AND_SAVE | `[{"op":"min","field":"price"}, {"op":"max","field":"price"}, {"op":"avg","field":"profitMargin"}, {"op":"count","field":"price"}]` |
| STOCK_MOVER | `[{"op":"sum","field":"quantity"}, {"op":"sum","field":"ordersCount"}, {"op":"avg","field":"profitMargin"}]` |
| SEASONAL | `[{"op":"sum","field":"ordersCount"}, {"op":"quantiles","field":"price","q":[0.5,0.9]}, {"op":"avg","field":"profitMargin"}]` |

### Call 2: GetProductCatalogData

Call `CallWixSiteAPI` with:

```
url: https://manage.wix.com/recommendations/v1/recommendations/get-product-catalog-data-tool
method: POST
siteId: <siteId>
body: {
  "businessGoal": "<goal from Step 3>",
  "minMarginPct": 0.15,
  "catalogLimit": 30,
  "query": "<keywords from Step 3, or empty string>",
  "categoryNames": <category suggestions from Step 3, or empty array>
}
```

### Failure handling

- **Both calls fail**: Fall back to SITE scope with 5-10% discount using only site data from Step 2.
- **Only GetProductCatalogData fails**: Use category names from analytics → call GetCategoryIds (Step 5b).
- **Only GetCatalogAnalytics fails**: Use product data to identify opportunities.

### Step 5b: Convert category names to GUIDs (if using CATEGORY scope)

**MANDATORY before outputting any categoryIds.**

Call `CallWixSiteAPI` with:

```
url: https://manage.wix.com/recommendations/v1/recommendations/get-category-ids-tool
method: POST
siteId: <siteId>
body: {
  "categoryNames": ["<category name from analytics>"]
}
```

If response returns empty `categoryIds`: fall back to SITE scope.

---

## Step 6: Generate up to 3 recommendations

**Only now — after Steps 0-5 have returned data — generate recommendations.**

Each recommendation MUST use a **different strategy**:

1. **If AOV data available** → UPSELL_BOOST (minSubTotal above AOV)
2. **If slow movers found** (high quantity, low ordersCount) → STOCK_MOVER
3. **If holiday within 30 days** → SEASONAL
4. **If many low-priced items** → BUNDLE_AND_SAVE
5. **Fallback** → conservative SITE-scope

Return fewer than 3 if data doesn't support more.

### Scope selection

1. **CATEGORY** (preferred): High-opportunity category from analytics. Must have GUID from GetCategoryIds.
2. **ITEMS** (specific): Individual products from catalog data. Max 5 product IDs.
3. **SITE** (fallback): When no clear category/product opportunity.

### Performance signals

| What you observe in the data | What to recommend |
|---|---|
| High visitors, low ordersCount | Site-wide discount to convert traffic |
| High AOV, few items per order | BUNDLE_AND_SAVE |
| Products with high stock + low orders | STOCK_MOVER |
| Holiday within 30 days | SEASONAL |

---

## Step 7: Validate before returning

1. **Conflict check**: Do existing active discounts/coupons overlap with your recommendation scope? Warn about stacking.
2. **Margin check**: Discount must not exceed `discountMargin` from Step 2 (unless merchant overrides).
3. **Strategy uniqueness**: Each recommendation uses a different strategy.
4. **Mechanism match**: Automatic or Coupon per Step 4.
5. **ID validity**: All categoryIds are GUIDs from GetCategoryIds. All productIds are from GetProductCatalogData.
6. **Rounding**: Discount percentages round to 5/10/15/20/25% unless merchant specified exact value.

---

## Output format

```json
{
  "recommendations": [
    {
      "title": "15% Off Electronics — Orders Over $200",
      "reasoning": "AOV is $165 (from GetSiteData). Electronics avg margin 42% (from GetCatalogAnalytics). Setting $200 threshold incentivizes adding one more item.",
      "domain": "discounts",
      "urgency": "HIGH | MEDIUM | LOW",
      "advice": {
        "action": "apply_discount",
        "params": {
          "mechanism": "AUTOMATIC | COUPON",
          "scope": "SITE | CATEGORY | ITEMS",
          "categoryIds": [],
          "productIds": [],
          "name": "Spend More, Save More",
          "why": "Rewards orders above your $165 average with 15% off.",
          "discountType": "PERCENTAGE",
          "discount": 15,
          "code": "",
          "usageLimit": 0,
          "limitPerCustomer": 0,
          "conditions": {
            "minItemQuantity": 0,
            "minSubTotal": 200,
            "startDate": "",
            "endDate": ""
          }
        },
        "success_criteria": "15% discount applied to Electronics for orders above $200"
      }
    }
  ]
}
```

### Field rules

| Field | Rule |
|---|---|
| `title` | Short, actionable. Max 200 chars. Always English. |
| `reasoning` | **Must reference which API call returned the data.** Always English. |
| `mechanism` | `AUTOMATIC` or `COUPON`. From Step 4. |
| `name` | Marketing headline, 2-5 words. Translate to site `language` if not English. |
| `why` | 1-2 sentences with specific data points from API responses. Translate to site `language`. |
| `code` | Only for COUPON. Memorable code, max 20 chars (e.g., "SAVE15"). |
| `scope` + IDs | Mutually exclusive: SITE = both empty, CATEGORY = categoryIds only (max 3), ITEMS = productIds only (max 5). |

---

## Constraints

- Maximum 3 recommendations
- Each must use a different strategy
- All data must come from API responses — no assumptions
- Respect discountMargin cap unless merchant overrides
- All IDs must be GUIDs from API responses
- Catalog queries limited to 30 items
