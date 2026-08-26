---
name: "eCommerce Recipes"
description: "Store commerce beyond the catalog — coupons, discount rules and promotions, shipping rates, regions, pickup and free-shipping thresholds, gift cards, and data-driven recommendations for raising order value, clearing stock or running seasonal campaigns. Use for anything users call discounts, coupons, promotions, sales, shipping, delivery, pickup, gift cards, upsells, bundles, clearance, or 'grow my sales'."

---

# eCommerce Recipes

Two habits make this area work. First, **load the store's context before recommending anything** — currency, country, recent orders and visitors come from the context recipe, and every recommendation depends on them. Second, this area is organised around **dispatchers**: for a question about discounts or shipping, open that domain's dispatcher first, because it owns the boundary rules and routes to the specific recipe. Product and catalog work lives in the stores recipes, not here.

The recommendation recipes are layered: a **goal** recipe owns classification and routing for one kind of ask, and its **flow** recipe is the sub-step it hands off to. Enter through a goal, never directly through a flow. If the user asks broadly for ideas rather than one action, start from the unified strategy recipe.

## Start here

### [eCommerce: Load Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context)
Use before any recommendation or promotion work — loads site currency, country, industry and recent order and visitor figures.

### [Recommend: eCommerce Strategy](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/recommend-e-commerce-strategy)
Use when the user asks broadly for ideas or 'what should I do' — analyses the site across domains and produces a short list of actions.

### [API: Recommendation Tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/api-recommendation-tracking)
Use alongside any generated recommendations — the tracking calls that record what was suggested.

## Pricing and promotions

### [Pricing & Promotions](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-promotions)
Open this first for any discount, coupon, sale, ribbon or bundle question — it owns the boundary rules and routes onward.

### [Pricing: Create Coupon](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-coupon)
Use to create a coupon, including converting a coupon recommendation into a real one.

### [Pricing: Create Discount Rule](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-create-discount-rule)
Use for automatic discounts — percentage or fixed amount, scoped catalog-wide, to collections, or to specific products.

### [Pricing: Discount Not Applying](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/pricing-discount-not-applying)
Use when a discount exists but is not applying at checkout — a diagnostic path through status, time window, scope and app install.

## Shipping

### [Shipping](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping)
Open this first for any shipping-setup question — rates, regions, pickup, free shipping — it owns the boundary and routes onward.

### [Shipping: Set Up Rates](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-set-up-rates)
Use to configure rate types (flat, tiered, free), conditions, and a free-shipping threshold calibrated against order value.

### [Shipping: Set Up Regions](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-set-up-regions)
Use for delivery profiles and regions — destinations, carriers, backup rates, and externally managed regions.

### [Shipping: Set Up Pickup / Local Delivery](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/local-delivery)
Use to offer in-store pickup or local delivery at checkout, via the Pickup carrier on a delivery profile.

### [Shipping: Add Free Shipping](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-add-free-shipping)
Use to add a free-shipping option with a threshold validated against the catalog's price distribution.

### [Shipping: Optimize Rates](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-optimize-rates)
Use to review an existing rate structure — flat-to-tiered conversion, tier gaps, and per-item penalties.

### [Shipping: Fix Coverage Gaps](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-fix-coverage-gaps)
Use when an active delivery region has no shipping options at all, leaving customers unable to check out.

### [Shipping: API Reference](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/shipping-api-reference)
Use for the exact Shipping Options endpoints and request shapes when a recipe above is not enough.

## Goals (enter here for recommendations)

### [Goal: Increase AOV](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-increase-aov)
Use for upsell, average-order-value or 'boost my sales' asks — owns the lever map across discounts, shipping and bundles.

### [Goal: Clear Inventory](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-clear-inventory)
Use for clearance, overstock, slow-moving or dead-stock asks.

### [Goal: Seasonal Revenue](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-seasonal-revenue)
Use for holiday, event or date-tied promotions — and note it takes priority when a seasonal signal competes with an upsell one.

### [Goal: Drive Cross-Sells](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-drive-cross-sells)
Use for bundling, cross-sell, multi-item or 'buy together' asks.

### [Goal: Sell Gift Cards](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/goal-sell-gift-cards)
Use for gift-card asks — sizes denominations from the site's own order values and catalog prices.

## Flows (sub-steps, reached from a goal above)

### [Flow: Upsell Boost](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-upsell-boost)
Reached from Goal: Increase AOV — do not enter directly.

### [Flow: Stock Mover](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-stock-mover)
Reached from Goal: Clear Inventory — do not enter directly.

### [Flow: Seasonal Promotion](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-seasonal-promotion)
Reached from Goal: Seasonal Revenue — do not enter directly.

### [Flow: Bundle and Save](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/flow-bundle-and-save)
Reached from Goal: Drive Cross-Sells — do not enter directly.
