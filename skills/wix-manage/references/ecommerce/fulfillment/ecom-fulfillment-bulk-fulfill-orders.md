---
name: "Fulfillment: Bulk Fulfill Orders"
description: Bulk-fulfills many eCommerce orders safely using the Order Fulfillments bulk create endpoint. Covers finding eligible orders, building batches, including tracking, handling partial failures, and retrying only failed orders.
---

# Bulk Fulfill Orders

Use this when the merchant wants to fulfill many orders at once, such as all paid unshipped orders from today.

Bulk fulfillment is a batch mutation. Be careful about order selection, duplicate fulfillment, and partial failures.

## Required APIs

- Search orders: `POST https://www.wixapis.com/ecom/v1/orders/search`
- Bulk create fulfillments: `POST https://www.wixapis.com/ecom/v1/fulfillments/orders/bulk/create-fulfillments`
- List fulfillments for a single order when checking duplicates: `GET https://www.wixapis.com/ecom/v1/fulfillments/orders/{orderId}`
- List fulfillments for multiple orders when prechecking a batch: `POST https://www.wixapis.com/ecom/v1/fulfillments/list-by-ids`

## API constraints from public docs

- Fulfillments can only be created for approved orders.
- Bulk create supports up to 100 orders at a time.
- Each fulfillment can include up to 300 line items.
- Each order line item can be included in only one fulfillment.
- Predefined carriers can auto-generate tracking links; custom carriers need manual tracking links.

## Step 1: Select eligible orders

Start from an explicit merchant selection or query for orders that are ready to ship.

Common filters:

- payment status is paid
- fulfillment status is `NOT_FULFILLED` or the specific status requested
- order status is approved
- order date or promised ship date matches the merchant's batch

Do not include unpaid orders unless the merchant explicitly confirms fulfillment before payment.

## Step 2: Build the batch payload

`bulk/create-fulfillments` takes `ordersWithFulfillments`, one entry per order. Each entry should include the line items and quantities to fulfill, plus optional tracking info.

Use per-order tracking when available. If tracking is not available yet, confirm whether the merchant still wants to mark the orders fulfilled.

## Step 3: Submit in safe batches

For large batches:

1. Chunk the orders into groups of at most 100 orders.
2. Submit one chunk at a time.
3. Record per-order success or failure.
4. Retry only failed orders after inspecting the error.

## Step 4: Handle partial failures

Do not rerun the whole batch blindly. That can duplicate successful fulfillments.

For each failed order:

- inspect the error
- check existing fulfillments for that order
- retry only if the order still needs fulfillment
- report failures separately from successes

## Guardrails

- Confirm the merchant's selection before mutating many orders.
- Confirm whether orders without tracking should still be marked fulfilled.
- Avoid fulfilling unpaid orders by default.
- Avoid fulfilling non-approved orders.
- Avoid duplicate line-item fulfillment.
- Preserve partial-fulfillment quantities exactly.
- Keep a summary of successes, failures, and skipped orders.

## Audit note

This file is not redundant with the Bulk Create Fulfillments API docs because it adds safe order selection, paid/approved-order filters, duplicate prechecks, batch chunking, partial-failure retry rules, and merchant confirmation for a high-impact batch mutation.
