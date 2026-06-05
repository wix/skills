---
name: "eCommerce Skill Graph"
description: Mermaid diagram of the eCommerce routing tree — WixREADME → category-doc → default (dispatcher) → promotion → support. Tax and Pricing migrated; Shipping & checkout still legacy flat.
---

## Skill Graph Diagram

```mermaid
flowchart TB
    MR["Merchant Query"] --> README["WixREADME<br/>(portal index — category-docs surface here)"]

    README --> TAX
    README --> PRICE

    LOADER["ecom-load-context.md<br/>(L1 loader — general site data;<br/>loaded by each default before dispatch)"]
    TAX -.-> |load context| LOADER
    PRICE -.-> |load context| LOADER

    %% ---------- Tax L3 ----------
    subgraph TAX["Tax — tax/"]
        direction TB
        TAXDEF["ecom-tax-default · dispatcher"]
        TC["ecom-tax-configure"]
        TA["ecom-tax-avalara"]
        TV["ecom-tax-eu-vat"]
        TS["ecom-tax-switch-calculator"]
        TU["ecom-tax-audit"]
        TT["ecom-tax-troubleshoot-calc-wrong"]
        TAXDEF ~~~ TC ~~~ TA ~~~ TV ~~~ TS ~~~ TU ~~~ TT
    end

    %% ---------- Pricing & promotions L3 ----------
    subgraph PRICE["Pricing & promotions — pricing-promotions/"]
        direction TB
        PRICEDEF["ecom-pricing-default · dispatcher"]
        PC["ecom-pricing-create-coupon"]
        PD["ecom-pricing-create-discount-rule"]
        PR["ecom-pricing-run-a-sale · business-flow orchestrator"]
        PB["ecom-pricing-troubleshoot-not-applying"]
        PG["goal-seasonal-revenue · goal-increase-aov<br/>goal-clear-inventory · goal-drive-cross-sells"]
        PF["flow-seasonal-promotion · flow-upsell-boost<br/>flow-bundle-and-save · flow-stock-mover"]
        PV["guardrail-discount-conflicts · guardrail-margin-protection<br/>tracking-api"]
        PRICEDEF ~~~ PC ~~~ PD ~~~ PR ~~~ PB ~~~ PG ~~~ PF ~~~ PV
    end

    %% ---------- Legacy flat (not yet an L3) ----------
    subgraph LEGACY["Legacy flat at ecommerce/ root — NOT migrated (→ Shipping & checkout)"]
        direction TB
        L1["setup-shipping-rates"]
        L2["setup-shipping-regions"]
        L3["setup-store-pickup-location"]
        L4["recipe-apply-shipping-recommendations"]
        L5["flow-add-free-shipping"]
        L6["flow-optimize-shipping-rates"]
        L7["flow-fix-coverage-gaps"]
        L8["guardrail-shipping-health"]
        L9["guardrail-rate-pricing-sanity"]
        L10["goal-reduce-cart-abandonment"]
        L11["troubleshoot-checkout-delivery-dropoff"]
        L12["api-shipping"]
        L1 ~~~ L2 ~~~ L3 ~~~ L4 ~~~ L5 ~~~ L6 ~~~ L7 ~~~ L8 ~~~ L9 ~~~ L10 ~~~ L11 ~~~ L12
    end
    README -.-> |direct entries today| LEGACY

    classDef dispatcher fill:#f59e0b,stroke:#d97706,color:#fff
    classDef promotion fill:#3b82f6,stroke:#2563eb,color:#fff
    classDef orchestrator fill:#ec4899,stroke:#db2777,color:#fff
    classDef support fill:#8b5cf6,stroke:#6d28d9,color:#fff
    classDef loader fill:#10b981,stroke:#059669,color:#fff
    classDef legacy fill:#6b7280,stroke:#4b5563,color:#fff

    class TAXDEF,PRICEDEF dispatcher
    class TC,TA,TV,TS,TU,TT,PC,PD,PB promotion
    class PR orchestrator
    class PG,PF,PV support
    class LOADER loader
    class L1,L2,L3,L4,L5,L6,L7,L8,L9,L10,L11,L12 legacy
```

The arrows land on each L3 **group**; inside a group, files stack vertically with the `default` dispatcher first. Internal dispatch (default → promotion) and support chains (run-a-sale → goal → flow → guardrail/tracking) are documented in the reachability table below rather than drawn as edges.

## File Reachability

| File | Role | Reached via |
|---|---|---|
| `ecom-load-context.md` | L1 loader | Loaded by each `*-default` dispatcher before dispatch (skipped if context already loaded) |
| `ecom-tax.md` | category-doc | WixREADME portal index |
| `ecom-pricing.md` | category-doc | WixREADME portal index |
| `tax/ecom-tax-default.md` | dispatcher | `ecom-tax.md` |
| `tax/ecom-tax-configure.md` | promotion | tax dispatch `[intent:configure-tax]` |
| `tax/ecom-tax-avalara.md` | promotion | tax dispatch `[intent:avalara]` |
| `tax/ecom-tax-eu-vat.md` | promotion | tax dispatch `[intent:eu-vat]` |
| `tax/ecom-tax-switch-calculator.md` | promotion | tax dispatch `[intent:switch-calculator]` |
| `tax/ecom-tax-audit.md` | promotion | tax dispatch `[intent:audit-tax]` |
| `tax/ecom-tax-troubleshoot-calc-wrong.md` | promotion | tax dispatch `[intent:troubleshoot]` |
| `pricing-promotions/ecom-pricing-default.md` | dispatcher | `ecom-pricing.md` |
| `pricing-promotions/ecom-pricing-create-coupon.md` | promotion | pricing dispatch `[intent:create-coupon]` |
| `pricing-promotions/ecom-pricing-create-discount-rule.md` | promotion | pricing dispatch `[intent:create-discount-rule / add-ribbon / schedule-sale]` |
| `pricing-promotions/ecom-pricing-run-a-sale.md` | business-flow | pricing dispatch `[intent:run-a-sale / boost-business / seasonal-promo / clearance / increase-aov]` |
| `pricing-promotions/ecom-pricing-troubleshoot-not-applying.md` | promotion | pricing dispatch `[intent:troubleshoot]` |
| `pricing-promotions/ecom-pricing-goal-seasonal-revenue.md` | support | run-a-sale → SEASONAL |
| `pricing-promotions/ecom-pricing-goal-increase-aov.md` | support | run-a-sale → UPSELL_BOOST / SHIPPING |
| `pricing-promotions/ecom-pricing-goal-clear-inventory.md` | support | run-a-sale → STOCK_MOVER |
| `pricing-promotions/ecom-pricing-goal-drive-cross-sells.md` | support | run-a-sale → BUNDLE_AND_SAVE |
| `pricing-promotions/ecom-pricing-flow-seasonal-promotion.md` | support | goal-seasonal-revenue |
| `pricing-promotions/ecom-pricing-flow-upsell-boost.md` | support | goal-increase-aov |
| `pricing-promotions/ecom-pricing-flow-bundle-and-save.md` | support | goal-increase-aov / goal-drive-cross-sells |
| `pricing-promotions/ecom-pricing-flow-stock-mover.md` | support | goal-clear-inventory |
| `pricing-promotions/ecom-pricing-guardrail-discount-conflicts.md` | support | all pricing flows |
| `pricing-promotions/ecom-pricing-guardrail-margin-protection.md` | support | flow-upsell-boost / flow-stock-mover |
| `pricing-promotions/ecom-pricing-tracking-api.md` | support | run-a-sale (Steps 2 + 8) |
| Shipping & checkout legacy files | legacy flat | README direct entries today — pending migration into Shipping & fulfillment / Checkout & cart categories |
</content>
