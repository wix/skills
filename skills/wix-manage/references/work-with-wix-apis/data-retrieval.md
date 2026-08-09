---
name: "Data Retrieval Across Wix APIs"
description: >-
  In-depth reference for data retrieval across Wix API endpoints: the Wix API Query Language,
  its operator vocabulary and semantics, how search, query, and list methods differ, and
  sorting and paging mechanics. Each API implements the language partially or in full.
---

# Data Retrieval Across Wix APIs

Search and query methods share one request language across every Wix API that offers them.
What doesn't carry over is the field set: each method's own API reference declares which of
its fields can be filtered and sorted on, and a field it doesn't declare can't be pushed to
the server at all.

| Article | What it covers |
| --- | --- |
| [About the Wix API Query Language](https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/data-retrieval/about-the-wix-api-query-language) | The operator vocabulary and what each operator matches — comparison (`$in`/`$nin`, `$startsWith`, `$isEmpty` among them), logical (`$and`/`$or`/`$not`), element (`$exists`), and array (`$hasAll`/`$hasSome`) — how conditions compose, array matching semantics, `fields`/`fieldsets` projection, aggregation types, free-text `search` parameters including `fuzzy`, and `timeZone` for date filters and aggregations. |
| [About Search, Query, and List Methods](https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/data-retrieval/about-search-query-and-list-methods) | The differences between the three methods: what each can express, aggregations and free-text search, result counts, and their consistency and latency trade-offs. |
| [About Sorting and Paging](https://dev.wix.com/docs/api-reference/articles/work-with-wix-apis/data-retrieval/about-sorting-and-paging) | The default `createdDate` DESC sort order, where sort and paging parameters sit on list calls (query parameters) versus query and search (request body), and why search typically uses cursors — consistent results when data changes mid-pagination. |
