---
name: wix-docs-base44
description: "Look up Wix API/SDK documentation from inside the Base44 builder sandbox, where tool results are capped and a whole doc page cannot be returned into context — never guess a Wix endpoint, field, or enum from memory. Fetch the page to disk with exec_tool, map it to line numbers, then read only those lines with read_file. Covers the docs search endpoints (semantic markdown and JSON), the menu browse endpoint, the API spec index, the .md suffix that turns a multi-megabyte HTML shell into markdown, and how to establish that an API does NOT exist. Triggers: look up a Wix API in a Base44 app, find the Wix endpoint or field, confirm a Wix request body, check whether Wix supports something, read Wix docs from the sandbox."
---

# Wix Docs from the Base44 sandbox

Get the exact truth about a Wix API — endpoint, HTTP verb, request/response shape, a field, an enum,
an error. **Never invent a Wix endpoint, path, body, or enum from memory.**

This is the [`wix-docs`](../wix-docs/SKILL.md) flow — find the right page, then read it — adapted to
the Base44 builder sandbox, where the shell-pipeline lane does not apply. Tool results here are
capped at roughly 5000 characters, so a doc page pulled straight into a result is clipped at the
point you needed it. A file has no such cap.

**So documents go to disk.** `exec_tool` fetches and returns only `{path, bytes}`; `read_file` then
pages through the file with `offset`/`limit`. Nothing large crosses a tool boundary. Fetching once to
a file also means the map-then-read step below costs no extra network round trip.

Work inside `src/scratch/`. One `exec_tool` call per round — never two, they share the sandbox and
can both time out — and each has a 10s budget, so one fetch per call. `exec_tool` must never return
document text.

Keep that directory small. A few hundred KB per doc is normal; filling it with megabytes starves the
sandbox sync that makes new files visible to `read_file` at all, and reads start failing.

## 1. Find the page

Four ways in. All take a **plain docs URL** — never put a `.md` URL in an endpoint payload.

Shared search body: `search_term` (required, natural language, 1–500 chars), `document_type`
(`REST` default · `SDK` · `WIX_HEADLESS` · `BUSINESS_SOLUTIONS` · `VELO` · `WDS` · `BUILD_APPS` ·
`CLI`), `maximum_results` (1–20, default 15), `lines_in_each_result` (1–200, default 20 — the size
lever: at 5 lines a 5-result query returns ~4.7 KB, at 200 lines ~20 KB).

**A. Semantic search, readable — start here for "how do I call X?"**
`POST https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown` returns
`{"content": "<one markdown string>"}` — condensed method docs carrying the endpoint, real request
examples, the response shape and the description. Often the whole answer in one call.

```js
const fs = require('fs');
const path = require('path');
const dir = path.join(process.cwd(), 'src', 'scratch');
fs.mkdirSync(dir, { recursive: true });

const resp = await fetch('https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    search_term: 'cancel a booking and refund the customer',
    document_type: 'REST',
    maximum_results: 5,
    lines_in_each_result: 20,
  }),
});
const { content } = await resp.json();
const file = path.join(dir, 'search-1.md');
fs.writeFileSync(file, content);

// hand the URLs back now, so the next round can fetch without reading the file first
const urls = [...new Set(content.match(/https:\/\/dev\.wix\.com\/docs\/[^\s)"'\]]+/g) || [])];
return { path: 'src/scratch/search-1.md', bytes: fs.statSync(file).size, urls };
// → { bytes: 10738, urls: [ '…/bookings/bookings-writer-v2/cancel-booking', … 11 total ] }
```

**B. Semantic search, structured — to route programmatically**
`POST https://www.wixapis.com/mcp-docs-search/v1/docs/search` returns
`{"results":[{title, url, content, relevance_score, …}]}`. Method hits carry a `url`; article hits
keep their link inside `content`. Return titles and URLs only.

**C. Browse the tree — deterministic, and how you learn what exists**
`POST https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse`. Body: `menu_url` (absolute docs
URL; omit for the portal root), `document_type` (`REST`), `depth` (1, max 6), `include`
(`CATEGORY`·`RESOURCE`·`METHOD`·`ARTICLE`·`WEBHOOK`·`OBJECT`·`SKILL`), `name_filter`, `deprecated`
(`HIDE`·`SHOW`·`ONLY`), `format` (`MARKDOWN` → `content` · `STRUCTURED` → JSON). Every child comes
back with its kind, HTTP verb and subtree counts, in ~2 KB:

```
Blog: 39 methods, 16 webhooks, 12 articles, 5 resources, 5 objects, 2 skills
- Draft Posts (resource) — 14 methods, 3 webhooks, 2 articles, 1 object
  - Bulk Create Draft Posts (POST)
  - Update Draft Post (PATCH)  …
```

`include:["METHOD"]` with `name_filter` jumps straight to the methods you want. REST reference only.

**D. Query the API spec index — exact schemas, or filtering across every method**
`POST https://mcp.wix.com/api/code-mode/search` with `{"code":"async function(){ … }"}`. In scope:
`lightIndex` (every REST resource and method, with `operationId`, `httpMethod`, `menuPath`,
`docsUrl`, `publicUrl`) and `getResourceSchemaByUrl(docsUrl)`. The response is wrapped in
`{"result": …}`.

This is the call that answers "does this API exist?" — one round returns a resource's entire method
list. Match on the entry's `docsUrl`, **not** on `operationId`: an `operationId` is fully qualified
(`wix.bookings.catalog.v1.ServiceOptionsAndVariantsService.CreateServiceOptionsAndVariants`), so
filtering it by a resource name silently returns almost nothing.

```js
const fn = `async function(){
  const r = lightIndex.find(x => /bookings-writer-v2/i.test(x.docsUrl || ''));
  return { docsUrl: r.docsUrl, methods: r.methods.map(m => m.operationId.split('.').pop()) };
}`;
const resp = await fetch('https://mcp.wix.com/api/code-mode/search', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: fn }),
});
const { result } = await resp.json();   // note the { result: … } wrapper
return result;
// → methods: [ 'CreateBooking', 'CancelBooking', 'RescheduleBooking',
//              'CancelBookingAnonymously', 'RescheduleMultiServiceBooking', … ]
```

Filter narrowly and return only the fields you need — an unfiltered dump is enormous. For an exact
request/response schema or an enum's values, call `getResourceSchemaByUrl(docsUrl)` in the same way
instead of slicing markdown. Prefer the whole resource over a single method: a requirement is often
documented on a *sibling* method, such as a field required on single-create but absent from the
bulk-create page.

### Search ranks, it does not match

The search endpoints always return their best guesses and **never report "no match"**. A nonsense
query comes back with a confident, irrelevant page, and the scores barely discriminate — for
`"schedule blog draft post"` a *Marketing* API (`marketing-plan/schedule-drafts`, score 0.667)
outranks every Blog result. Two consequences:

- Read the product and namespace in each URL and drop hits from outside the product you were asked
  about. A plausible method name from the wrong vertical is the most common wrong answer.
- **Search results are never evidence that something does not exist.** To establish absence,
  enumerate with C or D — browse the resource's methods, or filter `lightIndex` — and say what you
  enumerated.

Worth a look per vertical: the `skills` nodes (`…/business-solutions/<vertical>/skills`) hold recipe
and flow pages giving multi-step ordering and cross-step gotchas that no single method page mentions.

## 2. Fetch the page

**Append `.md` to every `https://dev.wix.com/docs/` URL.** The portal serves the markdown source that
way; without the suffix you get an HTML app shell with no content in it:

```
create-draft-post      5,325,977 bytes   HTML shell, useless
create-draft-post.md     414,150 bytes   markdown
```

Add `?apiView=SDK` for a page's SDK view. Every docs path has a `.md` twin, so you can also walk the
tree by hand: `https://dev.wix.com/docs/llms.txt` is the root map, and under it sit
`api-reference.md` (all backend/business APIs — the main one), `sdk.md` (client setup, core/host/
frontend modules), `go-headless.md`, `build-apps.md`, `wix-cli.md`, `velo.md`. Truncate a path to go
up, extend it to go down.

One `exec_tool` call per document:

```js
const fs = require('fs');
const path = require('path');
const url = 'https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings/bookings-writer-v2/cancel-booking';

const resp = await fetch(url + '.md');          // the suffix is what makes it markdown
const body = await resp.text();
const file = path.join(process.cwd(), 'src', 'scratch', 'cancel-booking.md');
fs.writeFileSync(file, body);
return { path: 'src/scratch/cancel-booking.md', bytes: fs.statSync(file).size, status: resp.status };
// → { bytes: 76170, status: 200 }
```

Three kinds of page come back, and they want different handling:

| kind | what it is | how to read it |
|---|---|---|
| **Menu** | a section path — a list of child links, tens of KB | map it for the child you want; never whole |
| **Article** | introduction, concept, sample flow — prose, small | read it whole |
| **Method** | one API method: REST *and* SDK sections, full schemas, examples — hundreds of KB | map first, then read the window |

## 3. Locate before you read

Method pages run to thousands of lines and repeat themselves: the same field name appears in the REST
schema, the SDK schema and the code examples, with different types and different meanings. Paging
blind is slow, and it is how you end up quoting the SDK when you were asked about REST.

So spend one `exec_tool` call mapping the file before reading any of it — matching lines *and* the
section headers, so you can tell which section each hit sits in. Return the match list, never the
body, and cap it so the result itself stays under the limit:

```js
const fs = require('fs');
const path = require('path');
const file = path.join(process.cwd(), 'src', 'scratch', 'cancel-booking.md');
const lines = fs.readFileSync(file, 'utf8').split('\n');
const term = /refund|flowControl|participantNotification/i;

const hits = [];
lines.forEach((text, i) => {
  if (/^#{1,3} /.test(text) || term.test(text)) hits.push({ line: i + 1, text: text.trim().slice(0, 100) });
});

// Budget the RESULT, not the hit count — a wide term set overflows the cap and
// the tail is silently clipped, which is the failure this whole flow exists to avoid.
const MAX = 3500;
let used = 0;
const shown = [];
for (const h of hits) {
  const n = h.text.length + 20;
  if (used + n > MAX) break;
  shown.push(h);
  used += n;
}
return { file: 'src/scratch/cancel-booking.md', lines: lines.length,
         shown: shown.length, omitted: hits.length - shown.length, hits: shown };
```

`omitted` is the point: if it comes back non-zero, narrow the term and map again rather than reading
on with a list you cannot see the end of. On this page a nine-term map produces 81 hits — 7,069
characters raw, clipped at 5,000 with no marker inside the JSON — while the budgeted version returns
3,630 characters and tells you 37 were left out.

```
lines: 431, 25 hits
  26  ## REST API
  28  ### Schema
  40  - name: withRefund | type: boolean | description: Whether to issue a refund when canceling…
 140  - name: status | type: BookingStatus | description: Booking status…
 154  -     REFUNDED: The booking is refunded.
```

That is the answer, in one round, with the section it belongs to — where blind paging would have
taken ten. Then `read_file` with `offset`/`limit` around the lines that matter, widening only as
needed, and confirm which section your line falls in before quoting it.

## 4. Answer

Cite the file and line for each claim, and name the product the page belongs to.

Distinguish three outcomes plainly: the docs show this; the docs show something adjacent that is not
the same thing; or you enumerated the resource's methods and none of them do this. The third is a
real answer — give it, and say what you enumerated. Never infer an endpoint, field or enum from a URL
pattern, from a similar API in another Wix product, or from a search snippet you did not open.

## Going deeper

The [`wix-docs`](../wix-docs/SKILL.md) skill carries the shared references — a pruned map of the docs
tree and per-section slicing recipes in `references/EXTRACTING.md`, and the full `lightIndex` /
`getResourceSchemaByUrl` example set in `references/API_SPEC_SEARCH.md`. The endpoints are the same;
only the transport differs.
