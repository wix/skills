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

1. **The directory name is not the namespace name.** Namespaces are camelCase, package directories
   are kebab-case — `extendedBookings` lives in `auto_sdk_bookings_extended-bookings`, not
   `auto_sdk_bookings_extendedBookings`. Don't derive one from the other; list them:
   `ls node_modules/@wix | grep <vertical>`.
2. **The entity is not always in `index.typings.d.mts`.** `Order`, `Refund`, `Service` live in the
   hashed `*.universal-*.d.mts` when the package has one. The hash changes between versions, so glob
   for it, never hard-code it, and fall back to `index.typings.d.mts` when no universal file exists.
3. **Never `cat` *or plain-`grep`* the barrel's export block.** These files end with a single
   several-hundred-KB `export { … as a, … as b }` line, so `grep -n "queryServices" index.d.mts`
   prints that whole line. Anchor to the declarations instead —
   `grep -oE "^declare (const|function) [a-zA-Z]+"` — or pipe any barrel grep through `cut -c1-200`.

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

## The SDK is not the REST API

Docs search returns REST pages, and a dashboard page calls the **SDK**. Append `?apiView=SDK` to the
URL of whatever page you landed on and read that view — it answers two of the four differences
before you write a line.

**1 and 2 — namespace and id naming. The SDK view states both.** It prints the package and namespace
outright (`SDK Package: @wix/members`, `SDK Namespace: customFields`), and uses `_id` in its own
parameter list. Infer either from the REST page and you get them wrong: REST paths say `services/v2`,
so `servicesV2` looks right, and the SDK exports `services`; REST responses show `"id"`, and the SDK
type declares `_id` — same for `_createdDate` / `_updatedDate`. Offline, the barrel is the fallback
for the namespace list:

```bash
grep -oE "as [a-zA-Z_]+" node_modules/@wix/<pkg>/build/es/index.d.mts | sed 's/as //' | sort -u
```

The next two are codegen artifacts that no docs page mentions — read them off the declaration.

**3. Don't derive types from `ReturnType`.** Most SDK functions are overloaded — a direct call
and an `httpClient` form — so `Awaited<ReturnType<typeof ns.method>>['items'][number]` resolves
against the wrong overload and fails. Import the entity type the package exports instead:

```ts
type Row = <namespace>.<Entity>;   // e.g. extendedBookings.ExtendedBooking — not ReturnType<typeof …>
```

**4. Paging metadata carries no `hasNext`.** `PagingMetadataV2` is `count`, `offset`, `total`,
`tooManyToCount`, `cursors` — nothing else, in every generated package. Whether another page exists
is knowable only from `pagingMetadata.cursors.next`. What the collection wants you to *return* is a
separate question — see [TABLE_STATE.md](TABLE_STATE.md#query-and-result-shapes).

## Two things to settle before you write the page

**Is the package even installed?** A vertical's SDK is not a default dependency. `@wix/bookings`,
`@wix/ecom` and the rest have to be present before the import resolves:

```bash
node -e "const p=require('./package.json');console.log(!!({...p.dependencies,...p.devDependencies})['@wix/<pkg>'])"
npm install @wix/<pkg>     # if false
```

**Does the app hold the scope?** This is the one that produces a page which builds, mounts, renders
its shell, and shows nothing — the hardest failure to read, because an empty table looks like empty
data. Reads of a vertical's data need that vertical's permission scope, granted in **Dev Center →
Permissions**; it cannot be declared in the repo, and the app's install consent screen names what it
actually has.

**Don't guess the scope name — the method's own docs page prints it.** In SDK view every method
carries `Method Permissions` and `Method Permissions Scopes IDs`, for example
`Manage Members: SCOPE.DC-MEMBERS.MANAGE-MEMBERS`. Look it up for the exact method you are calling,
assume it is missing on a fresh app, and report it under
[Manual Steps Required](../../SKILL.md#-manual-steps-required) by name. Wiring `errorState` on the
table (the draft template does) is what turns this from silent skeletons into a message you can read.

## A second vertical is a second scope

The two checks above are easy to run once, at Step 3, for the vertical the page is obviously about —
and then to skip for the *next* one, because by then you are deep in Step 4b adding a detail column
or resolving a search term. That second package needs the same two things, and it fails differently:
the page already worked, so the regression looks like something you broke in the UI.

A measured run added `@wix/crm` mid-implementation to resolve a client-name search. The app held
Bookings scopes and not `SCOPE.DC-CONTACTS.READ-CONTACTS`, the contacts call answered 403, and
because the search awaited it unconditionally, a page that had been loading fine stopped loading at
all.

**Run the package-and-scope check for every `@wix/*` import you add, whenever you add it** — and
then decide what its failure should cost:

- **Primary source** — the rows themselves. Its failure is the page's failure; `errorState` reports it.
- **Secondary source** — an enrichment lookup, a filter's option list, a term resolved to ids. Its
  failure must cost only that feature. Wrap the call, fall back to the empty result, and say so in
  the UI (`TableTopNotification` is the patterns component for it) rather than degrading silently.

Ask which one you are adding before you write the `await`. An unwrapped secondary call is a page
whose availability is the *intersection* of every scope it touches.

## Querying and paging

Filter field paths, WQL's one-operator-per-field rule, and the two cursor-paging traps are in
[QUERY_AND_PAGING.md](QUERY_AND_PAGING.md). Read it before writing `fetchData` — every rule there
was a shipped bug first.
