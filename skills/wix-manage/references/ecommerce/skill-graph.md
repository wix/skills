---
name: "eCommerce Skill Graph"
description: Mermaid diagram of the eCommerce routing tree — WixREADME → category entry (merged doc+dispatcher) → promotion → support. Tax, Pricing, and Shipping migrated; Checkout & cart still legacy flat.
---

## Skill Graph Diagram

```mermaid
flowchart TB
    MR["Merchant Query"] --> README["WixREADME<br/>(portal index — category-docs surface here)"]

    README --> TAX
    README --> PRICE
    README --> SHIP

    LOADER["ecom-load-context.md<br/>(L1 loader — general site data;<br/>loaded by each default before dispatch)"]
    TAX -.-> |load context| LOADER
    PRICE -.-> |load context| LOADER
    SHIP -.-> |load context| LOADER

    %% ---------- Tax L3 ----------
    subgraph TAX["Tax — tax/"]
        direction TB
        TAXDEF["ecom-tax · category-doc + dispatcher (merged)"]
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
        PRICEDEF["ecom-pricing · category-doc + dispatcher (merged)"]
        PC["ecom-pricing-create-coupon"]
        PD["ecom-pricing-create-discount-rule"]
        PR["ecom-pricing-run-a-sale · business-flow orchestrator"]
        PB["ecom-pricing-troubleshoot-not-applying"]
        PG["goal-seasonal-revenue · goal-increase-aov<br/>goal-clear-inventory · goal-drive-cross-sells"]
        PF["flow-seasonal-promotion · flow-upsell-boost<br/>flow-bundle-and-save · flow-stock-mover"]
        PV["guardrail-discount-conflicts · guardrail-margin-protection<br/>tracking-api"]
        PRICEDEF ~~~ PC ~~~ PD ~~~ PR ~~~ PB ~~~ PG ~~~ PF ~~~ PV
    end

    %% ---------- Shipping & fulfillment L3 (migrated) ----------
    subgraph SHIP["Shipping & fulfillment — shipping/"]
        direction TB
        SHIPDEF["ecom-shipping · category-doc + dispatcher (merged)"]
        SR["ecom-shipping-setup-rates"]
        SG["ecom-shipping-setup-regions"]
        SP["ecom-shipping-setup-pickup"]
        SF["ecom-shipping-free-shipping"]
        SO["ecom-shipping-optimize-rates"]
        SX["ecom-shipping-fix-coverage"]
        SS["ecom-shipping-api (inline ref, no public docs)"]
        SHIPDEF ~~~ SR ~~~ SG ~~~ SP ~~~ SF ~~~ SO ~~~ SX ~~~ SS
    end

    %% ---------- Checkout & cart — legacy flat (not migrated) ----------
    subgraph LEGACY["Checkout & cart — legacy flat at ecommerce/ root (NOT migrated)"]
        direction TB
        L10["goal-reduce-cart-abandonment"]
        L11["troubleshoot-checkout-delivery-dropoff"]
        L10 ~~~ L11
    end
    README -.-> |direct entries today| LEGACY

    classDef dispatcher fill:#f59e0b,stroke:#d97706,color:#fff
    classDef promotion fill:#3b82f6,stroke:#2563eb,color:#fff
    classDef orchestrator fill:#ec4899,stroke:#db2777,color:#fff
    classDef support fill:#8b5cf6,stroke:#6d28d9,color:#fff
    classDef loader fill:#10b981,stroke:#059669,color:#fff
    classDef legacy fill:#6b7280,stroke:#4b5563,color:#fff

    class TAXDEF,PRICEDEF,SHIPDEF dispatcher
    class TC,TA,TV,TS,TU,TT,PC,PD,PB,SR,SG,SP,SF,SO,SX promotion
    class PR orchestrator
    class PG,PF,PV,SS support
    class LOADER loader
    class L10,L11 legacy
```

The arrows land on each L3 **group**; inside a group, files stack vertically with the `default` dispatcher first. Internal dispatch (default → promotion) and support chains (run-a-sale → goal → flow → guardrail/tracking) are documented in the reachability table below rather than drawn as edges.

## File Reachability

| File | Role | Reached via |
|---|---|---|
| `ecom-load-context.md` | L1 loader | Loaded by each `*-default` dispatcher before dispatch (skipped if context already loaded) |
| `ecom-tax.md` | category-doc + dispatcher (merged — prototype) | WixREADME portal index; dispatches directly, no `-default` hop |
| `ecom-pricing.md` | category-doc + dispatcher (merged) | WixREADME portal index; dispatches directly, no `-default` hop |
| `tax/ecom-tax-configure.md` | promotion | tax dispatch `[intent:configure-tax]` |
| `tax/ecom-tax-avalara.md` | promotion | tax dispatch `[intent:avalara]` |
| `tax/ecom-tax-eu-vat.md` | promotion | tax dispatch `[intent:eu-vat]` |
| `tax/ecom-tax-switch-calculator.md` | promotion | tax dispatch `[intent:switch-calculator]` |
| `tax/ecom-tax-audit.md` | promotion | tax dispatch `[intent:audit-tax]` |
| `tax/ecom-tax-troubleshoot-calc-wrong.md` | promotion | tax dispatch `[intent:troubleshoot]` |
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
| `ecom-shipping.md` | category-doc + dispatcher (merged) | WixREADME portal index; dispatches directly |
| `shipping/ecom-shipping-setup-rates.md` | promotion | shipping dispatch `[intent:setup-rates]` |
| `shipping/ecom-shipping-setup-regions.md` | promotion | shipping dispatch `[intent:setup-regions]` |
| `shipping/ecom-shipping-setup-pickup.md` | promotion | shipping dispatch `[intent:setup-pickup]` |
| `shipping/ecom-shipping-free-shipping.md` | promotion | shipping dispatch `[intent:free-shipping]`; also loaded by run-a-sale → goal-increase-aov |
| `shipping/ecom-shipping-optimize-rates.md` | promotion | shipping dispatch `[intent:optimize-rates / rate-incorrect]`; also loaded by run-a-sale |
| `shipping/ecom-shipping-fix-coverage.md` | promotion | shipping dispatch `[intent:fix-coverage]` |
| `shipping/ecom-shipping-api.md` | support | inline API reference (no public docs page) — linked from every shipping recipe |
| (rate-pricing-sanity, shipping-health) | inlined | folded into free-shipping / optimize-rates and fix-coverage — no separate files |
| (apply-recommendations) | dissolved | redundant with the API Reference (query → create/update by rec action) — §7.5 |
| Checkout & cart legacy files | legacy flat | `goal-reduce-cart-abandonment`, `troubleshoot-checkout-delivery-dropoff` — pending Checkout & cart migration |
</content>
