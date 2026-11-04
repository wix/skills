---
name: "Find and Manage Pricing Plan Orders"
description: "Finds and manages the orders of a site's Wix Pricing Plans: the purchases and subscriptions that buyers hold. Covers who bought a plan and when, new purchases in a period, how many active subscribers a plan has, memberships that end or renew soon, the names and emails of current and former buyers, and changes to an order: pausing, resuming, cancelling, extending it, marking an offline order as paid, and recording a manual (offline) order for a member. Use when the user asks about their plan subscribers or members' subscriptions, wants a report or an export of plan purchases, or wants to change or add a plan order."
---

# Find and Manage Pricing Plan Orders

A plan order is one purchase of a pricing plan by one buyer: the subscription or membership itself. Read and change them with the [Orders API](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/introduction). The buyer of every order is a site member.

Every call below is complete and was run as written: send it without looking up its schema first. A schema lookup by the docs URL of List Orders or Get Order fails with "No API resource matches docsUrl", because the spec index has no entry for those two pages. When a task needs a field this recipe does not show, look up the Orders resource by the [Cancel Order](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/cancel-order) URL instead; it returns every Orders method, List Orders included.

The calls need the Wix Pricing Plans app on the site (`appDefId` `1522827f-c56c-a5c9-2ac9-00f9e6ae12d3`). To create, rename or reprice the plans themselves, use [Create and Update Pricing Plans](create-and-update-pricing-plans.md).

## Step 1: List the orders

[List Orders](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/order-management-service-list-orders): `GET https://www.wixapis.com/pricing-plans/v2/orders`. Use this method, not the member-facing List Orders (`/pricing-plans/v2/member/orders`), which returns `403` for the site owner.

All filters are query parameters:

| Parameter | Values |
|---|---|
| `orderStatuses` | `DRAFT`, `PENDING`, `ACTIVE`, `PAUSED`, `ENDED`, `CANCELED` |
| `paymentStatuses` | `PAID`, `UNPAID`, `PENDING`, `FAILED`, `REFUNDED`, `NOT_APPLICABLE` |
| `planIds` | Plan IDs, from Query Plans (below) |
| `buyerIds` | The buyers' member IDs |
| `autoRenewCanceled` | `true` or `false` |
| `sorting.fieldName` | `createdDate` or `endDate` only; `startDate` returns `400` |
| `sorting.order` | `ASC` (the default) or `DESC` |
| `limit`, `offset` | `limit` is at most 50; `51` returns `400` |

Write enum values in upper case, and repeat a parameter once per value: `orderStatuses=ACTIVE&orderStatuses=PAUSED`. A comma-joined list (`orderStatuses=ACTIVE,PAUSED`) or a lower-case value returns `400 Failed to parse JSON`. Different parameters combine with AND.

There is no date filter. For purchases in a period, sort on `createdDate` `DESC` and stop at the start of the period; for end dates, read every page and compare `endDate` in code (Step 3). Without `sorting`, the orders do not come back in date order.

**Active orders of one plan, newest first:**

```bash
curl -G 'https://www.wixapis.com/pricing-plans/v2/orders' \
-H 'Authorization: <AUTH>' \
--data-urlencode 'planIds=<plan id>' \
--data-urlencode 'orderStatuses=ACTIVE' \
--data-urlencode 'sorting.fieldName=createdDate' \
--data-urlencode 'sorting.order=DESC' \
--data-urlencode 'limit=50'
```

The response holds `orders[]` and `pagingMetadata` (`count`, `offset`, `hasNext`; no `total`). While `hasNext` is `true`, send the same request with `offset` raised by 50. A count or a report needs every page.

**The plan ID from its name.** List the plans with [Query Plans](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/plans-v3/query-plans) and match `name` in code, ignoring case (the API matches names case-sensitively). Archived plans are returned too and still have orders:

```bash
curl -X POST 'https://www.wixapis.com/pricing-plans/v3/plans/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{ "query": { "cursorPaging": { "limit": 100 } } }'
```

The plans are in `plans[]`, each with `id`, `name` and `archived`. Several plans fit the user's words: ask which one. Every order also holds `planName`, the plan's name at the time of purchase.

**One order:** `GET https://www.wixapis.com/pricing-plans/v2/orders/<order id>` returns `order`.

### The fields of an order

| Field | What it holds |
|---|---|
| `id` | Order ID, for every change in Step 4 |
| `planId`, `planName` | The plan bought |
| `buyer.memberId`, `buyer.contactId` | The buyer. Names and emails come from Contacts (Step 2) |
| `status` | `ACTIVE` (in use), `PENDING` (starts in the future), `PAUSED`, `ENDED`, `CANCELED`, or `DRAFT` (checkout started, not paid; not a purchase) |
| `lastPaymentStatus` | `PAID`, `UNPAID`, `PENDING`, `FAILED`, `REFUNDED`, `NOT_APPLICABLE` (free) |
| `type` | `ONLINE` (bought on the site), `OFFLINE` (recorded by the owner), `EXTERNAL` |
| `createdDate` | When the order was placed: use it as the purchase date |
| `startDate` | When the plan starts for the buyer |
| `endDate` | When the plan ends. Omitted for a subscription that renews until cancelled |
| `currentCycle.endedDate` | End of the current billing cycle: the next payment date of a renewing subscription. Omitted for `ENDED`, `CANCELED` and not yet started orders |
| `autoRenewCanceled` | `true` when a subscription will not renew. Omitted for one-time plans, which the `autoRenewCanceled=true` filter still returns |
| `cancellation` | `effectiveAt` (`IMMEDIATELY` or `NEXT_PAYMENT_DATE`) and `cause` (`OWNER_ACTION`, `MEMBER_ACTION`, `PAYMENT_FAILURE`, ...). Present from the moment a cancellation is requested |
| `pricing` | `subscription` for a recurring plan; `singlePaymentForDuration` or `singlePaymentUnlimited` for a one-time plan |
| `pricing.prices[0].price` | `total` (decimal string) and `currency` |
| `pausePeriods[]` | `pauseDate`, `resumeDate`, `status` |

## Step 2: Get the buyers' names and emails

Send the buyers' `buyer.contactId` values to [Query Contacts](https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts/contact-v4/query-contacts), up to 100 per request:

```bash
curl -X POST 'https://www.wixapis.com/contacts/v4/contacts/query' \
-H 'Content-Type: application/json' \
-H 'Authorization: <AUTH>' \
-d '{ "query": { "filter": { "id": { "$in": ["<contact id>", "<contact id>"] } }, "paging": { "limit": 100 } } }'
```

Each contact in `contacts[]` has `id`, `info.name.first`, `info.name.last` and `primaryInfo.email`. Match them to the orders on `id` = `buyer.contactId`.

**The orders of one buyer.** `buyerIds` takes member IDs.

- The user gives an email: find the member with Query Members (Step 5) and send its `id` as `buyerIds`.
- The user gives a name: find the contact with Query Contacts and `{ "filter": { "info.name.first": "Sam", "info.name.last": "Chen" } }` (case-insensitive). Then list the orders, of the plan when the user names one, and keep those whose `buyer.contactId` is the contact's `id`. Several contacts match: ask the user which one.

## Step 3: Build the answer

Leave out `DRAFT` orders in every answer: they are abandoned checkouts (an offline order also shows `DRAFT` for a second or two after it is created). Give dates in the site's time zone, `properties.timeZone` from `GET https://www.wixapis.com/site-properties/v4/properties`.

- **Who bought a plan, and when:** the plan's orders with every status except `DRAFT`. Give each buyer's name, email, `createdDate` as the purchase date, and `status`.
- **New purchases in the last N days:** sort on `createdDate` `DESC`, and read pages until an order's `createdDate` is older than the start of the period. Keep the orders inside it. Recorded offline orders can carry an earlier `startDate`; the purchase date is still `createdDate`.
- **How many active subscribers:** `orderStatuses=ACTIVE`, every page. Count distinct `buyer.contactId`, because one person can hold several orders, and say whether the number is people or orders. Give `PAUSED` and `PENDING` orders as separate numbers when there are any. Do not filter on `autoRenewCanceled=false` for this: one-time plans have no auto-renewal and drop out of that filter.
- **Ending in the next N days:** read the `ACTIVE` orders and keep those whose `endDate` falls in the period. Do not rely on sorting by `endDate`: orders without one come first in `ASC` order. An order without `endDate` renews; its next payment date is `currentCycle.endedDate`. Report that date when the user asks about renewals or payments due.
- **Set to cancel:** `ACTIVE` orders whose `cancellation.effectiveAt` is `NEXT_PAYMENT_DATE`; they end on `endDate`.
- **Current and former customers:** current = `ACTIVE`, `PAUSED` or `PENDING`; former = `ENDED` or `CANCELED`. A person with both kinds of order is a current customer. Find the emails with Step 2.
- **Unpaid orders:** `paymentStatuses=UNPAID`. Online payments update this field by themselves; an offline order stays `UNPAID` until the owner marks it paid.
- **Exports:** return the rows with the columns the user asked for. A list longer than a few dozen rows goes in a file or a table, not in a chat message.

No orders found: say so with the filter you used (plan, status, period), and offer the plan's orders of every status.

## Step 4: Change an order

A request that names the buyer or the order and the change ("pause Dana's Gold membership", "extend John's pass to 30 June") is already the user's confirmation. Ask first when several orders fit (one buyer with two orders of the plan), and before a change to more than one order, with their number. For a cancellation the user did not time, ask whether it is now or at the end of the paid period.

Every change returns `{}`, which means it was accepted. The order shows the change in a read one or two seconds later. Read it with Get Order before you report the result. If the read does not show the change yet, read up to two more times; if it still does not show, report what the last read shows. Do not send the change again.

| Change | Call | Rules |
|---|---|---|
| [Pause Order](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/pause-order) | `POST https://www.wixapis.com/pricing-plans/v2/orders/<order id>/pause` with `{}` | Only `ACTIVE` orders. Payments stop while paused |
| [Resume Order](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/resume-order) | `POST https://www.wixapis.com/pricing-plans/v2/orders/<order id>/resume` with `{}` | The paused time is added to the end date and the billing cycle |
| [Cancel Order](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/cancel-order) | `POST https://www.wixapis.com/pricing-plans/v2/orders/<order id>/cancel` with `{ "effectiveAt": "NEXT_PAYMENT_DATE" }` or `{ "effectiveAt": "IMMEDIATELY" }` | An order whose `pricing` has no `subscription` is a one-time plan and takes `IMMEDIATELY` only. When the user wants it to stop at the end of its period, tell them it already ends on `endDate` and does not renew |
| Extend: [Postpone End Date](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/postpone-end-date) | `PATCH https://www.wixapis.com/pricing-plans/v2/orders/<order id>` with `{ "endDate": "2026-12-31T23:59:59.000Z" }` | The new date must be later than `endDate`. An order without `endDate` returns `400`, and a `PAUSED` order returns `428` |
| [Mark As Paid](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/mark-as-paid) (offline orders) | `POST https://www.wixapis.com/pricing-plans/v2/orders/<order id>/mark-as-paid` with `{}` | `OFFLINE` orders only; a second call returns `428` |

After a cancel at `NEXT_PAYMENT_DATE`, the order stays `ACTIVE`: it gets `autoRenewCanceled: true`, a `cancellation`, and an `endDate` at the end of the paid cycle, when its status becomes `CANCELED`. That is the expected result; do not cancel again with `IMMEDIATELY`. A cancel `IMMEDIATELY` sets `status` to `CANCELED` and `endDate` to now.

A `409 INVALID_REVISION` from Mark as Paid on an order created a few seconds earlier can still have marked it paid. Read the order before you send it again.

No API method changes an order's start date or its payment date: tell the user so instead of searching for one. The owner can move the payment date of an active recurring subscription in the dashboard; give them the steps in [Changing the Payment Date for Recurring Subscriptions](https://support.wix.com/en/article/pricing-plans-changing-the-payment-date-for-recurring-subscriptions), and a link from [Pricing Plans Dashboard Navigation](pricing-plans-dashboard-navigation.md).

## Step 5: Record a manual (offline) order

Use [Create Offline Order](https://dev.wix.com/docs/api-reference/business-solutions/pricing-plans/orders/create-offline-order) when the buyer paid outside the site (cash, bank transfer), still owes an offline payment, or gets the plan from the owner for free. A request that names the buyer and the plan is the confirmation. Purchase limits of the plan do not apply to offline orders.

1. Find the buyer's member ID by email with [Query Members](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/query-members) (the match ignores case):

   ```bash
   curl -X POST 'https://www.wixapis.com/members/v1/members/query' \
   -H 'Content-Type: application/json' \
   -H 'Authorization: <AUTH>' \
   -d '{ "query": { "filter": { "loginEmail": "jane@example.com" } }, "fieldsets": ["FULL"] }'
   ```

   The member is `members[0]`; take its `id`. With `"fieldsets": ["FULL"]` it also holds `loginEmail`, `contactId` and `contact.firstName` / `contact.lastName`; without it, the member comes back with no email and no name. A member created a few seconds earlier is not found yet: when the result is empty, send the same query once more after a few seconds. Still no member has that email: ask the user before you create one with [Create Member](https://dev.wix.com/docs/api-reference/crm/members-contacts/members/member-management/members/create-member): `POST https://www.wixapis.com/members/v1/members` with `{ "member": { "loginEmail": "jane@example.com", "contact": { "firstName": "Jane", "lastName": "Doe" } } }`, then use `member.id`.

2. Find the plan ID with Query Plans (Step 1).

3. Create the order:

   ```bash
   curl -X POST 'https://www.wixapis.com/pricing-plans/v2/checkout/orders/offline' \
   -H 'Content-Type: application/json' \
   -H 'Authorization: <AUTH>' \
   -d '{ "planId": "<plan id>", "memberId": "<member id>", "paid": true }'
   ```

   `memberId` takes the member ID, not a contact ID. Send `paid: true` when the buyer paid outside the site or the owner gives a paid plan for free, because nothing is owed. Leave it out only when the buyer still owes the payment; mark the order paid later. A free plan needs no `paid`. `startDate` (for example `"2026-12-01T00:00:00.000Z"`) is optional and defaults to now; a future date makes the order `PENDING`.

The response holds `order.id`. Its `status` and `lastPaymentStatus` can still show `DRAFT`, `UNDEFINED` or `UNPAID` for a second or two; read the order with Get Order before you report them.

On sites where plans are sold through Wix eCommerce (the order has `onEcom: true`), every plan order also creates an eCommerce order with the plan name as its line item. Report subscription state (active, paused, cancelled, ending) from the plan orders here: the eCommerce order keeps `status` `APPROVED` after the plan order is cancelled.
