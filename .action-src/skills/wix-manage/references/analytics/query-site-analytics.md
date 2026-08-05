---
name: "Query Site Analytics"
description: Retrieve a Wix site's analytics through the Semantic Model API. Covers listing semantic models, inspecting a model's schema (measures, dimensions, parameters), and querying model data with a required time interval, filters, sorting, paging, and human-readable formatting.
---
# Query Site Analytics

This article shows how to read a site's analytics with the **Semantic Model API**. A semantic model describes one analytics subject area (such as site traffic, revenue, etc.) and defines the **measures**, **dimensions**, and **parameters** you can query.

## Prerequisites

1. The app/caller has the **Site Analytics – read** permission scope (`SCOPE.DC-ANALYTICS-AND-REPORTS.READ-SITE-ANALYTICS`).
2. A site context is available (the request is authorized against a specific site).

## Required APIs

- **Semantic Model API**: [REST](https://dev.wix.com/docs/api-reference/business-management/analytics/semantic-models/introduction)
- **Site Properties API** (for the site's time zone): [REST](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties)

Base path: `https://www.wixapis.com/analytics/semantic-model/v3`

| Step | Method | Endpoint |
|---|---|---|
| List models | `GET` | `/semantic-models` |
| Get model schema | `GET` | `/semantic-models/{semanticModelId}` |
| Query model data | `POST` | `/semantic-models/query-data` |

## Decision flow

Always follow **List → Get → Query**. You cannot construct a valid query without first discovering the model's field names from `Get Semantic Model`.

1. **List Semantic Models** — discover which subject areas exist and their IDs.
2. **Get Semantic Model** — inspect a model's `measures`, `dimensions`, and `parameters` to find the exact `name` values to query and their supported filters/sorting.
3. **Query Semantic Model Data** — request specific field names for a time `interval`, with optional filters, sorting, paging, and formatting.

**Run each step as its own separate API call, and stop to read the result before starting the next step.** The inputs to each step do not exist until the previous step returns:

- You cannot set `semanticModelId` until **List** returns it. **Never fabricate or guess a model ID** — it must be a GUID copied verbatim from a `List Semantic Models` result. A plausible-looking GUID that List did not return will fail (`SEMANTIC_MODEL_NOT_FOUND`).
- You cannot set `fields`, `filters[].field`, or `sort.fieldName` until you have read the schema from **Get**.

Choosing the model and the field names is a **reasoning** step you perform by reading the returned JSON — not something to automate with string matching. Do **not** chain List, Get, and Query into a single script/execution.

❌ **Don't do this** — one execution that lists, gets, and queries in a single pass, picking fields by pattern-matching their names:

```js
const models = await wix.request(/* list */);
const model  = models.find(m => /traffic/.test(m.slug));       // guessing the model
const schema = await wix.request(/* get model.id */);
const dim    = schema.dimensions.find(d => /url|path/i.test(d.name)); // guessing the field
await wix.request(/* query with guessed fields */);
```

This guesses field names, ignores each field's `dependencies` (so those fields come back silently empty), and never lets you actually verify the model or schema.

✅ **Do this** — three separate calls, reading each result before composing the next:

1. Call **List**. Read the returned models; pick the `id` whose subject area matches the request.
2. Call **Get** with that `id`. Read `measures`/`dimensions`/`parameters`; choose the exact `name`s you need and note each field's `dependencies`.
3. Call **Query** with the field names you chose.

## Before you begin (sharp edges)

- **`interval` is required on every query.** There is no way to query without a date range — omitting it fails.
- **`start`/`end` are absolute UTC instants — not wall-clock in `interval.timezone`.** The trailing `Z` is respected as a real point in time; `interval.timezone` does not reinterpret it, it aligns the range to local day boundaries (and materially changes the result — the same UTC window returned different totals under `UTC` vs `Asia/Jerusalem` vs `America/Los_Angeles` in testing). So to capture a **local calendar range**, send the UTC instants that equal **local midnight** in the site's time zone — *not* `...T00:00:00.000Z`. Example — all of January 2026 for a `America/New_York` site (EST, UTC−5): `start: "2026-01-01T05:00:00.000Z"`, `end: "2026-02-01T05:00:00.000Z"`. Using `...T00:00:00.000Z` would actually start the range at 7 pm on Dec 31 local and misalign every day boundary.
- **`interval` is start-inclusive, end-exclusive (`[start, end)`).** `start` is included, `end` is not — set `end` to the local-midnight instant of the day *after* the last day you want (e.g. for all of January, `end` is Feb 1 local midnight, in UTC).
- **Convert local midnight → UTC per date, and watch DST.** Compute each boundary as local-midnight-in-UTC using the site's offset **for that specific date** — the offset changes with daylight saving. `America/New_York` is UTC−4 in summer (June local midnight = `04:00:00.000Z`) but UTC−5 in winter (January local midnight = `05:00:00.000Z`), so a range spanning a DST switch has *different* offsets at its two ends. Don't hardcode one offset across a range.
- **Set `interval.timezone` to the site's time zone to match the Wix dashboard.** Analytics in the Wix business manager are bucketed by the site's time zone. If `interval.timezone` is omitted it defaults to **UTC**, so day boundaries shift and your numbers won't match what the owner sees in the dashboard (and the same goes for using a different time zone). Get the site's IANA time zone from `properties.timeZone` via [Get Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties) (`GET https://www.wixapis.com/site-properties/v4/properties`) and pass it through.
- **Field names must come from `Get Semantic Model`.** The `fields`, `filters[].field`, and `sort.fieldName` values must exactly match a `name` returned by the model schema (e.g. `traffic.sessions_count`). Do not guess field names.
- **The field-name prefix is NOT the model slug.** Do not build names as `<slug>.<field>`. A model's fields often use a different prefix — e.g. the model with slug `crm-people-subscribers` exposes its measure as `people.contacts_count`, not `people_subscribers.contacts_count`. Copy the exact `name` strings from `Get Semantic Model`; inferring the prefix from the slug produces a field the model doesn't have.
- **Read the COMPLETE schema — never sample or truncate it.** When inspecting a model in Step 2, read the full `measures` and `dimensions` lists; do not cap them with `.slice(0, N)` or otherwise return only the first few. Lists are often long and alphabetical, so a cutoff silently hides exactly the field you need (e.g. on `traffic`, a `.slice(0, 25)` drops `traffic.referrer_category_name`, `traffic.referrer_source_name`, and `traffic.visitor_type`). Choosing from a partial list re-introduces guessing — the agent assumes a missing field doesn't exist or fabricates a name. The same applies to a field's full `dependencies` array and to the model list from `List Semantic Models`.
- **A wrong field name can fail loudly OR fail silently — assume neither.** A `fields`/`filters[].field`/`sort.fieldName` value that isn't a valid model field either (a) rejects the query with a `4XX` error and a self-explanatory string code (e.g. `fieldIsInvalid`), sometimes listing the model's **available field names**, or (b) is **silently dropped** — the query returns `200` and that field just doesn't appear in `results[].fields` (same as a missing dependency). In testing, an unknown field in `fields` was silently omitted, not errored. Never rely on an error to catch a bad field. (See *Handling wrong fields* below.)
- **Field dependencies.** A field returns data only if at least one of the field names in its `dependencies` array is also included in the same query; otherwise it's **silently omitted** from results (no error). For example, a measure may only return data when a specific dimension is also requested.
- **Sorting a nullable measure — set `sort.nullsLast: true`.** `nullsLast` defaults to `false` and only affects **descending** (`DESC`) order. If a measure can return null and you sort it `DESC`, the null rows sort *first* — so a "top N" query surfaces nulls before your real values. Set `nullsLast: true` to push nulls to the end.
- **Result cap: 1,000 rows per query.** `results` is capped at 1,000 rows — paginate with `paging.offset` for larger datasets.
- **Formatting is opt-in.** Set `formattingEnabled: true` to also receive a human-readable `formattedValue` per cell (e.g. `1500` → `"$1,500.00"` or `1.5K`). Raw typed values are always returned.
- **Totals are opt-in.** Set `totalsIncluded: true` to get a `totals` row summing numeric fields across the **full (unpaginated)** result set.
- **Unique fields are not additive.** For `unique` measures (e.g. unique visitors), query the exact time range you want in a **single request** — never sum values from separate date-range queries. Uniques are deduplicated within each queried range, so adding per-range results double-counts anyone who appears in more than one range and overstates the true total.

## Step 1: List semantic models

```bash
curl -X GET \
  'https://www.wixapis.com/analytics/semantic-model/v3/semantic-models' \
  -H 'Authorization: <AUTH>'
```

Response:

```json
{
  "semanticModels": [
    { "id": "cad7fd34-2c8b-4dda-8296-3f9d47fb484d", "slug": "traffic", "description": "Site traffic", "keywords": ["sessions", "views"] }
  ]
}
```

Pick the model whose subject area matches the request, and keep its `id`.

## Step 2: Get the model schema

```bash
curl -X GET \
  'https://www.wixapis.com/analytics/semantic-model/v3/semantic-models/cad7fd34-2c8b-4dda-8296-3f9d47fb484d' \
  -H 'Authorization: <AUTH>'
```

Response shape:

```json
{
  "semanticModel": {
    "id": "string<GUID>",
    "slug": "string",
    "description": "string",
    "keywords": ["string"],
    "measures": [ "Field" ],
    "dimensions": [ "Field" ],
    "parameters": [ "Field" ]
  }
}
```

Each `Field` (in `measures`, `dimensions`, and `parameters`):

| Property | Meaning |
|---|---|
| `name` | The exact value to use in `fields`, `filters[].field`, and `sort.fieldName`. |
| `type` | `STRING`, `NUMBER`, `BOOLEAN`, `DATE`, `DATE_TIME`, `OBJECT`, or `ARRAY`. |
| `filters` | Supported filter `prefixes` (`IS`/`NOT`) and `conditions` (e.g. `EQUAL`, `RANGE_II`, `CONTAINS_ANY`). |
| `sortable` | Whether the field can be used in `sort`. |
| `enumerations` | Allowed values, for enumerated fields. |
| `dependencies` | Other field names this field needs present in the query to return data (see sharp edges). |
| `groupSlug` | Fields sharing a `groupSlug` are logically related. |
| `description` | Human-readable description of the field. |

- **Measures** are quantitative fields you aggregate (revenue, page views, order count).
- **Dimensions** are categorical fields you group by (traffic source, country, product name).
- **Parameters** are optional inputs that customize query behavior (currency, date granularity).

## Step 3: Query the model data

`POST /semantic-models/query-data` (body requires `Content-Type: application/json`).

Required body fields: `semanticModelId`, `interval`, `fields`.

```bash
curl -X POST \
  'https://www.wixapis.com/analytics/semantic-model/v3/semantic-models/query-data' \
  -H 'Authorization: <AUTH>' \
  -H 'Content-Type: application/json' \
  -d '{
  "semanticModelId": "cad7fd34-2c8b-4dda-8296-3f9d47fb484d",
  "interval": {
    "start": "2024-06-01T04:00:00.000Z",
    "end": "2025-06-01T04:00:00.000Z",
    "timezone": "America/New_York"
  },
  "fields": [
    "traffic.referrer_category_name",
    "traffic.sessions_count",
    "traffic.views_count"
  ],
  "filters": [
    {
      "field": "traffic.sessions_count",
      "condition": "GREATER_THAN",
      "values": ["100"]
    }
  ],
  "sort": {
    "fieldName": "traffic.sessions_count",
    "order": "DESC",
    "nullsLast": true
  },
  "paging": {
    "limit": 50,
    "offset": 0
  },
  "formattingEnabled": true,
  "totalsIncluded": true
}'
```

> The `interval` above uses `04:00:00.000Z`, not `00:00:00.000Z`: June is EDT (UTC−4) in `America/New_York`, so `04:00Z` is local midnight. `start`/`end` are absolute UTC instants — set them to local-midnight-in-UTC for the site's time zone, and recompute the offset per date (DST). See the interval sharp edges above.

### Request fields

| Field | Required | Notes |
|---|---|---|
| `semanticModelId` | Yes | GUID from List/Get. |
| `interval` | Yes | `{ start, end }` absolute UTC ISO instants (trailing `Z`), plus `timezone`. `start`/`end` are real points in time, not wall-clock in `timezone` — to capture a local calendar range set them to local-midnight-in-UTC for the site's time zone (offset varies with DST). Range is start-inclusive, end-exclusive (`[start, end)`) — set `end` to the local midnight after the last day you want. Set `timezone` to the site's IANA time zone (see Time zone section) so results align to the Wix dashboard; defaults to UTC when omitted. |
| `fields` | Yes | Up to 60 field `name`s from the model schema. |
| `filters` | No | Array of `{ field, values[], condition, prefix }`. `condition` defaults to `EQUAL`, `prefix` defaults to `IS`. For `RANGE_*` conditions provide exactly 2 values. |
| `sort` | No | `{ fieldName, order, nullsLast }`. `order` defaults to `ASC`; field must be `sortable`. `nullsLast` (default `false`) applies only to `DESC` order — set it to `true` when the sorted measure can contain nulls, otherwise nulls sort before real values. |
| `paging` | No | `{ limit, offset }`. Defaults: `limit` 50, `offset` 0. |
| `formattingEnabled` | No | Default `false`. Adds `formattedValue` per cell. |
| `totalsIncluded` | No | Default `false`. Adds a `totals` row. |

### Response shape

```json
{
  "results": [
    {
      "fields": {
        "traffic.referrer_category_name": { "stringValue": "Search", "formattedValue": "Search" },
        "traffic.sessions_count": { "numericValue": 1500, "formattedValue": "1.5K" }
      }
    }
  ],
  "pagingMetadata": { "count": 5, "offset": 0 },
  "totals": { "fields": { "traffic.sessions_count": { "numericValue": 9000 } } }
}
```

Each cell in `results[].fields` is a typed value — one of `numericValue`, `stringValue`, `booleanValue`, `timestampValue`, `arrayValue`, or `objectValue` — plus `formattedValue` when `formattingEnabled` is `true`. `totals` is present only when `totalsIncluded` is `true`.

## Time zone (match the Wix dashboard)

Analytics shown in the Wix business manager are aggregated by the **site's time zone**. To return numbers that match what the site owner sees, pass that time zone in `interval.timezone` on every query. **When `timezone` is omitted, the API defaults to UTC** — which shifts day boundaries and produces totals that don't line up with the dashboard (the same applies to any non-site time zone).

Two independent things both matter, and both use the time zone:

1. **`interval.timezone`** aligns aggregation to the site's local day boundaries. It is not cosmetic — the same `start`/`end` return different totals under different time zones.
2. **`start`/`end` themselves are absolute UTC instants.** To line them up with local calendar days you must send local-midnight-in-UTC — i.e. add the site's UTC offset **for that date** (DST-aware). For `America/New_York`: local midnight is `05:00:00.000Z` in winter (UTC−5) and `04:00:00.000Z` in summer (UTC−4). Sending `...T00:00:00.000Z` with a non-UTC `timezone` starts the range partway through the previous local day and skews the result.

Get the site's time zone from **Get Site Properties**:

```bash
curl -X GET \
  'https://www.wixapis.com/site-properties/v4/properties?fields.paths=timeZone' \
  -H 'Authorization: <AUTH>'
```

The IANA time zone string is returned in `properties.timeZone`:

```json
{
  "properties": {
    "timeZone": "America/New_York"
  }
}
```

Use that value as `interval.timezone` in `Query Semantic Model Data`. The Site Properties `timeZone` reflects the site's primary business address and requires the `SITE_SETTINGS.VIEW` permission.

## Pagination

To retrieve more than 1,000 rows, page through with `offset`:

1. Request page 1 with `paging: { limit: 1000, offset: 0 }`.
2. Increment `offset` by the page size until `pagingMetadata.count` is less than the requested `limit`.

## Handling wrong fields

A field can be "wrong" in three ways — guard against each:

1. **Rejected (`4XX`).** The query fails with a self-explanatory string code (e.g. `fieldIsInvalid`) and, when provided, the model's valid field names. Recovery: read them, pick the correct `name`, and re-query — do **not** retry the rejected name or invent a new one. If no field list is returned, fall back to `Get Semantic Model` (Step 2) and re-read the schema.

2. **Silently omitted (`200`).** The query succeeds but a requested field is **absent from every `results[].fields` entry** (and from `totals`). This happens for unknown field names *and* for fields whose `dependencies` weren't included — **no error is raised.** So **after every query, verify that each name in `fields` actually appears in the results.** If one is missing: re-check its exact `name` via `Get Semantic Model`, add any required `dependencies`, and re-query. Treat a silently-missing field as a failure, not as empty data.

3. **Valid but semantically wrong.** The name exists, so you get `200` and real-looking numbers — but it answers the wrong question (e.g. using `traffic.page_url` instead of `traffic.page_url_from` for per-page traffic, or a field whose `description` says *"Do not use it ever"*). This is the most dangerous case because nothing looks broken. Prevent it in **Step 2**: choose fields by reading each field's `description`, honor "do not use" notes, and never pick by name pattern alone. (This is why List → Get → Query are separate steps — see *Decision flow*.)

Cases 1 and 2 are caught **after** the query by validating the response; case 3 is prevented **before** the query by reading field descriptions when you choose fields.

## Answer from the site's own models — don't ask or call external sources

Analytics questions are answered from the site's **semantic models**, discovered via `List Semantic Models`. This includes data that originates from a third party — e.g. **Google Search / Search Console** metrics (impressions, clicks, CTR, average position, top queries and pages) — which Wix ingests and often enriches with its own site data. So: **do not ask the user whether a source is connected, and do not call the external provider (e.g. Google) directly** — find the matching model and query it. If a query returns no data for the requested period, report that there's no data (the source may not be connected) rather than asking the user to connect first.

## Common Errors

| HTTP | Code | Meaning |
|---|---|---|
| 4XX | `fieldIsInvalid` | A `fields`/`filters[].field`/`sort.fieldName` value doesn't exist in the model, and this query rejected it (some invalid fields are instead silently dropped from a `200` — see *Handling wrong fields*). When present, the error lists the model's **available field names** — pick the correct one and re-query. |
| 401 | `NO_ACCOUNT_IDENTITY` / `UNAUTHENTICATED` | Caller isn't authenticated; provide valid credentials. |
| 404 | `SEMANTIC_MODEL_NOT_FOUND` | The `semanticModelId` doesn't exist for this site. |

Error codes are self-explanatory strings (e.g. `fieldIsInvalid`) — read the code and the fields it returns rather than parsing a fixed body shape. Note: not every invalid field errors; some are silently omitted from a `200` response, so also validate the response (see *Handling wrong fields*).

Silent gap (no error): a requested field returns no data because none of its `dependencies` were included in the query — add a dependency field and re-query.

## Best Practices

1. Always run **List → Get → Query** as three separate calls; read each result before composing the next, and never hardcode or pattern-match field names — read them from `Get Semantic Model`.
2. Pass the site's time zone (`properties.timeZone` from Get Site Properties) in `interval.timezone` **and** set `start`/`end` to local-midnight-in-UTC for that zone (DST-aware) so results match the Wix dashboard. `start`/`end` are absolute instants, not wall-clock.
3. Include a field's `dependencies` in the query, or expect that field to be silently dropped.
4. After each query, validate the response — confirm every requested field appears in `results[].fields`. A wrong field either errors (`4XX`, e.g. `fieldIsInvalid`) or is silently dropped from a `200`; a missing field means an unknown name or a missing dependency. Fix and re-query rather than trusting the partial result. Choose fields by reading their `description` (honoring "do not use" notes), never by name pattern.
5. Use `formattingEnabled: true` for anything shown directly to a user; keep raw values for calculations.
6. Use `totalsIncluded: true` to get period totals alongside a paged breakdown in a single call.
7. Keep `fields` minimal (projection) and paginate large result sets with `offset`.

## Related Documentation

- [Semantic Model API: Introduction](https://dev.wix.com/docs/api-reference/business-management/analytics/semantic-models/introduction)
- [Semantic Model API: Sample Flows](https://dev.wix.com/docs/api-reference/business-management/analytics/semantic-models/sample-flows)
- [List Semantic Models](https://dev.wix.com/docs/api-reference/business-management/analytics/semantic-models/list-semantic-models)
- [Get Semantic Model](https://dev.wix.com/docs/api-reference/business-management/analytics/semantic-models/get-semantic-model)
- [Query Semantic Model Data](https://dev.wix.com/docs/api-reference/business-management/analytics/semantic-models/query-semantic-model-data)
- [Get Site Properties](https://dev.wix.com/docs/api-reference/business-management/site-properties/properties/get-site-properties) (source of the site's `timeZone`)
