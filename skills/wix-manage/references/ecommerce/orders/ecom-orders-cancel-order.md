---
name: "Orders: Cancel Order"
description: Cancels an eCommerce order safely using the Orders Cancel API. Covers order lookup, cancellation eligibility, restock/email options, confirmation, and post-cancel verification.
---

# Cancel Order

Use this when the merchant explicitly wants to cancel an eCommerce order.

Canceling is final for the order lifecycle. Do not call the cancel endpoint before confirming the exact order and side effects.

## Required API

- [Cancel Order](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/cancel-order): `POST https://www.wixapis.com/ecom/v1/orders/{id}/cancel`
- Permission: `Manage Orders`
- Optional body fields include `restockAllItems`, `sendOrderCanceledEmail`, and `customMessage`.

## Step 1: Resolve and inspect the order

If the merchant gives an order number such as `#1053`, search orders first to resolve the canonical order ID. Then get the order and inspect:

- order ID and number
- customer/buyer
- current order `status`
- `paymentStatus`
- `fulfillmentStatus`
- line items and Wix Stores inventory relevance

**If the order number returns zero matches**, do NOT stop at "which order?". Instead:
1. List up to 5 candidate recent orders (number, status, paymentStatus, total) so the merchant can correct the number.
2. Walk through Steps 2–5 below in narrative form — what the side-effect confirmation, the cancel API call, and the post-cancel verification WOULD look like for the order once identified. Make clear no API call has been made yet.
3. End with a single confirmation question that includes the placeholder `{orderNumber/orderId}` slots from Step 3.

Do not cancel if multiple orders match. Ask one clarifying question.

## Step 2: Clarify side effects

Before cancellation, confirm:

- whether to restock all Wix Stores items
- whether to send the buyer an order-canceled email
- custom message, if any
- whether a refund is also needed

Cancellation is not the same as refunding. If the merchant also wants money returned, route the refund portion to verified Get Paid/payment docs or Dashboard guidance.

## Step 3: Confirm before mutation

Ask for explicit confirmation:

> "Confirm canceling order {orderNumber}/{orderId}, restockAllItems={true/false}, sendOrderCanceledEmail={true/false}?"

Do not proceed on vague confirmation if the order or side effects are ambiguous.

## Step 4: Cancel

```http
POST https://www.wixapis.com/ecom/v1/orders/{id}/cancel
```

Example body:

```json
{
  "restockAllItems": true,
  "sendOrderCanceledEmail": true,
  "customMessage": "Your order was canceled per your request."
}
```

## Step 5: Verify

After cancellation, get the order again or inspect the response order and report:

- status is `CANCELED`
- whether restock/email were requested
- whether refund/payment action is still needed
- any failure/error message if cancellation did not complete

## Guardrails

- Do not cancel orders that are already canceled/rejected without reporting current state.
- Do not treat cancellation as refund.
- Do not route cancel-order to Fulfillment; fulfillment cancellation and order cancellation are different operations.
- If the order is fulfilled or partially fulfilled, call out the shipping/return implications before canceling.

## Audit note

This file is not redundant with the API docs because it adds order-number resolution, side-effect confirmation, cancellation-vs-refund separation, and post-cancel verification.
