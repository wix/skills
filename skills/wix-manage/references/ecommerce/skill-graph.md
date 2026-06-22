---
name: "Skill Graph"
description: Mermaid diagram of the eCommerce routing tree — WixREADME to category dispatcher, leaf recipes, and carried-forward root files. Migrated categories in this PR: Pricing & promotions, Shipping, Checkout.
---

## Skill Graph Diagram

```mermaid
flowchart TB
    MR["Merchant Query"] --> README["WixREADME<br/>(portal index — category dispatchers + root recipes surface here)"]

    README --> PRICE
    README --> SHIP
    README --> CHECKOUT
    README --> ROOT

    LOADER["ecom-load-context.md<br/>(L1 loader — general site data;<br/>loaded by each category before dispatch)"]
    PRICE -.-> |load context| LOADER
    SHIP -.-> |load context| LOADER
    CHECKOUT -.-> |load context| LOADER

    TRACKING["api-recommendation-tracking<br/>(cross-domain — any recipe that<br/>generates recommendations loads this)"]
    ROOT --> |"Steps 2+8: load history + BatchCreate"| TRACKING

    subgraph PRICE["Pricing & promotions — pricing-promotions/"]
        direction TB
        PRICEDEF["ecom-pricing — category-doc + dispatcher"]
        PC["ecom-pricing-create-coupon"]
        PD["ecom-pricing-create-discount-rule"]
        PB["ecom-pricing-troubleshoot-not-applying"]
        PG["ecom-pricing-goal-* (4 support files)"]
        PF["ecom-pricing-flow-* (4 support files)"]
        PRICEDEF ~~~ PC ~~~ PD ~~~ PB ~~~ PG ~~~ PF
    end

    subgraph SHIP["Shipping — shipping/"]
        direction TB
        SHIPDEF["ecom-shipping — category-doc + dispatcher"]
        SR["ecom-shipping-setup-rates"]
        SG["ecom-shipping-setup-regions"]
        SP["ecom-shipping-setup-pickup"]
        SF["ecom-shipping-free-shipping"]
        SO["ecom-shipping-optimize-rates"]
        SX["ecom-shipping-fix-coverage"]
        SS["ecom-shipping-api"]
        SHIPDEF ~~~ SR ~~~ SG ~~~ SP ~~~ SF ~~~ SO ~~~ SX ~~~ SS
    end

    subgraph CHECKOUT["Checkout & cart — checkout/"]
        direction TB
        CHKDEF["ecom-checkout — category-doc + dispatcher"]
        CT["ecom-checkout-troubleshoot-dropoff"]
        CD["config intents → Wix Dashboard"]
        CHKDEF ~~~ CT ~~~ CD
    end

    subgraph ROOT["Carry-forward orchestrator (not yet in routing tree)"]
        direction TB
        REC["recommend-ecommerce-strategy<br/>(business-flow orchestrator —<br/>classifies into SEASONAL / UPSELL_BOOST /<br/>STOCK_MOVER / BUNDLE_AND_SAVE)"]
    end

    classDef dispatcher fill:#f59e0b,stroke:#d97706,color:#fff
    classDef promotion fill:#3b82f6,stroke:#2563eb,color:#fff
    classDef orchestrator fill:#ec4899,stroke:#db2777,color:#fff
    classDef support fill:#8b5cf6,stroke:#6d28d9,color:#fff
    classDef loader fill:#10b981,stroke:#059669,color:#fff
    classDef legacy fill:#6b7280,stroke:#4b5563,color:#fff

    class PRICEDEF,SHIPDEF,CHKDEF dispatcher
    class PC,PD,PB,SR,SG,SP,SF,SO,SX,CT promotion
    class REC orchestrator
    class PG,PF,SS support
    class LOADER loader
    class TRACKING support
    class CD legacy
```

The arrows land on each L2 group. Internal dispatch and support chains are documented in the reachability table below.

## File Reachability

| File | Role | Reached via |
|---|---|---|
| `ecom-load-context.md` | L1 loader | Loaded by each kept category dispatcher when MerchantContext is missing |
| `api-recommendation-tracking.md` | cross-domain support | loaded by any recipe that generates recommendations (currently: `recommend-ecommerce-strategy` and the kept pricing flows) |
| `ecom-pricing.md` | category-doc + dispatcher | WixREADME portal index |
| `pricing-promotions/ecom-pricing-create-coupon.md` | promotion | pricing dispatch `[intent:create-coupon]` |
| `pricing-promotions/ecom-pricing-create-discount-rule.md` | promotion | pricing dispatch `[intent:create-discount-rule / add-ribbon / schedule-sale]` |
| `pricing-promotions/ecom-pricing-troubleshoot-not-applying.md` | promotion | pricing dispatch `[intent:troubleshoot]` |
| `pricing-promotions/ecom-pricing-goal-*.md` (4 files) | support | loaded by the pricing orchestrator (carry-forward `recommend-ecommerce-strategy.md`) |
| `pricing-promotions/ecom-pricing-flow-*.md` (4 files) | support | loaded by the goal files via embedded routing chain |
| `ecom-shipping.md` | category-doc + dispatcher | WixREADME portal index; shipping setup and rate/coverage optimization |
| `shipping/ecom-shipping-setup-rates.md` | promotion | shipping dispatch `[intent:setup-rates]` |
| `shipping/ecom-shipping-setup-regions.md` | promotion | shipping dispatch `[intent:setup-regions]` |
| `shipping/ecom-shipping-setup-pickup.md` | promotion | shipping dispatch `[intent:setup-pickup]` |
| `shipping/ecom-shipping-free-shipping.md` | promotion | shipping dispatch `[intent:free-shipping]` |
| `shipping/ecom-shipping-optimize-rates.md` | promotion | shipping dispatch `[intent:optimize-rates / rate-incorrect]` |
| `shipping/ecom-shipping-fix-coverage.md` | promotion | shipping dispatch `[intent:fix-coverage]` |
| `shipping/ecom-shipping-api.md` | support | inline API reference for Shipping Options and Delivery Profiles |
| `ecom-checkout.md` | category-doc + dispatcher | WixREADME portal index; live checkout/cart troubleshooting |
| `checkout/ecom-checkout-troubleshoot-dropoff.md` | promotion | checkout dispatch `[intent:troubleshoot-checkout / reduce-abandonment]` |
| `recommend-ecommerce-strategy.md` | business-flow orchestrator (carry-forward) | pricing dispatch `[intent:run-a-sale / boost-business / seasonal-promo / clearance / increase-aov]`; also surfaces directly in WixREADME |

*Guardrails (discount conflicts, margin protection, shipping health, rate pricing sanity) and `recipe-apply-shipping-recommendations` are no longer standalone files — their checks and API mechanics are inlined into the leaf recipes that perform the protected writes (pricing flows, discount-rule creation, shipping rate/region/free-shipping setup). `goal-reduce-cart-abandonment` is removed; the orchestrator's classification space is now 4-way (SEASONAL / UPSELL_BOOST / STOCK_MOVER / BUNDLE_AND_SAVE). Cart-abandonment recovery automation activation is no longer recommended by this routing tree.*
