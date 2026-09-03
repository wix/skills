---
name: "eCommerce Recipes"
description: "Store commerce beyond the catalog — coupons, discount rules and promotions, shipping rates, regions, pickup and free-shipping thresholds, gift cards, and data-driven recommendations for raising order value, clearing stock or running seasonal campaigns. Use for anything users call discounts, coupons, promotions, sales, shipping, delivery, pickup, gift cards, upsells, bundles, clearance, or 'grow my sales'."

---

# eCommerce Recipes

Two habits make this area work. First, **load the store's context before recommending anything** — currency, country, recent orders and visitors come from the context recipe, and every recommendation depends on them. Second, this area is organised around **dispatchers**: for a question about discounts or shipping, open that domain's dispatcher first, because it owns the boundary rules and routes to the specific recipe. Product and catalog work lives in the stores recipes, not here.

The recommendation recipes are layered: a **goal** recipe owns classification and routing for one kind of ask, and its **flow** recipe is the sub-step it hands off to. Enter through a goal, never directly through a flow. If the user asks broadly for ideas rather than one action, start from the unified strategy recipe.

**Open the recipe before calling any API.** This page names the area's recipes and says
when to reach for each one; the endpoints, request shapes, required fields and field names
live only in the recipes themselves.

## Start here

### [eCommerce: Load Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context)
**Technical:** eCommerce L1 context loader — calls
wix-profile-client/v4/profile/metasite (NOT site-properties) to load siteId, country,
currency, industry, last-30-day visitors/orders/GPV. Skip if already loaded.

### [Recommend: eCommerce Strategy](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-e-commerce-strategy)
**Technical:** Unified eCommerce recommendation skill — analyzes site data across ALL
domains (discounts, shipping, and future domains) and generates up to 5 actionable
recommendations. Entry point for requests about earning more from the visitors a store
already has: sales, promotions, discounts, coupons, clearance, holiday deals, AOV,
shipping. Out of scope — traffic acquisition (SEO, ads, social, content); route \"grow
my traffic\" requests to marketing instead. Tracking is built-in.

### [API: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-recommendation-tracking)
**Technical:** Cross-cutting tracking API for AI-generated recommendations across
eCommerce categories (checkout, shipping, pricing). ALWAYS LOAD BEFORE generating a
"give me N recommendations / concrete actions" response, in addition to the category
recipe.

## Pricing and promotions

### [Pricing & Promotions](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-promotions)
**Technical:** Pricing & Promotions boundary owner — discounts, coupons, sales, ribbons,
bundles. **Always load this dispatcher first when a question touches both discount work
and refunds, payments, product-price edits, or shipping rates** — the rules for which
side owns each topic live in this file, not in this README line.

### [Pricing: Create Coupon](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-coupon)
**Technical:** PREFERRED recipe for converting a COUPON recommendation (mechanism:
COUPON) into a Wix coupon. Use THIS entry — NOT the legacy setup-coupons entry which is
superseded. Maps scope/discountType/conditions to Coupons V2 API fields.

### [Pricing: Create Discount Rule](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-discount-rule)
**Technical:** Configures automatic discount rules using the eCommerce Discount Rules
API. Covers percentage and fixed-amount discounts, scope targeting (catalog-wide,
specific collections, or individual products), scheduling active periods, and the
find-by-name + update pattern.

### [Pricing: Discount Not Applying](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-discount-not-applying)
**Technical:** Diagnostic tree for when a discount rule exists but isn't applying at
checkout. Checks active status, time window, scope targeting, revision, and app
installation.

## Shipping

### [Shipping](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping)
**Technical:** Shipping-setup boundary owner for an eCommerce store. **Always load this
dispatcher first whenever a question touches shipping setup** — rates, regions, pickup,
free-shipping thresholds, and diagnosing wrong/missing shipping. Order fulfillment (mark
shipped, tracking, labels, invoices) is currently handled outside the routing tree.

### [Shipping: Set Up Rates](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-set-up-rates)
**Technical:** Configures shipping option rates — rate types (flat, tiered, free),
condition types and operators, free shipping threshold calibration, AOV sanity check,
per-item penalty avoidance, and tier gap detection.

### [Shipping: Set Up Regions](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-set-up-regions)
**Technical:** Configures delivery profiles and regions — creating profiles, adding
regions with destinations, assigning carriers, enabling backup rates, and handling
externally managed regions.

### [Shipping: Set Up Pickup / Local Delivery](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/local-delivery)
**Technical:** Configures a pickup option for an online store so customers can choose
in-store pickup at checkout. Uses the Delivery Profiles API to discover the Pickup
carrier, add a delivery region, and attach the carrier with a free pickup rate.

### [Shipping: Add Free Shipping](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-add-free-shipping)
**Technical:** Creates a free shipping option with an AOV-calibrated threshold to reduce
cart abandonment and increase average order value. Validates threshold against catalog
price distribution.

### [Shipping: Optimize Rates](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-optimize-rates)
**Technical:** Analyzes catalog price distribution and current rate structure to
recommend optimal shipping rate strategy. Handles flat-to-tiered conversion, tier gap
detection, and per-item penalty removal.

### [Shipping: Fix Coverage Gaps](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-fix-coverage-gaps)
**Technical:** Coverage gap = active delivery region with ZERO Shipping Options (NOT
zero carriers or no backup rate). Step 1: POST /ecom/v1/delivery-profiles/query. Step 2:
POST /ecom/v1/shipping-options/query — count options per region; gap = active region
with count 0. Step 3: POST /ecom/v1/shipping-options to create standard shipping for
each gap region.

### [Shipping: API Reference](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-api-reference)
**Technical:** Shipping Options API: POST /ecom/v1/shipping-options/query (list all),
POST /ecom/v1/shipping-options (create), PATCH /ecom/v1/shipping-options/{id} (update),
DELETE /ecom/v1/shipping-options/{id} (delete). Delivery Profiles API: POST
/ecom/v1/delivery-profiles/query. Base: https://www.wixapis.com/ecom

## Goals (enter here for recommendations)

### [Goal: Increase AOV](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-increase-aov)
**Technical:** UPSELL_BOOST goal — always load BEFORE recommending AOV / upsell / "boost
my sales" / shipping-threshold actions. Owns the cross-domain lever map (discount +
shipping + bundle) for open-ended sales prompts.

### [Goal: Clear Inventory](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-clear-inventory)
**Technical:** STOCK_MOVER clearance goal — always load BEFORE recommending any
clearance / overstock / slow-stock / dead-inventory action.

### [Goal: Seasonal Revenue](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-seasonal-revenue)
**Technical:** SEASONAL goal — always load BEFORE recommending any holiday / event /
date-tied promotion. Owns the priority rule (holiday beats UPSELL_BOOST when both
signals are present).

### [Goal: Drive Cross-Sells](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-drive-cross-sells)
**Technical:** BUNDLE_AND_SAVE goal — always load BEFORE recommending bundling /
cross-sell / multi-item / "buy together" actions.

### [Goal: Sell Gift Cards](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-sell-gift-cards)
**Technical:** SELL_GIFT_CARDS goal — the GIFT_CARDS domain logic loaded by the strategy
orchestrator. Sizes a gift card product from the site's own AOV and catalog prices
(preset denominations, custom amount range, expiration policy) and gates on the site
already selling gift cards. Sub-step, NOT a direct entry point — load Recommend:
eCommerce Strategy first; it owns domain activation, cross-domain dedup, and tracking.

## Flows (sub-steps, reached from a goal above)

### [Flow: Upsell Boost](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-upsell-boost)
**Technical:** UPSELL_BOOST sub-flow — load [Goal: Increase AOV] FIRST (it owns
classification and routing); this is a sub-step, NOT a direct entry from README.

### [Flow: Stock Mover](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-stock-mover)
**Technical:** Stock-mover clearance sub-flow — load [Goal: Clear Inventory] FIRST (it
owns the routing); this is a sub-step.

### [Flow: Seasonal Promotion](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-seasonal-promotion)
**Technical:** SEASONAL sub-flow — load [Goal: Seasonal Revenue] FIRST (it owns
classification and routing); this is a sub-step, NOT a direct entry from README.

### [Flow: Bundle and Save](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-bundle-and-save)
**Technical:** BUNDLE_AND_SAVE sub-flow — load [Goal: Drive Cross-Sells] FIRST (it owns
classification and routing); this is a sub-step, NOT a direct entry from README.
