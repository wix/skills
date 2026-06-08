---
name: "Shipping: Fulfill Orders & Tracking"
description: Fulfill orders and manage tracking — mark an order fulfilled, add/update a tracking number, fulfill part of an order (partial fulfillment), and bulk-fulfill many orders at once. Uses the eCommerce Order Fulfillments API. Triggers on "mark order fulfilled", "I shipped order", "add tracking number", "fulfill all orders", "ship 2 of 3 items".
---

# Fulfill Orders & Tracking

Create and manage order fulfillments via the **Order Fulfillments API** (TPA-public / GA). A *fulfillment* records that some or all of an order's line items shipped, optionally with carrier + tracking.

## Required APIs

- Create: `POST https://www.wixapis.com/ecom/v1/fulfillments/orders/{orderId}/create-fulfillment`
- Bulk create: `POST https://www.wixapis.com/ecom/v1/fulfillments/orders/bulk/create-fulfillments`
- Update: `PATCH https://www.wixapis.com/ecom/v1/fulfillments/{fulfillmentId}/orders/{orderId}`
- List for an order: `GET https://www.wixapis.com/ecom/v1/fulfillments/orders/{orderId}`

## Mark an order fulfilled

`create-fulfillment` with **all** of the order's line items. To include tracking, add `trackingInfo`:

```json
{
  "fulfillment": {
    "lineItems": [ { "id": "<orderLineItemId>", "quantity": 2 } ],
    "trackingInfo": {
      "trackingNumber": "1Z999...",
      "shippingProvider": "ups",
      "trackingLink": "https://www.ups.com/track?tracknum=1Z999..."
    }
  }
}
```

Response returns the created `fulfillment.id`. The order's fulfillment status moves toward `FULFILLED`.

> **Gotcha:** `TRACKING_NUMBER_ALREADY_EXISTS` (409) — that tracking number is already on a fulfillment. Reuse/Update the existing fulfillment instead of creating a duplicate.

## Add or update tracking on an existing fulfillment

If the order is already fulfilled and you just need to set/correct tracking, **Update** rather than create a second fulfillment:

```
PATCH /ecom/v1/fulfillments/{fulfillmentId}/orders/{orderId}
{ "fulfillment": { "id": "<fulfillmentId>", "trackingInfo": { "trackingNumber": "...", "shippingProvider": "..." } } }
```

Get the `fulfillmentId` from `GET /ecom/v1/fulfillments/orders/{orderId}` first.

## Partial fulfillment (ship some items now)

Call `create-fulfillment` with **only the line items shipping now** (and their quantities). The order becomes `PARTIALLY_FULFILLED`; create another fulfillment for the rest later. Each shipment can carry its own tracking number.

## Bulk fulfill many orders

`bulk/create-fulfillments` takes `ordersWithFulfillments` — one entry per order, each with its line items (+ optional tracking). Use this for "fulfill all of today's orders":

1. Query the orders to fulfill (Orders query — e.g. `fulfillmentStatus = NOT_FULFILLED`, paid).
2. Build one `ordersWithFulfillments` entry per order with its line items.
3. POST in batches; inspect the per-order results array for partial failures and retry only the failures.

## Guardrails

- Only fulfill **paid** orders unless the merchant explicitly fulfills-before-payment.
- Don't re-fulfill already-fulfilled line items (check `GET …/fulfillments/orders/{orderId}` first) — it double-counts shipments and trips the tracking-duplicate error.
- Match `quantity` to what actually shipped so partial states stay accurate.
