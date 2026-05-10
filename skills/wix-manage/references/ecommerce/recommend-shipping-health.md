---
name: "Recommend: Shipping Health"
description: Proactive shipping health audit — analyzes delivery profiles, shipping options, and site metrics to generate prioritized recommendations for shipping setup improvement.
layer: R
references:
  - name: "Guardrail: Shipping Health"
    path: ecommerce/guardrail-shipping-health.md
    load: true
  - name: "Goal: Reduce Cart Abandonment"
    path: ecommerce/goal-reduce-cart-abandonment.md
    load: true
  - name: "Flow: Fix Coverage Gaps"
    path: ecommerce/flow-fix-coverage-gaps.md
    load: false
  - name: "Flow: Add Free Shipping"
    path: ecommerce/flow-add-free-shipping.md
    load: false
  - name: "Flow: Optimize Shipping Rates"
    path: ecommerce/flow-optimize-shipping-rates.md
    load: false
  - name: "Recipe: Recommendation Tracking"
    path: ecommerce/recipe-recommendation-tracking.md
    load: true
---
# Recommend: Shipping Health

> **Before executing this skill**, read these referenced skills with `ReadFullDocsArticle`:
> - [Guardrail: Shipping Health](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/guardrail-shipping-health)
> - [Goal: Reduce Cart Abandonment](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-reduce-cart-abandonment)
> - [Recipe: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recipe-recommendation-tracking)
>
> **After running checks**, read the matching flow skills with `ReadFullDocsArticle` based on your findings:
> - Coverage gaps or missing regions → [Flow: Fix Coverage Gaps](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-fix-coverage-gaps)
> - No free shipping or threshold issues → [Flow: Add Free Shipping](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-add-free-shipping)
> - Rate too high, missing tiers, or pricing issues → [Flow: Optimize Shipping Rates](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-optimize-shipping-rates)

Proactive shipping health audit that analyzes the store's delivery configuration, identifies gaps and optimization opportunities, and generates prioritized recommendations to improve shipping setup and checkout conversion.

---

## Step 0: Load recommendation history (Tracking)

**If Recommendation Tracking is active** (check the tracking skill's activation gate), execute **Phase 1** of the tracking skill now: query the tracking database for this site's recommendation history. Use the returned history to avoid re-proposing rejected or already-applied recommendations.

---

## Data Sources

All data is pre-fetched before analysis begins:

| Data Source | Contents | Purpose |
|---|---|---|
| site_context | Country, currency, industry, language | Localization and benchmarking |
| delivery_profiles | Profiles, regions, carriers, destinations | Coverage and configuration analysis |
| shipping_options | Options per region with rates and conditions | Rate and option analysis |
| pickup_locations | Physical pickup points | Fulfillment option coverage |
| shippo_config | Shippo carrier integration details | Identify externally managed regions |
| local_delivery | Local delivery settings | Fulfillment option coverage |
| site_metrics | Visitors, orders, revenue, delivery_step_cvr | Performance context |
| catalog_stats | Product count, price range, AOV | Threshold calibration |

---

## Step 0: Identify Externally Managed Regions

Before any analysis, identify regions managed by external carrier apps (e.g., Shippo).

**Detection:** Regions where `deliveryCarriers[].appId` matches a known external carrier app ID (e.g., Shippo's appId).

**Rule:** Exclude externally managed regions from ALL subsequent analysis. Do not generate recommendations for regions controlled by third-party carrier integrations — the merchant manages those through the carrier app, not through Wix shipping settings.

---

## Core Logic (Immutable)

These 5 checks always run in order. They cannot be skipped or reordered.

### Check 1: Configuration Completeness

Verify the basic shipping setup is functional:
- At least one delivery profile exists
- At least one active region exists
- At least one shipping option exists for each active region
- Domestic region (matching site country) is present and active

### Check 2: Region Coverage Gap Check

Identify regions that exist but have no shipping options, or destinations that are not covered by any region:
- Active regions without any shipping options = **CRITICAL** gap
- Domestic country not covered by any region = **CRITICAL** gap
- Inactive regions with shipping options = possible oversight

### Check 3: Checkout Conversion Impact

Correlate shipping configuration with checkout conversion:
- delivery_step_cvr below 65% benchmark → shipping friction likely
- No free shipping option anywhere → major conversion risk
- Shipping rates exceeding 15% of AOV → sticker shock risk

### Check 4: Priority Assignment

Assign priority to each finding using at least 2 urgency levels:

| Priority | Criteria | Examples |
|---|---|---|
| HIGH | Blocks checkout or directly causes abandonment | No shipping options for active region, no domestic coverage |
| MEDIUM | Impacts conversion or revenue but not a hard blocker | No free shipping, rates too high, missing delivery estimates |
| LOW | Configuration improvement, best practice | Too many options causing choice paralysis, missing carrier backup |

### Check 5: Final Validation Pass

Before outputting recommendations, validate:
- No duplicate recommendations (same action + same target)
- No contradictory recommendations (e.g., "add more options" and "reduce options" for the same region)
- No empty fields in any recommendation
- No hypothetical recommendations (every recommendation must be based on observed data, not assumptions)

---

## Configurable Rules

These rules generate specific recommendations based on the data analysis.

### Rule A: Configuration Completeness

| Finding | Recommendation |
|---|---|
| No delivery profile | CRITICAL — store cannot ship at all |
| No active regions | CRITICAL — no destinations configured |
| Region exists but no options | Create shipping option for that region |

### Rule B: Shipping Option Analysis

| Finding | Recommendation |
|---|---|
| Too many options per region (> 5) | Consolidate — choice paralysis reduces conversion |
| Too few options per region (1) | Add at least one alternative (e.g., express tier) |
| No free shipping option | Add free shipping with AOV-calibrated threshold |
| Missing delivery time estimate | Add `estimatedDeliveryTime` to options lacking it |
| Free shipping threshold too high (> 2x AOV) | Lower threshold to 1.2-1.5x AOV |
| Flat rate too high (> 15% of AOV) | Reduce rate or add conditional tiering |
| Per-item pricing enabled | Review — usually causes unexpectedly high totals |
| Surcharges present | Verify surcharges are intentional and documented |

### Rule C: Regional Coverage

| Finding | Recommendation |
|---|---|
| Profile without any regions | Add at least domestic region |
| Inactive regions with options | Activate region or remove orphaned options |
| Missing domestic region | CRITICAL — add domestic shipping |
| International opportunity (traffic from uncovered countries) | Consider adding international region |
| Coverage gaps between regions | Add regions to cover gaps |
| Options on inactive regions (orphans) | Clean up or activate the region |

### Rule D: Carrier Configuration

| Finding | Recommendation |
|---|---|
| No backup rate on carrier regions | Enable backup rate as fallback |
| Carrier region with no options | Add manual fallback option |

### Rule E: Fulfillment Options

| Finding | Recommendation |
|---|---|
| No pickup locations despite physical business | Consider adding store pickup |
| No local delivery despite local customer base | Consider adding local delivery |

### Rule F: Checkout Conversion

| Finding | Recommendation |
|---|---|
| delivery_step_cvr < 50% | CRITICAL — major shipping friction, prioritize free shipping + coverage |
| delivery_step_cvr 50-65% | MEDIUM — room for improvement, audit rates and options |
| delivery_step_cvr > 65% | Healthy — focus on optimization, not fixes |

### Rule G: Rate Strategy

| Finding | Recommendation |
|---|---|
| All flat rates, no conditional pricing | Add threshold-based tiers for better conversion |
| Free shipping threshold but no paid alternative | Add a paid standard option for below-threshold orders |
| Large rate gap between tiers | Add intermediate tier |

---

## Priority Calibration

Recommendations are ordered by business impact:

1. **CRITICAL blockers** — Issues preventing checkout completion (no options, no coverage)
2. **Conversion-linked** — Issues directly correlated with delivery_step_cvr (no free shipping, high rates)
3. **Revenue opportunities** — Improvements that could increase revenue (international expansion, tiered pricing)
4. **Configuration improvements** — Best practices that improve maintainability (consolidate options, add estimates)
5. **Nice-to-haves** — Optional enhancements (pickup locations, local delivery)

---

## Persist recommendations (Tracking)

**If Recommendation Tracking is active**, execute **Phase 2** of the tracking skill now: call `BatchCreate` to persist ALL recommendations to the tracking database as PROPOSED. Save the returned `id` and `revision` for each recommendation — include them in the output.

**Do NOT present recommendations to the merchant before persisting them.**

---

## Output Format

Maximum **5 recommendations** per audit. Each recommendation follows this structure:

```json
{
  "recommendations": [
    {
      "title": "Add Free Shipping for Orders Over $75",
      "reasoning": "Your store has no free shipping option. delivery_step_cvr is 48%, well below the 65% benchmark. Your AOV is $62, so a $75 threshold would incentivize slightly larger orders while offering free shipping to engaged buyers.",
      "domain": "shipping",
      "urgency": "HIGH",
      "advice": {
        "action": "create_shipping_option",
        "params": {
          "category": "free_shipping",
          "ids": ["region-guid-domestic"],
          "rates": [
            {
              "amount": "0",
              "conditions": [
                {
                  "type": "BY_TOTAL_PRICE",
                  "operator": "GTE",
                  "value": "75"
                }
              ]
            }
          ],
          "region": "Domestic"
        }
      }
    },
    {
      "title": "Enable Backup Rate for Carrier Region",
      "reasoning": "The Northern Europe region uses a carrier integration but has no backup rate. If the carrier API is unavailable at checkout, customers in this region will see no shipping options.",
      "domain": "shipping",
      "urgency": "MEDIUM",
      "advice": {
        "action": "enable_backup_rate",
        "params": {
          "ids": ["region-guid-northern-europe"],
          "rates": [
            {
              "amount": "12.99"
            }
          ],
          "region": "Northern Europe"
        }
      }
    }
  ]
}
```

### Action Types

Only these 4 action types are valid:

| Action | Description | When to use |
|---|---|---|
| `create_shipping_option` | Add a new shipping option to a region | Missing free shipping, missing tiers, new options |
| `update_shipping_option` | Modify an existing shipping option | Rate adjustment, add delivery estimate, change threshold |
| `enable_backup_rate` | Enable a backup rate on a carrier region | Carrier regions without fallback |
| `activate_region` | Activate an inactive delivery region | Inactive regions that should be serving customers |

**No other action types are permitted.** If a finding does not map to one of these 4 actions, describe it in the recommendation reasoning but do not include an `advice` block.

### Output Field Reference

| Field | Required | Description |
|---|---|---|
| `title` | Yes | Human-readable recommendation title |
| `reasoning` | Yes | Data-backed explanation referencing specific metrics or configuration findings |
| `domain` | Yes | Always `"shipping"` for this orchestrator |
| `urgency` | Yes | `HIGH`, `MEDIUM`, or `LOW` — at least 2 urgency levels must be used across all recommendations |
| `advice.action` | Yes | One of the 4 valid action types |
| `advice.params.category` | Conditional | Recommendation category (e.g., `free_shipping`, `express`, `standard`) |
| `advice.params.ids` | Yes | Region IDs or shipping option IDs targeted |
| `advice.params.rates` | Conditional | Rate configuration for create/update actions |
| `advice.params.region` | Yes | Human-readable region name for context |

---

## Constraints

- Maximum 5 recommendations per audit
- At least 2 different urgency levels must be used
- Never recommend changes to externally managed (Shippo) regions
- Every recommendation must be grounded in observed data — no hypothetical suggestions
- No duplicate recommendations (same action targeting the same entity)
- No contradictory recommendations within the same audit
