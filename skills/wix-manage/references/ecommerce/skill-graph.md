---
name: "eCommerce Skill Graph"
description: Mermaid diagram of the eCommerce routing tree - WixREADME to category entry, promotion, and support files. Tax, Pricing, Shipping, Checkout, Abandoned Carts, and Fulfillment are migrated.
---

## Skill Graph Diagram

```mermaid
flowchart TB
    MR["Merchant Query"] --> README["WixREADME<br/>(portal index - category-docs surface here)"]

    README --> TAX
    README --> PRICE
    README --> SHIP
    README --> CHECKOUT
    README --> ABANDONED
    README --> FULFILL

    LOADER["ecom-load-context.md<br/>(L1 loader - general site data;<br/>loaded by each category before dispatch)"]
    TAX -.-> |load context| LOADER
    PRICE -.-> |load context| LOADER
    SHIP -.-> |load context| LOADER
    CHECKOUT -.-> |load context| LOADER
    ABANDONED -.-> |load context| LOADER
    FULFILL -.-> |load context| LOADER

    subgraph TAX["Tax - tax/"]
        direction TB
        TAXDEF["ecom-tax - category-doc + dispatcher"]
        TC["ecom-tax-configure"]
        TA["ecom-tax-avalara"]
        TV["ecom-tax-eu-vat"]
        TS["ecom-tax-switch-calculator"]
        TU["ecom-tax-audit"]
        TT["ecom-tax-troubleshoot-calc-wrong"]
        TAXDEF ~~~ TC ~~~ TA ~~~ TV ~~~ TS ~~~ TU ~~~ TT
    end

    subgraph PRICE["Pricing & promotions - pricing-promotions/"]
        direction TB
        PRICEDEF["ecom-pricing - category-doc + dispatcher"]
        PC["ecom-pricing-create-coupon"]
        PD["ecom-pricing-create-discount-rule"]
        PR["ecom-pricing-run-a-sale - business-flow orchestrator"]
        PB["ecom-pricing-troubleshoot-not-applying"]
        PH["ecom-pricing-health"]
        PG["goal-* support files"]
        PF["flow-* support files"]
        PV["tracking-api"]
        PRICEDEF ~~~ PC ~~~ PD ~~~ PR ~~~ PB ~~~ PH ~~~ PG ~~~ PF ~~~ PV
    end

    subgraph SHIP["Shipping - shipping/"]
        direction TB
        SHIPDEF["ecom-shipping - category-doc + dispatcher"]
        SR["ecom-shipping-setup-rates"]
        SG["ecom-shipping-setup-regions"]
        SP["ecom-shipping-setup-pickup"]
        SF["ecom-shipping-free-shipping"]
        SO["ecom-shipping-optimize-rates"]
        SX["ecom-shipping-fix-coverage"]
        SS["ecom-shipping-api"]
        SHIPDEF ~~~ SR ~~~ SG ~~~ SP ~~~ SF ~~~ SO ~~~ SX ~~~ SS
    end

    subgraph CHECKOUT["Checkout & cart - checkout/"]
        direction TB
        CHKDEF["ecom-checkout - category-doc + dispatcher"]
        CR["ecom-checkout-reduce-abandonment"]
        CT["ecom-checkout-troubleshoot-dropoff"]
        CA["ecom-checkout-agentic-readiness"]
        CH["ecom-checkout-store-health"]
        CD["config intents -> Wix Dashboard"]
        CHKDEF ~~~ CR ~~~ CT ~~~ CA ~~~ CH ~~~ CD
    end

    subgraph ABANDONED["Abandoned carts - abandoned-carts/"]
        direction TB
        ACDEF["ecom-abandoned-carts - category-doc + dispatcher"]
        AR["ecom-abandoned-carts-recover-email"]
        AL["ecom-abandoned-carts-recovery-link"]
        AT["ecom-abandoned-carts-troubleshoot-recovery"]
        AH["ecom-abandoned-carts-recovery-health"]
        ACDEF ~~~ AR ~~~ AL ~~~ AT ~~~ AH
    end

    subgraph FULFILL["Fulfillment - fulfillment/"]
        direction TB
        FDEF["ecom-fulfillment - category-doc + dispatcher"]
        FO["ecom-fulfillment-fulfill-orders"]
        FB["ecom-fulfillment-bulk-fulfill-orders"]
        FL["labels -> Wix Dashboard"]
        FI["invoice / packing slip -> API route"]
        FDEF ~~~ FO ~~~ FB ~~~ FL ~~~ FI
    end

    classDef dispatcher fill:#f59e0b,stroke:#d97706,color:#fff
    classDef promotion fill:#3b82f6,stroke:#2563eb,color:#fff
    classDef orchestrator fill:#ec4899,stroke:#db2777,color:#fff
    classDef support fill:#8b5cf6,stroke:#6d28d9,color:#fff
    classDef loader fill:#10b981,stroke:#059669,color:#fff
    classDef legacy fill:#6b7280,stroke:#4b5563,color:#fff

    class TAXDEF,PRICEDEF,SHIPDEF,CHKDEF,ACDEF,FDEF dispatcher
    class TC,TA,TV,TS,TU,TT,PC,PD,PB,PH,SR,SG,SP,SF,SO,SX,CR,CT,CA,CH,AR,AL,AT,AH,FO,FB promotion
    class PR orchestrator
    class PG,PF,PV,SS,FI support
    class LOADER loader
    class CD,FL legacy
```

The arrows land on each L2 group. Internal dispatch and support chains are documented in the reachability table below.

## File Reachability

| File | Role | Reached via |
|---|---|---|
| `ecom-load-context.md` | L1 loader | Loaded by eCommerce category dispatchers when MerchantContext is missing |
| `ecom-tax.md` | category-doc + dispatcher | WixREADME portal index |
| `tax/ecom-tax-configure.md` | promotion | tax dispatch `[intent:configure-tax]` |
| `tax/ecom-tax-avalara.md` | promotion | tax dispatch `[intent:avalara]` |
| `tax/ecom-tax-eu-vat.md` | promotion | tax dispatch `[intent:eu-vat]` |
| `tax/ecom-tax-switch-calculator.md` | promotion | tax dispatch `[intent:switch-calculator]` |
| `tax/ecom-tax-audit.md` | promotion | tax dispatch `[intent:audit-tax]` |
| `tax/ecom-tax-troubleshoot-calc-wrong.md` | promotion | tax dispatch `[intent:troubleshoot]` |
| `ecom-pricing.md` | category-doc + dispatcher | WixREADME portal index |
| `pricing-promotions/ecom-pricing-create-coupon.md` | promotion | pricing dispatch `[intent:create-coupon]` |
| `pricing-promotions/ecom-pricing-create-discount-rule.md` | promotion | pricing dispatch `[intent:create-discount-rule / add-ribbon / schedule-sale]` |
| `pricing-promotions/ecom-pricing-run-a-sale.md` | business-flow | pricing dispatch `[intent:run-a-sale / boost-business / seasonal-promo / clearance / increase-aov]` |
| `pricing-promotions/ecom-pricing-troubleshoot-not-applying.md` | promotion | pricing dispatch `[intent:troubleshoot]` |
| `pricing-promotions/ecom-pricing-health.md` | promotion | pricing dispatch `[intent:pricing-health]` |
| `pricing-promotions/ecom-pricing-*.md` support files | support | loaded by the pricing orchestrator or linked recipes |
| `ecom-shipping.md` | category-doc + dispatcher | WixREADME portal index; shipping setup and rate/coverage optimization |
| `shipping/ecom-shipping-setup-rates.md` | promotion | shipping dispatch `[intent:setup-rates]` |
| `shipping/ecom-shipping-setup-regions.md` | promotion | shipping dispatch `[intent:setup-regions]` |
| `shipping/ecom-shipping-setup-pickup.md` | promotion | shipping dispatch `[intent:setup-pickup]` |
| `shipping/ecom-shipping-free-shipping.md` | promotion | shipping dispatch `[intent:free-shipping]`; also loaded by run-a-sale |
| `shipping/ecom-shipping-optimize-rates.md` | promotion | shipping dispatch `[intent:optimize-rates / rate-incorrect]` |
| `shipping/ecom-shipping-fix-coverage.md` | promotion | shipping dispatch `[intent:fix-coverage]` |
| `shipping/ecom-shipping-api.md` | support | inline API reference for Shipping Options and Delivery Profiles |
| `ecom-checkout.md` | category-doc + dispatcher | WixREADME portal index; live checkout/cart setup and troubleshooting |
| `checkout/ecom-checkout-reduce-abandonment.md` | promotion | checkout dispatch `[intent:reduce-abandonment]`; also loaded by run-a-sale ABANDONED_CART branch |
| `checkout/ecom-checkout-troubleshoot-dropoff.md` | promotion | checkout dispatch `[intent:troubleshoot-checkout]` |
| `checkout/ecom-checkout-agentic-readiness.md` | promotion | checkout dispatch `[intent:agentic]` |
| `checkout/ecom-checkout-store-health.md` | promotion | checkout dispatch `[intent:store-health]` |
| `ecom-abandoned-carts.md` | category-doc + dispatcher | WixREADME portal index; recovery/recapture after checkout abandonment |
| `abandoned-carts/ecom-abandoned-carts-recover-email.md` | promotion | abandoned-carts dispatch `[intent:recover-email]` |
| `abandoned-carts/ecom-abandoned-carts-recovery-link.md` | promotion | abandoned-carts dispatch `[intent:recovery-link]` |
| `abandoned-carts/ecom-abandoned-carts-troubleshoot-recovery.md` | promotion | abandoned-carts dispatch `[intent:troubleshoot-recovery]` |
| `abandoned-carts/ecom-abandoned-carts-recovery-health.md` | promotion | abandoned-carts dispatch `[intent:recovery-health]` |
| `ecom-fulfillment.md` | category-doc + dispatcher | WixREADME portal index; post-purchase fulfillment and shipping-document routing |
| `fulfillment/ecom-fulfillment-fulfill-orders.md` | promotion | fulfillment dispatch `[intent:fulfill-order / update-tracking / partial-fulfillment]` |
| `fulfillment/ecom-fulfillment-bulk-fulfill-orders.md` | promotion | fulfillment dispatch `[intent:bulk-fulfill]` |
| (shipping labels) | Dashboard | fulfillment dispatch `[intent:shipping-labels]`; no public API route in this repo |
| (invoice / packing slip) | API route | fulfillment dispatch `[intent:order-invoice]`; eCommerce Orders Invoice API |
