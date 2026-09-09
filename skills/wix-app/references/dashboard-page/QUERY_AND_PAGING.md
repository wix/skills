# Querying and paging a Wix API from a collection page

> Split out of [DATA_SOURCES.md](DATA_SOURCES.md) so each file covers one job: that one is about
> finding the method and its fields, this one is about calling it.

Filters are written in **WQL**, which is shared across the platform — the rules below come from
[About the Wix API Query Language][wql], not from one endpoint's behaviour, so they hold for
`@wix/ecom`, `@wix/stores`, `@wix/bookings` and the rest alike.

## The filterable fields are a closed list, published per endpoint

> "This endpoint declares which fields it can filter and sort by, and with which operators; that
> list is closed and covers this endpoint only. Anything else errors or silently returns the wrong
> rows." — [WQL][wql]

So a field path is never inferable from the entity shape, and the endpoint's own prose is not
authoritative either. **Most query endpoints publish a "Supported Filters and Sorting" page**, and
the SDK typedoc for the query's `filter` field links to it — Contacts, Orders, Products V3,
Pipelines and Bookings all do. Find the link before you guess:

```bash
grep -rho "https://[^)]*supported-filters[^)]*" node_modules/@wix/<pkg>/build/es/*.d.mts | sort -u
```

**Read the page, don't just find it.** It is a table of field → operators, and it routinely lists
more than the endpoint's prose implies — Query Extended Bookings' prose mentions filtering courses
"by `scheduleId`", while its table also declares `serviceId` and the staff `resource.id` on both
`bookedEntity` branches, and `contactDetails.contactId` / `.email`. Those are the difference between
a page with two working filters and one with five.

**Honour the *Filter Performance* note.** Many pages carry one, naming fields to include in every
request — Query Extended Bookings "strongly recommends" `startDate` in all of them. Don't satisfy it
by hiding a clause in `fetchData`: a filter the user cannot see or clear makes rows go missing for no
visible reason. Seed the visible filter instead, so the default is applied, labelled and adjustable:

```ts
const dateFilter = dateRangeFilter({
  name: 'Date',
  initialValue: { from: startOfDay(subDays(new Date(), 30)), to: null },
});
```

`initialValue` is on every filter factory (`FilterStateBaseParams`), so the same trick seeds a status
or category default. Pick a window that matches the page's job — a booking review wants recent and
upcoming, an audit log wants the last 24 hours.

**A seeded default must not defeat search.** Search is a "find this anywhere" gesture, so a window
the user never chose silently hiding matches from it reads as broken search — a measured run shipped
exactly that, and the report was "search doesn't work", not "the date filter is too narrow". Bypass
the range while it is still the seeded value, and keep it once the user has set their own:

```ts
const DEFAULT_FROM = startOfDayDaysAgo(30);
const isUntouchedDefault = (r?: { from?: Date; to?: Date }) =>
  !r?.to && r?.from?.getTime() === DEFAULT_FROM.getTime();
// in fetchData AND fetchTotal:
dateRange: search?.trim() && isUntouchedDefault(range) ? undefined : range,
```

Whatever a filter or a permission removes from the result, **say so in `noResultsState`** — "no
matches" and "no matches because a default you didn't set, or a scope you don't hold, excluded them"
look identical, and only the second is actionable.

Two traps the list resolves, both of which look like a working filter:

**Nested paths.** A field that reads as top-level on the entity is often only filterable at its full
path. Query Extended Bookings describes itself as filtering "by `scheduleId` of the relevant
service", and a bare `scheduleId` is rejected outright — the accepted paths are nested under
`bookedEntity`. The error names the offending path exactly, so one call settles it:

```json
{ "code": "INVALID_FILTER", "data": { "unknownField": { "fieldPath": "scheduleId" } } }
```

**Oneof branches.** When the entity has a oneof, one path covers only one branch, and a filter over
just that branch silently drops every row of the other kind — exactly as the row mapper has to
handle both. Cover them with `$or`, and check each branch separately before wiring it into a page:

```ts
$or: [
  { 'bookedEntity.item.slot.scheduleId':     { $in: scheduleIds } },
  { 'bookedEntity.item.schedule.scheduleId': { $in: scheduleIds } },
]
```

## One operator per field

> "The filter is written in WQL, where each field takes a single operator, so conditions are
> combined with the logical operators instead: `$and` and `$or` take an array of expressions,
> `$not` takes one, and they can nest. They are WQL syntax, not field capabilities." — [WQL][wql]

A date range written the obvious way therefore fails, and the error quotes the whole object back as
the offending "operator", which reads like a parser bug and is actually the rule:

```ts
{ startDate: { $gte: from, $lte: to } }   // INVALID_FILTER — unknownOperator
```

Ranges are two clauses under `$and`; `$or` nests inside it:

```ts
{ $and: [
  { status: { $in: statuses } },
  { startDate: { $gte: from } },
  { startDate: { $lte: to } },
  { $or: [ /* the oneof branches */ ] },
] }
```

Build the filter as a list of clauses and wrap it at the end — return the bare clause when there is
only one, `{}` when there are none — rather than mutating one object and hoping the operators do not
collide. A page with several filters hits this the moment two of them apply at once, which is
usually after the single-filter case has already been called working. The full operator set —
including `$not`, `$nin`, `$exists`, `$isEmpty`, `$hasAll`, `$hasSome` — is in the [WQL article][wql].

## A follow-up cursor page carries the cursor alone

The cursor already encodes the filter and sort of the query that produced it, so re-sending them is
rejected. This is not one API's quirk: it is stated on the `cursorPaging.cursor` field of every
generated Wix SDK that offers cursor paging — 46 of the 179 `auto_sdk_*` packages in one install —
in a standard sentence you can read before making a request:

> "Cursor token pointing to a page of results. Not used in the first request. Following requests use
> the cursor token and not `filter` or `sort`."

Build the first request and the follow-ups differently:

```ts
const response = await ns.query(
  query.cursor
    ? { cursorPaging: { limit: query.limit, cursor: query.cursor } }
    : { filter, sort, cursorPaging: { limit: query.limit } },
);
```

Sending them together answers `"Invalid cursor. Sort or filter can not be specified together with
cursor"` — and because the collection retries, that renders as a spinner under the last row, which
reads as "still loading". What you return on the **last** page is the collection's own contract, and
has its own trap: [TABLE_STATE.md](TABLE_STATE.md#query-and-result-shapes).

Cursor mode also takes a separate `fetchTotal`, since a cursor-paged response carries no total.
Build its filter exactly as the page's, or the count disagrees with the rows it counts.

## When a table will not settle

An extension runs in a cross-origin iframe whose console you cannot read, but its own `SummaryBar`
will happily display `state.collection.status.status`, a fetch counter and the last rejection
message. That is what turns "it spins" into a named error in one reload.

[wql]: https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/data-retrieval/about-the-wix-api-query-language
