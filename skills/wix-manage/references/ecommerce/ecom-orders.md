---
name: "Orders"
description: eCommerce order lifecycle and lookup - search orders, view order details/counts, cancel orders, diagnose pending orders, and route fulfillment, refunds, payments, returns, and notifications to the right owner.
---

# Orders

Use this category for eCommerce order lookup and lifecycle routing: search orders, get order details, count recent orders, cancel orders, diagnose pending/stuck orders, and distinguish order lifecycle from fulfillment, payments, refunds, catalog, and inventory.

**Orders is NOT:**
- Fulfillment/shipping/tracking -> see [Fulfillment](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/fulfillment).
- Refund execution or payment reporting -> route to the existing Get Paid/payment docs or Dashboard-supported payment flows.
- Product catalog or inventory updates -> see Stores Catalog / Stores Inventory.

> **Before dispatching** - confirm MerchantContext is loaded. If `siteData.country` is not in your conversation context, load it via [Load Merchant Context](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/e-commerce-load-context). Skip if already loaded.
>
> **Promotion dispatch.** Score each entry below by the merchant's query -> `intent:*` tags. Load the highest-scoring entry. No match -> base recipe.

### Order lifecycle actions

> - [Cancel Order](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/orders-cancel-order) - tags: `[intent:cancel-order]` - priority 0 - *destructive order lifecycle mutation; confirm restock/email/payment implications before canceling*

### Main-file API routes

Use the main file, not a separate skill, for common read-only Orders intents:

| Intent | Merchant examples | API route |
|---|---|---|
| View recent orders / order counts | "Show me today's orders"; "How many orders came in this week?" | `POST /ecom/v1/orders/search` with date filters and paging |
| Get order details | "Show me order #1052" | search by number/display context, then `GET /ecom/v1/orders/{id}` |
| Search orders by customer/criteria | "Show me orders from California"; "Find orders for jane@example.com" | `POST /ecom/v1/orders/search` with supported filters |
| Diagnose pending/stuck order | "Order is stuck in pending" | Get/search order, inspect `status`, `paymentStatus`, `fulfillmentStatus`, and route to Payments/Fulfillment/Checkout as needed |

### Explicit handoffs and Dashboard routes

> - Approve an order - tags: `[intent:approve-order]` - **unverified API route**. Do not write an approve-order skill until the exact public method is verified. Diagnose status first; if approval depends on offline payment/manual approval, route to Dashboard or verified Orders/Payments docs.
> - Handle a return - tags: `[intent:return-order]` - **Dashboard / workflow route**. Do not treat "return" as an immediate refund. If the merchant asks to refund, route to verified Get Paid/payment docs or Dashboard guidance.
> - Create a manual order with a pay link - tags: `[intent:manual-order-pay-link]` - **Dashboard / partial route**. Payment links are covered by [Create Payment Links](https://dev.wix.com/docs/api-reference/business-management/get-paid/skills/create-payment-links), but manual order creation must be verified before an execution skill is created.
> - Contact customer about order - tags: `[intent:contact-customer]` - **Dashboard-only / unverified messaging route** unless the message is specifically a payment link send.
> - Configure new-order notifications - tags: `[intent:order-notifications]` - **Wix Dashboard**. No verified public API route in this repo.

## Required APIs

- [Search Orders](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/search-orders): `POST https://www.wixapis.com/ecom/v1/orders/search`
- [Get Order](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/get-order): `GET https://www.wixapis.com/ecom/v1/orders/{id}`
- [Cancel Order](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/cancel-order): `POST https://www.wixapis.com/ecom/v1/orders/{id}/cancel`

## Base recipe

1. Classify the request as lookup/search, cancel, pending diagnosis, return, payment/refund, fulfillment, or Dashboard-only setup.
2. For lookup/search, use Orders Search/Get and keep the flow read-only.
3. For cancel, load the dedicated cancel-order skill.
4. For "pending" or "stuck," inspect order `status`, `paymentStatus`, and `fulfillmentStatus`, then route:
   - payment issue -> Payments
   - fulfillment issue -> Fulfillment
   - checkout/order creation issue -> Checkout or Orders depending on evidence
5. For returns, payment refunds, or payment collection, do not mutate through Orders without the correct owner skill.

## Audit note

This file is not redundant with the Orders API docs because it establishes ownership and routing boundaries: generic order lookup belongs here, fulfillment actions belong to Fulfillment, money movement belongs to Get Paid, and Dashboard-only order operations must not be overclaimed as API-supported.
