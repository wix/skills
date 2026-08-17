---
name: wix-docs-base44
description: "Look up Wix API/SDK documentation from inside the Base44 builder sandbox, where tool results are capped and a whole doc page cannot be returned into context — never guess a Wix endpoint, field, or enum from memory. A bundled module (scripts/docs.js, run via exec_tool) does the mechanics: browse the docs tree, search, fetch pages to disk as markdown, map them to line numbers, read only those lines with read_file, and enumerate a resource's methods to establish that an API does NOT exist. Triggers: look up a Wix API in a Base44 app, find the Wix endpoint or field, confirm a Wix request body, check whether Wix supports something, read Wix docs from the sandbox."
---

# Wix Docs from the Base44 sandbox

Get the exact truth about a Wix API — endpoint, HTTP verb, request/response shape, a field, an enum,
an error. **Never invent a Wix endpoint, path, body, or enum from memory.**

This is the [`wix-docs`](../wix-docs/SKILL.md) flow — find the right page, then read it — for a
sandbox with no shell pipeline and a ~5,000-char cap on tool results. Documents therefore live on
disk in `src/scratch/`: `exec_tool` fetches and returns only facts about the bytes; `read_file`
(45,000-char budget, real paging) reads the bytes. Nothing large ever crosses a tool boundary.

## The module

The mechanics live in **`scripts/docs.js`** — byte budgets, the `.md` suffix, the filtered-browse
rule, the `docsUrl` match. Call it rather than hand-rolling the requests; every function either
answers inline under the cap or writes to `src/scratch/` and returns `{ path, bytes }`.

Load it in `exec_tool` like this (`require()` can return empty exports for build-time files):

```js
const fs = require("fs");
const docs = (() => { const m = { exports: {} };
  new Function("module", "exports", "require",
    fs.readFileSync("/app/src/scratch/docs.js", "utf8"))(m, m.exports, require);
  return m.exports; })();
```

(The module must be on disk first — `platforms/base44.md` is the paste-ready bootstrap that installs
this skill into the app via `npx skills add`; after it runs, the path is
`/app/.agents/skills/wix-docs-base44/scripts/docs.js`.)

| call | does | returns |
|---|---|---|
| `await docs.browse({ menuUrl, nameFilter, include, depth })` | walk the docs tree | `{ content }` inline, or `{ path, bytes }` if big |
| `await docs.search(term, { type, max, lines })` | semantic search → disk | `{ path, bytes, urls }` |
| `await docs.fetchDoc(url, slug?)` | one page → disk as markdown | `{ path, bytes, status }` |
| `docs.mapTerms(slug, /regex/i)` | line numbers of matches + section headers | `{ lines, shown, omitted, rows }` |
| `docs.sections(slug)` | the outline, with `read_file` coordinates | `{ lines, shown, omitted, rows }` |
| `await docs.methodsOf("resource-pattern")` | every method of a resource, from the spec index | `{ resources, rows }` |
| `await docs.methodSchema(docsUrl, slug?)` | one method's exact schema → disk | `{ path, bytes, publicUrl, httpMethod }` |

One `exec_tool` call per round, never two. The default timeout is 10s; pass `timeout` (up to 120)
for a single large fetch. `exec_tool` must never return document text — that is the module's
invariant too.

If a response shape surprises you, read `docs.js` itself — the functions are thin wrappers over
four endpoints, each documented below — and hand-roll the one call. Never guess.

## 1. Find the page

**Know the product? Browse.** Deterministic — no ranking, no wrong-product noise.

```js
await docs.browse({ menuUrl: "https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings",
                    include: ["METHOD"], nameFilter: "resched", depth: 4 })
// → inline: Reschedule Booking (POST), Reschedule Booking Anonymously (POST), … with doc URLs
```

Drill by counts, never enumerate a vertical's methods: orient first (`{ menuUrl }` alone — children
with subtree counts, ~1.3 KB for all of Restaurants), then filter. An unfiltered
`include: ["METHOD"]` over a vertical is ~30 KB; the module writes it to disk instead of letting it
clip. Use a `menuUrl` a previous response gave you — a composed path (`…/restaurants/orders` for
what is actually `online-orders`) returns `{ exists: false }` with the API's own error; re-orient a
level up instead of retrying variants.

**Don't know where it lives? Search.**

```js
await docs.search("cancel a booking and refund the customer")
// → { path: "src/scratch/search-1.md", bytes: 10738, urls: [ …/cancel-booking, … ] }
```

`type` (default `REST`): `SDK` · `WIX_HEADLESS` · `BUSINESS_SOLUTIONS` · `VELO` · `WDS` ·
`BUILD_APPS` · `CLI`. Read the saved file, then **switch to browsing the subtree a hit names**.

**Search ranks, it does not match.** It always returns its best guesses and never reports "no
match" — a nonsense query comes back with a confident, irrelevant page, and scores barely
discriminate ("schedule blog draft post" ranks a *Marketing* API above every Blog result). Drop
hits from outside the product you were asked about, and **never treat search results as evidence
that something does not exist** — that takes enumeration (below).

Worth a look per vertical: the `skills` nodes (`…/business-solutions/<vertical>/skills`) hold
recipe and flow pages giving multi-step ordering no single method page mentions.

## 2. Fetch the page

```js
await docs.fetchDoc("https://dev.wix.com/docs/…/bookings-writer-v2/cancel-booking")
// → { path: "src/scratch/cancel-booking.md", bytes: 76170, status: 200 }
```

The module appends **`.md`** — the suffix that makes the portal serve markdown instead of a
multi-megabyte HTML shell (`create-draft-post`: 5,325,977 bytes as HTML, 414,150 as `.md`). Keep
`src/scratch/` in the hundreds of KB: filling it with megabytes starves the sandbox sync that makes
new files visible to `read_file`, and reads start failing.

Menu pages (child links) and articles (small prose) can be read whole. Method pages are the heavy
ones — hundreds of KB, REST *and* SDK halves — map before reading.

## 3. Locate before you read

Method pages repeat every field name across the REST schema, the SDK schema and the examples, at
different types. Map first, then read windows:

```js
docs.mapTerms("cancel-booking", /refund/i)
// → { lines: 431, shown: 25, omitted: 0, rows: [
//     { line:  40, text: "- name: withRefund | type: boolean | …" },
//     { line:  26, text: "## REST API" }, …
```

`omitted > 0` means the map itself would have overflowed the cap — narrow the regex and map again;
never read on past a tail you cannot see.

Don't know what to grep? Get the outline with `read_file` coordinates precomputed:

```js
docs.sections("cancel-booking")
```

```
## Introduction                offset  19, limit   6    ← each row is a read_file call
## REST API                    offset  25, limit   2    limit ≤ 3 = container, read its children
   ### Schema                  offset  27, limit 176    the entire REST schema, exactly
   ### Examples                offset 203, limit   2    (container)
      ### Cancel a booking     offset 205, limit  16    English title = REST curl example
## JavaScript SDK              offset 221, limit   2    ┐ the OTHER half — same field
   ### Schema                  offset 223, limit 176    ┘ names, different types
   ### Examples                offset 399, limit   2    (container)
      ### cancelBooking        offset 401, limit   9    camelCase = SDK snippet
```

Know which `##` you are under before quoting anything.

## 4. Establish absence

To say an API does not exist, enumerate — and say what you enumerated:

```js
await docs.methodsOf("bookings-writer-v2")
// → { resources: [ …/bookings-writer-v2 ], shown: 29, rows: [
//     { op: "CancelBooking", verb: "post" }, { op: "RescheduleBooking", verb: "post" }, … ] }
```

This queries the API spec index and matches the resource's `docsUrl` — `operationId`s are fully
qualified (`wix.bookings.catalog.v1.…Service.CreateServiceOptionsAndVariants`), so a resource name
never matches them. For one method's exact request/response schema or enum values,
`docs.methodSchema(docsUrl)` writes it to disk as JSON — prefer it over slicing markdown, and check
the *sibling* methods too: a requirement is often documented on single-create but absent from the
bulk-create page.

## 5. Answer

Cite the file and line for each claim, and name the product the page belongs to.

Distinguish three outcomes, plainly: the docs show this; the docs show something adjacent that is
not the same thing; or you enumerated the resource's methods and none of them do this. The third is
a real answer — give it, and say what you enumerated. Never infer an endpoint, field or enum from a
URL pattern, from a similar API in another Wix product, or from a search snippet you did not open.

## The raw endpoints (what the module wraps)

| endpoint | function |
|---|---|
| `POST https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse` | `browse` — body: `menu_url`, `include`, `name_filter`, `depth` (1–6), `deprecated`, `format` |
| `POST https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown` | `search` — body: `search_term`, `document_type`, `maximum_results` (1–20), `lines_in_each_result` (1–200) |
| `GET https://dev.wix.com/docs/…?.md` | `fetchDoc` — every docs path has a `.md` twin; `https://dev.wix.com/docs/llms.txt` is the root map; `?apiView=SDK` for the SDK view |
| `POST https://mcp.wix.com/api/code-mode/search` | `methodsOf` / `methodSchema` — `{ code: "async function(){…}" }` with `lightIndex` and `getResourceSchemaByUrl(docsUrl)` in scope; response wrapped in `{ result }` |

There is also a structured search (`POST …/v1/docs/search`, same body → `{ results: [{ title, url,
relevance_score }] }`) when you want to route on hits programmatically.

## Going deeper

The [`wix-docs`](../wix-docs/SKILL.md) skill carries the shared references — a pruned map of the docs
tree and per-section slicing recipes in `references/EXTRACTING.md`, and the full `lightIndex` /
`getResourceSchemaByUrl` example set in `references/API_SPEC_SEARCH.md`. The endpoints are the same;
only the transport differs.
