---
name: "Checkout: Agentic Readiness"
description: Checks whether a store is ready for AI shopping agents to discover and buy — catalog data quality for AI discovery, a programmatic test-checkout that proves an agent can complete a purchase, and UCP/agentic-commerce enablement. Triggers on "can an AI agent buy from my store", "agentic readiness", "test agentic checkout", "UCP".
---

# Agentic Readiness

Assess whether AI shopping agents can (a) **discover** the store's products and (b) **complete a purchase** programmatically. There is **no public UCP / agentic-commerce REST API** to toggle — readiness is a function of catalog data quality + a checkout that a non-human buyer can complete. This skill audits both with public APIs and runs a real test-checkout.

> **UCP / agentic-commerce enablement itself is a platform + Dashboard feature** (no TPA-public API). After the checks below, point the merchant to the Wix Dashboard / agentic-commerce settings to opt in, if available for their site.

## Part 1 — Catalog data quality for AI discovery

Agents rank and select products from structured data. Query the catalog and flag products missing fields an agent needs:

- **Products:** `POST https://www.wixapis.com/stores/v3/products/query` (or v1 if the site is on Catalog V1 — detect first).
- For each product check: `name`, a non-empty `description`, at least one `image`, a `price`, `inStock`/inventory, and **identifiers** (GTIN/SKU/brand) used by shopping agents.

| Signal | Why agents need it | Flag when |
|---|---|---|
| Title + description | relevance matching | missing/empty |
| Image | result rendering | none |
| Price + currency | comparison/affordability | missing |
| In-stock | don't surface unbuyable items | tracked & 0 |
| GTIN / brand / SKU | disambiguation across catalogs | missing |

Report a **discovery-readiness score** = % of active products with all signals present.

## Part 2 — Test agentic checkout (prove an agent can buy)

Run the public eCommerce purchase flow end-to-end against a real in-stock product to confirm a programmatic buyer can complete it:

1. **Create a cart** — `POST https://www.wixapis.com/ecom/v1/carts` with one in-stock line item.
2. **Create a checkout** — `POST https://www.wixapis.com/ecom/v1/checkouts` (or create-checkout from the cart). Supply a test buyer email + shipping address.
3. **Verify it resolves** — the checkout returns shipping options, tax, and totals with no blocking error. A `MISSING_*` / `CHECKOUT_*` error here is exactly what blocks an agent.
4. Do **not** place a real order in production; stop at a resolvable checkout (or use a test/sandbox site to call `create-order`).

**Common blockers an agent hits** (each maps to a fix):
- Guest checkout disabled → agent has no account → **enable guest checkout** (Dashboard; see `ecom-checkout.md`).
- Required custom checkout fields → agent can't fill them → minimize required fields (Dashboard).
- No shipping option for the test address → **fix coverage** (see Shipping & fulfillment → `ecom-shipping-fix-coverage`).
- Minimum order amount above the test cart → note it.

## Part 3 — Report

Combine into a readiness verdict:
- **Discovery:** the data-quality score + the top missing-field offenders.
- **Checkout:** pass/fail of the test-checkout + the specific blocker if it failed.
- **Enablement:** direct the merchant to the Dashboard for UCP / agentic-commerce opt-in (no API).

Prioritize fixes by impact: a failing test-checkout (agents can't buy at all) outranks data-quality gaps (agents buy less).
