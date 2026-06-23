---
name: "Fulfillment: Fulfill Orders & Tracking"
description: Mark an order fulfilled or add/update tracking. **Always load this recipe before answering** — the request/response shapes, duplicate-fulfillment guardrail, partial-fulfillment field mask, and the exact Order Fulfillments endpoints live in this file, not in this README line. Do NOT improvise from the description.
---

# Fulfill Orders & Tracking

Create and manage order fulfillments via the **Order Fulfillments API** (TPA-public / GA). A fulfillment records that some or all of an order's line items shipped, optionally with carrier and tracking.

## Required APIs

- Create: `POST https://www.wixapis.com/ecom/v1/fulfillments/orders/{orderId}/create-fulfillment`
- Update: `PATCH https://www.wixapis.com/ecom/v1/fulfillments/{fulfillmentId}/orders/{orderId}`
- List for an order: `GET https://www.wixapis.com/ecom/v1/fulfillments/orders/{orderId}`
- Search/get order first when the merchant provides an order number instead of an order ID.

For many orders at once, use [Bulk Fulfill Orders](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/skills/fulfillment-bulk-fulfill-orders).

## API constraints from public docs

- Fulfillments can only be created for orders in an approved state.
- Each order line item can be included in only one fulfillment.
- A single fulfillment can include up to 300 line items.
- Standard shipping providers can auto-generate tracking links from provider + tracking number.
- Custom shipping providers require a manually supplied tracking link.

## Mark an order fulfilled

First get/search the order and confirm it is approved and eligible for fulfillment. **If the order is not found** (lookup returns empty or 404), do not stop — explain the steps you would take, cite the exact API endpoints, and surface the guardrails below as if the order existed. The merchant needs to know the process even when the specific order ID is unavailable in the current context. Then call `create-fulfillment` with the order line items that shipped. To include tracking, add `trackingInfo`:

```json
{
  "fulfillment": {
    "lineItems": [
      {
        "id": "<orderLineItemId>",
        "quantity": 2
      }
    ],
    "trackingInfo": {
      "trackingNumber": "1Z999...",
      "shippingProvider": "ups",
      "trackingLink": "https://www.ups.com/track?tracknum=1Z999..."
    }
  }
}
```

The response returns the created `fulfillment.id`. The order's fulfillment status moves toward `FULFILLED`.

## Add or update tracking on an existing fulfillment

If the order is already fulfilled and the merchant only needs to add or correct tracking, update the existing fulfillment instead of creating another one.

1. Get the fulfillment ID:

```http
GET https://www.wixapis.com/ecom/v1/fulfillments/orders/{orderId}
```

2. Patch the fulfillment:

```http
PATCH https://www.wixapis.com/ecom/v1/fulfillments/{fulfillmentId}/orders/{orderId}
```

Example body:

```json
{
  "fulfillment": {
    "id": "<fulfillmentId>",
    "trackingInfo": {
      "trackingNumber": "1Z999...",
      "shippingProvider": "ups"
    }
  }
}
```

## Partial fulfillment

For "ship some items now", create a fulfillment with only the line items and quantities shipping now. The order becomes `PARTIALLY_FULFILLED`; create another fulfillment later for the remaining items.

Each shipment can carry its own tracking number.

## Response handling

Create Fulfillment returns the created `fulfillmentId` and `orderWithFulfillments`. Update/List return `orderWithFulfillments`. Use these response fields to verify:

- the target line items and quantities are included
- the tracking info is present
- the order moved to the expected fulfillment state

## Guardrails

- Only fulfill paid orders unless the merchant explicitly confirms fulfillment before payment.
- Only create fulfillment for an approved order.
- Do not re-fulfill already-fulfilled line items. Check existing fulfillments first.
- Match `quantity` to what actually shipped so partial states stay accurate.
- If the API returns `TRACKING_NUMBER_ALREADY_EXISTS`, reuse or update the existing fulfillment instead of creating a duplicate.
- Do not use fulfillment to cancel an order, process a refund, or buy/export a shipping label.

## Audit note

This file is not redundant with the Order Fulfillments API docs because it adds merchant-language routing, order-number lookup, paid/approved-order checks, duplicate-fulfillment prevention, partial quantity handling, tracking update branching, and post-write verification.
