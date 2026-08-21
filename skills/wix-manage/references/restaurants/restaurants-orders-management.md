---
name: "Restaurants Orders Management"
description: "Finds, reads and reports on orders that customers have already placed at a restaurant. Restaurant online orders are eCommerce orders, so they are read and fulfilled through the eCommerce Orders API rather than any restaurants-specific endpoint — this recipe explains how to tell a restaurant order apart from other orders on the same site, what the restaurant-specific parts of a line item mean, and where the merchant sees and acts on orders. Use for 'where are my orders', 'did that order come through', 'how many orders yesterday', or refunds and order status questions. Not for configuring hours, pickup or delivery."
---

# Restaurants Orders Management

A restaurant's online orders are **eCommerce orders**. There is no separate restaurants order API, and looking for one is the usual dead end. This recipe is the bridge: how to find them, how to read the restaurant-specific parts, and where the merchant acts on them.

For configuring *whether and when* customers can order, see [Restaurants Orders Settings](restaurants-orders-settings.md).

## When to Use

- "Where are my orders?", "did that order come through?"
- Counting or summarising orders over a period
- Refunds, cancellations, order status questions
- Checking whether ordering actually produced a real order after setup

## Prerequisites

1. Wix Restaurants Orders installed, which also installs Wix eCommerce
2. API access with eCommerce orders permissions — restaurants permissions alone are not enough

## Telling a Restaurant Order Apart

On a site that also sells other things, restaurant orders are identified by the app that owns the line item's catalog:

```
lineItems[].catalogReference.appId == 9a5d83fd-8570-482e-81ab-cfa88942ee60
```

That is the Wix Restaurants Orders app ID. Filter on it rather than guessing from item names.

The restaurant-specific detail rides inside `catalogReference.options` on each line item:

- `operationId` — which ordering service the order came through
- `menuId` and `sectionId` — where the item sat on the menu
- `modifierGroups` — the choices the customer made, with their selected modifiers
- `priceVariant` — which size or variant was ordered

Read modifiers from there when a merchant asks what a customer actually ordered. The item name alone will not say "no pickles, extra cheese".

## Flow

1. **Search or read the orders** through the eCommerce Orders API, filtering to the restaurants app ID above:

```json
{
  "search": {
    "filter": { "lineItems.catalogReference.appId": "9a5d83fd-8570-482e-81ab-cfa88942ee60" },
    "cursorPaging": { "limit": 50 }
  }
}
```

The filter reaches into line items by dotted path, and `metadata.total` gives the count without paging through every order — answer "how many" from that, not from the length of one page.
2. **Read fulfillment from the order's fulfillment status**, not from a restaurants field. Whether it is pickup or delivery, and the requested time, come from the order's shipping/fulfillment info.
3. **Answer in the merchant's terms** — "three pickup orders since 6pm, the most recent at 19:42" beats an order-ID dump.
4. **For anything that changes an order** — refunds, cancellations, marking fulfilled — use the eCommerce Orders API, and confirm with the merchant before acting. These are customer-visible and often irreversible.

## Endpoints

Under `https://www.wixapis.com` with an `Authorization` header:

| Purpose | Call |
|---|---|
| Search orders | `POST /ecom/v1/orders/search` |
| Read one order | `GET /ecom/v1/orders/{orderId}` |

Field shapes, fulfillment and refund methods are in the [eCommerce Orders API docs](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/introduction). Read them there rather than from this table.

## Where the Merchant Acts

Day-to-day order handling happens on the **orders board**, not through the API — accepting, marking ready, printing. Send merchants there rather than narrating order states at them:

`wix-restaurants-orders-new` for the board, `ecom-platform/order-details/{orderId}` for one order. See [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md) for building the full URL.

## Error Handling

| Symptom | Cause | Action |
|---|---|---|
| No orders found on a site that has them | Filtering by a restaurants endpoint or by item name instead of the catalog `appId` | Filter on `catalogReference.appId` |
| 403 reading orders | Restaurants permissions do not cover eCommerce orders | Request eCommerce orders access |
| Merchant says an order never arrived | Often the order was never placed — checkout could not complete | Confirm a payment method is connected; see [Restaurants Orders Setup](restaurants-orders-setup.md) |
| Order exists but shows the wrong menu or operation | The line item's `operationId` points at a different ordering service | Read `catalogReference.options` to see which one |

## What This Skill Does NOT Cover

- **Ordering hours, cutoff, fulfillment methods** — see [Restaurants Orders Settings](restaurants-orders-settings.md)
- **What is on the menu** — see [Restaurants Menus Setup](restaurants-menus-setup.md)
- **Getting ordering live in the first place** — see [Restaurants Orders Setup](restaurants-orders-setup.md)
- **Table reservations** — a different app; see [Restaurants Reservations Setup](restaurants-reservations-setup.md)
- **The prep board, printing, and order acceptance flow** — dashboard only, see [Restaurants Dashboard Navigation](restaurants-dashboard-navigation.md)
- **Order notifications** — configured outside these APIs

Never state that an order was refunded, cancelled or fulfilled without a successful call behind it.
