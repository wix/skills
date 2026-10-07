# Finding the real SDK shape behind a dashboard page

> **Scope.** [DRAFT_TEMPLATE.md](DRAFT_TEMPLATE.md) gives you the page. This file is the other half:
> locating the method and the *field names* for its data. Read it before Step 3's MCP discovery —
> the installed package is the version your code compiles against, so it beats a doc search.

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
   hashed `*.universal-*.d.mts` when the package has one. Glob for it (the hash changes between
   versions) and fall back to `index.typings.d.mts`.
3. **Never `cat` *or plain-`grep`* the barrel's export block.** These files end with one
   several-hundred-KB `export { … as a, … as b }` line, so a plain grep prints all of it. Anchor to
   the declarations — `grep -oE "^declare (const|function) [a-zA-Z]+"` — or pipe through `cut -c1-200`.

## Confirming a method

```bash
E=node_modules/@wix/auto_sdk_ecom_order-transactions/build/es
grep -oE "^declare function [a-zA-Z]+" $E/index.d.mts
```

Prefer this to recall: of `listTransactionsForMultipleOrders(orderIds: string[])` and
`listTransactionsForSingleOrder`, only the first avoids an N+1 across the visible page.

## Confirming a field — the part that ships bugs

Once you have the entity, read the declaration for **every field you map into a column**, not just
the uncertain ones. Two failure modes recur:

**Deprecated fields still compile.** On `RegularPaymentDetails`, `paymentMethod` is
`@deprecated Use paymentMethodName.buyerLanguageName instead` (a bare code, not the localised name). Grep before you map:

```bash
grep -B4 "paymentMethod?:" $E/index.typings.d.mts   # shows the @deprecated banner above it
```

A column bound to a deprecated field renders something plausible and wrong.

**Aggregates hide one level down.** Refund money is `refund.summary.refunded.amount`
(`AggregatedRefundSummary`, beside `pendingRefund`, `failedRefundAmount`, `requestedRefund`); per-transaction
status is `refund.transactions[].refundStatus`. Summing the wrong one under-reports.

**A generic-sounding field is not the related entity.** Treat `.title`, `.name` and `.summary` as
unverified until you read the declaration: an `Extended*` / `*WithDetails` shape attaches the real
related entity, and a summary field on the base item is not a substitute.

**A mapper must cover every shape the response returns.** Responses often carry a oneof — Bookings'
`bookedEntity` is `slot` for an appointment, `schedule` for a class — and a mapper reading one
variant renders blank cells for the other while passing `tsc`.

## Joining two sources for one row

A collection page usually needs one query plus one batch lookup, never a lookup per row:

```ts
const { orders: found } = await orders.searchOrders({ filter, sort, cursorPaging: { limit, cursor } });
const ids = found.map((o) => o._id).filter((id): id is string => Boolean(id));
const { orderTransactions: txns } = await orderTransactions.listTransactionsForMultipleOrders(ids);
const byId = new Map(txns.map((t) => [t.orderId, t]));
```

`orderIds` takes at most 100 ids, and inaccessible orders are silently omitted (a missing scope looks
like an empty map). Build the `Map` once; skip the second call on an empty page.

## Filter syntax

`searchOrders` takes a `CursorSearch`: `{ cursorPaging, filter, sort }`, where `filter` is a
Mongo-shaped `Record<string, any>` — `{ paymentStatus: { $in: [...] } }`,
`{ $and: [{ _createdDate: { $gte } }, { _createdDate: { $lte } }] }` (one operator per field, see
[QUERY_AND_PAGING.md](QUERY_AND_PAGING.md#one-operator-per-field)). `number` takes only `$eq`, `$ne`,
`$in`, `$exists`, `$gt`, `$gte`, `$lt`, `$lte` — no `$startsWith`, which is allowed on
`billingInfo.contactDetails.firstName` / `.lastName` and `buyerInfo.email`. Enum values come from the
declaration, not from memory: order payment status is `FULLY_REFUNDED` / `PARTIALLY_REFUNDED` /
`PAID` / `NOT_PAID` / `PENDING` / `PARTIALLY_PAID` / `PENDING_MERCHANT` / `CANCELED` / `DECLINED` /
`UNSPECIFIED`.

`searchOrders` hides `PENDING` and `REJECTED` orders unless the filter names the status, and never
returns `INITIALIZED` ones (use `getOrder`).

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
grep -oE "as [a-zA-Z0-9_]+" node_modules/@wix/<pkg>/build/es/index.d.mts | sed 's/as //' | grep -v '^auto_sdk' | sort -u
```

The next two are codegen artifacts that no docs page mentions — read them off the declaration.

**3. Don't derive types from `ReturnType`.** Most SDK functions are overloaded — a direct call
and an `httpClient` form — so `Awaited<ReturnType<typeof ns.method>>['items'][number]` resolves
against the wrong overload and fails. Import the entity type the package exports instead:

```ts
type Row = <namespace>.<Entity>;   // e.g. extendedBookings.ExtendedBooking — not ReturnType<typeof …>
```

Stores V3's entity is `productsV3.V3Product`, not the unrelated `productsV3.Product`.

**4. Check the paging metadata type.** `PagingMetadataV2` (`count`, `offset`, `total`,
`tooManyToCount`, `cursors`, as in Media) has no `hasNext`: use `cursors.next`. Stores V3's
`CursorPagingMetadata` has `hasNext`. Most methods return `pagingMetadata`, but `labels.listLabels`
and the `members` list/query responses return `metadata`; the wrong name reads `undefined`. What the collection wants you to *return* is a separate question — see [TABLE_STATE.md](TABLE_STATE.md#query-and-result-shapes).

## Two things to settle before you write the page

**Is the package even installed?** A vertical's SDK is not a default dependency:

```bash
node -e "const p=require('./package.json');console.log(!!({...p.dependencies,...p.devDependencies})['@wix/<pkg>'])"
npm install @wix/<pkg>     # if false
```

**Does the app hold the scope?** This is the one that produces a page which builds, mounts, renders
its shell, and shows nothing, because an empty table looks like empty data. Reads of a vertical's
data need that vertical's permission scope, granted in **Dev Center → Permissions** (it cannot be
declared in the repo).

**Don't guess the scope name — the method's own docs page prints it.** In SDK view every method
carries `Method Permissions` and `Method Permissions Scopes IDs`, for example
`Manage Members: SCOPE.DC-MEMBERS.MANAGE-MEMBERS`. Look it up for the exact method, assume it
is missing on a fresh app, and report it under [Manual Steps Required](../../SKILL.md#-manual-steps-required).
Wiring `errorState` on the table (the draft template does) turns a missing scope from silent skeletons into a message you can read.

**A printed scope can be an alternative or wrong** (`queryExtendedBookings` lists three; the V2 staff
methods print `SCOPE.RENTALS.MANAGE`). Confirm the id exists in the app's Dev Center permission
picker (search by id), pick the least privilege that works, and report it under Manual Steps
Required. Tags need `SCOPE.DC-OS.READ-TAGS`.

## A second vertical is a second scope

The package-and-scope checks above are easy to run once, for the obvious vertical, and skip for the
*next* one added mid-implementation — which then fails like a regression in your UI. A measured run
added `@wix/crm` to resolve a client-name search; the app lacked `SCOPE.DC-CONTACTS.READ-CONTACTS`,
the call answered 403, and because the search awaited it unconditionally, a page that had loaded
fine stopped loading.

**Run both checks for every `@wix/*` import you add, when you add it**, then decide what its failure costs:

- **Primary source** — the rows themselves. Its failure is the page's failure; `errorState` reports it.
- **Secondary source** — an enrichment lookup, a filter's option list, a term resolved to ids. Its
  failure must cost only that feature: wrap the call, fall back to the empty result, and say so in
  the UI (`TableTopNotification` is the patterns component for it) rather than degrading silently. An unwrapped secondary call makes
  the page's availability the *intersection* of every scope it touches.

## Querying and paging

Filter field paths, WQL's one-operator-per-field rule, and the two cursor-paging traps are in
[QUERY_AND_PAGING.md](QUERY_AND_PAGING.md). Read it before writing `fetchData` — every rule there
was a shipped bug first.
