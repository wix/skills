---
name: wix-headless-stores
description: "Inner skill — invoked by wix-headless-features-orchestrator. Implements product catalog, cart, checkout, and e-commerce flows using @wix/stores, @wix/ecom, and @wix/redirects."
---

# Wix Headless Stores — E-Commerce Implementation

Wires designed product and cart components to live data via `@wix/stores`, `@wix/ecom`, and `@wix/redirects`. Implements the full e-commerce flow: product listing, product detail, cart, checkout redirect, and thank-you page.

## Anti-Patterns

| WRONG | CORRECT |
|-------|---------|
| `import { products } from "@wix/stores"` | `import { productsV3 } from "@wix/stores"` — V1 `products` silently returns 0 results on V3 catalogs |
| Skip `variantId` when adding to cart | Always include `variantId` — even single-variant products have one |
| Preview before full e-commerce flow is complete | Wire all e-commerce pages (products, detail, cart, checkout, thank-you) before first preview |
| Build product listing without cart support | Implement the complete flow — partial e-commerce shows a broken site |
| Hardcode product data | Use SDK queries with `productsV3` for real product data |

> **Visual boundary:** This skill handles SDK integration only. All styling is owned by the design skill. React islands must use the class names from the designed component's styling contract (`COMPONENT_PATTERNS.md`). Do not add Tailwind classes, inline styles, or `<style>` blocks.

## Required Dependencies

```
@wix/stores @wix/ecom @wix/redirects
```

> Features collects these for a single batch install — do NOT install independently.

## Implementation

Follow the reference files in order:

| Reference | What It Covers |
|-----------|---------------|
| `references/PRODUCT_CATALOG.md` | Product queries (V3 catalog), product listing, product detail, MCP product replacement, cart operations, checkout redirect, thank-you page |
| `references/CART_STATE.md` | Cart badge (live item count), unavailable item warnings, cross-island communication pattern |
| `../shared/IMAGE_GENERATION.md` | AI image generation, Wix Media import, product image attachment |

Build `PRODUCT_CATALOG.md` first (complete e-commerce flow), then layer `CART_STATE.md` enhancements on top.

After completing the e-commerce flow, **log results** to `.wix/features.log.md` per `../shared/FEATURES_LOG.md`, and **append a lifecycle entry** (`####` sub-phase) to `.wix/lifecycle.log.md` per `../shared/LIFECYCLE_LOG.md`.

After completing the e-commerce flow, tell the user:
> Checkout is hosted by Wix and will show "we aren't accepting payments" until two things are configured in the Wix dashboard: (1) upgrade to a premium plan with eCommerce, and (2) connect at least one payment provider (Stripe, PayPal, etc.) under Settings > Accept Payments.
