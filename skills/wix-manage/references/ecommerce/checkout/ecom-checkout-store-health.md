---
name: "Checkout: Store Health Monitor"
description: Periodic technical health check of the checkout/cart path — test the checkout flow end-to-end, detect configuration drift, and surface checkout-blocking issues before they cost sales. Triggers on "store health", "is my checkout working", "periodic checkout check", "store health monitor".
---

# Store Health Monitor

A periodic, technical check of whether the store can actually take orders — distinct from the conversion-focused [Reduce Abandonment](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-reduce-abandonment) (why buyers leave) and [Troubleshoot Drop-off](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-troubleshoot-dropoff) (a reported problem). Run this proactively (e.g. as a scheduled digest) and report only what's broken or drifting.

## Check 1: Checkout flow works end-to-end

Reuse the test-checkout from [Agentic Readiness](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-checkout-agentic-readiness) → Part 2: create a cart with a real in-stock item, create a checkout, and confirm it resolves (shipping options + tax + totals, no blocking error). A failure here is **CRITICAL** — the store cannot take orders.

## Check 2: Configuration drift

Compare current config against a healthy baseline; flag changes that block or degrade checkout:
- **Payment provider connected** — no active provider → can't collect payment (CRITICAL).
- **Shipping coverage** — regions with zero shipping options (see `ecom-shipping-fix-coverage`) → buyers in those regions can't complete checkout.
- **Tax configured** — for sites that require it (see Tax category).
- **Guest checkout / required fields** — newly-added required custom fields can silently raise abandonment.

## Check 3: Order-flow anomalies (error signal)

Without an app-error API, infer trouble from order/checkout data:
- **Abandoned-checkout spike** — route recovery-performance analysis to [Abandoned Carts: Recovery Health](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/ecom-abandoned-carts-recovery-health). A sudden jump can still signal a checkout problem (payment failing, shipping gap, surprise cost).
- **Orders stalled** — recent orders stuck unpaid/unfulfilled (Orders query) relative to normal volume.

## Report

Severity-ranked digest:
- **CRITICAL** — test-checkout fails, no payment provider, or no shipping coverage. The store is losing every affected sale now.
- **WARNING** — abandonment spike, drifted config, tax gaps.
- **OK** — checkout resolves and config matches baseline; note the green state.

For each issue, link the fixing skill (shipping coverage, tax, checkout config) rather than re-explaining it.
