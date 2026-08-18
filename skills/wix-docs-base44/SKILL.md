---
name: wix-docs-base44
description: "Look up Wix API/SDK documentation from inside the Base44 builder sandbox, where tool results are capped and a whole doc page cannot be returned into context — never guess a Wix endpoint, field, or enum from memory. A bundled module (scripts/docs.js, run via exec_tool) does the mechanics: browse the docs tree, search, fetch pages to disk as markdown, map them to line numbers, read only those lines with read_file, and enumerate a resource's methods to establish that an API does NOT exist. Triggers: look up a Wix API in a Base44 app, find the Wix endpoint or field, confirm a Wix request body, check whether Wix supports something, read Wix docs from the sandbox."
---

# Wix Docs from the Base44 sandbox

Get the exact truth about a Wix API — endpoint, HTTP verb, request/response shape, a field, an enum,
an error. **Discover everything: every endpoint, path, doc URL, body and enum comes from this
skill's tools, never from training, memory, or pattern.** A URL you composed and a path you
remembered are guesses even when they look right — and a 404 or an empty result means discover,
not permute.

This is the [`wix-docs`](../wix-docs/SKILL.md) flow — find the right page, then read it — for a
sandbox with no shell pipeline and a ~5,000-char cap on tool results. Documents therefore live on
disk — in the skill's own scratch folder, `.agents/skills/wix-docs-base44/scratch/`: `exec_tool` fetches and returns only facts about the bytes; `read_file`
(45,000-char budget, real paging) reads the bytes. Nothing large ever crosses a tool boundary.

## The module

The mechanics live in **`scripts/docs.js`** — byte budgets, the `.md` suffix, the filtered-browse
rule, the `docsUrl` match. Call it rather than hand-rolling the requests; every function either
answers inline under the cap or saves into the scratch folder and returns `{ path, bytes }` —
a workspace-relative path you pass to `read_file` exactly as returned.

Load it in `exec_tool` like this (`require()` can return empty exports for build-time files):

```js
const fs = require("fs");
const docs = (() => { const m = { exports: {} };
  new Function("module", "exports", "require",
    fs.readFileSync("/app/.agents/skills/wix-docs-base44/scripts/docs.js", "utf8"))(m, m.exports, require);
  return m.exports; })();
```

(The module must be on disk first — `bootstrap.md` is the paste-ready bootstrap that installs
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
| `await docs.specQuery("async function(){…}")` | read schemas: your own query over the spec index | `{ result }` inline, or `{ path, bytes }` if big |
| `await docs.callApi({ url, token, body })` | run a call you read the contract for | `{ status, json }`, or clipped `text` + `truncated` |

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
// → { path: ".agents/skills/wix-docs-base44/scratch/search-1.md", bytes: 10738, urls: [ … ] }
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
// → { path: ".agents/skills/wix-docs-base44/scratch/cancel-booking.md", bytes: 76170, status: 200 }
```

The module appends **`.md`** — the suffix that makes the portal serve markdown instead of a
multi-megabyte HTML shell (`create-draft-post`: 5,325,977 bytes as HTML, 414,150 as `.md`). Keep
the scratch folder in the hundreds of KB: filling it with megabytes starves the sandbox sync that makes
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
never matches them.

**Reading a schema is `specQuery`.** Two globals are in scope, and knowing their shape is the
difference between an answer and a silent `[]`:

```typescript
lightIndex: Array<{             // RESOURCES, not methods
  name: string                  // "Cart"
  docsUrl: string               // the resource page
  menuPath: string[]            // ["business-solutions", "e-commerce", "purchase-flow", "cart"]
  methods: Array<{
    operationId: string         // fully qualified: "com.wix.ecom…CartService.AddToCurrentCart"
    summary: string; httpMethod: string
    path: string                // PARTIAL ("/v1/carts/current/add-to-cart") — never call it
    publicUrl: string           // "https://www.wixapis.com/ecom/v1/carts/current/add-to-cart" — call THIS
    docsUrl: string
  }>
}>
getResourceSchemaByUrl(docsUrl)  // full schema; API pages only — skill/article pages have none
```

`specQuery` is an **inspect** tool, not discovery: arrive with a `docsUrl` from browse or search,
find the entry **by docsUrl**, then read. Substring-filtering `lightIndex` by name has no ranking
and misses methods whose resource is named after a different noun — an empty result means the query
missed the shape, not that the API is absent.

The endpoint to call is always `publicUrl` — `path` is a fragment. When a call 404s, this one
round replaces guessing path variants:

```js
await docs.specQuery(`async function(){
  const r = lightIndex.find(x => x.docsUrl ===
    "https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/purchase-flow/cart");
  return r.methods.map(m => ({ op: m.operationId.split(".").pop(),
                               verb: m.httpMethod, call: m.publicUrl }));
}`)
// → { op: "AddToCurrentCart", verb: "post",
//     call: "https://www.wixapis.com/ecom/v1/carts/current/add-to-cart" }
```

Schemas are huge, so return the slice you need and **iterate** — each call is one round; refine the
query instead of returning more. A method's request fields, names and types only:

```js
await docs.specQuery(`async function(){
  const u = "https://dev.wix.com/docs/api-reference/business-solutions/blog/draft-posts/create-draft-post";
  const s = await getResourceSchemaByUrl(u);
  const m = s.methods.find(x => x.docsUrl === u);
  const props = m.requestBody.content["application/json"].schema.properties;
  return Object.entries(props).map(([k, v]) => k + ": " + (v.type || v.$circular || "object"));
}`)
// → ["draftPost: object", "publish: boolean", "fieldsets: array"]
```

Next round, drill into the object you care about; a field typed `{ "$circular": "<name>" }` is a
repeated type stored once — resolve it with `s.components.schemas["<name>"]`, returning only its
field names and types.

The same door answers anything the canned calls can't — enum values, comparing two methods'
fields, filtering across every API. Check the *sibling* methods too: a requirement is often
documented on single-create but absent from the bulk-create page.

## 5. Answer

Cite the file and line for each claim, and name the product the page belongs to.

Distinguish three outcomes, plainly: the docs show this; the docs show something adjacent that is
not the same thing; or you enumerated the resource's methods and none of them do this. The third is
a real answer — give it, and say what you enumerated. Never infer an endpoint, field or enum from a
URL pattern, from a similar API in another Wix product, or from a search snippet you did not open.

## 6. From docs to calls

The docs were the map; `docs.callApi` is the territory — it runs the contract you just read.
API responses are site data, so they stay out of scratch: small ones come back inline, an
oversized one comes back clipped with `truncated: true` — narrow the call (filters, cursor paging,
fewer fields) rather than re-request the same size.

Two identities, and which one a call wants is part of what you read:

| identity | token | for |
|---|---|---|
| **admin** | the app's Wix connector | managing the site — ad hoc from `exec_tool`, or the same fetch inside a backend function |
| **visitor** | minted in the app's client code | everything the site's end user does — storefront reads, cart, checkout |

**Admin — the connector is the token.** Any management or read call from its docs contract:

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
return await docs.callApi({
  url: "https://www.wixapis.com/stores/v3/products/query",   // from the page you just read
  token: accessToken,
  body: { query: { cursorPaging: { limit: 10 } } },
});
```

**Visitor — minted from the OAuth app's client id, in the client.** The client id is a public
value (it lives in a committed config file); the mint is one unauthenticated call, so it belongs
in the app's own frontend code, straight from the docs contract:

```js
// src/lib/wixClient.js — app code, not exec_tool
const res = await fetch("https://www.wixapis.com/oauth2/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ clientId: WIX_CLIENT_ID, grantType: "anonymous" }),
});
const { access_token } = await res.json();   // bearer for products, cart, checkout
```

The cart and checkout APIs act on the *caller's* identity, so they want the visitor token — the
admin token is for managing the site, the visitor token is for being on it.

The authentication docs, all fetchable with `docs.fetchDoc`:

- `api-reference/articles/authentication/about-identities` — the identity model
- `api-reference/articles/authentication/rest-api-authentication` — headers, token kinds
- `business-management/headless/authentication/retrieve-tokens` — the /oauth2/token contract, all grant types
- `go-headless/authentication/about-authentication` — visitor vs member sessions
- `go-headless/getting-started/setup/authentication/create-an-oauth-app-for-visitors-and-members` — where the client id comes from
- `go-headless/authentication/setup/set-up-a-headless-client` — wiring the client

## 7. Special APIs worth knowing

**Dynamic Site Context — "what IS this site?"** One admin call returns a markdown report of the
whole site: installed apps, status, URL, locale.

```js
await docs.callApi({
  url: "https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown",
  token: accessToken,
  body: {},            // siteId optional — site token returns that site; account token returns up to 10,
                       // each with its ID, so you can call again with { siteId } to target one
})
```

The report can be large — expect `truncated: true` on content-rich sites. And a `200` with
`{"markdown": ""}` means the token or `siteId` is wrong — the endpoint reports an empty context
instead of an auth error, so treat empty as "check auth", never as "empty site".

For site management, the **`wix-manage`** skill carries per-area recipes. It may already be
installed at
`.agents/skills/wix-manage/`; install it with `npx -y skills add wix/skills/skills/wix-manage`,
or read it straight off the registry: `https://www.wix.com/skills/wix-manage`.

## The raw endpoints (what the module wraps)

| endpoint | function |
|---|---|
| `POST https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse` | `browse` — body: `menu_url`, `include`, `name_filter`, `depth` (1–6), `deprecated`, `format` |
| `POST https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown` | `search` — body: `search_term`, `document_type`, `maximum_results` (1–20), `lines_in_each_result` (1–200) |
| `GET https://dev.wix.com/docs/…?.md` | `fetchDoc` — every docs path has a `.md` twin; `https://dev.wix.com/docs/llms.txt` is the root map; `?apiView=SDK` for the SDK view |
| `POST https://mcp.wix.com/api/code-mode/search` | `methodsOf` / `specQuery` — `{ code: "async function(){…}" }` with `lightIndex` and `getResourceSchemaByUrl(docsUrl)` in scope; response wrapped in `{ result }` |

There is also a structured search (`POST …/v1/docs/search`, same body → `{ results: [{ title, url,
relevance_score }] }`) when you want to route on hits programmatically.

## Going deeper

The [`wix-docs`](../wix-docs/SKILL.md) skill carries the shared references — a pruned map of the docs
tree and per-section slicing recipes in `references/EXTRACTING.md`, and the full `lightIndex` /
`getResourceSchemaByUrl` example set in `references/API_SPEC_SEARCH.md`. The endpoints are the same;
only the transport differs.
