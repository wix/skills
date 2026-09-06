# Querying and paging a Wix API from a collection page

> Split out of [DATA_SOURCES.md](DATA_SOURCES.md) to stay inside the 10k-char reference fetch
> limit. That file is about finding the method and its fields; this one is about calling it.

## Confirm a filter field path before you ship it

A filter path is cheap to verify and expensive to guess, and the endpoint's own prose is not
authoritative about it. Query Extended Bookings describes itself as "filter by `scheduleId` of the
relevant service"; a bare `scheduleId` is rejected outright:

```json
{ "code": "INVALID_FILTER", "data": { "unknownField": { "fieldPath": "scheduleId" } } }
```

The accepted paths are nested per `bookedEntity` branch — which the same page's worked example
hints at with `bookedEntity.item.slot.sessionId`. **Trust the example over the sentence.** And
because `bookedEntity` is a oneof, a filter that covers every row is an `$or` over both branches,
exactly as the row mapper handles both:

```ts
$or: [
  { 'bookedEntity.item.slot.scheduleId':     { $in: scheduleIds } },
  { 'bookedEntity.item.schedule.scheduleId': { $in: scheduleIds } },
]
```

Send the query once with the path you intend to use and read the response: the error names the
offending `fieldPath` exactly, so one call settles it. One branch returning rows is not the filter
working — check each branch separately before wiring it into a page, or the filter silently drops
every row of the other kind.

## One operator per field

WQL allows a field **one** operator. A date range written the obvious way is rejected:

```ts
{ startDate: { $gte: from, $lte: to } }   // INVALID_FILTER — unknownOperator
```

The error quotes the whole object back as the offending "operator", which reads like a parser bug
and is actually the rule. Ranges are two clauses, combined with `$and`; `$or` nests inside it:

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
usually after the single-filter case has already been called working.

## Cursor paging has two traps, and both look like a hung table

**A follow-up page carries the cursor alone.** The cursor already encodes the filter and sort of the
query that produced it, so re-sending them is rejected — Bookings answers `"Invalid cursor. Sort or
filter can not be specified together with cursor"`. Build the first request and the follow-ups
differently:

```ts
const response = await ns.query(
  query.cursor
    ? { cursorPaging: { limit: query.limit, cursor: query.cursor } }
    : { filter, sort, cursorPaging: { limit: query.limit } },
);
```

**Return no cursor on the last page.** `CursorQueryResult` requires the key to be *present* but
allows `undefined` as its value, so `cursor: ''` is falsy and still a cursor. The collection reads a
present cursor as "there is more", requests the next page forever, and appends the same rows each
pass — a table that grows without end while the API is perfectly happy. Use
`response.pagingMetadata?.cursors?.next || undefined`.

Cursor mode also takes a separate `fetchTotal`, since a cursor-paged response carries no total.
Build its filter exactly as the page's, or the count disagrees with the rows it counts.

**Both failures render as a spinner under the last row**, which reads as "still loading" and is
actually a retry loop or an endless page walk. When a table will not settle, instrument the page
itself — an extension runs in a cross-origin iframe whose console you cannot read, but its own
`SummaryBar` will happily display `state.collection.status.status`, a fetch counter and the last
rejection message. That is what turns "it spins" into a named error in one reload.
