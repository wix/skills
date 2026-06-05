---
name: "eCommerce Skill Graph"
description: Mermaid diagram of the eCommerce routing tree — WixREADME → category-doc → default (dispatcher) → promotion → support. Tax and Pricing migrated; Shipping & checkout still legacy flat.
---

## Skill Graph Diagram

```mermaid
flowchart TB
    MR["Merchant Query"] --> README

    README["WixREADME<br/>(portal index — category-docs surface here)"]

    README --> TAXDOC["ecom-tax.md<br/>(category-doc)"]
    README --> PRICEDOC["ecom-pricing.md<br/>(category-doc)"]

    LOADER["ecom-load-context.md<br/>(L1 loader — general site data)"]

    %% ---------- Tax category ----------
    TAXDOC --> TAXDEF
    subgraph TAX["Tax — tax/"]
        TAXDEF["ecom-tax-default<br/>(dispatcher)"]
        TAXDEF --> tax-configure
        TAXDEF --> tax-avalara
        TAXDEF --> tax-eu-vat
        TAXDEF --> tax-switch-calculator
        TAXDEF --> tax-audit
        TAXDEF --> tax-troubleshoot-calc-wrong
    end

    %% ---------- Pricing category ----------
    PRICEDOC --> PRICEDEF
    subgraph PRICE["Pricing & promotions — pricing-promotions/"]
        PRICEDEF["ecom-pricing-default<br/>(dispatcher)"]
        PRICEDEF --> pricing-create-coupon
        PRICEDEF --> pricing-create-discount-rule
        PRICEDEF --> pricing-troubleshoot-not-applying
        PRICEDEF --> RUNSALE["ecom-pricing-run-a-sale<br/>(business-flow orchestrator)"]

        subgraph PGOALS["Support: goal-*"]
            goal-seasonal-revenue
            goal-clear-inventory
            goal-increase-aov
            goal-drive-cross-sells
        end
        subgraph PFLOWS["Support: flow-*"]
            flow-seasonal-promotion
            flow-upsell-boost
            flow-bundle-and-save
            flow-stock-mover
        end
        subgraph PGUARD["Support: guardrail-* + tracking"]
            guardrail-discount-conflicts
            guardrail-margin-protection
            tracking-api
        end

        RUNSALE --> goal-seasonal-revenue
        RUNSALE --> goal-increase-aov
        RUNSALE --> goal-clear-inventory
        RUNSALE --> goal-drive-cross-sells
        RUNSALE -.-> |"Steps 2+8: persist recommendations"| tracking-api

        goal-seasonal-revenue --> flow-seasonal-promotion
        goal-clear-inventory --> flow-stock-mover
        goal-increase-aov --> flow-upsell-boost
        goal-increase-aov --> flow-bundle-and-save
        goal-drive-cross-sells --> flow-bundle-and-save

        flow-seasonal-promotion --> guardrail-discount-conflicts
        flow-bundle-and-save --> guardrail-discount-conflicts
        flow-stock-mover --> guardrail-discount-conflicts
        flow-stock-mover --> guardrail-margin-protection
        flow-upsell-boost --> guardrail-discount-conflicts
        flow-upsell-boost --> guardrail-margin-protection
    end

    %% ---------- §7.5 API-doc dispatch (no skill) ----------
    PRICEDEF -.-> |"§7.5 — API doc, no skill"| APIDOCS["dev.wix.com API docs<br/>(query-coupons, query-discount-rules, get-coupon-usage, …)"]
    TAXDEF -.-> |"calls"| APIDOCS

    %% ---------- Dispatchers load L1 context before dispatch ----------
    TAXDEF -.-> |"load if not in context"| LOADER
    PRICEDEF -.-> |"load if not in context"| LOADER

    %% ---------- Legacy flat — pending migration ----------
    subgraph LEGACY["Legacy flat at ecommerce/ root — NOT yet migrated (→ Shipping & checkout categories)"]
        setup-shipping-rates
        setup-shipping-regions
        setup-store-pickup-location
        recipe-apply-shipping-recommendations
        flow-add-free-shipping
        flow-optimize-shipping-rates
        flow-fix-coverage-gaps
        guardrail-shipping-health
        guardrail-rate-pricing-sanity
        goal-reduce-cart-abandonment
        troubleshoot-checkout-delivery-dropoff
        api-shipping
    end

    classDef catdoc fill:#14b8a6,stroke:#0d9488,color:#fff
    classDef dispatcher fill:#f59e0b,stroke:#d97706,color:#fff
    classDef promotion fill:#3b82f6,stroke:#2563eb,color:#fff
    classDef orchestrator fill:#ec4899,stroke:#db2777,color:#fff
    classDef goal fill:#8b5cf6,stroke:#6d28d9,color:#fff
    classDef guardrail fill:#ef4444,stroke:#dc2626,color:#fff
    classDef loader fill:#10b981,stroke:#059669,color:#fff
    classDef legacy fill:#6b7280,stroke:#4b5563,color:#fff
    classDef apidoc fill:#e5e7eb,stroke:#9ca3af,color:#374151

    class TAXDOC,PRICEDOC catdoc
    class TAXDEF,PRICEDEF dispatcher
    class tax-configure,tax-avalara,tax-eu-vat,tax-switch-calculator,tax-audit,tax-troubleshoot-calc-wrong,pricing-create-coupon,pricing-create-discount-rule,pricing-troubleshoot-not-applying promotion
    class RUNSALE orchestrator
    class goal-seasonal-revenue,goal-clear-inventory,goal-increase-aov,goal-drive-cross-sells goal
    class flow-seasonal-promotion,flow-upsell-boost,flow-bundle-and-save,flow-stock-mover promotion
    class guardrail-discount-conflicts,guardrail-margin-protection guardrail
    class tracking-api promotion
    class LOADER loader
    class setup-shipping-rates,setup-shipping-regions,setup-store-pickup-location,recipe-apply-shipping-recommendations,flow-add-free-shipping,flow-optimize-shipping-rates,flow-fix-coverage-gaps,guardrail-shipping-health,guardrail-rate-pricing-sanity,goal-reduce-cart-abandonment,troubleshoot-checkout-delivery-dropoff,api-shipping legacy
    class APIDOCS apidoc
```

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
