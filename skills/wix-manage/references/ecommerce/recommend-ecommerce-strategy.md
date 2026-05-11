---
name: "Recommend: eCommerce Strategy"
description: Unified eCommerce recommendation skill — analyzes site data across ALL domains (discounts, shipping, and future domains) and generates up to 5 actionable recommendations. Single entry point for any "help my business" request. Tracking is built-in.
layer: R
references:
  - name: "API: Discount Recommendations"
    path: ecommerce/api-discount-recommendations.md
    load: true
  - name: "API: Recommendation Tracking"
    path: ecommerce/api-recommendation-tracking.md
    load: true
---
# Recommend: eCommerce Strategy

> **Before executing this skill**, read this API reference with `ReadFullDocsArticle`:
> - [API: Discount Recommendations](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-discount-recommendations)

## EXECUTION RULES — READ BEFORE ANYTHING ELSE

**You are an operator, not a consultant.** When this recipe is activated:

1. **Do NOT ask clarifying questions — start executing immediately from Step 1.** The merchant's request contains enough information. The analysis steps will determine which domains and strategies apply.
2. **Do NOT produce recommendations before calling the mandatory APIs.** If you skip the API calls and generate advice from assumptions, your output is wrong — even if it sounds reasonable.
3. **Execute every step in order.** Do not skip steps. Do not merge steps. Do not answer "in the meantime."
4. **Use ONLY data returned by API calls.** Never substitute reasoning, general knowledge, or doc summaries for live data.
5. **If a call fails or is blocked, report the exact blocker.** Do not work around it with assumptions.
6. **All API calls use `CallWixSiteAPI`.** The internal tool names (getSiteData, getCatalogAnalytics, etc.) are NOT directly callable.
7. **Generate recommendations across ALL relevant domains** — not just discounts. Consider shipping, discounts, and any other domain that the data supports.

---

## Step 1: Resolve the target site

**MANDATORY — do this first.**

If you don't already have a `siteId`, call `ListWixSites` to find it.

If the merchant mentioned a site name, match it. If only one site exists, auto-select it. Store the `siteId` — every subsequent API call requires it.

**Do not proceed without a siteId.**

---

## Step 2: Load recommendation history (Tracking)

**MANDATORY — do NOT skip unless the user said `SKIP_TRACKING` or "don't track".**

Query the tracking database for existing recommendations on this site:

```
CallWixSiteAPI(
  url: "https://manage.wix.com/_api/agentic-recommendations/v1/agentic-recommendations/query",
  method: "POST",
  siteId: <siteId>,
  body: { "query": { "filter": {}, "cursorPaging": { "limit": 50 } } }
)
```

**Use the returned history to inform your analysis:**

| State | How to use it |
|---|---|
| `PROPOSED` | Don't re-propose — ask about the pending one |
| `DONE` | Don't re-propose — consider complementary recommendations |
| `REJECTED` | Do NOT re-propose. If `rejectionPermanent` is true, never suggest this action type again |
| `FAILED` | Offer to retry or suggest alternative |
| `EXPIRED` | Can re-propose if still relevant with fresh data |

If the query returns empty results or fails, continue — this is a fresh session.

---

## Step 3: Gather site data

**MANDATORY API CALL — do not skip.**

```
CallWixSiteAPI(
  url: "https://manage.wix.com/recommendations/v1/recommendations/get-site-data-tool",
  method: "POST",
  siteId: <siteId>,
  body: {
    "fields": ["country", "businessType", "industry", "visitors", "revenue", "ordersCount", "currency", "language"],
    "include": ["currentDiscounts", "AOV", "discountMargin"]
  }
)
```

**You need these values:**

| Value | Used for |
|---|---|
| `aov` | Discount thresholds, shipping threshold calibration |
| `discountMargin` | Max allowed discount (decimal, 0.25 = 25%) |
| `currentDiscounts` | Conflict detection |
| `country` | Holiday detection, shipping region analysis |
| `currency` | Price formatting |
| `language` | Translating recommendation names |
| `visitors` | Traffic-to-conversion analysis |
| `ordersCount` | Conversion analysis |

**STOP if `country`, `industry`, or `revenue` are missing or null.** Report: "Cannot generate recommendations — missing required site data: {fields}."

---

## Step 4: Identify applicable domains

Based on the merchant's request AND the site data, determine which domains to analyze. **Multiple domains can be active simultaneously.**

| Domain | When to activate | Data signals |
|---|---|---|
| **DISCOUNTS** | Merchant mentions sales, promotions, revenue, AOV, clearance, holidays, coupons. **Also activate if no specific domain is mentioned** (default). | Always — site data contains discount metrics |
| **SHIPPING** | Merchant mentions shipping, delivery, checkout conversion, cart abandonment. **Also activate proactively** if site data suggests shipping issues. | High visitors + low orders may indicate shipping friction |

**Priority rule**: If the merchant mentions a specific holiday/event/date, the DISCOUNTS domain MUST use the **SEASONAL** strategy — even if other signals match other goals.

**If the request is generic** (e.g., "boost my sales", "help my business"), **activate ALL domains**. The best recommendations will come from analyzing every angle.

**If the request targets a specific domain** (e.g., "give me a coupon", "fix my shipping rates", "set up a gift card"), **activate ONLY that domain**. Do not generate cross-domain recommendations — focus all 5 recommendation slots on the requested domain. The merchant asked for something specific; respect that focus.

---

## Step 5: Analyze catalog (Discounts domain)

**Skip this step if DISCOUNTS domain is not active.**

Call both APIs concurrently:

### Call 1: GetCatalogAnalytics

```
CallWixSiteAPI(
  url: "https://manage.wix.com/recommendations/v1/recommendations/get-catalog-analytics-tool",
  method: "POST",
  siteId: <siteId>,
  body: {
    "aggregates": [
      {"op":"sum","field":"ordersCount"},
      {"op":"quantiles","field":"price","q":[0.5,0.75,0.9]},
      {"op":"avg","field":"profitMargin"}
    ],
    "minMarginPct": 0.15
  }
)
```

### Call 2: GetProductCatalogData

```
CallWixSiteAPI(
  url: "https://manage.wix.com/recommendations/v1/recommendations/get-product-catalog-data-tool",
  method: "POST",
  siteId: <siteId>,
  body: {
    "businessGoal": "SEASONAL",
    "minMarginPct": 0.15,
    "catalogLimit": 30,
    "query": "",
    "categoryNames": []
  }
)
```

Adjust `businessGoal` based on Step 4 classification. If SEASONAL, use `"SEASONAL"`. If generic, use `"UPSELL_BOOST"` as default.

### Failure handling

- Both fail: Generate discount recommendations using only site data (conservative 5-10%).
- One fails: Use whichever succeeded.

---

## Step 6: Generate recommendations across ALL active domains

**Only now — after data gathering — generate recommendations.**

Maximum **5 recommendations total** across all domains. Each recommendation includes its `domain` field.

### Discount recommendations (if DISCOUNTS domain active)

Use site data + catalog data to generate discount recommendations. Each should use a **different strategy**:

| Strategy | When to use | Key parameters |
|---|---|---|
| SEASONAL | Holiday/event within 30 days | Time-bounded, site-wide or category scope |
| UPSELL_BOOST | AOV data available | minSubTotal above current AOV |
| STOCK_MOVER | Products with high stock + low orders | Deeper discounts on slow movers |
| BUNDLE_AND_SAVE | Many low-priced items | minItemQuantity conditions |

**Discount constraints:**
- Discount must not exceed `discountMargin` from site data (unless merchant overrides)
- Round percentages to 5/10/15/20/25% unless merchant specified exact value
- All categoryIds must be GUIDs from GetCategoryIds (call if using CATEGORY scope)
- All productIds must be from GetProductCatalogData

### Shipping recommendations (if SHIPPING domain active)

Analyze the site's shipping configuration using the rules below. All shipping recommendations use `domain: "shipping"`.

**Externally managed regions:** Regions where `deliveryCarriers[].appId` matches an external carrier (e.g., Shippo) — exclude from ALL analysis. Do not recommend changes to these.

**Shipping analysis rules — evaluate each and recommend where data supports:**

| Rule | Finding | Recommendation |
|---|---|---|
| **Coverage** | Active region with zero shipping options | CRITICAL — `create_shipping_option` for that region |
| **Coverage** | Domestic country not covered by any region | CRITICAL — `activate_region` or create domestic region |
| **Coverage** | Inactive regions with shipping options | `activate_region` or clean up orphaned options |
| **Free Shipping** | No free shipping option anywhere | `create_shipping_option` with AOV-calibrated threshold (1.2-1.5x AOV) |
| **Free Shipping** | Free shipping threshold > 2x AOV | Lower threshold — too high for most customers |
| **Rates** | Flat rate > 15% of AOV | Reduce rate or add conditional tiering — sticker shock risk |
| **Rates** | All flat rates, no conditional pricing | Add threshold-based tiers for better conversion |
| **Rates** | Per-item pricing enabled | Review — usually causes unexpectedly high totals |
| **Carrier** | No backup rate on carrier regions | `enable_backup_rate` as fallback |
| **Options** | Too many options per region (> 5) | Consolidate — choice paralysis reduces conversion |
| **Options** | Only 1 option per region | Add at least one alternative (e.g., express tier) |

**Shipping action types:** `create_shipping_option`, `update_shipping_option`, `enable_backup_rate`, `activate_region`.

**Priority order:** CRITICAL blockers (no options, no coverage) → Conversion-linked (no free shipping, high rates) → Revenue opportunities (international, tiered pricing) → Configuration improvements (consolidate, add estimates).

### Cross-domain balance

- If request is generic, aim for recommendations from **multiple domains** (e.g., 2-3 discount + 1-2 shipping)
- If request targets a specific domain, prioritize that domain but include 1 cross-domain recommendation if data strongly supports it
- Rank by business impact: CRITICAL blockers first, then conversion-linked, then revenue opportunities

---

## Step 7: Validate before returning

1. **No duplicates**: Each recommendation targets a different scope/action combination
2. **No contradictions**: Don't recommend opposite actions in the same domain
3. **Margin check**: Discounts within `discountMargin` cap
4. **Strategy diversity**: Discount recommendations use different strategies where possible
5. **Data-backed**: Every recommendation must reference specific data from API responses
6. **Domain labeled**: Every recommendation has the correct `domain` field

---

## Step 8: Persist recommendations to database (Tracking)

**MANDATORY — do NOT skip unless the user said `SKIP_TRACKING`.**

Call `BatchCreate` to persist ALL recommendations as PROPOSED:

```
CallWixSiteAPI(
  url: "https://manage.wix.com/_api/agentic-recommendations/v1/agentic-recommendations/batch-create",
  method: "POST",
  siteId: <siteId>,
  body: {
    "agenticRecommendations": [
      {
        "title": "<recommendation title>",
        "reasoning": "<recommendation reasoning>",
        "domain": "<discounts|shipping>",
        "urgency": "<CRITICAL|HIGH|MEDIUM|LOW>",
        "advice": {
          "action": "<action type>",
          "params": <params object>,
          "successCriteria": "<how to verify success>"
        }
      }
    ],
    "conversationId": "<conversationId>"
  }
)
```

**Save the `id` and `revision` from each result.** Include them in the output.

If BatchCreate fails, report the error and include recommendations without tracking IDs.

---

## Output format

```json
{
  "recommendations": [
    {
      "id": "<tracking-id from BatchCreate, or omit if tracking failed>",
      "revision": "<revision from BatchCreate>",
      "title": "Memorial Weekend Flash Sale — 15% Off Orders Over $250",
      "reasoning": "AOV is $242 (from GetSiteData). Country is US, Memorial Day is within 7 days. Setting $250 threshold nudges carts above AOV while staying within 25% discount cap.",
      "domain": "discounts",
      "urgency": "HIGH",
      "advice": {
        "action": "apply_discount",
        "params": {
          "mechanism": "AUTOMATIC",
          "scope": "SITE",
          "categoryIds": [],
          "productIds": [],
          "name": "Memorial Weekend Sale",
          "why": "Your AOV is $242. A 15% discount on orders over $250 encourages adding one more item.",
          "discountType": "PERCENTAGE",
          "discount": 15,
          "conditions": {
            "minSubTotal": 250,
            "startDate": "2026-05-23",
            "endDate": "2026-05-26"
          }
        },
        "success_criteria": "15% discount applied site-wide for orders above $250 during Memorial Weekend"
      }
    },
    {
      "title": "Add Free Shipping for Orders Over $290",
      "reasoning": "No free shipping option detected. Site has 26,300 visitors but checkout conversion may be impacted by shipping costs. AOV is $242, so $290 threshold (1.2x AOV) incentivizes slightly larger orders.",
      "domain": "shipping",
      "urgency": "MEDIUM",
      "advice": {
        "action": "create_shipping_option",
        "params": {
          "category": "free_shipping",
          "rates": [{ "amount": "0", "conditions": [{ "type": "BY_TOTAL_PRICE", "operator": "GTE", "value": "290" }] }]
        },
        "success_criteria": "Free shipping option created for orders above $290"
      }
    }
  ]
}
```

### Field rules

| Field | Rule |
|---|---|
| `id` | GUID from tracking BatchCreate response (omit if tracking skipped/failed) |
| `title` | Short, actionable. Max 200 chars. Always English. |
| `reasoning` | **Must reference which API call returned the data.** Always English. |
| `domain` | `"discounts"` or `"shipping"` (future: `"gift_cards"`, `"taxes"`) |
| `urgency` | `CRITICAL`, `HIGH`, `MEDIUM`, or `LOW` |
| `advice.action` | Domain-specific action type |
| `advice.params` | Domain-specific parameters |
| `success_criteria` | How to verify the recommendation was applied correctly |

### Valid action types by domain

| Domain | Action types |
|---|---|
| discounts | `apply_discount` |
| shipping | `create_shipping_option`, `update_shipping_option`, `enable_backup_rate`, `activate_region` |

---

## Constraints

- Maximum 5 recommendations total across all domains
- All data must come from API responses — no assumptions
- Respect discountMargin cap unless merchant overrides
- All IDs must be GUIDs from API responses
- Catalog queries limited to 30 items
- Every recommendation MUST be persisted via tracking before presenting (unless SKIP_TRACKING)
- Recommendations should span multiple domains when the request is generic
