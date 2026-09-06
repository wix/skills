# Finding the real SDK shape behind a dashboard page

> **Scope.** [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md) gives you the page. This file is the other half:
> locating the method and the *field names* for the data it lists. Read it before Step 3's MCP
> discovery — the installed package answers most of it faster and more accurately than a doc search,
> because it is the version your code will compile against.

## Where the types actually live

A Wix vertical package such as `@wix/ecom` is a thin re-export barrel. `build/es/index.d.mts` is a
list of namespaces (`orders`, `orderTransactions`, `currentCart`, …), each re-exported from its own
generated package:

```
node_modules/@wix/ecom/build/es/index.d.mts          # namespace list only, ~90 lines
node_modules/@wix/auto_sdk_ecom_orders/build/es/
  index.d.mts                                        # the callable functions
  index.typings.d.mts                                # request/response types
  ecom-v1-order-orders.universal-<hash>.d.mts        # the domain entities
```

Three consequences worth knowing before you start grepping:

1. **The namespace list is the cheap map.** `grep -oE "as [a-zA-Z_]+" .../ecom/build/es/index.d.mts`
   prints every module in one call — faster than guessing package names.
2. **The entity is not in `index.typings.d.mts`.** `Order`, `Refund`, `Payment` live in the hashed
   `*.universal-*.d.mts`. The hash changes between versions, so glob for it, never hard-code it.
3. **Never `cat` the barrel's export block.** These files end with a single several-hundred-KB
   `export { … as a, … as b }` line. Target `interface X {` with `grep -n`, then `sed` a window.

## Confirming a method

```bash
E=node_modules/@wix/auto_sdk_ecom_order-transactions/build/es
grep -oE "^declare function [a-zA-Z]+" $E/index.d.mts
```

Prefer this to recall: `listTransactionsForMultipleOrders(orderIds: string[])` and
`listTransactionsForSingleOrder` differ by exactly the shape a collection page needs, and only one
of them avoids an N+1 across the visible page.

## Confirming a field — the part that ships bugs

Once you have the entity, read the declaration for **every field you map into a column**, not just
the uncertain ones. Two failure modes recur:

**Deprecated fields still compile.** On `RegularPaymentDetails`, `paymentMethod` carries
`@deprecated Use paymentMethodName.buyerLanguageName instead` — the deprecated one is a bare code,
the replacement is the localised name a person expects to read. Grep before you map:

```bash
grep -B4 "paymentMethod?:" $E/index.typings.d.mts   # shows the @deprecated banner above it
```

A column bound to a deprecated field renders something plausible and wrong, which is the hardest
kind of defect to catch in review.

**Aggregates hide one level down.** Money on a refund is not on the refund — it is
`refund.summary.refunded.amount` (`AggregatedRefundSummary`, with `pendingRefund`, `failedRefundAmount`
and `requestedRefund` beside it), while per-transaction status is
`refund.transactions[].refundStatus`. Summing the wrong one silently under-reports.

## Joining two sources for one row

A collection page usually needs one query plus one batch lookup, never a lookup per row:

```ts
const { orders: found } = await orders.searchOrders({ filter, sort, cursorPaging: { limit, cursor } });
const ids = found.map((o) => o._id).filter((id): id is string => Boolean(id));
const { orderTransactions: txns } = await orderTransactions.listTransactionsForMultipleOrders(ids);
const byId = new Map(txns.map((t) => [t.orderId, t]));
```

Build the `Map` once and index it in the row mapper. Guard the empty case before the second call —
a batch endpoint given `[]` is a wasted round trip at best.

## Filter syntax

`searchOrders` takes a `CursorSearch`: `{ cursorPaging, filter, sort }`, where `filter` is a
Mongo-shaped `Record<string, any>` — `{ paymentStatus: { $in: [...] } }`,
`{ _createdDate: { $gte, $lte } }`, `{ number: { $startsWith } }`. Enum values come from the
declaration, not from memory: order payment status is `FULLY_REFUNDED` / `PARTIALLY_REFUNDED` /
`PAID` / `NOT_PAID` / `PENDING` / `PARTIALLY_PAID` / `PENDING_MERCHANT` / `CANCELED` / `DECLINED` /
`UNSPECIFIED`.
