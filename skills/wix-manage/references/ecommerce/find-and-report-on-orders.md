---
name: "Find and Report on Orders"
description: "Finds a Wix site's eCommerce orders and turns them into answers and reports: one order by its number, orders in a date range, the orders of one buyer, orders that contain a product, unpaid or unfulfilled orders, and sales totals such as units sold per product or revenue for a period. Covers which order fields can be filtered, paging through every result, and which fields a report reads. Use when the user asks about a specific order, their order history or what customers bought, or wants a sales report or an export built from their store's orders."
---

# Find and Report on Orders

Reads orders with [Search Orders](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/search-orders). Every call here is read-only. Orders from Wix Stores, Bookings, Events and other Wix apps that sell through eCommerce all come back from the same endpoint.

To change an order after finding it (fulfil, refund, cancel, edit), use the method for that action in the [Orders API](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/introduction), and confirm the change with the user first.

## Step 1: Pick the filter

Search Orders accepts filters on a closed list of fields. Use these:

| The user gives | Filter |
|---|---|
| An order number ("order #10003") | `"number": 10003` |
| A period ("last month", "since 1 October") | `purchasedDate` with `$gte` and `$lt`, each in its own condition under `$and`; one object holding both operators is rejected with `400` |
| A buyer's email | `"buyerInfo.email": "jane@example.com"` (case-insensitive; `$startsWith` also works) |
| A buyer's contact ID | `"buyerInfo.contactId": "<contact id>"` |
| A product's exact name | `"lineItems.productName.original": { "$hasSome": ["Baseball Cap"] }` (case-insensitive, whole name only) |
| A product's ID | `"lineItems.catalogReference.catalogItemId": { "$hasSome": ["<product id>"] }` |
| Unpaid orders | `"paymentStatus": "NOT_PAID"` and `"status": { "$in": ["APPROVED", "PENDING"] }`, so orders still waiting for payment are included |
| Paid orders | `"paymentStatus": "PAID"` |
| Orders not shipped yet | `"fulfillmentStatus": "NOT_FULFILLED"` |
| Cancelled orders | `"status": "CANCELED"` |

These filters are rejected with `400 Unknown token`, although the method schema lists them: `billingInfo.contactDetails.firstName`, `billingInfo.contactDetails.lastName` and `priceSummary.total.amount`. To find orders by the buyer's name, find the contact first and filter on its ID (below). To find orders by their total, read the orders and filter them in code. For a partial product name ("the cap"), find the product first with [Find Products](../stores/find-products-query-and-search-catalog-v3.md) and filter by its ID.

**Buyer by name.** Find the contact with [Query Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/query-contacts), then filter orders on `buyerInfo.contactId`:

```bash
curl -X POST 'https://www.wixapis.com/contacts/v4/contacts/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{ "query": { "filter": { "info.name.last": "Chen" } } }'
```

The contacts are in `contacts[]`, each with `id`, `info.name.first`, `info.name.last` and `primaryInfo.email`. Several contacts match: ask the user which one. None matches: read the orders and match `billingInfo.contactDetails.firstName` and `lastName` in code.

Use `purchasedDate` for periods, not `createdDate`. They are the same for checkout orders, but `createdDate` is when the order record was created, so it is wrong for orders added later with a past purchase date.

## Step 2: Search

`POST https://www.wixapis.com/ecom/v1/orders/search`

**One order by its number:**

```bash
curl -X POST 'https://www.wixapis.com/ecom/v1/orders/search' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "search": {
    "filter": { "number": 10003 }
  }
}'
```

**Orders purchased in October 2026, oldest first.** Set the bounds at midnight in the site's time zone, converted to UTC; the time zone is `properties.timeZone` (for example `America/New_York`) from `GET https://www.wixapis.com/site-properties/v4/properties`. The example uses UTC midnight:

```bash
curl -X POST 'https://www.wixapis.com/ecom/v1/orders/search' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "search": {
    "filter": {
      "$and": [
        { "purchasedDate": { "$gte": "2026-10-01T00:00:00.000Z" } },
        { "purchasedDate": { "$lt": "2026-11-01T00:00:00.000Z" } }
      ]
    },
    "sort": [{ "fieldName": "purchasedDate", "order": "ASC" }],
    "cursorPaging": { "limit": 100 }
  }
}'
```

**Unpaid orders of one buyer that contain a product:**

```bash
curl -X POST 'https://www.wixapis.com/ecom/v1/orders/search' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{
  "search": {
    "filter": {
      "buyerInfo.email": "jane@example.com",
      "paymentStatus": "NOT_PAID",
      "status": { "$in": ["APPROVED", "PENDING"] },
      "lineItems.productName.original": { "$hasSome": ["Baseball Cap"] }
    }
  }
}'
```

The response holds `orders` and `metadata`. Without a sort, the newest `createdDate` comes first.

**Paging.** `cursorPaging.limit` is at most 100. While `metadata.hasNext` is `true`, send the next request with only `cursorPaging`, holding the same `limit` and `metadata.cursors.next`. The cursor carries the filter and the sort of the first request; a filter sent with a cursor is ignored.

```json
{ "search": { "cursorPaging": { "limit": 100, "cursor": "<metadata.cursors.next>" } } }
```

A report needs every page. Stop only when `hasNext` is `false`.

**What is left out.** Without a `status` filter, orders with `status` `PENDING` or `REJECTED` are not returned. Orders with `status` `INITIALIZED` are never returned; read one with [Get Order](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/orders/get-order) (`GET https://www.wixapis.com/ecom/v1/orders/<orderId>`). Cancelled orders are returned, so exclude `"status": "CANCELED"` from sales totals unless the user asks for them. An order placed a few seconds ago can be missing from the results until the search index catches up; when you hold its ID, read it with Get Order.

## Step 3: Read the fields

| Field | What it holds |
|---|---|
| `id` | Order ID, for Get Order and for dashboard links |
| `number` | The order number the owner sees |
| `purchasedDate` | When the order was placed |
| `status` | `APPROVED`, `CANCELED`, `PENDING`, `REJECTED`, or `INITIALIZED` (only from Get Order) |
| `paymentStatus` | `PAID`, `NOT_PAID`, `PARTIALLY_PAID`, `PENDING`, `PARTIALLY_REFUNDED`, `FULLY_REFUNDED`, and others |
| `fulfillmentStatus` | `NOT_FULFILLED`, `PARTIALLY_FULFILLED`, `FULFILLED` |
| `currency` | Currency of every amount in the order |
| `priceSummary.total.amount` | Order total, as a decimal string (`"414.00"`); also `subtotal`, `shipping`, `tax`, `discount` |
| `lineItems[].productName.original` | Item name |
| `lineItems[].quantity` | Units of the item |
| `lineItems[].totalPriceAfterTax.amount` | What the buyer paid for that line |
| `lineItems[].catalogReference.catalogItemId` | Product ID of the item |
| `buyerInfo.email`, `buyerInfo.contactId` | The buyer |
| `billingInfo.contactDetails` | `firstName`, `lastName`, `phone`, `company` |
| `billingInfo.address` | `city`, `country`, `postalCode`, `addressLine` |
| `recipientInfo` | Who receives the order; `shippingInfo.logistics.shippingDestination` holds the shipping address, or the pickup address for pickup orders |

Amounts in `priceSummary.total` include shipping and tax; `priceSummary.subtotal` is the items only.

The order does not hold payment methods. For those, send the order IDs to [List Transactions For Multiple Orders](https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/order-transactions/list-transactions-for-multiple-orders):

```bash
curl -X POST 'https://www.wixapis.com/ecom/v1/payments/list-by-ids' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{ "orderIds": ["<order id>", "<order id>"] }'
```

The response has one entry per order in `orderTransactions[]`, with `orderId` and `payments[]`. The method of a payment is `payments[].regularPaymentDetails.paymentMethodName.siteLanguageName` (for example `"Credit/Debit Cards"`); a gift card payment has `giftcardPaymentDetails` instead. An order with no recorded payment has an empty `payments` list.

## Step 4: Build the answer

- **One order:** give its number, date, status, payment and fulfillment status, items with quantities, and total with currency. Add the dashboard link from [Stores Dashboard Navigation](../stores/stores-dashboard-navigation.md) when the user needs to act on it.
- **Units sold per product:** read every page for the period, skip orders with `status` `CANCELED`, and add up `lineItems[].quantity` per `productName.original` (or per `catalogItemId` when names can repeat).
- **Revenue for a period:** add up `priceSummary.total.amount` of the orders with `paymentStatus` `PAID` whose `status` is not `CANCELED`. List the orders with any other `paymentStatus` (such as `NOT_PAID`, `PENDING`, `PARTIALLY_PAID`, `PARTIALLY_REFUNDED`, `FULLY_REFUNDED`) on one line per status, with their count and total, and leave them out of the revenue figure. Say that the figure includes shipping and tax, and give the `subtotal` sum too when the user asks for sales before shipping and tax. Amounts are strings: convert them to numbers before adding, and do not add amounts in different `currency` values.
- **Per customer:** group by `buyerInfo.email`, and take the name from `billingInfo.contactDetails`.
- **Exports:** return the rows with the columns the user asked for. A list longer than a few dozen rows goes in a file or a table, not in a chat message.

No orders found: say so with the filter you used (number, period or buyer), and offer the most recent orders instead.
