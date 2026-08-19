# Building on Wix from Base44

The Wix connector is connected; this is how the app gets built on it — gather the site's context,
find the APIs and learn their contracts from the docs, write the code. **Discover everything**: endpoints, paths, doc URLs,
request and response fields all come from the calls below, never from memory or pattern. 404 or
empty ⇒ discover, not permute. Examples teach mechanics and go stale — verify before relying.

## What are you building?

The app's audience picks the token, and the token picks the architecture: the **visitor token is
public** — anyone can mint it from the site's `clientId` — and the **admin token is a secret**,
the connector's, server-side only.

```
browser            ──(visitor token)─► wixapis.com   the visitor's own reads & actions
base44/functions/* ──(admin token)───► wixapis.com   work that needs the owner's identity
exec_tool          ──(admin token)───► wixapis.com   you: ad hoc probing/managing while building
```

**A site for visitors** — storefront, blog, booking. Headless means the Wix site has no pages of
its own: your app IS its frontend, and it calls Wix from the browser. Every call the visitor token
can make lives in the client — one file, `src/lib/wixClient.js` (Write the code, below).
`base44/functions/*` hold the work that needs the owner's identity — elevated-permission ops a
visitor triggers, webhooks, scheduled jobs — and the app's non-Wix backend.

**An admin tool for the owner** — dashboard, back office. The pages act as the owner, whose token
is a secret: `pages → base44/functions/* ──(admin token)──► wixapis.com`.

## Gather context — the dynamic context report

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const r = await fetch("https://www.wixapis.com/_api/dynamic-context/v1/dynamic-context/markdown", {
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({}),   // the connector token is site-bound; siteId filter is optional
});
const { markdown } = await r.json();   // big? extract a section, don't page blind:
const apps = (markdown.match(/### Apps[\s\S]*?(?=\n### |$)/) || [markdown.slice(0, 3500)])[0];
return { total: markdown.length, apps: apps.slice(0, 3500) };
```

One report: installed apps **with ids** (incl. Stores' catalog version — V1 vs V3 decides its
endpoints), the OAuth app id (**also the visitor `clientId`**), locale, currency, CMS collections.
`markdown: ""` = bad token, never an empty site.

## Learn Wix — find the APIs, learn their contracts

Research runs in exec_tool, and every research call is **fetch → reduce in memory → return
≤ 4,000 chars** (results clip at ~5,000). Nothing is written to disk; state between rounds =
re-fetching (~1s). **Fetch every URL inside exec with `fetch()`** — website/browser tools clip at
10,000 chars silently. Return facts, not documents; a big result returns a count of what was left
out. One exec per round; timeout 10s, up to 120 via `{timeout}`. Clip guard for any big return:
`const s = JSON.stringify(out); return s.length > 4000 ? { truncated: true, total: s.length, head: s.slice(0, 4000) } : out;`

### Find what to read

**Know the product? Browse (deterministic).** Orient with counts, then filter — unfiltered
listings clip:

```js
const r = await fetch("https://www.wixapis.com/mcp-docs-search/v1/docs/menu/browse", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    menu_url: "https://dev.wix.com/docs/api-reference/business-solutions/bookings/bookings",
    include: ["METHOD"], name_filter: "resched", depth: 4,   // orient first: menu_url alone
  }),
});
return (await r.json()).content;   // null/404 ⇒ not a docs node — re-orient a level up
```

**Don't know where it lives? Search (ranks, never matches).** Each hit is a condensed method
doc. Reduce per hit, keeping the riches:

```js
const r = await fetch("https://www.wixapis.com/mcp-docs-search/v1/docs/search/markdown", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ search_term: "pause a pricing plan subscription and resume it",
    document_type: "REST",   // or SDK | WIX_HEADLESS | VELO | CLI
    maximum_results: 5, lines_in_each_result: 6 }),
});
const { content } = await r.json();
const hits = content.split(/\n---\n+(?=#### )/).map(b => ({
  method:   (b.match(/^# Method: (.+)$/m) || [])[1],
  endpoint: (b.match(/^# Method API Endpoint: (.+)$/m) || [])[1],   // callable
  docsUrl:  (b.match(/#### \[[^\]]+\]\((https:[^)]+)\)/) || [])[1],
  gist: ((b.match(/## Method Description:\s*\n([\s\S]{0,400})/) || [])[1] || "").trim().replace(/\s+/g, " ").slice(0, 220),
})).filter(h => h.docsUrl);
return { total: content.length, hits };   // hits often ARE the answer
```

Go deeper for fields, enums, or absence — only the spec index proves absence. Drop
wrong-product hits.

### Read a doc page — fetch + map in one exec

Always append **`.md`** (without it: a multi-MB HTML shell). Method pages are 100 KB+, twin REST
and SDK halves repeating field names at different types — never return the page, map it:

```js
const url = "https://dev.wix.com/docs/…/cancel-booking";   // from browse/search output
const res = await fetch(url.replace(/\.md$/, "") + ".md");
if (!res.ok) return { status: res.status, hint: "not a docs page — take URLs from output, don't compose" };
const lines = (await res.text()).split("\n");
const hits = [];
lines.forEach((text, i) => {
  if (/^#{1,3} /.test(text) || /refund/i.test(text))   // headers always; term of interest
    hits.push({ line: i + 1, text: text.trim().slice(0, 100) });
});
return { lines: lines.length, shown: Math.min(hits.length, 40),
         omitted: Math.max(0, hits.length - 40), hits: hits.slice(0, 40) };
```

`omitted > 0` ⇒ narrow, map again. Headers say which `##` half each hit is in — quote only yours.
No term = the outline; header-to-header = section windows.

**Window the REST example FIRST** — under `### Examples` below `## REST API` sits a complete
working request (URL, headers, body): usually all you need. Window it with the same
fetch, sliced to the map's line numbers: `lines.slice(a, b).map((t, i) => (a + 1 + i) + ": " + t.slice(0, 110)).join("\n")`.

### The spec index — endpoints, exact schemas

`POST https://mcp.wix.com/api/code-mode/search` with `{ code: "async function(){…}" }` → `{ result }`.
In scope:

```typescript
lightIndex: Array<{   // RESOURCES, not methods
  name; docsUrl; menuPath: string[]
  methods: Array<{ operationId,   // fully qualified — never filter by resource name on it
    summary, httpMethod,
    path,        // PARTIAL — never call it
    publicUrl,   // the callable https://www.wixapis.com/… URL — call THIS
    docsUrl }> }>
getResourceSchemaByUrl(docsUrl)   // full schema; API method pages only
```

The index answers questions about pages you already found — arrive with a `docsUrl`, match by it.
A resource's methods with callable URLs — also the only proof an API does NOT exist:

```js
const r = await fetch("https://mcp.wix.com/api/code-mode/search", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ code: `async function(){
    const r = lightIndex.find(x => x.docsUrl ===
      "https://dev.wix.com/docs/api-reference/crm/members-contacts/contacts/contacts-v5");
    return r.methods.filter(m => /query/i.test(m.summary))
                    .map(m => ({ op: m.operationId.split(".").pop(),
                                 verb: m.httpMethod, call: m.publicUrl }));
  }` }),
});
return (await r.json()).result;
```

Request fields: same wrapper, `getResourceSchemaByUrl(methodDocsUrl)` → schema at
`m.requestBody.content["application/json"].schema.properties` — names and types only, drill next
round; `$circular` stubs resolve via `s.components.schemas["<name>"]`.

### Management recipes — check before composing admin flows

~100 curated multi-step recipes (install apps, seed catalogs, set up whole verticals) from the
`wix-manage` skill. Drill in three steps — categories, a category's recipes, one recipe:

```js
// 1. what categories exist
const { base, files } = await (await fetch("https://dev.wix.com/docs/skills/manage.manifest.json")).json();
const cats = {};
for (const f of files) { const m = f.path.match(/^references\/([^/]+)\//); if (m) cats[m[1]] = (cats[m[1]] || 0) + 1; }
return cats;   // { stores: 9, bookings: 13, ecommerce: 24, cms: 7, "app-installation": 3, … }
```

```js
// 2. one category's recipes — names and descriptions are written for choosing
return files.filter(f => f.path.startsWith("references/stores/"))
            .map(f => ({ name: f.name, gist: (f.description || "").slice(0, 120), url: base + f.path, kb: Math.round(f.size / 1024) }));
```

```js
// 3. read the chosen recipe — whole when small, outline first when big
const text = await (await fetch(url)).text();   // url from step 2
if (text.length <= 4000) return text;
const lines = text.split("\n");
return { total: text.length, outline: lines.map((t, i) => /^#{1,3} /.test(t)
  ? { line: i + 1, text: t.slice(0, 80) } : null).filter(Boolean) };
```

```js
// 4. a big section is usually ONE fenced example (bulk-create's STEP 1: 897 lines, one fence) —
//    reduce it to its shape, window verbatim only where exact values matter
const sec = lines.slice(from - 1, to);   // bounds: this header's line → the next header's
const fields = [...new Set(sec.join("\n").match(/"([a-zA-Z][a-zA-Z0-9]*)":/g) || [])].map(s => s.slice(1, -2));
return { sectionLines: sec.length, fields };   // the request vocabulary in one round
```

A matching recipe beats composing the flow from single endpoints: it carries ordering and
cross-step gotchas no method page mentions.

## Write the code

**Response shapes obey the discover rule in every lane**: code against fields you saw in a live
response or the schema — remembered names are often from older versions. Probe one real row first.

### The visitor client — src/lib/wixClient.js

One file carries the whole visitor path; pages import it. Neither `clientId` (from the context
report) nor the minted token is a secret — together they are "an anonymous visitor", safe in
shipped code:

```js
// src/lib/wixClient.js
let visitorToken;
async function mint(body) {
  const res = await fetch("https://www.wixapis.com/oauth2/token", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const { access_token, refresh_token } = await res.json();   // expires_in: 14400s = 4h
  visitorToken = access_token;
  sessionStorage.setItem("wixRefresh", refresh_token);
}
// first visit:                 mint({ clientId: WIX_CLIENT_ID, grantType: "anonymous" });
// on expiry — same visitor:    mint({ refreshToken: sessionStorage.getItem("wixRefresh"),
//                                     grantType: "refresh_token" });
// (a fresh anonymous mint is a NEW visitor — the old one's cart goes with it)

const wix = (path, opts = {}) => fetch("https://www.wixapis.com" + path, { ...opts,
  headers: { Authorization: `Bearer ${visitorToken}`, "Content-Type": "application/json" } });

wix("/stores/v3/products/query", { method: "POST", body: JSON.stringify({ query: {} }) });
//  ↑ public reads included — the visitor token queries catalog directly
wix("/ecom/v1/carts/current");
wix("/ecom/v1/carts/current/create-checkout", { method: "POST", body: "{}" });
//  ↑ carts/current/* and checkout act on the CALLER's cart — only the visitor token
//    reaches the visitor's cart
```

Token contract: `…/headless/authentication/retrieve-tokens`.

### Admin calls — exec ad hoc, backend functions deployed

The admin token is the connector's; the same call works from exec (probing, managing) and from a
deployed `base44/functions/*` (work the app does as the owner). Project the response to facts:

```js
const { accessToken } = await base44.asServiceRole.connectors.getConnection("wix");
const r = await fetch("https://www.wixapis.com/contacts/v5/contacts/query", {   // spec-index publicUrl
  method: "POST",
  headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: { cursorPaging: { limit: 10 } } }),
});
if (!r.ok) return { status: r.status, error: (await r.text()).slice(0, 300) };
const data = await r.json();   // project, don't dump:
return { count: data.contacts?.length, keys: Object.keys(data.contacts?.[0] || {}) };
```
