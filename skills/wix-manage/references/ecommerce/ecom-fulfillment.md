---
name: "Fulfillment"
description: Post-purchase fulfillment operations for eCommerce orders - find unshipped or problematic orders, mark orders fulfilled, update tracking, handle partial and bulk fulfillment, route invoice/packing-slip requests, and direct shipping-label export to Dashboard.
---

# Fulfillment

Handle what happens after an order is placed: find orders that need shipping attention, create fulfillments, update tracking, handle partial or bulk fulfillment, and route shipping documents correctly.

**Fulfillment is NOT:**
- Shipping rates, delivery regions, pickup, or free-shipping setup -> see **Shipping**.
- Checkout drop-off before an order is placed -> see **Checkout & Cart**.
- Refunds and payments -> route to the existing Get Paid/payment docs or Dashboard-supported payment flows. Order cancellations belong to **Orders** when that category is available.

> **Before dispatching** - confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context). Skip if already loaded.
>
> **Promotion dispatch.** Score each entry below by the merchant's query -> `intent:*` tags. Load the highest-scoring entry. No match -> base recipe.

### Fulfillment actions

> - [Fulfill orders & tracking](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/fulfillment-fulfill-orders-tracking) - tags: `[intent:fulfill-order]`, `[intent:update-tracking]`, `[intent:partial-fulfillment]` - priority 0 - *Fulfillments API: create fulfillment, update tracking, partial fulfillment*
> - [Bulk fulfill orders](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/fulfillment-bulk-fulfill-orders) - tags: `[intent:bulk-fulfill]` - priority 0 - *batch fulfillment with partial-failure handling*

### Lookup and document routes

> - Find unshipped / problematic orders - tags: `[intent:find-unshipped]` - **API route, no dedicated skill** - use Orders search with fulfillment status filters such as `NOT_FULFILLED` or `PARTIALLY_FULFILLED`; then route to a fulfillment action if the merchant wants to mutate orders.
> - Orders needing shipping label - tags: `[intent:orders-needing-label]` - **main-file route** - find candidate paid, unfulfilled orders via Orders search; actual label export/printing is Dashboard.
> - Print packing slip / invoice - tags: `[intent:order-invoice]` - **API route, no dedicated skill** - eCommerce Orders Invoice API (`wix.ecom.orders.v1.invoice`) when available for the requested document.
> - Export shipping labels - tags: `[intent:shipping-labels]` - **Wix Dashboard** - no verified public API route in this repo.

## API and Dashboard status

| Capability | Route | Status |
|---|---|---|
| Create one fulfillment for one order | `POST /ecom/v1/fulfillments/orders/{orderId}/create-fulfillment` | TPA-public |
| Update tracking / fulfillment fields | `PATCH /ecom/v1/fulfillments/{fulfillmentId}/orders/{orderId}` | TPA-public |
| List fulfillments for one order | `GET /ecom/v1/fulfillments/orders/{orderId}` | TPA-public |
| Bulk create fulfillments | `POST /ecom/v1/fulfillments/orders/bulk/create-fulfillments` | TPA-public |
| Find orders needing fulfillment | `POST /ecom/v1/orders/search` with fulfillment/payment/status filters | TPA-public |
| Export / buy shipping labels | Wix Dashboard | Dashboard-managed in this repo |

## Tag matching examples

| Merchant query | Match |
|---|---|
| "I shipped order #1052" | `ecom-fulfillment-fulfill-orders` via `intent:fulfill-order` |
| "Add tracking number for order #1052" | `ecom-fulfillment-fulfill-orders` via `intent:update-tracking` |
| "I can only ship 2 of the 3 items now" | `ecom-fulfillment-fulfill-orders` via `intent:partial-fulfillment` |
| "Fulfill all orders from today" | `ecom-fulfillment-bulk-fulfill-orders` via `intent:bulk-fulfill` |
| "Which orders need shipping labels today?" | main-file route via `intent:orders-needing-label` |
| "Cancel order #1053" | Orders category, not Fulfillment |

## Base recipe

If nothing matches, ask **one** clarifying question:

> "Do you want to **find orders that need fulfillment**, **mark/update fulfillments**, **bulk fulfill orders**, or **print invoices/labels**?"

Route shipping setup questions back to **Shipping**.

## Audit note

This file is not redundant with Wix API docs because it owns the routing boundary between fulfillment, orders, payments/refunds, shipping setup, and Dashboard-only label work. The child fulfillment skills carry the mutation guardrails; this file keeps shallow lookup/document routes in the 80% main path.
